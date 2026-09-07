import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FileRoot, UatOperationResponse, UatPreflightResponse } from '@/types/api-contracts';
import { errorMessage } from '@/types/frontend';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { Check, ChevronDown, Clipboard, FolderArchive, Loader2, LockKeyhole } from 'lucide-react';
import AdditionalConfigRequiredField from '@/components/AdditionalConfigRequiredField';
import FileBrowser from '@/components/FileBrowser';
import LockNotice from '@/components/LockNotice';
import PageTutorial from '@/components/PageTutorial';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormDescription, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Notice, Page } from '@/components/PagePrimitives';
import { usePortal } from '@/context/PortalContext';
import { uatBuildTutorialSteps } from '@/lib/pageTutorials';
import {
  convertUatBuild,
  getFileRoots,
  getWarApplications,
  isLockConflict,
  preflightUatBuild,
  releaseUatBuildLock,
  techDriveHeaders,
  uatBuildOperationEventUrl,
} from '@/lib/contractApi';

const supportedEvents = new Set(['UAT_BUILD_RUNNING', 'UAT_BUILD_COMPLETED', 'UAT_BUILD_FAILED']);
type RequestState = 'idle' | 'loading' | 'ready' | 'error';
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
type ConversionState = RequestState | 'starting' | 'running' | 'completed' | 'failed';
type RootsByKey = Partial<Record<FileRoot['key'], FileRoot>>;
const storageKeyFor = (username: string) => `uat-build-operation:${username}`;
const TUTORIAL_LOCK_ID = 'tutorial-uat-lock';
const tutorialSampleWar = 'tutorial/example.war';
const tutorialSampleJenkins = 'tutorial/exploded';
const tutorialPreflight = (): UatPreflightResponse => ({
  lockId: TUTORIAL_LOCK_ID,
  lockExpiresAt: new Date(Date.now() + 60000).toISOString(),
  lockTtlSeconds: 60,
  ready: false,
  decisionRequired: true,
  warnings: [],
  missingFromJenkinsFiles: ['WEB-INF/lib/uat-only.jar'],
  missingUatFiles: [],
  duplicateFiles: { 'web.xml': ['WEB-INF/web.xml', 'legacy/web.xml'] },
  automaticallyResolved: { 'application.properties': 'WEB-INF/classes/application.properties' },
});
const tutorialResult: UatOperationResponse = {
  operationId: 'tutorial-operation',
  status: 'COMPLETED',
  outputPath: 'tutorial/example.war',
  warFileName: 'example.war',
  sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

type UatTutorialSnapshot = {
  activeStep: number;
  application: string;
  source: string[];
  jenkinsDirectory: string[];
  additionalConfigRequired: boolean;
  preflight: UatPreflightResponse | null;
  duplicateSelections: Record<string, string>;
  lockId: string;
  conversionState: ConversionState;
  result: UatOperationResponse | null;
  notice: string;
  error: string;
};
const rootLabel = (root: FileRoot | string | null | undefined) =>
  typeof root === 'string' ? root : root?.path || 'Configured backend root';
const list = <T,>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);
const isUatOperationResponse = (value: unknown): value is UatOperationResponse =>
  value !== null &&
  typeof value === 'object' &&
  'operationId' in value &&
  typeof value.operationId === 'string' &&
  'status' in value &&
  (value.status === 'RUNNING' || value.status === 'COMPLETED' || value.status === 'FAILED');

export function techDrivePath(
  root: FileRoot | string | null | undefined,
  username: string,
  outputPath: string | null | undefined,
) {
  const [first, ...rest] = [rootLabel(root), username, outputPath];
  return [String(first).replace(/[\\/]+$/, ''), ...rest.map((part) => String(part || '').replace(/^[\\/]+|[\\/]+$/g, ''))]
    .filter(Boolean)
    .join('/');
}

export function allDuplicatesSelected(duplicateFiles: Record<string, string[]> = {}, selections: Record<string, string> = {}) {
  return Object.entries(duplicateFiles || {}).every(
    ([filename, candidates]) => Array.isArray(candidates) && candidates.includes(selections[filename]),
  );
}

export default function UatBuildPage() {
  const { username, findConflictingLock, lastSystemEvent, handleSessionRevoked } = usePortal();
  const [activeStep, setActiveStep] = useState(1);
  const [applications, setApplications] = useState<Array<{ application: string; warFileName: string; environments: string[] }>>(
    [],
  );
  const [application, setApplication] = useState('');
  const [applicationState, setApplicationState] = useState<RequestState>('loading');
  const [roots, setRoots] = useState<RootsByKey | null>(null);
  const [source, setSource] = useState<string[]>([]);
  const [jenkinsDirectory, setJenkinsDirectory] = useState<string[]>([]);
  const [additionalConfigRequired, setAdditionalConfigRequired] = useState(false);
  const [preflight, setPreflight] = useState<UatPreflightResponse | null>(null);
  const [preflightState, setPreflightState] = useState<RequestState>('idle');
  const [duplicateSelections, setDuplicateSelections] = useState<Record<string, string>>({});
  const [lockId, setLockId] = useState('');
  const [now, setNow] = useState(Date.now());
  const [operationId, setOperationId] = useState('');
  const [conversionState, setConversionState] = useState<ConversionState>('idle');
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [operationEvent, setOperationEvent] = useState<UatOperationResponse | null>(null);
  const [result, setResult] = useState<UatOperationResponse | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [streamWarning, setStreamWarning] = useState('');
  const [copyState, setCopyState] = useState('idle');
  const [streamRevision, setStreamRevision] = useState(0);
  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialApplicationOpen, setTutorialApplicationOpen] = useState(false);
  const lockRef = useRef('');
  const operationRef = useRef('');
  const conversionAcceptedRef = useRef(false);
  const tutorialSnapshotRef = useRef<UatTutorialSnapshot | null>(null);

  useEffect(() => {
    lockRef.current = lockId;
  }, [lockId]);
  useEffect(() => {
    operationRef.current = operationId;
  }, [operationId]);
  useEffect(() => {
    const event = lastSystemEvent;
    if (!event || !('eventType' in event)) return;
    const completedId = event.eventType === 'OPERATION_FINISHED' ? event.resources.operationId : event.deploymentId;
    if (event.eventType === 'OPERATION_FINISHED' && event.resources.section === 'UAT' && completedId === operationId) {
      setStreamRevision((current) => current + 1);
    }
  }, [lastSystemEvent, operationId]);

  useEffect(() => {
    setApplicationState('loading');
    Promise.all([getWarApplications(), getFileRoots()])
      .then(([apps, nextRoots]) => {
        const next = (Array.isArray(apps) ? apps : []).filter((item) => !item.environments || item.environments.includes('qc'));
        setApplications(next);
        setApplication((current) => current || next[0]?.application || '');
        setRoots(Object.fromEntries(nextRoots.map((root) => [root.key, root])));
        setApplicationState('ready');
      })
      .catch((reason: unknown) => {
        setApplicationState('error');
        setError(errorMessage(reason, 'Unable to load UAT build inputs.'));
      });
  }, []);

  useEffect(() => {
    if (!username || operationRef.current) return;
    const restored = sessionStorage.getItem(storageKeyFor(username)) || '';
    if (!restored) return;
    operationRef.current = restored;
    conversionAcceptedRef.current = true;
    setOperationId(restored);
    setConversionState('running');
    setActiveStep(2);
    setNotice('Restored an unfinished UAT build operation. Reconnecting to its status stream.');
  }, [username]);

  useEffect(
    () => () => {
      if (lockRef.current && lockRef.current !== TUTORIAL_LOCK_ID && !conversionAcceptedRef.current)
        releaseUatBuildLock(lockRef.current).catch(() => {});
    },
    [],
  );

  const lockTime = preflight?.lockExpiresAt ? new Date(preflight.lockExpiresAt).getTime() : 0;
  const remainingSeconds = lockTime ? Math.max(0, Math.ceil((lockTime - now) / 1000)) : 0;

  useEffect(() => {
    if (!lockId || !lockTime || conversionState === 'running') return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [conversionState, lockId, lockTime]);

  useEffect(() => {
    if (tutorialActive || !lockId || !lockTime || lockTime > now || conversionState === 'running') return;
    lockRef.current = '';
    setLockId('');
    setPreflight(null);
    setDuplicateSelections({});
    setActiveStep(1);
    setNotice('The write lock expired. Review the inputs and request a new lock.');
  }, [conversionState, lockId, lockTime, now, tutorialActive]);

  const clearStoredOperation = useCallback(() => {
    if (username) sessionStorage.removeItem(storageKeyFor(username));
  }, [username]);

  const finishOperation = useCallback(
    (event: UatOperationResponse) => {
      clearStoredOperation();
      conversionAcceptedRef.current = false;
      operationRef.current = '';
      lockRef.current = '';
      setOperationId('');
      setLockId('');
      setPreflight(null);
      setPreflightState('idle');
      setDuplicateSelections({});
      setConnectionState('disconnected');
      setStreamWarning('');
      setOperationEvent(event);
      setResult(event);
      setConversionState('completed');
      setActiveStep(3);
    },
    [clearStoredOperation],
  );

  const failOperation = useCallback(
    (event: UatOperationResponse) => {
      clearStoredOperation();
      conversionAcceptedRef.current = false;
      operationRef.current = '';
      lockRef.current = '';
      setOperationId('');
      setLockId('');
      setPreflight(null);
      setPreflightState('idle');
      setDuplicateSelections({});
      setConnectionState('disconnected');
      setStreamWarning('');
      setOperationEvent(event);
      setConversionState('failed');
      setError([event.message || 'UAT build conversion failed.', event.code].filter(Boolean).join(' · '));
      setActiveStep(2);
    },
    [clearStoredOperation],
  );

  useEffect(() => {
    if (!operationId || !username) return undefined;
    const controller = new AbortController();
    let disposed = false;
    let terminal = false;
    setConnectionState('connecting');
    setStreamWarning('');

    void fetchEventSource(uatBuildOperationEventUrl(operationId), {
      method: 'GET',
      headers: { ...techDriveHeaders(username), Accept: 'text/event-stream' },
      credentials: 'include',
      signal: controller.signal,
      openWhenHidden: true,
      onopen: async (response) => {
        if (response.status === 401) {
          handleSessionRevoked();
          throw new Error('Portal session ended');
        }
        if (!response.ok) throw new Error(`UAT build event stream returned ${response.status}`);
        if (!disposed) {
          setConnectionState('connected');
          setStreamWarning('');
        }
      },
      onmessage: (message) => {
        if (!supportedEvents.has(message.event)) return;
        try {
          const parsed: unknown = JSON.parse(message.data);
          if (!isUatOperationResponse(parsed) || disposed || parsed.operationId !== operationId) return;
          const event = parsed;
          setOperationEvent(event);
          if (message.event === 'UAT_BUILD_RUNNING') {
            setConversionState('running');
            return;
          }
          terminal = true;
          controller.abort();
          if (message.event === 'UAT_BUILD_COMPLETED') finishOperation(event);
          else failOperation(event);
        } catch {
          /* ignore malformed UAT build events */
        }
      },
      onclose: () => {
        if (controller.signal.aborted || terminal || disposed) return;
        setConnectionState('reconnecting');
        setStreamWarning('The UAT build status stream closed. Reconnecting…');
        throw new Error('UAT build event stream closed');
      },
      onerror: () => {
        if (controller.signal.aborted || terminal || disposed) return undefined;
        setConnectionState('reconnecting');
        setStreamWarning('Unable to receive UAT build status. Reconnecting…');
        return 3000;
      },
    }).catch(() => {
      if (!controller.signal.aborted && !terminal && !disposed) {
        setConnectionState('reconnecting');
        setStreamWarning('Unable to receive UAT build status. Reconnecting…');
      }
    });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [failOperation, finishOperation, handleSessionRevoked, operationId, streamRevision, username]);

  const releaseAndReset = useCallback((message = '') => {
    const currentLock = lockRef.current;
    lockRef.current = '';
    setLockId('');
    setPreflight(null);
    setPreflightState('idle');
    setDuplicateSelections({});
    setConversionState('idle');
    setResult(null);
    setOperationEvent(null);
    setActiveStep(1);
    setNotice(message);
    setError('');
    if (currentLock && currentLock !== TUTORIAL_LOCK_ID && !conversionAcceptedRef.current)
      releaseUatBuildLock(currentLock).catch((reason) =>
        setNotice(`Inputs were reset, but the lock could not be released: ${reason.message}`),
      );
  }, []);

  const changeInput = <T,>(setter: (value: T) => void, value: T) => {
    if (!tutorialActive && (lockRef.current || result)) releaseAndReset('Inputs changed. Request a new write lock to continue.');
    setter(value);
  };

  const startTutorial = useCallback(() => {
    tutorialSnapshotRef.current = {
      activeStep,
      application,
      source,
      jenkinsDirectory,
      additionalConfigRequired,
      preflight,
      duplicateSelections,
      lockId,
      conversionState,
      result,
      notice,
      error,
    };
    setTutorialActive(true);
    setTutorialApplicationOpen(true);
    setActiveStep(1);
  }, [
    activeStep,
    additionalConfigRequired,
    application,
    conversionState,
    duplicateSelections,
    error,
    jenkinsDirectory,
    lockId,
    notice,
    preflight,
    result,
    source,
  ]);

  const showTutorialStep = useCallback((step: number) => {
    setTutorialApplicationOpen(step === 0);
    if (step <= 3) setActiveStep(1);
    if (step >= 1) setSource((current) => (current[0] ? current : [tutorialSampleWar]));
    if (step >= 2) setJenkinsDirectory((current) => (current[0] ? current : [tutorialSampleJenkins]));
    if (step === 4 || step === 5) {
      const sample = tutorialPreflight();
      setActiveStep(2);
      setPreflight(sample);
      setPreflightState('ready');
      setDuplicateSelections({});
      setLockId(sample.lockId);
      lockRef.current = sample.lockId;
      setNow(Date.now());
      setResult(null);
      setConversionState('idle');
    }
    if (step === 6) {
      setActiveStep(3);
      setResult(tutorialResult);
      setConversionState('completed');
    }
    return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }, []);

  const resetTutorial = useCallback(() => {
    const snapshot = tutorialSnapshotRef.current;
    tutorialSnapshotRef.current = null;
    setTutorialActive(false);
    setTutorialApplicationOpen(false);
    if (!snapshot) return;
    lockRef.current = snapshot.lockId;
    setActiveStep(snapshot.activeStep);
    setApplication(snapshot.application);
    setSource(snapshot.source);
    setJenkinsDirectory(snapshot.jenkinsDirectory);
    setAdditionalConfigRequired(snapshot.additionalConfigRequired);
    setPreflight(snapshot.preflight);
    setDuplicateSelections(snapshot.duplicateSelections);
    setLockId(snapshot.lockId);
    setConversionState(snapshot.conversionState);
    setResult(snapshot.result);
    setNotice(snapshot.notice);
    setError(snapshot.error);
  }, []);

  const runPreflight = async () => {
    if (tutorialActive || !application || !source[0] || !jenkinsDirectory[0] || preflightState === 'loading') return;
    setPreflightState('loading');
    setError('');
    setNotice('');
    try {
      const response = await preflightUatBuild({
        application,
        sourceRootKey: 'techDrive',
        sourceWarPath: source[0],
        jenkinsRootKey: 'jenkinsBuild',
        jenkinsExplodedWarPath: jenkinsDirectory[0],
        additionalConfigRequired,
      });
      if (!response?.lockId || !response?.lockExpiresAt) throw new Error('The backend did not return a valid write lock.');
      setPreflight(response);
      setDuplicateSelections({});
      setLockId(response.lockId);
      lockRef.current = response.lockId;
      setNow(Date.now());
      setActiveStep(2);
      setPreflightState('ready');
    } catch (reason: unknown) {
      setPreflightState('error');
      setError(
        isLockConflict(reason)
          ? `Write lock conflict: ${errorMessage(reason)}`
          : errorMessage(reason, 'Unable to inspect UAT inputs.'),
      );
    }
  };

  const duplicates = useMemo(() => Object.entries(preflight?.duplicateFiles || {}), [preflight?.duplicateFiles]);
  const duplicatesComplete = allDuplicatesSelected(preflight?.duplicateFiles, duplicateSelections);
  const missingUatFiles = list(preflight?.missingUatFiles);

  const convert = async () => {
    if (
      tutorialActive ||
      !lockId ||
      lockId === TUTORIAL_LOCK_ID ||
      missingUatFiles.length ||
      !duplicatesComplete ||
      ['starting', 'running'].includes(conversionState)
    )
      return;
    setConversionState('starting');
    setError('');
    setStreamWarning('');
    try {
      const response = await convertUatBuild({ lockId, duplicateSelections });
      if (!response?.operationId) throw new Error('The backend accepted conversion without returning an operation ID.');
      conversionAcceptedRef.current = true;
      operationRef.current = response.operationId;
      sessionStorage.setItem(storageKeyFor(username), response.operationId);
      setOperationEvent({ ...response, status: response.status || 'RUNNING' });
      setConversionState('running');
      setOperationId(response.operationId);
    } catch (reason: unknown) {
      setConversionState('idle');
      const message = errorMessage(reason, 'Unable to create UAT build.');
      setError(message);
      if (
        reason !== null &&
        typeof reason === 'object' &&
        'status' in reason &&
        (reason.status === 404 || reason.status === 410 || reason.status === 423)
      )
        releaseAndReset(message);
    }
  };

  const opmMessage = result
    ? `Scan the war from below location and place in <clientName> SFTP.\n\ntechDrive: ${techDrivePath(roots?.techDrive, username, result.outputPath || result.warFileName)}\nHash: ${result.sha256 || ''}`
    : '';
  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(opmMessage);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  const uatLock = findConflictingLock?.({ section: 'UAT', profile: jenkinsDirectory[0], mode: 'WRITE' });
  const canPreflight =
    !tutorialActive &&
    application &&
    source[0] &&
    jenkinsDirectory[0] &&
    preflightState !== 'loading' &&
    !operationId &&
    !uatLock;
  const canConvert =
    !tutorialActive &&
    !!lockId &&
    lockId !== TUTORIAL_LOCK_ID &&
    !missingUatFiles.length &&
    duplicatesComplete &&
    !['starting', 'running'].includes(conversionState);
  const convertLabel =
    conversionState === 'running'
      ? 'Creating UAT build…'
      : conversionState === 'starting'
        ? 'Starting…'
        : lockId && remainingSeconds
          ? `Convert (${remainingSeconds})`
          : 'Convert';

  return (
    <Page
      title="Create UAT build"
      description="Combine UAT configuration with a Jenkins exploded WAR, package the result, and generate its SHA-256 hash."
      headerAction={
        <PageTutorial
          steps={uatBuildTutorialSteps}
          disabled={!!operationId}
          onStart={startTutorial}
          onStepPrepare={showTutorialStep}
          onReset={resetTutorial}
        />
      }
    >
      <div className="space-y-4">
        {notice && <Notice tone="warning">{notice}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <LockNotice lock={uatLock} />

        <StepCard
          number={1}
          title="Select build inputs"
          active={activeStep === 1}
          available={!operationId}
          onOpen={() => setActiveStep(1)}
          summary={
            application && source[0] && jenkinsDirectory[0]
              ? `${application} · ${source[0]} · ${jenkinsDirectory[0]}`
              : 'Choose an application, UAT WAR, and Jenkins directory.'
          }
        >
          <div className="space-y-5">
            <FormItem data-tour="uat-application">
              <FormLabel>Application</FormLabel>
              <Select
                value={application}
                open={tutorialActive ? tutorialApplicationOpen : undefined}
                onOpenChange={(open) => {
                  if (tutorialActive) setTutorialApplicationOpen(open);
                }}
                onValueChange={(value) => {
                  if (!tutorialActive) changeInput(setApplication, value);
                }}
                disabled={applicationState === 'loading'}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select application" />
                </SelectTrigger>
                <SelectContent>
                  {applications.map((item) => (
                    <SelectItem key={item.application} value={item.application}>
                      {item.application}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
            <div className="grid gap-5 xl:grid-cols-2">
              <div data-tour="uat-source" className="space-y-3">
                <BrowserPanel
                  title="UAT WAR or ZIP from Tech Drive"
                  description={roots?.techDrive ? `Root: ${rootLabel(roots.techDrive)}` : 'Select one .war or .zip file.'}
                >
                  <FileBrowser
                    rootKey="techDrive"
                    selectableType="file"
                    selectableExtension={['.war', '.zip']}
                    selected={source}
                    onSelectionChange={(items) => changeInput(setSource, items.slice(-1))}
                  />
                  {source[0] && (
                    <FormDescription>
                      Selected: <span className="font-mono text-foreground">{source[0]}</span>
                    </FormDescription>
                  )}
                </BrowserPanel>
                <AdditionalConfigRequiredField
                  sourceLabel="archive"
                  checked={additionalConfigRequired}
                  disabled={tutorialActive}
                  onCheckedChange={(checked) => changeInput(setAdditionalConfigRequired, checked)}
                />
              </div>
              <div data-tour="uat-jenkins">
                <BrowserPanel
                  title="Jenkins exploded WAR"
                  description={roots?.jenkinsBuild ? `Root: ${rootLabel(roots.jenkinsBuild)}` : 'Select one directory.'}
                >
                  <FileBrowser
                    rootKey="jenkinsBuild"
                    selectableType="directory"
                    selected={jenkinsDirectory}
                    onSelectionChange={(items) => changeInput(setJenkinsDirectory, items.slice(-1))}
                  />
                  {jenkinsDirectory[0] && (
                    <FormDescription>
                      Selected: <span className="font-mono text-foreground">{jenkinsDirectory[0]}</span>
                    </FormDescription>
                  )}
                </BrowserPanel>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                The backend will exclusively lock both selected paths for the returned duration.
              </p>
              <Button type="button" className="gap-2" disabled={!canPreflight} onClick={runPreflight} data-tour="uat-inspect">
                {preflightState === 'loading' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LockKeyhole className="h-4 w-4" />
                )}
                {preflightState === 'loading' ? 'Inspecting…' : 'Inspect and lock'}
              </Button>
            </div>
          </div>
        </StepCard>

        <StepCard
          number={2}
          title="Review UAT build"
          tour="uat-review"
          active={activeStep === 2}
          available={!!preflight || !!operationId || conversionState === 'failed'}
          onOpen={() => setActiveStep(2)}
          summary={
            preflight
              ? `${duplicates.length} duplicate(s) · ${missingUatFiles.length} blocking · ${remainingSeconds}s remaining`
              : operationId
                ? `Operation ${operationId}`
                : 'Available after the backend grants a write lock.'
          }
        >
          <div className="space-y-4">
            {lockId && (
              <Notice tone={remainingSeconds <= 30 ? 'warning' : 'info'}>
                <strong>Write lock: {remainingSeconds}s remaining.</strong>
              </Notice>
            )}
            {preflight && (
              <Notice tone={preflight.ready ? 'success' : preflight.decisionRequired ? 'warning' : 'info'}>
                {preflight.ready
                  ? 'Preflight is ready.'
                  : preflight.decisionRequired
                    ? 'Resolve every duplicate filename before conversion.'
                    : 'Review the preflight result before conversion.'}
              </Notice>
            )}
            {preflight && preflight.warnings.length > 0 && (
              <PathList title="Warnings" paths={preflight.warnings} tone="warning" />
            )}
            {preflight && preflight.missingFromJenkinsFiles.length > 0 && (
              <PathList
                title="Present in UAT but missing from Jenkins"
                paths={preflight.missingFromJenkinsFiles}
                tone="error"
                description="These files will be copied from UAT automatically and require no action."
              />
            )}
            {missingUatFiles.length > 0 && (
              <PathList
                title="Missing required UAT files"
                paths={missingUatFiles}
                tone="error"
                description="Conversion is blocked until these files are available in the UAT WAR."
              />
            )}
            {preflight && Object.keys(preflight.automaticallyResolved).length > 0 && (
              <Notice>
                <strong>Automatically resolved</strong>
                {Object.entries(preflight.automaticallyResolved).map(([file, path]) => (
                  <div className="mt-1 break-all font-mono text-xs" key={file}>
                    {file} → {path}
                  </div>
                ))}
              </Notice>
            )}
            {duplicates.map(([file, candidates]) => (
              <FormItem key={file}>
                <FormLabel>Resolve duplicate: {file}</FormLabel>
                <Select
                  value={duplicateSelections[file] || ''}
                  onValueChange={(value) => setDuplicateSelections((current) => ({ ...current, [file]: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose the exact candidate path" />
                  </SelectTrigger>
                  <SelectContent>
                    {list(candidates).map((path) => (
                      <SelectItem key={path} value={path}>
                        {path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!list(candidates).includes(duplicateSelections[file]) && <FormMessage>A selection is required.</FormMessage>}
              </FormItem>
            ))}
            {operationId && (
              <Notice tone={connectionState === 'connected' ? 'info' : 'warning'}>
                <strong>UAT build {operationEvent?.status?.toLowerCase() || 'running'}.</strong> Status stream: {connectionState}.
                {operationEvent?.message && <div className="mt-1">{operationEvent.message}</div>}
              </Notice>
            )}
            {streamWarning && <Notice tone="warning">{streamWarning}</Notice>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {missingUatFiles.length
                  ? `${missingUatFiles.length} required UAT file(s) are missing.`
                  : duplicatesComplete
                    ? 'All blocking decisions are complete.'
                    : 'Select one candidate for every duplicate filename.'}
              </p>
              <Button type="button" className="gap-2" disabled={!canConvert} onClick={convert} data-tour="uat-convert">
                {['starting', 'running'].includes(conversionState) ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderArchive className="h-4 w-4" />
                )}
                {convertLabel}
              </Button>
            </div>
          </div>
        </StepCard>

        <StepCard
          number={3}
          title="Copy OPM message"
          tour="uat-opm"
          active={activeStep === 3}
          available={!!result}
          onOpen={() => setActiveStep(3)}
          summary={result ? 'UAT build created and SHA-256 generated.' : 'Available when conversion completes.'}
        >
          <div className="space-y-3">
            <div className="relative rounded-lg border border-border bg-muted/30 p-4 pr-14">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="absolute right-3 top-3"
                aria-label="Copy OPM message"
                onClick={copyMessage}
              >
                <Clipboard className="h-4 w-4" />
              </Button>
              <p className="mb-2 text-sm font-medium">Copy and paste this message on OPM:</p>
              {result?.warFileName && (
                <p className="mb-2 break-all text-sm">
                  WAR: <span className="font-mono">{result.warFileName}</span>
                </p>
              )}
              <pre className="whitespace-pre-wrap break-all font-mono text-sm">{opmMessage}</pre>
            </div>
            {copyState === 'copied' && (
              <p className="flex items-center gap-2 text-sm text-green-700">
                <Check className="h-4 w-4" />
                Copied to clipboard.
              </p>
            )}
            {copyState === 'error' && (
              <Notice tone="error">Clipboard access failed. Select and copy the message manually.</Notice>
            )}
          </div>
        </StepCard>
      </div>
    </Page>
  );
}

function StepCard({
  number,
  title,
  active,
  available,
  onOpen,
  summary,
  tour,
  children,
}: {
  number: number;
  title: string;
  active: boolean;
  available: boolean;
  onOpen: () => void;
  summary: string;
  tour?: string;
  children: ReactNode;
}) {
  return (
    <Card className={active ? 'border-primary/40 shadow-glow' : ''} data-tour={tour}>
      <button
        type="button"
        className="flex w-full items-center gap-4 p-5 text-left disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!available}
        aria-expanded={active}
        onClick={onOpen}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
        >
          {number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${active ? 'rotate-180' : ''}`} />
      </button>
      {active && <CardContent className="border-t border-border pt-5">{children}</CardContent>}
    </Card>
  );
}

function BrowserPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function PathList({
  title,
  paths,
  tone,
  description,
}: {
  title: string;
  paths: string[];
  tone: 'info' | 'success' | 'warning' | 'error';
  description?: string;
}) {
  return (
    <Notice tone={tone}>
      <strong>{title}</strong>
      {description && <p className="mt-1">{description}</p>}
      <ul className="ml-5 mt-1 list-disc">
        {list(paths).map((path) => (
          <li className="break-all font-mono text-xs" key={path}>
            {path}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

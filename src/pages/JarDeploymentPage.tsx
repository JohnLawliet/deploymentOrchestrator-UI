import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JarApplication, PortStatus } from '@/types/api-contracts';
import type { FrontendProfileActivityModel, RuntimeActivityModel } from '@/types/frontend';
import { errorMessage } from '@/types/frontend';
import { Loader2, Package, Rocket } from 'lucide-react';
import FileBrowser from '@/components/FileBrowser';
import SearchableProfileSelect from '@/components/SearchableProfileSelect';
import { deployJar, fetchJarBat, getJars, getPortStatus, isLockConflict } from '@/lib/contractApi';
import { generatedJarCommand, isValidJarApplicationName, jarApplicationNameFromPath } from '@/lib/jarContract';
import { isOperationTerminal } from '@/lib/operationProgress';
import { normalizeRuntimeActivity, overlayRuntimeActivity } from '@/lib/runtimeActivity';
import { usePortal } from '@/context/PortalContext';
import JarFrontendDetails, { hasAuthoritativeFrontendAssociation } from '@/components/JarFrontendDetails';
import LockNotice from '@/components/LockNotice';
import PageTutorial from '@/components/PageTutorial';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormItem, FormLabel } from '@/components/ui/form';
import { Choice, Field, Notice, Page } from '@/components/PagePrimitives';
import type { LockScope } from '@/lib/collaborationState';
import { jarTutorialSteps } from '@/lib/pageTutorials';

const FRONTEND_MODES = { REUSE: 'REUSE_ASSOCIATION', DEPLOY: 'DEPLOY' } as const;
type FrontendMode = (typeof FRONTEND_MODES)[keyof typeof FRONTEND_MODES] | null;
const frontendModeOptions: ReadonlyArray<readonly [Exclude<FrontendMode, null>, string]> = [
  [FRONTEND_MODES.REUSE, 'Use existing frontend association'],
  [FRONTEND_MODES.DEPLOY, 'Deploy to frontend'],
];
type ApplicationSelection = { type: 'existing'; id: string; name: string } | { type: 'new'; name: string };
type TutorialFormState = {
  applicationName: string;
  applicationSelection: ApplicationSelection | null;
  source: string[];
  provideScript: boolean;
  javaPath: string;
  includeFrontend: boolean;
  frontendMode: FrontendMode;
  frontendSources: string[];
  confirmReassociation: boolean;
  port: string;
  portTouched: boolean;
  healthUrl: string;
  frontendQuery: string;
  frontendProfileUuid: string;
  frontendSelectionStale: boolean;
};
const normalized = (value: unknown) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase();
const frontendLauncherComments = (profile: FrontendProfileActivityModel | null | undefined) =>
  profile
    ? [`REM Frontend profile: ${profile.profileName}`, `REM Frontend document root: ${profile.documentRoot || 'Not configured'}`]
    : [];

export default function JarDeploymentPage() {
  const {
    jarProfileActivityMap,
    frontendProfileActivityMap,
    operations,
    lastSystemEvent,
    snapshotRevision,
    reconcileResourceActivity,
    registerOperation,
    findConflictingLock,
  } = usePortal();
  const [jars, setJars] = useState<Array<JarApplication & RuntimeActivityModel>>([]);
  const [applicationName, setApplicationName] = useState('');
  const [applicationSelection, setApplicationSelection] = useState<ApplicationSelection | null>(null);
  const [source, setSource] = useState<string[]>([]);
  const [provideScript, setProvideScript] = useState(false);
  const [javaPath, setJavaPath] = useState('');
  const [existingBat, setExistingBat] = useState('');
  const [batLoading, setBatLoading] = useState(false);
  const [batError, setBatError] = useState('');
  const [includeFrontend, setIncludeFrontend] = useState(false);
  const [frontendMode, setFrontendMode] = useState<FrontendMode>(null);
  const [frontendSources, setFrontendSources] = useState<string[]>([]);
  const [confirmReassociation, setConfirmReassociation] = useState(false);
  const [port, setPort] = useState('');
  const [portTouched, setPortTouched] = useState(false);
  const [healthUrl, setHealthUrl] = useState('');
  const [portStatus, setPortStatus] = useState<PortStatus | null>(null);
  const [portChecking, setPortChecking] = useState(false);
  const [portCheckError, setPortCheckError] = useState('');
  const [portRefresh, setPortRefresh] = useState(0);
  const [frontendQuery, setFrontendQuery] = useState('');
  const [frontendProfileUuid, setFrontendProfileUuid] = useState('');
  const [frontendSelectionStale, setFrontendSelectionStale] = useState(false);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [structuredDeploymentError, setStructuredDeploymentError] = useState(false);
  const [pendingOperationId, setPendingOperationId] = useState('');
  const [tutorialActive, setTutorialActive] = useState(false);
  const submissionGuard = useRef(false);
  const portRequestSequence = useRef(0);
  const pendingSnapshotRevision = useRef(0);
  const tutorialFormState = useRef<TutorialFormState | null>(null);

  useEffect(() => {
    let disposed = false;
    getJars()
      .then((response) => {
        if (disposed) return;
        const items = response.jars;
        const next = (Array.isArray(items) ? items : [])
          .map((item) => {
            const normalized = normalizeRuntimeActivity({
              ...item,
              resourceType: 'JAR',
            });
            return normalized?.id && normalized.applicationName ? { ...item, ...normalized } : null;
          })
          .filter((item): item is JarApplication & RuntimeActivityModel => item !== null);
        setJars(next);
      })
      .catch((reason: unknown) => {
        if (!disposed) setCatalogueError(errorMessage(reason, 'Unable to load JAR catalogue.'));
      })
      .finally(() => {
        if (!disposed) setCatalogueLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const trimmedApplicationName = applicationName.trim();
  const applicationNameValid = isValidJarApplicationName(trimmedApplicationName);
  const applicationCommitted = applicationSelection?.name === trimmedApplicationName;
  const selected = applicationSelection?.type === 'existing' ? jars.find((item) => item.id === applicationSelection.id) : null;
  const activity = selected ? overlayRuntimeActivity(selected, jarProfileActivityMap[selected.id]) : null;
  const active = activity?.status === 'ACTIVE';
  const profileBusy = ['STARTING', 'STOPPING', 'DEPLOYING'].includes(activity?.status ?? '');
  const frontendProfiles = useMemo(() => Object.values(frontendProfileActivityMap || {}), [frontendProfileActivityMap]);
  const firstFrontendProfile = frontendProfiles[0];
  const selectedFrontend = frontendProfiles.find((profile) => profile.profileUuid === frontendProfileUuid);
  const frontendAssociation = activity && hasAuthoritativeFrontendAssociation(activity) ? activity.frontendProfile : null;
  const selectedFrontendOwnerMatches =
    selectedFrontend &&
    (selectedFrontend.jarProfileUuid === selected?.id ||
      normalized(selectedFrontend.applicationName) === normalized(selected?.applicationName));
  const reassociationRequired = Boolean(selectedFrontend?.jarProfileUuid && !selectedFrontendOwnerMatches);
  const portNumber = Number(port);
  const portValid = /^\d+$/.test(port) && Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  const frontendProfileValid =
    !includeFrontend ||
    (frontendMode === FRONTEND_MODES.REUSE && !!selected && !!frontendAssociation) ||
    (frontendMode === FRONTEND_MODES.DEPLOY &&
      !!selectedFrontend &&
      frontendSources.length > 0 &&
      (!reassociationRequired || confirmReassociation));
  const reuseExistingLauncher = !provideScript;
  const savedLauncherPort = activity?.applicationPort;
  const savedJavaExecutablePath = activity?.javaExecutablePath;
  const launcherCommand = generatedJarCommand(trimmedApplicationName, port, javaPath);
  const launcherFrontend =
    provideScript && includeFrontend && frontendMode === FRONTEND_MODES.REUSE
      ? frontendAssociation
      : provideScript && includeFrontend && frontendMode === FRONTEND_MODES.DEPLOY
        ? selectedFrontend
        : null;
  const launcherPreview = [...(provideScript ? [launcherCommand] : [existingBat]), ...frontendLauncherComments(launcherFrontend)]
    .filter(Boolean)
    .join('\r\n');
  const deploymentPort = provideScript ? port : String(savedLauncherPort ?? '');
  const deploymentPortNumber = Number(deploymentPort);
  const deploymentPortValid =
    /^\d+$/.test(deploymentPort) &&
    Number.isInteger(deploymentPortNumber) &&
    deploymentPortNumber >= 1 &&
    deploymentPortNumber <= 65535;
  const jarScopes: LockScope[] = [
    {
      resourceKey: `profile:${selected?.id || trimmedApplicationName}`,
      section: 'JAR',
      profile: selected?.applicationName || trimmedApplicationName,
      mode: 'WRITE' as const,
    },
    ...(deploymentPortValid
      ? [
          {
            resourceKey: `port:${deploymentPortNumber}`,
            section: 'JAR',
            profile: selected?.applicationName || trimmedApplicationName,
            mode: 'WRITE' as const,
          },
        ]
      : []),
    ...(source[0]
      ? [
          {
            resourceKey: `file:techDrive:${source[0]}`,
            section: 'FILE',
            profile: 'techDrive',
            mode: 'WRITE' as const,
          },
        ]
      : []),
    ...(includeFrontend && frontendMode === FRONTEND_MODES.DEPLOY && selectedFrontend
      ? [
          {
            resourceKey: `profile:${selectedFrontend.profileUuid}`,
            section: 'FRONTEND',
            profile: selectedFrontend.profileName,
            mode: 'WRITE' as const,
          },
        ]
      : []),
    ...frontendSources.map((path) => ({
      resourceKey: `file:techDrive:${path}`,
      section: 'FILE',
      profile: 'techDrive',
      mode: 'WRITE' as const,
    })),
  ];
  const jarLock = findConflictingLock?.(jarScopes);

  useEffect(() => {
    const sequence = ++portRequestSequence.current;
    setPortStatus(null);
    setPortCheckError('');
    setPortChecking(false);
    if (!deploymentPortValid || !applicationNameValid || !applicationCommitted) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPortChecking(true);
      getPortStatus(deploymentPortNumber, trimmedApplicationName, controller.signal)
        .then((status) => {
          if (sequence === portRequestSequence.current && !controller.signal.aborted) setPortStatus(status);
        })
        .catch((reason) => {
          if (sequence === portRequestSequence.current && !controller.signal.aborted) {
            setPortCheckError(reason.message || 'Unable to inspect the port');
          }
        })
        .finally(() => {
          if (sequence === portRequestSequence.current && !controller.signal.aborted) setPortChecking(false);
        });
    }, 800);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    deploymentPortNumber,
    deploymentPortValid,
    trimmedApplicationName,
    applicationNameValid,
    applicationCommitted,
    portRefresh,
    lastSystemEvent,
  ]);

  useEffect(() => {
    if (provideScript || !selected || !applicationNameValid) {
      setExistingBat('');
      setBatError('');
      setBatLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setBatLoading(true);
    setBatError('');
    fetchJarBat(trimmedApplicationName, controller.signal)
      .then((script) => {
        if (!controller.signal.aborted) setExistingBat(script);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setExistingBat('');
          setBatError(errorMessage(reason, 'Unable to fetch the existing launcher file.'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBatLoading(false);
      });
    return () => controller.abort();
  }, [provideScript, selected, applicationNameValid, trimmedApplicationName]);

  useEffect(() => {
    if (selected?.id) reconcileResourceActivity(`JAR:${selected.id}`).catch(() => {});
  }, [selected?.id, reconcileResourceActivity]);

  useEffect(() => {
    if (!frontendProfileUuid || selectedFrontend) return;
    setFrontendProfileUuid('');
    setFrontendQuery('');
    setFrontendSelectionStale(true);
  }, [frontendProfileUuid, selectedFrontend]);

  useEffect(() => {
    if (!pendingOperationId) return;
    const pending = operations[pendingOperationId];
    if (
      activity?.activeOperationId === pendingOperationId ||
      (pending && isOperationTerminal(pending)) ||
      snapshotRevision > pendingSnapshotRevision.current
    ) {
      setPendingOperationId('');
    }
  }, [pendingOperationId, activity?.activeOperationId, operations, snapshotRevision]);

  const applyApplicationNameFromJar = useCallback(
    (path: string) => {
      const derived = path ? jarApplicationNameFromPath(path) : '';
      if (!derived) {
        setApplicationName('');
        setApplicationSelection(null);
        setFrontendMode(null);
        return;
      }
      if (!isValidJarApplicationName(derived)) {
        setApplicationName(derived);
        setApplicationSelection(null);
        return;
      }
      const match = jars.find((jar) => normalized(jar.applicationName) === normalized(derived));
      setApplicationName(match ? match.applicationName : derived);
      setApplicationSelection(
        match ? { type: 'existing', id: match.id, name: match.applicationName } : { type: 'new', name: derived },
      );
      setFrontendMode(null);
    },
    [jars],
  );

  const selectSource = (items: string[]) => {
    const next = items.slice(-1);
    setSource(next);
    applyApplicationNameFromJar(next[0] || '');
  };

  useEffect(() => {
    if (!source[0]) return;
    applyApplicationNameFromJar(source[0]);
  }, [source, jars, applyApplicationNameFromJar]);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (
      !applicationCommitted ||
      !applicationNameValid ||
      !source[0] ||
      !deploymentPortValid ||
      portChecking ||
      !portStatus?.deploymentAllowed ||
      !frontendProfileValid ||
      tutorialActive ||
      submitting ||
      pendingOperationId ||
      profileBusy ||
      jarLock ||
      submissionGuard.current
    )
      return;
    if (active && !window.confirm(`${trimmedApplicationName} is currently active. Continue with redeployment?`)) return;
    submissionGuard.current = true;
    setSubmitting(true);
    setError('');
    setStructuredDeploymentError(false);
    try {
      const frontend: import('@/types/api-contracts').JarFrontendDeployment = !includeFrontend
        ? { mode: 'NONE' }
        : frontendMode === FRONTEND_MODES.REUSE
          ? { mode: FRONTEND_MODES.REUSE, catalogueJarId: selected?.id ?? null }
          : {
              mode: FRONTEND_MODES.DEPLOY,
              profileUuid: selectedFrontend?.profileUuid ?? null,
              sourceRootKey: 'techDrive',
              sourcePaths: frontendSources,
              ...(reassociationRequired ? { confirmReassociation: true } : {}),
            };
      const operation = await deployJar({
        applicationName: trimmedApplicationName,
        ...(selected ? { catalogueJarId: selected.id } : {}),
        sourcePath: source[0],
        launcher: provideScript
          ? {
              mode: 'GENERATE_AND_SAVE',
              port: deploymentPortNumber,
              javaExecutablePath: javaPath.trim() || null,
            }
          : { mode: 'REUSE_EXISTING' },
        ...(healthUrl.trim() ? { healthUrl: healthUrl.trim() } : {}),
        frontend,
      });
      if (!operation?.deploymentId) throw new Error('The backend did not return a deployment ID.');
      pendingSnapshotRevision.current = snapshotRevision;
      setPendingOperationId(operation.deploymentId);
      registerOperation(
        {
          ...operation,
          resourceType: 'JAR',
          applicationName: trimmedApplicationName,
          operationType: 'JAR_DEPLOY',
          frontendDeploymentRequested: frontendMode === FRONTEND_MODES.DEPLOY,
        },
        `JAR:${selected?.id || trimmedApplicationName}`,
        `Deploy JAR · ${trimmedApplicationName}${frontendMode === FRONTEND_MODES.DEPLOY ? ` + ${selectedFrontend?.profileName || ''}` : ''}`,
      );
    } catch (reason: unknown) {
      setStructuredDeploymentError(
        isLockConflict(reason) &&
          (reason.code === 'INVALID_HEALTH_URL' || (reason.status === 400 && reason.code === 'JAR_NOT_EXECUTABLE')),
      );
      setError(isLockConflict(reason) ? `Application conflict: ${errorMessage(reason)}` : errorMessage(reason));
      if (isLockConflict(reason) && (reason.code === 'PORT_OCCUPIED' || reason.code === 'PORT_STATE_CHANGED')) {
        setPortStatus(null);
        setPortRefresh((current) => current + 1);
      }
    } finally {
      submissionGuard.current = false;
      setSubmitting(false);
    }
  };

  const startJarTutorial = useCallback(() => {
    tutorialFormState.current = {
      applicationName,
      applicationSelection,
      source: [...source],
      provideScript,
      javaPath,
      includeFrontend,
      frontendMode,
      frontendSources: [...frontendSources],
      confirmReassociation,
      port,
      portTouched,
      healthUrl,
      frontendQuery,
      frontendProfileUuid,
      frontendSelectionStale,
    };
    setTutorialActive(true);
  }, [
    applicationName,
    applicationSelection,
    confirmReassociation,
    frontendMode,
    frontendProfileUuid,
    frontendQuery,
    frontendSelectionStale,
    frontendSources,
    healthUrl,
    includeFrontend,
    javaPath,
    port,
    portTouched,
    provideScript,
    source,
  ]);

  const resetJarTutorial = useCallback(() => {
    const saved = tutorialFormState.current;
    tutorialFormState.current = null;
    setTutorialActive(false);
    if (!saved) return;
    setApplicationName(saved.applicationName);
    setApplicationSelection(saved.applicationSelection);
    setSource(saved.source);
    setProvideScript(saved.provideScript);
    setJavaPath(saved.javaPath);
    setIncludeFrontend(saved.includeFrontend);
    setFrontendMode(saved.frontendMode);
    setFrontendSources(saved.frontendSources);
    setConfirmReassociation(saved.confirmReassociation);
    setPort(saved.port);
    setPortTouched(saved.portTouched);
    setHealthUrl(saved.healthUrl);
    setFrontendQuery(saved.frontendQuery);
    setFrontendProfileUuid(saved.frontendProfileUuid);
    setFrontendSelectionStale(saved.frontendSelectionStale);
  }, []);

  const changeJarTutorialStep = useCallback(
    (index: number) => {
      if (!tutorialFormState.current) return;
      if (index === 2 || index === 3 || index === 4 || index === 5 || index === 6) {
        setProvideScript(true);
        return;
      }
      if (index === 7) {
        setProvideScript(false);
        return;
      }
      if (index === 8) {
        setIncludeFrontend(true);
        setFrontendMode(null);
        setConfirmReassociation(false);
        return;
      }
      if (index === 9) {
        setIncludeFrontend(true);
        setFrontendMode(FRONTEND_MODES.DEPLOY);
        setConfirmReassociation(false);
        return;
      }
      if (index === 10 || index === 11 || index === 12 || index === 13) {
        setIncludeFrontend(true);
        setFrontendMode(FRONTEND_MODES.DEPLOY);
        setConfirmReassociation(false);
        if (firstFrontendProfile) {
          setFrontendProfileUuid(firstFrontendProfile.profileUuid);
          setFrontendQuery(firstFrontendProfile.profileName);
          setFrontendSelectionStale(false);
        } else {
          setFrontendProfileUuid('');
          setFrontendQuery('');
        }
      }
    },
    [firstFrontendProfile],
  );

  const formInvalid =
    !applicationCommitted ||
    !applicationNameValid ||
    !source[0] ||
    !deploymentPortValid ||
    (reuseExistingLauncher && (!selected || batLoading || !!batError || !existingBat)) ||
    portChecking ||
    !portStatus?.deploymentAllowed ||
    !frontendProfileValid ||
    !!jarLock;
  const formDisabled = tutorialActive || submitting || !!pendingOperationId;

  return (
    <Page
      title="Deploy JAR"
      description="Deploy a backend application from a JAR in your Tech Drive."
      headerAction={
        <PageTutorial
          steps={jarTutorialSteps}
          onStart={startJarTutorial}
          onReset={resetJarTutorial}
          onStepChange={changeJarTutorialStep}
        />
      }
    >
      <Card className="w-full shadow-glow">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            JAR deployment
          </CardTitle>
          <CardDescription>
            Choose a Tech Drive-relative JAR to derive the application name, then set the runtime port.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-5">
            <LockNotice lock={jarLock} />
            <div data-tour="jar-source">
              <p className="text-sm font-medium mb-2">JAR from Tech Drive</p>
              <FileBrowser
                rootKey="techDrive"
                selectableExtension=".jar"
                selected={source}
                onSelectionChange={selectSource}
                disabled={formDisabled}
              />
              {source[0] && (
                <p className="help mt-2">
                  Selected: <span className="font-mono text-foreground">{source[0]}</span>
                </p>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2 md:items-end" data-tour="jar-runtime">
              <div data-tour="jar-application-name">
                <Field label="Application name (required)">
                  <Input
                    readOnly
                    value={applicationName}
                    placeholder="Select a Jar from techDrive"
                    aria-label="Application name (required)"
                    disabled={formDisabled}
                  />
                </Field>
              </div>
              <Choice
                label="Provide launcher settings?"
                value={provideScript}
                onChange={setProvideScript}
                yes="Yes, include launcher settings"
                no="No, reuse existing launcher"
                yesDataTour="jar-launcher-yes"
                noDataTour="jar-launcher-no"
                disabled={formDisabled}
              />
            </div>
            <div data-tour="jar-health-url">
              <Field label="Health URL (optional)">
                <Input
                  value={healthUrl}
                  onChange={(event) => setHealthUrl(event.target.value)}
                  placeholder="https://application.example/actuator/health"
                  disabled={formDisabled}
                />
              </Field>
            </div>
            {source[0] && (!applicationNameValid || !applicationCommitted) && (
              <Notice tone="error">
                {!applicationNameValid
                  ? 'The selected JAR filename must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.'
                  : 'Unable to derive a valid application name from the selected JAR.'}
              </Notice>
            )}
            {provideScript && portTouched && !portValid && (
              <Notice tone="error">{port === '' ? 'Port is required.' : 'Port must be a whole number from 1 to 65535.'}</Notice>
            )}
            {!catalogueLoading && !jars.length && !catalogueError && !source[0] && (
              <Notice>
                No existing JAR applications were returned. Select a JAR from Tech Drive to derive the application name.
              </Notice>
            )}
            {catalogueError && (
              <Notice tone="warning">
                Existing applications could not be loaded: {catalogueError}. A new deployment can still be submitted.
              </Notice>
            )}
            {active && (
              <Notice tone="warning">This application is currently ACTIVE. You will be asked to confirm redeployment.</Notice>
            )}
            {profileBusy && (
              <Notice tone="warning">
                This application is currently {activity?.status?.toLowerCase() || 'changing state'}. Another deployment cannot
                start yet.
              </Notice>
            )}
            {pendingOperationId && <Notice>Deployment request accepted. Waiting for backend activity…</Notice>}
            {activity?.health === 'MISSING' && (
              <Notice tone="error">
                <strong>MISSING</strong> — the configured runtime resource was not found. Deployment is still available.
              </Notice>
            )}
            {activity?.health === 'NOT_FUNCTIONAL' && (
              <Notice tone="warning">
                <strong>NOT_FUNCTIONAL</strong> · {activity.consecutiveFailures || 0} consecutive failures. Deployment is still
                available.
              </Notice>
            )}

            {deploymentPortValid && applicationCommitted && portChecking && (
              <Notice>Checking port {deploymentPortNumber}...</Notice>
            )}
            {portCheckError && (
              <Notice tone="error">
                Port check failed: {portCheckError}. Deployment is disabled until the port can be verified.
              </Notice>
            )}
            {portStatus && !portStatus.occupied && <Notice>Port {portStatus.port} is available.</Notice>}
            {portStatus?.sameApplication && (
              <Notice tone="warning">
                {portStatus.message}. Deployment will stop PID {portStatus.pid}, finish its log capture, and redeploy it.
              </Notice>
            )}
            {portStatus?.occupied && !portStatus.sameApplication && (
              <Notice tone="error">
                {portStatus.message}. {portStatus.pid ? `PID ${portStatus.pid}. ` : ''}
                {portStatus.jarName ? `JAR: ${portStatus.jarName}. ` : ''}Free this port before deploying.
              </Notice>
            )}
            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4" data-tour="jar-launcher-preview">
              <Field label={provideScript ? 'Launcher script to save alongside the JAR' : 'Existing launcher script'}>
                <textarea
                  className="form-control min-h-28 font-mono text-sm"
                  readOnly
                  aria-label="Launcher script preview"
                  value={launcherPreview}
                  placeholder={
                    applicationCommitted
                      ? 'Loading the existing launcher script…'
                      : 'Select a JAR to preview the launcher script.'
                  }
                />
              </Field>
              {provideScript ? (
                <p className="help">This script will be saved as {trimmedApplicationName || 'application'}.bat.</p>
              ) : (
                <p className="help">
                  The existing {trimmedApplicationName || 'application'}.bat will be reused; this preview is read-only.
                  {savedJavaExecutablePath ? ` Saved Java path: ${savedJavaExecutablePath}.` : ''}
                </p>
              )}
              {batLoading && <p className="help">Loading the existing launcher file…</p>}
              {batError && <Notice tone="error">{batError}</Notice>}
              {reuseExistingLauncher && applicationCommitted && !selected && (
                <Notice tone="error">
                  No saved launcher is available for this new JAR. Generate and save launcher settings first.
                </Notice>
              )}
              {reuseExistingLauncher && selected && !batLoading && !batError && !deploymentPortValid && (
                <Notice tone="error">
                  This JAR profile has no saved launcher port. Generate and save launcher settings before reusing it.
                </Notice>
              )}
            </div>
            {provideScript && (
              <div className="grid gap-4 md:grid-cols-2">
                <div data-tour="jar-port">
                  <Field label="Port number (required)">
                    <Input
                      type="number"
                      min="1"
                      max="65535"
                      step="1"
                      required
                      value={port}
                      onChange={(event) => setPort(event.target.value)}
                      onBlur={() => setPortTouched(true)}
                      disabled={formDisabled}
                    />
                  </Field>
                </div>
                <div data-tour="jar-java-path">
                  <Field label="Java path in QC (optional)">
                    <Input
                      value={javaPath}
                      onChange={(event) => setJavaPath(event.target.value)}
                      placeholder="C:\\Program Files\\Java\\jdk-21\\bin\\java.exe"
                      disabled={formDisabled}
                    />
                  </Field>
                </div>
              </div>
            )}
            <Label className="flex items-start gap-3 rounded-md border p-3" data-tour="jar-frontend-toggle">
              <Checkbox
                aria-label="Include frontend"
                checked={includeFrontend}
                disabled={formDisabled}
                onCheckedChange={(checked) => {
                  setIncludeFrontend(checked === true);
                  setFrontendMode(null);
                  setConfirmReassociation(false);
                  if (checked !== true) {
                    setFrontendProfileUuid('');
                    setFrontendQuery('');
                    setFrontendSources([]);
                  }
                }}
              />
              <span>
                <strong>Include frontend</strong>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Reuse an existing association or deploy frontend production files with this JAR.
                </span>
              </span>
            </Label>
            {includeFrontend && (
              <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
                <fieldset data-tour="jar-frontend-modes" disabled={formDisabled}>
                  <legend className="text-sm font-medium mb-2">Frontend deployment mode (required)</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {frontendModeOptions.map(([mode, label]) => (
                      <label key={mode} className={`choice ${frontendMode === mode ? 'choice-active' : ''}`}>
                        <input
                          type="radio"
                          name="frontend-mode"
                          checked={frontendMode === mode}
                          onChange={() => {
                            setFrontendMode(mode);
                            setConfirmReassociation(false);
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {frontendMode === FRONTEND_MODES.REUSE && !selected && (
                  <Notice tone="error">
                    Select an existing JAR application from the catalogue to reuse its frontend association.
                  </Notice>
                )}
                {frontendMode === FRONTEND_MODES.REUSE && selected && !frontendAssociation && (
                  <Notice tone="error">
                    JAR wasn't associated with frontend during deployment. Redeploy with frontend setup.
                  </Notice>
                )}
                {frontendMode === FRONTEND_MODES.DEPLOY && (
                  <div className="space-y-4">
                    <div data-tour="jar-frontend-profile">
                      <FormItem>
                        <FormLabel>Frontend profile (required)</FormLabel>
                        <SearchableProfileSelect
                          profiles={frontendProfiles}
                          value={frontendQuery}
                          onValueChange={(value) => {
                            setFrontendQuery(value);
                            setFrontendProfileUuid('');
                            setConfirmReassociation(false);
                          }}
                          onSelect={(profile) => {
                            setFrontendProfileUuid(profile.profileUuid);
                            setFrontendQuery(profile.profileName);
                            setFrontendSelectionStale(false);
                            setConfirmReassociation(false);
                          }}
                          getKey={(profile) => profile.profileUuid}
                          getLabel={(profile) => profile.profileName}
                          getDescription={(profile) =>
                            [
                              `Port ${profile.port}`,
                              profile.applicationName ? `JAR ${profile.jarName || profile.applicationName}` : 'Unassociated',
                            ].join(' · ')
                          }
                          getSearchText={(profile) =>
                            `${profile.profileName} ${profile.port} ${profile.frontendUrl || ''} ${profile.applicationName || ''} ${profile.jarName || ''}`
                          }
                          ariaLabel="Select frontend profile"
                          inputAriaLabel="Frontend profile name, port, URL, or JAR"
                          className="w-full justify-between font-normal sm:w-96"
                          disabled={formDisabled}
                        />
                      </FormItem>
                    </div>
                    {!selectedFrontend && <p className="field-error">Select an available frontend profile.</p>}
                    <div data-tour="jar-frontend-details">
                      {selectedFrontend ? (
                        <JarFrontendDetails
                          activity={{
                            id: selectedFrontend.profileUuid,
                            frontendProfile: selectedFrontend,
                            frontendUrl: selectedFrontend.frontendUrl,
                          }}
                        />
                      ) : (
                        <p className="help">Select a frontend profile to view its URL, status, current JAR, and DocumentRoot.</p>
                      )}
                    </div>
                    {reassociationRequired && (
                      <Notice tone="warning">
                        This frontend profile is currently associated with{' '}
                        {selectedFrontend?.jarName || selectedFrontend?.applicationName}. Confirm reassociation to continue.
                      </Notice>
                    )}
                    {reassociationRequired && (
                      <Label className="flex items-center gap-3">
                        <Checkbox
                          aria-label="Confirm frontend reassociation"
                          checked={confirmReassociation}
                          disabled={formDisabled}
                          onCheckedChange={(checked) => setConfirmReassociation(checked === true)}
                        />
                        Confirm reassociation from {selectedFrontend?.jarName || selectedFrontend?.applicationName}
                      </Label>
                    )}
                    <div data-tour="jar-frontend-sources">
                      <p className="text-sm font-medium mb-2">Frontend production build from Tech Drive</p>
                      <FileBrowser
                        rootKey="techDrive"
                        showSelectAll
                        selected={frontendSources}
                        onSelectionChange={setFrontendSources}
                        disabled={formDisabled}
                      />
                      {frontendSources.length > 0 && (
                        <p className="help mt-2">{frontendSources.length} file(s) or folder(s) selected.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {frontendSelectionStale && (
              <Notice tone="warning">The selected frontend profile is no longer available. Select another profile.</Notice>
            )}
            {submitting && <Notice>Verifying resources, acquiring deployment locks, and starting the operation…</Notice>}
            {error && <Notice tone="error">{structuredDeploymentError ? <strong>{error}</strong> : error}</Notice>}
            <Button type="submit" disabled={formInvalid || formDisabled || profileBusy} className="gap-2" data-tour="jar-deploy">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              {submitting ? 'Verifying and locking…' : 'Deploy JAR'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Page>
  );
}

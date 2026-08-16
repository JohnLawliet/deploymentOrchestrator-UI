import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Rocket } from 'lucide-react';
import FileBrowser from '@/components/FileBrowser';
import LockNotice from '@/components/LockNotice';
import PageTutorial from '@/components/PageTutorial';
import {
  cancelWarPreflight,
  deployWar,
  getProfileDatasources,
  getProfiles,
  getWarApplications,
  isLockConflict,
  preflightWar,
} from '@/lib/contractApi';
import { deploymentIdOf } from '@/lib/deploymentIdentity';
import { usePortal } from '@/context/PortalContext';
import { useWarDeployStore } from '@/warDeployStore';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormDescription, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Notice, Page } from '@/components/PagePrimitives';
import type { AsyncState } from '@/types/frontend';
import { errorMessage } from '@/types/frontend';
import { warTutorialSteps } from '@/lib/pageTutorials';
import type { RootKey, SystemEvent, WarDeploymentRequest, WarPreflightResponse, WildFlyDatasource } from '@/types/api-contracts';

const normalizeDatasource = (value: WildFlyDatasource | null | undefined): WildFlyDatasource | null =>
  value
    ? {
        name: value.name,
        jndiName: value.jndiName,
        connectionUrl: value.connectionUrl,
        username: value.username,
        password: value.password,
        enabled: value.enabled,
      }
    : null;
const sameDatasource = (left: WildFlyDatasource | null, right: WildFlyDatasource | null): boolean =>
  JSON.stringify(normalizeDatasource(left)) === JSON.stringify(normalizeDatasource(right));

const tutorialDatasource: WildFlyDatasource = {
  name: 'ExampleDatasource',
  jndiName: 'java:/jdbc/example',
  connectionUrl: 'jdbc:postgresql://qc-db.example.local:5432/example',
  username: 'qc_user',
  password: '********',
  enabled: true,
};
const tutorialWarSource = 'tutorial/example-application.war';

export default function WarDeploymentPage() {
  const {
    username,
    wildflyProfileActivityMap,
    mergeActivity,
    reconcileProfileActivity,
    registerOperation,
    findConflictingLock,
    lastSystemEvent,
    snapshotRevision,
  } = usePortal();
  const currentStore = useWarDeployStore();
  const store = useRef(currentStore).current;
  const {
    applications,
    applicationState,
    applicationError,
    profiles,
    profileState,
    profileError,
    version,
    profileId,
    application,
    source,
    datasource,
    originalDatasource,
    additionalConfigRequired,
    datasourceState,
    datasourceError,
    duplicateSelections,
    preflight,
    preflightState,
    preflightChecked,
    error,
    cancellationWarning,
    submitting,
  } = currentStore;
  const [now, setNow] = useState(Date.now());
  const [pendingOperationId, setPendingOperationId] = useState('');
  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [tutorialApplicationOpen, setTutorialApplicationOpen] = useState(false);
  const [tutorialProfileOpen, setTutorialProfileOpen] = useState(false);
  const [tutorialLockExpiresAt, setTutorialLockExpiresAt] = useState<string | null>(null);
  const pendingSnapshotRevision = useRef(0);
  const submissionGuard = useRef(false);
  const reservedProfile = useRef('');

  const versions = useMemo(() => [...new Set(profiles.map((item) => item.version).filter(Boolean))], [profiles]);

  const filteredProfiles = useMemo(() => profiles.filter((item) => item.version === version), [profiles, version]);
  const selectedProfile = useMemo(() => profiles.find((item) => item.id === profileId), [profileId, profiles]);
  const requiredValid = !!(application && version && profileId && source[0]);
  const selectedActivity = wildflyProfileActivityMap[profileId];
  const profileBusy = ['STARTING', 'STOPPING', 'DEPLOYING'].includes(selectedActivity?.status ?? '');
  const profileLock = findConflictingLock?.({
    resourceKey: `profile:${profileId}`,
    section: 'WAR',
    profile: selectedProfile?.name,
    mode: 'WRITE',
  });
  const duplicates = Object.entries(preflight?.duplicateFiles || {});
  const allDuplicatesSelected = duplicates.every(([name, candidates]) => candidates.includes(duplicateSelections[name]));
  const actualLockTime = preflight?.lockExpiresAt ? new Date(preflight.lockExpiresAt).getTime() : 0;
  const actualExpired = !!actualLockTime && actualLockTime <= now;
  const canDeploy =
    preflightState === 'ready' &&
    requiredValid &&
    actualLockTime > 0 &&
    !preflight?.missingFiles?.length &&
    allDuplicatesSelected &&
    !actualExpired &&
    !submitting &&
    !pendingOperationId &&
    !profileBusy &&
    !profileLock;

  const tutorialVersion = versions[0] || version;
  const tutorialProfiles = useMemo(
    () => profiles.filter((item) => item.version === tutorialVersion),
    [profiles, tutorialVersion],
  );
  const tutorialApplication = applications[0]?.application || application;
  const tutorialProfileId = tutorialProfiles[0]?.id || profileId;
  const displayApplication = tutorialActive ? tutorialApplication : application;
  const displayVersion = tutorialActive ? tutorialVersion : version;
  const displayProfiles = tutorialActive ? tutorialProfiles : filteredProfiles;
  const displayProfileId = tutorialActive ? tutorialProfileId : profileId;
  const displaySelectedProfile = tutorialActive
    ? tutorialProfiles.find((item) => item.id === tutorialProfileId)
    : selectedProfile;
  const tutorialPreflight = useMemo<WarPreflightResponse | null>(
    () =>
      tutorialActive && tutorialStep >= 4 && tutorialLockExpiresAt
        ? {
            ready: true,
            decisionRequired: true,
            missingFiles: [],
            duplicateFiles: {
              'application.properties': [
                'WEB-INF/classes/application.properties',
                'WEB-INF/classes/config/application.properties',
              ],
              'CustomFilter.java': [
                'WEB-INF/classes/com/example/web/CustomFilter.java',
                'WEB-INF/classes/com/example/security/CustomFilter.java',
              ],
            },
            automaticallyResolved: {
              'web.xml': 'WEB-INF/web.xml',
              'log4j2.properties': 'WEB-INF/classes/log4j2.properties',
            },
            warnings: [],
            lockExpiresAt: tutorialLockExpiresAt,
            activity: null,
          }
        : null,
    [tutorialActive, tutorialLockExpiresAt, tutorialStep],
  );
  const displayPreflight = tutorialPreflight || preflight;
  const displayPreflightState = tutorialPreflight ? 'ready' : preflightState;
  const displayPreflightChecked = tutorialPreflight ? true : preflightChecked;
  const displayDatasource = tutorialActive && tutorialStep >= 2 ? tutorialDatasource : datasource;
  const displayDatasourceState: AsyncState = tutorialActive && tutorialStep >= 2 ? 'ready' : datasourceState;
  const displayDatasourceError = tutorialActive && tutorialStep >= 2 ? '' : datasourceError;
  const displaySource = tutorialActive && tutorialStep >= 3 ? [tutorialWarSource] : source;
  const displayAdditionalConfigRequired = tutorialActive && tutorialStep >= 3 ? true : additionalConfigRequired;
  const displayRequiredValid = tutorialActive
    ? !!(displayApplication && displayVersion && displayProfileId && displaySource[0])
    : requiredValid;
  const displayProfileBusy = tutorialActive ? false : profileBusy;
  const displayProfileLock = tutorialActive ? null : profileLock;
  const lockTime = displayPreflight?.lockExpiresAt ? new Date(displayPreflight.lockExpiresAt).getTime() : 0;
  const remainingMs = lockTime ? Math.max(0, lockTime - now) : 0;
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const expired = !!lockTime && remainingMs <= 0;
  const displayDuplicates = Object.entries(displayPreflight?.duplicateFiles || {});
  const tutorialDisabled =
    applicationState !== 'ready' ||
    profileState !== 'ready' ||
    !applications.length ||
    !profiles.length ||
    preflightChecked ||
    (preflightState === 'ready' && !actualExpired) ||
    submitting ||
    !!pendingOperationId;

  useEffect(() => {
    const event = lastSystemEvent;
    if (
      !event ||
      !('eventType' in event) ||
      event.eventType !== 'OPERATION_FINISHED' ||
      (event.resources?.section !== 'WAR' && event.resources?.resourceType !== 'WILDFLY_PROFILE')
    )
      return;
    const affected = String(event.resources?.resourceKey || event.resourceKey || '').replace(/^WILDFLY_PROFILE:/, '');
    if (affected !== profileId) return;
    getProfiles()
      .then((items) => store.setProfiles(Array.isArray(items) ? items : []))
      .catch(() => {});
  }, [lastSystemEvent, profileId, store]);

  useEffect(() => {
    store.setApplicationState('loading');
    store.setApplicationError('');
    getWarApplications()
      .then((items) => {
        const next = (Array.isArray(items) ? items : []).filter((item) => item.environments?.includes('qc'));
        store.setApplications(next);
        store.setApplication((current) => current || next[0]?.application || '');
        store.setApplicationState('ready');
      })
      .catch((reason: unknown) => {
        store.setApplicationError(errorMessage(reason));
        store.setApplicationState('error');
      });
    store.setProfileState('loading');
    store.setProfileError('');
    getProfiles()
      .then((items) => {
        const next = Array.isArray(items) ? items : [];
        store.setProfiles(next);
        store.setVersion((current) => current || next.find((item) => item.version)?.version || '');
        store.setProfileState('ready');
      })
      .catch((reason: unknown) => {
        store.setProfileError(errorMessage(reason));
        store.setProfileState('error');
      });
  }, [store]);

  useEffect(() => {
    if (!filteredProfiles.length) return;
    store.setProfileId((current) => (filteredProfiles.some((item) => item.id === current) ? current : filteredProfiles[0].id));
  }, [filteredProfiles, store]);

  useEffect(() => {
    store.setDatasource(null);
    store.setOriginalDatasource(null);
    store.setDatasourceError('');
    if (!profileId) {
      store.setDatasourceState('idle');
      return undefined;
    }
    reconcileProfileActivity(profileId).catch(() => {});
    store.setDatasourceState('loading');
    const controller = new AbortController();
    getProfileDatasources(profileId, controller.signal)
      .then((result) => {
        const next = normalizeDatasource(result);
        store.setDatasource(next);
        store.setOriginalDatasource(next ? { ...next } : null);
        store.setDatasourceState('ready');
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof Error && reason.name === 'CanceledError')) {
          store.setDatasourceError(errorMessage(reason));
          store.setDatasourceState('error');
        }
      });
    return () => controller.abort();
  }, [profileId, store, reconcileProfileActivity]);

  useEffect(() => {
    if (
      pendingOperationId &&
      (selectedActivity?.activeOperationId === pendingOperationId || snapshotRevision > pendingSnapshotRevision.current)
    )
      setPendingOperationId('');
  }, [pendingOperationId, selectedActivity?.activeOperationId, snapshotRevision]);

  useEffect(() => {
    if (!lockTime || expired) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [lockTime, expired]);

  useEffect(() => {
    if (!expired || !preflightChecked) return;
    store.setPreflightChecked(false);
    store.setPreflightState('expired');
  }, [expired, preflightChecked, store]);

  const clearLocalPreflight = useCallback(() => {
    store.setPreflight(null);
    store.setDuplicateSelections({});
    store.setPreflightChecked(false);
    store.setPreflightState('idle');
    reservedProfile.current = '';
  }, [store]);

  const cancelReservation = useCallback(
    async (profile = reservedProfile.current) => {
      clearLocalPreflight();
      if (!profile) return;
      try {
        await cancelWarPreflight(profile);
        store.setCancellationWarning('');
      } catch (reason: unknown) {
        store.setCancellationWarning(
          `The reservation could not be cancelled: ${errorMessage(reason)}. It will still expire on the server.`,
        );
      }
    },
    [clearLocalPreflight, store],
  );

  useEffect(
    () => () => {
      const profile = reservedProfile.current;
      reservedProfile.current = '';
      if (profile) cancelWarPreflight(profile).catch(() => {});
    },
    [],
  );

  const invalidateAnd = <T,>(setter: (value: T) => void, value: T): void => {
    if (reservedProfile.current) cancelReservation();
    else clearLocalPreflight();
    setter(value);
    store.setError('');
  };

  const payload = useMemo(
    (): WarDeploymentRequest => ({
      application,
      profileId,
      sourceRootKey: 'techDrive' as RootKey,
      sourcePath: source[0] || '',
      datasourceOverride: sameDatasource(datasource, originalDatasource) ? null : normalizeDatasource(datasource),
      additionalConfigRequired,
      duplicateSelections,
    }),
    [application, username, profileId, source, datasource, originalDatasource, additionalConfigRequired, duplicateSelections],
  );

  const runPreflight = async () => {
    if (!requiredValid || preflightState === 'loading' || profileBusy || pendingOperationId) return;
    store.setPreflightChecked(true);
    store.setPreflightState('loading');
    store.setError('');
    store.setCancellationWarning('');
    try {
      const result = await preflightWar(payload);
      store.setPreflight(result);
      store.setPreflightState('ready');
      reservedProfile.current = result.lockExpiresAt ? profileId : '';
      setNow(Date.now());
      if (result.activity) mergeActivity(result.activity, 'WILDFLY_PROFILE');
    } catch (reason: unknown) {
      store.setPreflightChecked(false);
      store.setPreflightState('error');
      store.setError(errorMessage(reason));
      reservedProfile.current = '';
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (tutorialActive || !canDeploy || submissionGuard.current) return;
    submissionGuard.current = true;
    store.setSubmitting(true);
    store.setError('');
    try {
      const operation = await deployWar(payload);
      if (!operation?.deploymentId) throw new Error('The backend did not return a deployment ID.');
      reservedProfile.current = '';
      clearLocalPreflight();
      pendingSnapshotRevision.current = snapshotRevision;
      setPendingOperationId(deploymentIdOf(operation));
      registerOperation(
        { ...operation, operationType: 'WAR_DEPLOY' },
        `WILDFLY_PROFILE:${profileId}`,
        `Deploy WAR · ${application}`,
      );
    } catch (reason: unknown) {
      store.setError(isLockConflict(reason) ? `Profile reservation conflict: ${errorMessage(reason)}` : errorMessage(reason));
      if (isLockConflict(reason)) clearLocalPreflight();
    } finally {
      submissionGuard.current = false;
      store.setSubmitting(false);
    }
  };

  const startWarTutorial = useCallback(() => {
    setTutorialActive(true);
    setTutorialStep(0);
    setTutorialApplicationOpen(true);
    setTutorialProfileOpen(false);
    setTutorialLockExpiresAt(null);
  }, []);

  const prepareWarTutorialStep = useCallback((index: number): Promise<void> => {
    setTutorialStep(index);
    setTutorialApplicationOpen(index === 0);
    setTutorialProfileOpen(index === 1);
    if (index === 4) {
      const startedAt = Date.now();
      setNow(startedAt);
      setTutorialLockExpiresAt(new Date(startedAt + 59_000).toISOString());
    }
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }, []);

  const resetWarTutorial = useCallback(() => {
    setTutorialActive(false);
    setTutorialStep(0);
    setTutorialApplicationOpen(false);
    setTutorialProfileOpen(false);
    setTutorialLockExpiresAt(null);
  }, []);

  return (
    <Page
      title="Deploy WAR"
      description="Reserve a WildFly profile, validate an existing Tech Drive WAR, and deploy it."
      headerAction={
        <PageTutorial
          steps={warTutorialSteps}
          disabled={tutorialDisabled || tutorialActive}
          onStart={startWarTutorial}
          onStepPrepare={prepareWarTutorialStep}
          onReset={resetWarTutorial}
        />
      }
    >
      <form onSubmit={submit} className="grid xl:grid-cols-[1.05fr_.95fr] gap-5 items-start">
        <Card data-tour="war-target">
          <CardHeader>
            <CardTitle>Source and target</CardTitle>
            <CardDescription>
              Profile identifiers and selected paths are submitted exactly as backend UUIDs and Tech Drive-relative paths.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <FormItem data-tour="war-application">
              <FormLabel>Application</FormLabel>
              <Select
                value={displayApplication}
                open={tutorialActive ? tutorialApplicationOpen : applicationOpen}
                onOpenChange={(open) => {
                  if (tutorialActive) setTutorialApplicationOpen(open);
                  else setApplicationOpen(open);
                }}
                onValueChange={(value) => {
                  if (!tutorialActive) invalidateAnd(store.setApplication, value);
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
              {applicationError && <FormMessage>{applicationError}</FormMessage>}
            </FormItem>
            <div className="grid sm:grid-cols-2 gap-4" data-tour="war-version-profile">
              <FormItem>
                <FormLabel>WildFly version</FormLabel>
                <Select
                  value={displayVersion}
                  onValueChange={(value) => {
                    if (!tutorialActive) invalidateAnd(store.setVersion, value);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {profileError && <FormMessage>{profileError}</FormMessage>}
              </FormItem>
              <FormItem>
                <FormLabel>Profile</FormLabel>
                <Select
                  value={displayProfileId}
                  open={tutorialActive ? tutorialProfileOpen : profileOpen}
                  onOpenChange={(open) => {
                    if (tutorialActive) setTutorialProfileOpen(open);
                    else setProfileOpen(open);
                  }}
                  onValueChange={(value) => {
                    if (!tutorialActive) invalidateAnd(store.setProfileId, value);
                  }}
                  disabled={profileState === 'loading'}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {displayProfiles.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                        {item.portOffset != null ? ` · offset ${item.portOffset}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {displaySelectedProfile?.lastDeployedUser && (
                  <FormDescription>Last deployed by {displaySelectedProfile.lastDeployedUser}</FormDescription>
                )}
              </FormItem>
            </div>
            <div data-tour="war-datasource">
              <DatasourceEditor
                state={displayDatasourceState}
                error={displayDatasourceError}
                value={displayDatasource}
                onChange={(value) => {
                  if (!tutorialActive) invalidateAnd(store.setDatasource, value);
                }}
              />
            </div>
            <div data-tour="war-source-config">
              <div>
                <p className="text-sm font-medium mb-2">WAR from Tech Drive</p>
                <FileBrowser
                  rootKey="techDrive"
                  selectableExtension=".war"
                  selected={displaySource}
                  onSelectionChange={(items) => {
                    if (!tutorialActive) invalidateAnd(store.setSource, items.slice(-1));
                  }}
                />
                {displaySource[0] ? (
                  <FormDescription className="mt-2">
                    Selected: <span className="font-mono text-foreground">{displaySource[0]}</span>
                  </FormDescription>
                ) : (
                  <FormMessage className="mt-2">Select one .war file.</FormMessage>
                )}
              </div>
              <Label
                className={`mt-5 flex items-start gap-3 rounded-md border p-3 ${
                  displayAdditionalConfigRequired ? 'border-primary bg-primary/10' : ''
                }`}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={displayAdditionalConfigRequired}
                  onCheckedChange={(checked) => {
                    if (!tutorialActive) invalidateAnd(store.setAdditionalConfigRequired, checked === true);
                  }}
                />
                <span>
                  <strong>Apply additional WAR configuration</strong>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Require an additionalConfig.toml beside the selected WAR for properties or web.xml changes. Leave unchecked
                    when no additional changes are needed.
                  </span>
                </span>
              </Label>
            </div>
          </CardContent>
        </Card>
        <Card className="xl:sticky xl:top-5" data-tour="war-preflight">
          <CardHeader>
            <CardTitle>Preflight and deployment</CardTitle>
            <CardDescription>The profile is exclusively reserved until the server-provided expiry time.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Label
              data-tour="war-preflight-toggle"
              className={`flex items-center gap-3 rounded-md border p-3 ${displayPreflightChecked ? 'border-primary bg-primary/10' : ''}`}
            >
              <Checkbox
                checked={displayPreflightChecked}
                disabled={
                  tutorialActive ||
                  !displayRequiredValid ||
                  displayPreflightState === 'loading' ||
                  submitting ||
                  !!pendingOperationId ||
                  displayProfileBusy ||
                  !!displayProfileLock
                }
                onCheckedChange={(checked) => {
                  if (!tutorialActive) void (checked ? runPreflight() : cancelReservation());
                }}
              />
              <span>
                <strong>Run preflight and reserve profile</strong>
                <span className="block text-xs text-muted-foreground mt-1">
                  Available after application, profile, and WAR are selected.
                </span>
              </span>
            </Label>
            {displayPreflightState === 'loading' && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Running preflight…
              </p>
            )}
            {displayPreflightState === 'expired' && (
              <Notice tone="warning">The exclusive reservation expired. Run preflight again before deploying.</Notice>
            )}
            {displayProfileBusy && (
              <Notice tone="warning">
                This profile is currently {selectedActivity.status?.toLowerCase() || 'changing state'}. Wait for the backend state
                to change before starting another deployment.
              </Notice>
            )}
            <LockNotice lock={displayProfileLock} />
            {pendingOperationId && <Notice>Deployment request accepted. Waiting for the backend activity event…</Notice>}
            {displayPreflight && displayPreflight.warnings.length > 0 && (
              <Notice tone="warning">
                <strong>Warnings</strong>
                <ul className="list-disc ml-5 mt-1">
                  {displayPreflight.warnings.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {displayPreflight && displayPreflight.missingFiles.length > 0 && (
              <Notice tone="error">
                <strong>Missing required files</strong>
                <ul className="list-disc ml-5 mt-1">
                  {displayPreflight.missingFiles.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Notice>
            )}
            <div data-tour="war-conflict-resolution" className="space-y-4">
              {displayPreflight && Object.keys(displayPreflight.automaticallyResolved).length > 0 && (
                <Notice>
                  <strong>Automatically resolved</strong>
                  {Object.entries(displayPreflight.automaticallyResolved).map(([file, path]) => (
                    <div className="font-mono text-xs mt-1" key={file}>
                      {file} → {path}
                    </div>
                  ))}
                </Notice>
              )}
              {displayDuplicates.map(([file, candidates]) => (
                <FormItem key={file}>
                  <FormLabel>Resolve duplicate: {file}</FormLabel>
                  <Select
                    value={duplicateSelections[file] || ''}
                    onValueChange={(value) => {
                      if (!tutorialActive)
                        store.setDuplicateSelections((current) => ({
                          ...current,
                          [file]: value,
                        }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose the exact candidate path" />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((path) => (
                        <SelectItem key={path} value={path}>
                          {path}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!duplicateSelections[file] && <FormMessage>A selection is required.</FormMessage>}
                </FormItem>
              ))}
            </div>
            {cancellationWarning && <Notice tone="warning">{cancellationWarning}</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" disabled={tutorialActive || !canDeploy} className="w-full gap-2" data-tour="war-deploy">
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : canDeploy && !tutorialActive ? (
                <Rocket className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {submitting ? 'Starting deployment…' : `Deploy WAR${lockTime > 0 && !expired ? ` (${remainingSeconds})` : ''}`}
            </Button>
            <p className="text-xs text-muted-foreground flex gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {canDeploy && !tutorialActive
                ? 'All checks passed. Deploy before the reservation expires.'
                : 'Complete preflight and resolve every blocking decision.'}
            </p>
          </CardContent>
        </Card>
      </form>
    </Page>
  );
}

function DatasourceEditor({
  state,
  error,
  value,
  onChange,
}: {
  state: AsyncState;
  error: string;
  value: WildFlyDatasource | null;
  onChange: (value: WildFlyDatasource | null | ((current: WildFlyDatasource | null) => WildFlyDatasource | null)) => void;
}) {
  if (state === 'idle') return <Notice>Select a profile to load its datasource.</Notice>;
  if (state === 'loading')
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading datasource…
      </p>
    );
  if (state === 'error') return <Notice tone="error">{error}</Notice>;
  if (!value) return <Notice tone="warning">No datasource was returned for this profile.</Notice>;
  const update = <K extends keyof WildFlyDatasource>(field: K, next: WildFlyDatasource[K]): void =>
    onChange((current) => (current ? { ...current, [field]: next } : current));
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">Profile datasource</p>
        <p className="text-xs text-muted-foreground">Changes are applied only as part of this WAR deployment.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {(['name', 'jndiName', 'connectionUrl', 'username', 'password'] as const).map((field) => (
          <FormItem className={field === 'connectionUrl' ? 'sm:col-span-2' : ''} key={field}>
            <FormLabel>
              {field === 'jndiName'
                ? 'JNDI name'
                : field === 'connectionUrl'
                  ? 'Connection URL'
                  : field[0].toUpperCase() + field.slice(1)}
            </FormLabel>
            <Input
              type={field === 'password' ? 'password' : 'text'}
              autoComplete={field === 'password' ? 'new-password' : 'off'}
              value={value[field]}
              onChange={(event) => update(field, event.target.value)}
            />
          </FormItem>
        ))}
      </div>
      <Label className="flex items-center gap-2">
        <Checkbox checked={value.enabled} onCheckedChange={(checked) => update('enabled', checked === true)} />
        Enabled
      </Label>
    </div>
  );
}

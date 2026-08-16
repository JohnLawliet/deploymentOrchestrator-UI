import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  Loader2,
  Power,
  RefreshCw,
  RotateCcw,
  Server,
} from 'lucide-react';
import { getJars, getProfiles, isLockConflict, restartJar, stopJar, startProfile, stopProfile } from '@/lib/contractApi';
import { isOperationTerminal } from '@/lib/operationProgress';
import { normalizeDashboardProfile, normalizeRuntimeActivity, overlayRuntimeActivity } from '@/lib/runtimeActivity';
import { usePortal } from '@/context/PortalContext';
import JarFrontendDetails from '@/components/JarFrontendDetails';
import JarRollbackButton from '@/components/JarRollbackButton';
import RollbackButton from '@/components/RollbackButton';
import SearchableProfileSelect from '@/components/SearchableProfileSelect';
import LockNotice from '@/components/LockNotice';
import PageTutorial, { type TutorialStep } from '@/components/PageTutorial';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice, Page } from '@/components/PagePrimitives';
import type { JarApplication, Profile, SystemEvent } from '@/types/api-contracts';
import type { OperationRecord, RuntimeActivityModel } from '@/types/frontend';
import { errorMessage } from '@/types/frontend';

const busyStates = new Set(['STARTING', 'STOPPING', 'DEPLOYING']);
const readinessLabels = {
  HTTP_VERIFIED: 'Verified healthy',
  PORT_VERIFIED: 'Healthy — process and port verified',
};
const fallbackWildflyProfilesPerPage = 20;
const configuredWildflyProfilesPerPage = (() => {
  const value = Number(import.meta.env.VITE_WILDFLY_PROFILES_PER_PAGE);
  return Number.isInteger(value) && value > 0 ? value : fallbackWildflyProfilesPerPage;
})();

type DashboardTutorialSnapshot = {
  version: string;
  profileQuery: string;
  debouncedProfileQuery: string;
  wildflyPage: number;
};

const waitForTutorialTarget = (selector: string, timeout = 2500, requireVisible = false): Promise<void> =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      const target = document.querySelector(selector);
      const targetReady = target && (!requireVisible || !(target instanceof HTMLElement) || !target.hidden);
      if (targetReady || Date.now() - startedAt >= timeout) {
        resolve();
        return;
      }
      window.setTimeout(check, 16);
    };
    check();
  });

export function shouldRefreshDashboardActivity(event: unknown): boolean {
  if (typeof event !== 'object' || event === null || !('eventType' in event)) return false;
  const { eventType } = event as { eventType?: unknown };
  const resources = 'resources' in event ? (event as { resources?: unknown }).resources : undefined;
  return (
    eventType === 'RESOURCE_ACTIVE' ||
    eventType === 'RESOURCE_FAILED' ||
    eventType === 'DEPLOYMENT_SUCCEEDED' ||
    eventType === 'DEPLOYMENT_FAILED' ||
    eventType === 'OPERATION_FINISHED' ||
    (eventType === 'OPERATION_PROGRESS' &&
      typeof resources === 'object' &&
      resources !== null &&
      'status' in resources &&
      ['COMPLETED', 'FAILED'].includes(String(resources.status)))
  );
}

export default function PortalDashboardPage() {
  const {
    wildflyProfileActivityMap,
    jarProfileActivityMap,
    replaceProfileActivities,
    reconcileResourceActivity,
    registerOperation,
    setViewingOperation,
    operations,
    lastSystemEvent,
    findConflictingLock,
  } = usePortal();
  const [jars, setJars] = useState<Array<JarApplication & RuntimeActivityModel>>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [version, setVersion] = useState('');
  const [profileQuery, setProfileQuery] = useState('');
  const [debouncedProfileQuery, setDebouncedProfileQuery] = useState('');
  const [wildflyPage, setWildflyPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialProfile, setTutorialProfile] = useState<Profile | null>(null);
  const [tutorialSearchOpen, setTutorialSearchOpen] = useState(false);
  const [tutorialExpandedProfileId, setTutorialExpandedProfileId] = useState<string | null>(null);
  const [tutorialRollbackProfileId, setTutorialRollbackProfileId] = useState<string | null>(null);
  const [tutorialJarDemo, setTutorialJarDemo] = useState(false);
  const [pendingTutorialRestore, setPendingTutorialRestore] = useState<DashboardTutorialSnapshot | null>(null);
  const tutorialSnapshotRef = useRef<DashboardTutorialSnapshot | null>(null);
  const versions = useMemo(() => [...new Set(profiles.map((p) => p.version).filter(Boolean))], [profiles]);
  const versionProfiles = useMemo(() => profiles.filter((profile) => profile.version === version), [profiles, version]);
  const filteredProfiles = useMemo(() => {
    const query = debouncedProfileQuery.trim().toLocaleLowerCase();
    if (!query) return versionProfiles;
    return versionProfiles.filter((profile) =>
      [profile.name, profile.id].some((value) =>
        String(value || '')
          .toLocaleLowerCase()
          .includes(query),
      ),
    );
  }, [debouncedProfileQuery, versionProfiles]);
  const wildflyPageCount = Math.max(1, Math.ceil(filteredProfiles.length / configuredWildflyProfilesPerPage));
  const visibleProfiles = useMemo(
    () =>
      filteredProfiles.slice(
        wildflyPage * configuredWildflyProfilesPerPage,
        (wildflyPage + 1) * configuredWildflyProfilesPerPage,
      ),
    [filteredProfiles, wildflyPage],
  );
  const wildflyRangeStart = filteredProfiles.length ? wildflyPage * configuredWildflyProfilesPerPage + 1 : 0;
  const wildflyRangeEnd = Math.min((wildflyPage + 1) * configuredWildflyProfilesPerPage, filteredProfiles.length);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedProfileQuery(profileQuery), 400);
    return () => window.clearTimeout(timer);
  }, [profileQuery]);

  useEffect(() => {
    setWildflyPage(0);
  }, [profiles, version, debouncedProfileQuery]);

  useEffect(() => {
    if (!pendingTutorialRestore) return;
    setWildflyPage(pendingTutorialRestore.wildflyPage);
    setPendingTutorialRestore(null);
  }, [pendingTutorialRestore]);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError('');
    Promise.all([getJars(), getProfiles()])
      .then(([jarItems, profileItems]) => {
        if (disposed) return;
        const nextJars = (Array.isArray(jarItems?.jars) ? jarItems.jars : [])
          .map((jar) => {
            const activity = normalizeRuntimeActivity({ ...jar, resourceType: 'JAR' });
            return activity?.id && activity.applicationName ? { ...jar, ...activity } : null;
          })
          .filter((jar): jar is JarApplication & RuntimeActivityModel => jar !== null);
        const nextProfiles = Array.isArray(profileItems) ? profileItems : [];
        setJars(nextJars);
        setProfiles(nextProfiles);
        replaceProfileActivities(nextProfiles);
        setVersion((current) => current || nextProfiles.find((p) => p.version)?.version || '');
        setLoading(false);
        const reconciliations = [...nextJars.filter((jar) => jar.id).map((jar) => reconcileResourceActivity(`JAR:${jar.id}`))];
        void Promise.allSettled(reconciliations);
      })
      .catch((e: unknown) => {
        if (!disposed) setError(errorMessage(e));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [refresh, reconcileResourceActivity, replaceProfileActivities]);

  useEffect(() => {
    if (shouldRefreshDashboardActivity(lastSystemEvent)) {
      setRefresh((current) => current + 1);
    }
  }, [lastSystemEvent]);

  const runRestart = async (
    key: string,
    action: () => Promise<OperationRecord>,
    label: string,
    warning: string,
  ): Promise<void> => {
    if (!window.confirm(warning)) return;
    setSubmitting(key);
    setError('');
    try {
      registerOperation(await action(), key, label);
    } catch (e: unknown) {
      setError(isLockConflict(e) ? `Resource conflict: ${errorMessage(e)}` : errorMessage(e));
    } finally {
      setSubmitting('');
    }
  };

  const viewOutput = (activity: RuntimeActivityModel, label: string, resourceType?: 'JAR' | 'WILDFLY_PROFILE'): void => {
    const resolvedResourceType = resourceType || ('applicationName' in activity ? 'JAR' : 'WILDFLY_PROFILE');
    const deploymentId = resolvedResourceType === 'JAR' ? activity?.terminalDeploymentId : activity?.activeOperationId;
    if (resolvedResourceType === 'JAR' && (!deploymentId || activity?.terminalAvailable !== true)) return;
    if (resolvedResourceType === 'WILDFLY_PROFILE' && !activity?.serverLogAvailable) return;
    const resourceKey = `${resolvedResourceType}:${activity.id}`;
    setViewingOperation({
      ...(deploymentId ? operations[deploymentId] || {} : {}),
      deploymentId: deploymentId || resourceKey,
      resourceKey,
      resourceType: resolvedResourceType,
      ...(resolvedResourceType === 'WILDFLY_PROFILE' ? { profileId: activity.id } : {}),
      outputRequested: true,
      ...(activity.status ? { status: activity.status } : {}),
      label,
    });
  };

  const runProfilePower = async (profile: Profile, activity: RuntimeActivityModel): Promise<void> => {
    const key = `WILDFLY_PROFILE:${profile.id}`;
    const active = activity.status === 'ACTIVE';
    const verb = active ? 'Stop' : 'Start';
    if (!window.confirm(`${verb} ${profile.name}?`)) return;
    setSubmitting(key);
    setError('');
    try {
      const result = active ? await stopProfile(profile.id) : await startProfile(profile.id);
      // The accepted response is the terminal-stream capability. Register it
      // before reconciliation so the owner can consume replayed/live output
      // immediately rather than waiting for a runtime read.
      let deploymentId = result.deploymentId || undefined;
      if (!deploymentId) {
        const reconciled = await reconcileResourceActivity(key);
        deploymentId = reconciled?.activeOperationId || undefined;
      } else {
        void reconcileResourceActivity(key);
      }
      if (deploymentId) {
        registerOperation(
          {
            deploymentId,
            resourceType: result.resourceType || 'WILDFLY_PROFILE',
            profileId: profile.id,
            applicationName: result.applicationName || activity.applicationName || profile.application || null,
            operationType: active ? 'PROFILE_STOP' : 'PROFILE_START',
          },
          key,
          `${verb} profile · ${profile.name}`,
        );
      }
    } catch (reason: unknown) {
      setError(isLockConflict(reason) ? `Resource conflict: ${errorMessage(reason)}` : errorMessage(reason));
    } finally {
      setSubmitting('');
    }
  };

  const changeVersion = (nextVersion: string): void => {
    setVersion(nextVersion);
    setProfileQuery('');
    setDebouncedProfileQuery('');
    setWildflyPage(0);
  };

  const changeProfileQuery = (nextQuery: string): void => {
    setProfileQuery(nextQuery);
    if (!nextQuery) setDebouncedProfileQuery('');
  };

  const selectProfile = (profile: Profile): void => {
    setProfileQuery(profile.name);
    setDebouncedProfileQuery(profile.name);
    setWildflyPage(0);
  };

  const startDashboardTutorial = useCallback(() => {
    tutorialSnapshotRef.current = { version, profileQuery, debouncedProfileQuery, wildflyPage };
    const nextProfile = versionProfiles[0] || profiles[0] || null;
    setTutorialActive(true);
    setTutorialProfile(nextProfile);
    setTutorialSearchOpen(false);
    setTutorialExpandedProfileId(null);
    setTutorialRollbackProfileId(null);
    setTutorialJarDemo(false);
    if (nextProfile?.version && nextProfile.version !== version) changeVersion(nextProfile.version);
  }, [debouncedProfileQuery, profileQuery, profiles, version, versionProfiles, wildflyPage]);

  const resetDashboardTutorial = useCallback(() => {
    const snapshot = tutorialSnapshotRef.current;
    tutorialSnapshotRef.current = null;
    setTutorialActive(false);
    setTutorialProfile(null);
    setTutorialSearchOpen(false);
    setTutorialExpandedProfileId(null);
    setTutorialRollbackProfileId(null);
    setTutorialJarDemo(false);
    if (!snapshot) return;
    setVersion(snapshot.version);
    setProfileQuery(snapshot.profileQuery);
    setDebouncedProfileQuery(snapshot.debouncedProfileQuery);
    setPendingTutorialRestore(snapshot);
  }, []);

  const activeTutorialProfile = tutorialProfile ? profiles.find((profile) => profile.id === tutorialProfile.id) || null : null;
  const tutorialActivity = useMemo(() => {
    if (!activeTutorialProfile) return null;
    const initialActivity = normalizeDashboardProfile(activeTutorialProfile) ?? {
      id: activeTutorialProfile.id,
      profileName: activeTutorialProfile.name,
      version: activeTutorialProfile.version,
      status: activeTutorialProfile.status,
      health: activeTutorialProfile.health,
    };
    return overlayRuntimeActivity(initialActivity, wildflyProfileActivityMap[activeTutorialProfile.id]);
  }, [activeTutorialProfile, wildflyProfileActivityMap]);
  const tutorialProfileLock = activeTutorialProfile
    ? findConflictingLock?.({
        resourceKey: `profile:${activeTutorialProfile.id}`,
        section: 'WAR',
        profile: activeTutorialProfile.name,
        mode: 'WRITE',
      })
    : null;
  const tutorialRollbackAvailable = Boolean(
    activeTutorialProfile &&
    tutorialActivity &&
    submitting !== `WILDFLY_PROFILE:${activeTutorialProfile.id}` &&
    !busyStates.has(tutorialActivity.status ?? '') &&
    !tutorialProfileLock &&
    !Object.values(operations).some(
      (operation) =>
        operation.operationType === 'WAR_ROLLBACK' &&
        operation.resourceKey === `WILDFLY_PROFILE:${activeTutorialProfile.id}` &&
        !isOperationTerminal(operation),
    ),
  );
  const dashboardTutorialSteps = useMemo<TutorialStep[]>(() => {
    const jarStep: TutorialStep = {
      target: '[data-tour="dashboard-tutorial-jar-example"]',
      title: 'Understand JAR applications',
      instruction:
        'A JAR can run alone or with a frontend. The example combines the JAR’s runtime/readiness information with its associated frontend details.',
      why: 'View output needs a retained attachable terminal. JAR snapshots are created only after an eligible non-first deployment, then listed newest-first.',
      placement: 'top',
      before: async () => {
        setTutorialJarDemo(true);
        await waitForTutorialTarget('[data-tour="dashboard-tutorial-jar-example"]');
      },
      targetWaitTimeout: 3000,
    };

    if (!activeTutorialProfile || !tutorialActivity) {
      return [
        {
          target: loading || error ? '[data-tour="dashboard-refresh"]' : '[data-tour="dashboard-wildfly"]',
          title: loading
            ? 'Waiting for profile inventory'
            : error
              ? 'Profile inventory could not load'
              : 'No usable WildFly profiles found',
          instruction: loading
            ? 'Wait for the inventory, then restart the tutorial.'
            : error
              ? 'Resolve the connection issue, refresh, then restart the tutorial.'
              : 'No profile is available to demonstrate.',
          why: 'A profile needs a valid <directoryName>.bat launcher and runtime paths.',
        },
        jarStep,
      ];
    }

    const profile = activeTutorialProfile;
    const profileDetailsStep: TutorialStep = {
      target: '[data-tour="dashboard-tutorial-profile-details"]',
      title: 'Inspect the critical profile details',
      instruction:
        'PID identifies the managed WildFly process; Application is the deployed WAR. Port offset comes from the launcher, while Consecutive failures tracks deployment failures and Latest result records the backend outcome.',
      why: 'A successful deployment resets consecutive failures. Latest result is not changed merely because the terminal window closes.',
    };
    const rollbackStep: TutorialStep = tutorialRollbackAvailable
      ? {
          target: '[data-tour="dashboard-tutorial-rollback-popover"]',
          title: 'Review rollback snapshots',
          instruction: 'The tutorial opens snapshots but never selects or rolls back one.',
          why: 'Usable snapshots are newest-first and follow the application backup rules.',
          before: async () => {
            setTutorialRollbackProfileId(profile.id);
            await waitForTutorialTarget('[data-tour="dashboard-tutorial-rollback-popover"]');
          },
          targetWaitTimeout: 3000,
        }
      : {
          target: '[data-tour="dashboard-tutorial-rollback"]',
          title: 'Rollback is currently unavailable',
          instruction: 'This profile is locked or busy, so rollback stays closed.',
          why: 'Rollback cannot conflict with a live operation.',
        };

    return [
      {
        target: '[data-tour="dashboard-profile-filters"]',
        title: 'Find a WildFly profile',
        instruction:
          'Dashboard profiles are discovered from immediate profile directories beneath configured WildFly roots. A profile requires a valid <directoryName>.bat launcher and valid runtime paths.',
        why: 'They identify the exact WildFly runtime that later checks and actions apply to.',
      },
      {
        target: '[data-tour="dashboard-tutorial-search-input"]',
        title: 'Filter to one profile',
        instruction: `Search opens and filters to ${profile.name}, leaving its matching profile card visible.`,
        why: 'Filtering prevents reviewing output or rollback data for the wrong profile.',
        before: async () => {
          setTutorialSearchOpen(true);
          setProfileQuery(profile.name);
          setDebouncedProfileQuery(profile.name);
          setWildflyPage(0);
          await waitForTutorialTarget('[data-tour="dashboard-tutorial-search-input"]');
        },
        targetWaitTimeout: 3000,
      },
      {
        target: '[data-tour="dashboard-tutorial-profile-card"]',
        title: 'Read runtime and health badges',
        instruction:
          'Runtime can be STARTING, DEPLOYING, STOPPING, ACTIVE, INACTIVE, or FAILED. Health can be FUNCTIONAL, NOT_FUNCTIONAL, or MISSING.',
        why: 'ACTIVE requires a PID plus reachable application and management ports. NOT_FUNCTIONAL means invalid paths or three failed deployments; MISSING has no usable launcher.',
        before: async () => {
          setTutorialSearchOpen(false);
          selectProfile(profile);
          setTutorialExpandedProfileId(profile.id);
          await waitForTutorialTarget('[data-tour="dashboard-tutorial-profile-details"]', 2500, true);
        },
      },
      profileDetailsStep,
      {
        target: '[data-tour="dashboard-tutorial-view-output"]',
        title: 'Open server output when available',
        instruction:
          'View output is enabled only when this profile has a readable server.log file; otherwise the button remains disabled.',
        why: 'The required file is <profileDir>/log/server.log, so the page never opens output for a missing or unreadable log.',
      },
      rollbackStep,
      jarStep,
    ];
  }, [activeTutorialProfile, error, loading, tutorialActivity, tutorialRollbackAvailable]);

  return (
    <Page
      title="Dashboard"
      description="Live QC resource inventory and restart controls."
      headerAction={
        <PageTutorial steps={dashboardTutorialSteps} onStart={startDashboardTutorial} onReset={resetDashboardTutorial} />
      }
    >
      <div className="flex justify-end mb-4" data-tour="dashboard-refresh">
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setRefresh((v) => v + 1)}>
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh activity
        </Button>
      </div>
      <div data-tour="dashboard-inventory" hidden={tutorialJarDemo}>
        {loading && (
          <div className="py-16 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading inventory…
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {!loading && (
          <div className="space-y-8">
            <section data-tour="dashboard-wildfly">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-semibold">WildFly profiles</h2>
                  <p className="text-sm text-muted-foreground">
                    Runtime state and health are reported independently by the backend.
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row" data-tour="dashboard-profile-filters">
                  <select
                    aria-label="WildFly version"
                    className="form-control w-full sm:w-auto sm:min-w-52"
                    value={version}
                    onChange={(event) => changeVersion(event.target.value)}
                  >
                    {versions.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <SearchableProfileSelect
                    profiles={versionProfiles}
                    align="end"
                    value={profileQuery}
                    onValueChange={changeProfileQuery}
                    onSelect={selectProfile}
                    open={tutorialActive ? tutorialSearchOpen : undefined}
                    inputDataTour="dashboard-tutorial-search-input"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {visibleProfiles.map((profile) => {
                  const initialActivity = normalizeDashboardProfile(profile) ?? {
                    id: profile.id,
                    profileName: profile.name,
                    version: profile.version,
                    status: profile.status,
                    health: profile.health,
                  };
                  const activity = overlayRuntimeActivity(initialActivity, wildflyProfileActivityMap[profile.id]);
                  const key = `WILDFLY_PROFILE:${profile.id}`;
                  const profileLock = findConflictingLock?.({
                    resourceKey: `profile:${profile.id}`,
                    section: 'WAR',
                    profile: profile.name,
                    mode: 'WRITE',
                  });
                  return (
                    <ActivityCard
                      key={profile.id}
                      activity={activity}
                      title={activity.profileName || profile.name}
                      subtitle={activity.version || profile.version}
                      lastDeployedUser={profile.lastDeployedUser}
                      wildfly
                      tutorialExpanded={tutorialActive && tutorialExpandedProfileId === profile.id ? true : undefined}
                      tourTarget={
                        tutorialActive && tutorialProfile?.id === profile.id ? 'dashboard-tutorial-profile-card' : undefined
                      }
                      detailsTourTarget={
                        tutorialActive && tutorialProfile?.id === profile.id ? 'dashboard-tutorial-profile-details' : undefined
                      }
                    >
                      <div className="flex w-full flex-wrap gap-2" data-testid={`profile-actions-primary-${profile.id}`}>
                        <LockNotice lock={profileLock} />
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          disabled={!activity.serverLogAvailable}
                          data-tour={
                            tutorialActive && tutorialProfile?.id === profile.id ? 'dashboard-tutorial-view-output' : undefined
                          }
                          onClick={() => viewOutput(activity, `Profile · ${profile.name}`)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View output
                        </Button>
                        <Button
                          size="sm"
                          className="gap-2"
                          disabled={submitting === key || busyStates.has(activity.status ?? '') || !!profileLock}
                          onClick={() => runProfilePower(profile, activity)}
                        >
                          {submitting === key ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Power className="w-3.5 h-3.5" />
                          )}
                          {activity.status === 'STARTING'
                            ? 'Starting…'
                            : activity.status === 'STOPPING'
                              ? 'Stopping…'
                              : activity.status === 'ACTIVE'
                                ? 'Stop'
                                : 'Start'}
                        </Button>
                      </div>
                      <div className="w-full" data-testid={`profile-actions-secondary-${profile.id}`}>
                        <RollbackButton
                          profileId={profile.id}
                          profileName={profile.name}
                          disabled={submitting === key || busyStates.has(activity.status ?? '') || !!profileLock}
                          open={tutorialActive ? tutorialRollbackProfileId === profile.id : undefined}
                          tourTarget={
                            tutorialActive && tutorialProfile?.id === profile.id ? 'dashboard-tutorial-rollback' : undefined
                          }
                        />
                      </div>
                    </ActivityCard>
                  );
                })}
              </div>
              {filteredProfiles.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                  <span>
                    Showing {wildflyRangeStart}–{wildflyRangeEnd} of {filteredProfiles.length} profiles
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={wildflyPage === 0}
                      onClick={() => setWildflyPage((current) => Math.max(0, current - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Previous
                    </Button>
                    <span aria-label="WildFly profile page">
                      Page {wildflyPage + 1} of {wildflyPageCount}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={wildflyPage >= wildflyPageCount - 1}
                      onClick={() => setWildflyPage((current) => Math.min(wildflyPageCount - 1, current + 1))}
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
              {!profiles.length ? (
                <p className="empty-state">No valid WildFly launchers were discovered.</p>
              ) : debouncedProfileQuery.trim() && !filteredProfiles.length ? (
                <p className="empty-state">
                  No profiles match &ldquo;{debouncedProfileQuery.trim()}&rdquo; for {version}.
                </p>
              ) : (
                !versionProfiles.length && <p className="empty-state">No profiles found for this version.</p>
              )}
            </section>
            <section data-tour="dashboard-jars">
              <h2 className="text-lg font-semibold mb-1">Backend JAR applications</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Configured applications discovered in the backend-JAR catalogue.
              </p>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                {jars.map((jar) => {
                  const initialActivity: RuntimeActivityModel = {
                    id: jar.id ?? '',
                    applicationName: jar.applicationName,
                    jarName: jar.jarName,
                    status: jar.status,
                    health: jar.health,
                  };
                  const liveActivity = jarProfileActivityMap[jar.id || ''];
                  const activity = overlayRuntimeActivity(initialActivity, liveActivity);
                  const key = `JAR:${jar.id}`;
                  const jarLock = findConflictingLock?.([
                    {
                      resourceKey: `profile:${jar.id}`,
                      section: 'JAR',
                      profile: activity.applicationName || jar.applicationName,
                      mode: 'WRITE',
                    },
                    {
                      resourceKey: `port:${activity.applicationPort}`,
                      section: 'JAR',
                      profile: activity.applicationName || jar.applicationName,
                      mode: 'WRITE',
                    },
                  ]);
                  return (
                    <ActivityCard
                      key={jar.id}
                      activity={activity}
                      title={activity.applicationName || jar.applicationName}
                      subtitle={activity.jarName}
                      lastDeployedUser={jar.lastDeployedUser}
                    >
                      <JarFrontendDetails activity={activity} />
                      <LockNotice lock={jarLock} />
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={!activity.terminalDeploymentId || activity.terminalAvailable !== true}
                        onClick={() => viewOutput(activity, `JAR · ${activity.applicationName || jar.applicationName}`, 'JAR')}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View output
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={
                          activity.status !== 'ACTIVE' || submitting === key || busyStates.has(activity.status ?? '') || !!jarLock
                        }
                        onClick={() =>
                          runRestart(
                            key,
                            () => stopJar(activity.applicationName || jar.applicationName),
                            `Stop JAR · ${activity.applicationName || jar.applicationName}`,
                            `Stop ${activity.applicationName || jar.applicationName}? Its managed Java process and log capture will be closed.`,
                          )
                        }
                      >
                        <Power className="w-3.5 h-3.5" />
                        Stop
                      </Button>
                      <Button
                        size="sm"
                        className="gap-2"
                        disabled={submitting === key || busyStates.has(activity.status ?? '') || !!jarLock}
                        onClick={() =>
                          runRestart(
                            key,
                            () => restartJar(activity.applicationName || jar.applicationName),
                            `Restart JAR · ${activity.applicationName || jar.applicationName}`,
                            `Restart ${activity.applicationName || jar.applicationName}? The running process will be stopped and started again.`,
                          )
                        }
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restart
                      </Button>
                      <JarRollbackButton
                        resourceId={jar.id}
                        applicationName={activity.applicationName || jar.applicationName}
                        disabled={submitting === key || busyStates.has(activity.status ?? '') || !!jarLock}
                      />
                    </ActivityCard>
                  );
                })}
              </div>
              {!jars.length && <p className="empty-state">No deployable JAR applications were found.</p>}
            </section>
          </div>
        )}
      </div>
      {tutorialJarDemo && <JarTutorialDemoCard />}
    </Page>
  );
}

function JarTutorialDemoCard() {
  return (
    <section data-tour="dashboard-tutorial-jar-example" className="mx-auto max-w-xl">
      <Card className="border-primary/40 bg-card shadow-sm">
        <CardHeader className="p-5 pb-3">
          <div className="flex justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-green-500/15 text-green-700">
                <Server className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Example orders service</CardTitle>
                <CardDescription className="mt-1">orders-service.jar</CardDescription>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant="success">ACTIVE</Badge>
              <Badge variant="success">FUNCTIONAL</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-5 pt-0 text-sm">
          <p className="font-medium text-green-700">Healthy — process and port verified</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Java PID</dt>
            <dd>4080</dd>
            <dt className="text-muted-foreground">Application port</dt>
            <dd>14000</dd>
            <dt className="text-muted-foreground">Deployments</dt>
            <dd>16</dd>
          </dl>
          <div className="rounded-md border border-border p-3 text-xs">
            <p className="mb-2 font-semibold tracking-wide text-muted-foreground">ASSOCIATED FRONTEND</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Profile</dt>
              <dd>orders-ui</dd>
              <dt className="text-muted-foreground">URL</dt>
              <dd>https://qc.example/orders</dd>
              <dt className="text-muted-foreground">Directory</dt>
              <dd>Available</dd>
              <dt className="text-muted-foreground">Health</dt>
              <dd>FUNCTIONAL</dd>
              <dt className="text-muted-foreground">Current JAR</dt>
              <dd>orders-service.jar</dd>
            </dl>
          </div>
          <p className="text-xs text-muted-foreground">Tutorial example — no live deployment is selected.</p>
        </CardContent>
      </Card>
    </section>
  );
}

function ActivityCard({
  activity,
  title,
  subtitle,
  lastDeployedUser,
  wildfly = false,
  tutorialExpanded,
  tourTarget,
  detailsTourTarget,
  children,
}: {
  activity: RuntimeActivityModel;
  title: string;
  subtitle: string | null | undefined;
  lastDeployedUser: string | null | undefined;
  wildfly?: boolean;
  tutorialExpanded?: boolean;
  tourTarget?: string;
  detailsTourTarget?: string;
  children: React.ReactNode;
}) {
  const active = activity.status === 'ACTIVE';
  const healthWarning = ['MISSING', 'NOT_FUNCTIONAL'].includes(activity.health ?? '');
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const expanded = wildfly ? (tutorialExpanded ?? expandedOverride ?? active) : true;
  const detailsId = useId();

  return (
    <Card
      className={`${active ? 'border-green-500/35 bg-green-500/5' : ''} ${activity.health === 'MISSING' ? 'ring-1 ring-red-500/70' : ''}`}
      data-tour={tourTarget}
    >
      <CardHeader className={wildfly ? 'p-4 pb-2' : 'p-5 pb-3'}>
        <div className="flex justify-between gap-3">
          <div className={`flex min-w-0 ${wildfly ? 'gap-2.5' : 'gap-3'}`}>
            <div
              className={`${wildfly ? 'h-8 w-8' : 'h-9 w-9'} grid shrink-0 place-items-center rounded-md ${active ? 'bg-green-500/15 text-green-700' : 'bg-muted text-muted-foreground'}`}
            >
              <Server className={wildfly ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
            </div>
            <div className="min-w-0">
              <CardTitle className={`${wildfly ? 'text-sm' : 'text-base'} truncate`}>{title}</CardTitle>
              <CardDescription className={`${wildfly ? 'text-xs' : ''} mt-1 truncate`}>
                {subtitle || 'No artifact reported'}
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={active ? 'success' : activity.status === 'FAILED' ? 'destructive' : 'muted'}>{activity.status}</Badge>
            <Badge variant={healthWarning ? 'destructive' : activity.health === 'FUNCTIONAL' ? 'success' : 'muted'}>
              {activity.health}
            </Badge>
            {wildfly && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-expanded={expanded}
                aria-controls={detailsId}
                title={expanded ? 'Collapse profile details' : 'Expand profile details'}
                onClick={() => setExpandedOverride(!expanded)}
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                <span className="sr-only">{expanded ? 'Collapse profile details' : 'Expand profile details'}</span>
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className={`${wildfly ? 'p-4 pt-0' : 'p-5 pt-0'} space-y-3`}>
        {healthWarning && (
          <Notice tone={activity.health === 'MISSING' ? 'error' : 'warning'}>
            <strong>{activity.health}</strong>
            {wildfly && activity.health === 'NOT_FUNCTIONAL' && ` · ${activity.consecutiveFailures || 0} consecutive failures`}
          </Notice>
        )}
        {!wildfly && activity.readinessStatus && activity.readinessStatus in readinessLabels && (
          <p className="text-sm font-medium text-green-700" role="status">
            {readinessLabels[activity.readinessStatus as keyof typeof readinessLabels]}
          </p>
        )}
        {!wildfly && activity.readinessReason && (
          <p className="text-xs text-muted-foreground">Readiness diagnostic: {activity.readinessReason}</p>
        )}
        {lastDeployedUser && (
          <p className="text-xs text-muted-foreground">
            Last deployed by <span className="font-medium text-foreground">{lastDeployedUser}</span>
          </p>
        )}
        <div id={detailsId} hidden={!expanded} data-tour={detailsTourTarget}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{wildfly ? 'PID' : 'Java PID'}</dt>
            <dd>{activity.pid ?? 'Unavailable'}</dd>
            {!wildfly && (
              <>
                <dt className="text-muted-foreground">Application port</dt>
                <dd>{activity.applicationPort ?? '—'}</dd>
              </>
            )}
            {wildfly && (
              <>
                <dt className="text-muted-foreground">Application</dt>
                <dd>{activity.application ?? 'No WAR history'}</dd>
                <dt className="text-muted-foreground">Port offset</dt>
                <dd>{activity.offset ?? '—'}</dd>
                <dt className="text-muted-foreground">Application port</dt>
                <dd>{activity.applicationPort ?? '—'}</dd>
                <dt className="text-muted-foreground">Management port</dt>
                <dd>{activity.managementPort ?? '—'}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Deployments</dt>
            <dd>{activity.deployCount ?? 0}</dd>
            {wildfly && (
              <>
                <dt className="text-muted-foreground">Failed deployments</dt>
                <dd>{activity.failedDeployCount ?? 0}</dd>
                <dt className="text-muted-foreground">Consecutive failures</dt>
                <dd>{activity.consecutiveFailures ?? 0}</dd>
              </>
            )}
            {activity.activeOperationId && (
              <>
                <dt className="text-muted-foreground">Active operation</dt>
                <dd className="truncate" title={activity.activeOperationId}>
                  {activity.activeOperationId}
                </dd>
              </>
            )}
            {wildfly && (
              <>
                <dt className="text-muted-foreground">Last deployment</dt>
                <dd>{activity.lastDeploymentOn ? new Date(activity.lastDeploymentOn).toLocaleString() : '—'}</dd>
                <dt className="text-muted-foreground">Last successful deployment</dt>
                <dd>
                  {activity.lastSuccessfulDeploymentOn ? new Date(activity.lastSuccessfulDeploymentOn).toLocaleString() : '—'}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Last update</dt>
            <dd>{activity.lastUpdatedOn ? new Date(activity.lastUpdatedOn).toLocaleString() : '—'}</dd>
            {wildfly && (
              <>
                <dt className="text-muted-foreground">Latest result</dt>
                <dd className={activity.lastResult === 'FAILED' ? 'font-medium text-red-700' : ''}>
                  {activity.lastResult || '—'}
                </dd>
              </>
            )}
          </dl>
        </div>
        <div className="flex flex-wrap gap-2">{children}</div>
      </CardContent>
    </Card>
  );
}

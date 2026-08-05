import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import {
  eventUrl,
  getLocks,
  getProfiles,
  getRuntimeResource,
  onLockConflict,
  reportUserActivity,
  techDriveHeaders,
  validateUser,
} from '@/lib/contractApi';
import {
  findConflictingLock as findLockConflict,
  normalizeUsername,
  reduceLocks,
  reducePresence,
  removeExpiredLocks,
  replaceLocks,
  replacePresence,
  sortOnlineUsers,
} from '@/lib/collaborationState';
import { deploymentIdOf, withDeploymentIdentity } from '@/lib/deploymentIdentity';
import { normalizeDashboardProfile, normalizeRuntimeActivity, normalizeSystemSnapshot } from '@/lib/runtimeActivity';
import { isOperationTerminal, reduceOperationProgress, registerOperationInMap } from '@/lib/operationProgress';
import { getStoredPortalUsername, PORTAL_USERNAME_SESSION_KEY } from '@/lib/portalSession';
import { UPLOAD_EVENT_TYPES } from '@/lib/uploadContract';
import { formatCompletionNotification } from '@/lib/operationNotifications';

const PortalContext = createContext(null);
const systemEvents = [
  'RESOURCE_STARTING',
  'RESOURCE_DEPLOYING',
  'RESOURCE_ACTIVE',
  'RESOURCE_STOPPING',
  'RESOURCE_INACTIVE',
  'RESOURCE_FAILED',
  'DEPLOYMENT_SUCCEEDED',
  'DEPLOYMENT_FAILED',
  'TERMINAL_AVAILABLE',
  'TERMINAL_CLOSED',
  'WAR_PREFLIGHT_READY',
  'WAR_PREFLIGHT_CANCELLED',
  'DEPLOYMENT_LOG_AVAILABLE',
  'FRONTEND_INACTIVE',
  'FRONTEND_PROFILE_UNRESOLVED',
  'FRONTEND_CONFIGURATION_INVALID',
  'PROFILE_LOG_UNAVAILABLE',
];
const frontendWarningEvents = new Set(['FRONTEND_INACTIVE', 'FRONTEND_PROFILE_UNRESOLVED', 'FRONTEND_CONFIGURATION_INVALID']);
const jarReconciliationEvents = new Set(['RESOURCE_ACTIVE', 'RESOURCE_FAILED', 'DEPLOYMENT_SUCCEEDED', 'DEPLOYMENT_FAILED']);
const eventStatuses = {
  RESOURCE_STARTING: 'STARTING',
  RESOURCE_DEPLOYING: 'DEPLOYING',
  RESOURCE_ACTIVE: 'ACTIVE',
  RESOURCE_STOPPING: 'STOPPING',
  RESOURCE_INACTIVE: 'INACTIVE',
  RESOURCE_FAILED: 'FAILED',
};
const mapById = (items) =>
  Object.fromEntries((Array.isArray(items) ? items : []).filter((item) => item?.id).map((item) => [item.id, item]));
export const mapFrontendProfiles = (items) =>
  Object.fromEntries(
    (Array.isArray(items) ? items : []).filter((item) => item?.profileUuid).map((item) => [item.profileUuid, item]),
  );

export function buildActivityMapsFromSnapshot(resources, currentMaps = {}) {
  const snapshot = normalizeSystemSnapshot(resources);
  const current = {
    wildflyProfileActivityMap: {},
    jarProfileActivityMap: {},
    frontendProfileActivityMap: {},
    ...currentMaps,
  };
  return {
    wildflyProfileActivityMap: Array.isArray(resources?.wildflyProfiles)
      ? mapById(snapshot.wildflyProfiles)
      : current.wildflyProfileActivityMap,
    jarProfileActivityMap: Array.isArray(resources?.jarProfiles)
      ? mapById(snapshot.jarProfiles)
      : current.jarProfileActivityMap,
    frontendProfileActivityMap: Array.isArray(resources?.frontendProfiles)
      ? mapFrontendProfiles(snapshot.frontendProfiles)
      : current.frontendProfileActivityMap,
  };
}

export function reconcileOperationsWithSnapshot(operations, snapshot) {
  const activeIds = new Set(
    [...snapshot.wildflyProfiles, ...snapshot.jarProfiles].map((activity) => activity.activeOperationId).filter(Boolean),
  );
  return Object.fromEntries(
    Object.entries(operations).filter(([operationId, operation]) => activeIds.has(operationId) || isOperationTerminal(operation)),
  );
}
const eventResourceType = (event) =>
  event.resourceType || (String(event.resourceKey || '').startsWith('JAR:') ? 'JAR' : 'WILDFLY_PROFILE');
const eventResourceId = (event) =>
  String(
    eventResourceType(event) === 'JAR'
      ? event.resourceKey || event.resources?.id || ''
      : event.profileId || event.resourceKey || event.resources?.id || '',
  ).replace(/^(WILDFLY_PROFILE|JAR):/, '');
const eventProfileId = (event) => String(event.profileId || eventResourceId(event) || '');

export const isFrontendWarningEvent = (eventType) => frontendWarningEvents.has(eventType);

export function jarResourceKeyForReconciliation(event) {
  if (!event?.resourceKey || !jarReconciliationEvents.has(event.eventType) || eventResourceType(event) !== 'JAR') return null;
  return event.resourceType ? `${event.resourceType}:${eventResourceId(event)}` : event.resourceKey;
}

export function mergeOperationEventRecord(currentRecord, event) {
  const deploymentId = deploymentIdOf(event);
  const jarTerminalEvent = eventResourceType(event) === 'JAR';
  const auxiliaryEvent = isFrontendWarningEvent(event.eventType) || event.eventType === 'DEPLOYMENT_LOG_AVAILABLE';
  const terminalAvailabilityConfirmed =
    jarTerminalEvent && event.eventType === 'TERMINAL_AVAILABLE'
      ? true
      : jarTerminalEvent && event.eventType === 'TERMINAL_CLOSED'
        ? false
        : currentRecord?.terminalAvailabilityConfirmed;
  return {
    ...currentRecord,
    ...withDeploymentIdentity(event),
    deploymentId,
    statusEvent: auxiliaryEvent ? currentRecord?.statusEvent : event.eventType,
    message: auxiliaryEvent ? currentRecord?.message : (event.message ?? currentRecord?.message),
    logAvailable: event.eventType === 'DEPLOYMENT_LOG_AVAILABLE' || currentRecord?.logAvailable,
    frontendWarning: isFrontendWarningEvent(event.eventType) ? event.message : currentRecord?.frontendWarning,
    ...(terminalAvailabilityConfirmed !== undefined ? { terminalAvailabilityConfirmed } : {}),
  };
}

export function mergeActivityMap(map, event) {
  const id = eventResourceId(event);
  if (!id) return map;
  const deploymentId = deploymentIdOf(event);
  if (event.eventType === 'TERMINAL_AVAILABLE') {
    if (eventResourceType(event) === 'WILDFLY_PROFILE') {
      return {
        ...map,
        [id]: {
          id,
          ...map[id],
          serverLogAvailable: true,
        },
      };
    }
    if (!map[id] || !deploymentId) return map;
    return {
      ...map,
      [id]: {
        ...map[id],
        terminalDeploymentId: deploymentId,
        terminalAvailable: true,
      },
    };
  }
  if (event.eventType === 'PROFILE_LOG_UNAVAILABLE') {
    return {
      ...map,
      [id]: {
        id,
        ...map[id],
        serverLogAvailable: false,
      },
    };
  }
  if (event.eventType === 'TERMINAL_CLOSED') {
    if (eventResourceType(event) !== 'JAR') return map;
    if (!map[id] || !deploymentId || map[id].terminalDeploymentId !== deploymentId) return map;
    return {
      ...map,
      [id]: {
        ...map[id],
        terminalAvailable: false,
      },
    };
  }
  const payload = event.resources?.activity || (event.resources?.id ? event.resources : {});
  const status = event.state || eventStatuses[event.eventType];
  const hasActiveOperationId = Object.prototype.hasOwnProperty.call(event, 'activeOperationId');
  return {
    ...map,
    [id]: {
      id,
      ...map[id],
      ...payload,
      ...(status ? { status } : {}),
      ...(event.pid !== undefined ? { pid: event.pid } : {}),
      ...(event.deployCount !== undefined ? { deployCount: event.deployCount } : {}),
      ...(event.failedDeployCount !== undefined ? { failedDeployCount: event.failedDeployCount } : {}),
      ...(event.consecutiveFailures !== undefined ? { consecutiveFailures: event.consecutiveFailures } : {}),
      ...(event.lastResult !== undefined ? { lastResult: event.lastResult } : {}),
      ...(event.hasBackup !== undefined ? { hasBackup: event.hasBackup } : {}),
      ...(Object.prototype.hasOwnProperty.call(event, 'backupSnapshotId') ? { backupSnapshotId: event.backupSnapshotId } : {}),
      ...(event.timestamp ? { lastUpdatedOn: event.timestamp } : {}),
      ...(hasActiveOperationId ? { activeOperationId: event.activeOperationId } : {}),
    },
  };
}

export function PortalProvider({ children }) {
  const [username, setUsername] = useState(getStoredPortalUsername);
  const [validated, setValidated] = useState(false);
  const [validationState, setValidationState] = useState(username ? 'validating' : 'idle');
  const [validationError, setValidationError] = useState('');
  const [activityMaps, setActivityMaps] = useState({
    wildflyProfileActivityMap: {},
    jarProfileActivityMap: {},
    frontendProfileActivityMap: {},
  });
  const [systemStatus, setSystemStatus] = useState('disconnected');
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const [lastSystemEvent, setLastSystemEvent] = useState(null);
  const [operations, setOperations] = useState({});
  const [viewingOperation, setViewingOperation] = useState(null);
  const [profileLogLines, setProfileLogLines] = useState({});
  const [presenceState, setPresenceState] = useState(() => replacePresence([]));
  const [lockState, setLockState] = useState(() => replaceLocks([]));
  const [operationToasts, setOperationToasts] = useState([]);
  const mapsRef = useRef(activityMaps);
  const operationsRef = useRef(operations);
  const completionKeysRef = useRef([]);
  const lastActivityReportRef = useRef(null);
  const lockLabelsRef = useRef({});
  const lockLabelOrderRef = useRef([]);
  useEffect(() => {
    mapsRef.current = activityMaps;
  }, [activityMaps]);
  useEffect(() => {
    operationsRef.current = operations;
  }, [operations]);
  const updateOperations = useCallback((updater) => {
    setOperations((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      operationsRef.current = next;
      return next;
    });
  }, []);

  const mergeActivity = useCallback((activity, resourceType) => {
    if (!activity?.id) return;
    const jar = resourceType === 'JAR' || 'applicationName' in activity;
    const key = jar ? 'jarProfileActivityMap' : 'wildflyProfileActivityMap';
    setActivityMaps((current) => {
      const existing = current[key][activity.id];
      return { ...current, [key]: { ...current[key], [activity.id]: { ...existing, ...activity } } };
    });
  }, []);

  const replaceProfileActivities = useCallback((profiles) => {
    const activities = (Array.isArray(profiles) ? profiles : []).map(normalizeDashboardProfile).filter(Boolean);
    setActivityMaps((current) => ({
      ...current,
      wildflyProfileActivityMap: mapById(activities),
    }));
    return activities;
  }, []);

  const reconcileResourceActivity = useCallback(
    async (resourceKey) => {
      if (!resourceKey) return null;
      const resource = await getRuntimeResource(resourceKey);
      const activity = normalizeRuntimeActivity(resource);
      if (activity) mergeActivity(activity, resource.resourceType);
      return activity;
    },
    [mergeActivity],
  );

  const reconcileProfileActivity = useCallback(
    async (profileId) => {
      const activities = replaceProfileActivities(await getProfiles());
      return profileId ? activities.find((activity) => activity.id === profileId) || null : activities;
    },
    [replaceProfileActivities],
  );

  const rememberLockLabel = useCallback((lock) => {
    const operationId = String(lock?.deploymentId || '');
    const label = String(lock?.profile || '').trim();
    if (!operationId || !label) return;
    lockLabelsRef.current = { ...lockLabelsRef.current, [operationId]: label };
    lockLabelOrderRef.current = [...lockLabelOrderRef.current.filter((id) => id !== operationId), operationId].slice(-100);
    const retained = new Set(lockLabelOrderRef.current);
    lockLabelsRef.current = Object.fromEntries(Object.entries(lockLabelsRef.current).filter(([id]) => retained.has(id)));
  }, []);

  const reconcileLocks = useCallback(async () => {
    const items = await getLocks();
    const activeLocks = Array.isArray(items) ? items : [];
    setLockState(replaceLocks(activeLocks));
    activeLocks.forEach(rememberLockLabel);
    return activeLocks;
  }, [rememberLockLabel]);

  const reportInteraction = useCallback(() => {
    const now = Date.now();
    if (lastActivityReportRef.current !== null && now - lastActivityReportRef.current < 30000) return false;
    lastActivityReportRef.current = now;
    reportUserActivity().catch(() => {});
    return true;
  }, []);

  const dismissOperationToast = useCallback((id) => {
    setOperationToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const clearProfileLogs = useCallback((profileId) => {
    if (!profileId) return;
    setProfileLogLines((current) => ({ ...current, [profileId]: [] }));
  }, []);

  const acceptUser = useCallback(async (candidate) => {
    const entered = candidate.trim();
    if (!entered) {
      setValidationError('Enter your username.');
      return false;
    }
    setValidationState('validating');
    setValidationError('');
    try {
      await validateUser(entered);
      sessionStorage.setItem(PORTAL_USERNAME_SESSION_KEY, entered);
      setUsername(entered);
      setValidated(true);
      setValidationState('valid');
      return true;
    } catch (error) {
      sessionStorage.removeItem(PORTAL_USERNAME_SESSION_KEY);
      setValidated(false);
      setValidationState('invalid');
      setValidationError(error.message);
      return false;
    }
  }, []);

  useEffect(() => {
    if (username && !validated) acceptUser(username);
  }, [acceptUser, username, validated]);

  useEffect(() => {
    if (!validated || !username) return undefined;
    const pointerOptions = { passive: true };
    const visible = () => {
      if (document.visibilityState === 'visible') reportInteraction();
    };
    window.addEventListener('pointerdown', reportInteraction, pointerOptions);
    window.addEventListener('pointermove', reportInteraction, pointerOptions);
    window.addEventListener('keydown', reportInteraction);
    window.addEventListener('focus', reportInteraction);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('pointerdown', reportInteraction, pointerOptions);
      window.removeEventListener('pointermove', reportInteraction, pointerOptions);
      window.removeEventListener('keydown', reportInteraction);
      window.removeEventListener('focus', reportInteraction);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [reportInteraction, username, validated]);

  useEffect(() => {
    if (!validated) return undefined;
    return onLockConflict(() => {
      reconcileLocks().catch(() => {});
    });
  }, [reconcileLocks, validated]);

  useEffect(() => {
    const expiries = Object.values(lockState.locks)
      .map((lock) => (lock.expiresAt ? new Date(lock.expiresAt).getTime() : 0))
      .filter((time) => time > 0);
    if (!expiries.length) return undefined;
    const delay = Math.max(0, Math.min(...expiries) - Date.now() + 1);
    const timer = window.setTimeout(() => setLockState((current) => removeExpiredLocks(current)), Math.min(delay, 2147483647));
    return () => window.clearTimeout(timer);
  }, [lockState.locks]);

  useEffect(() => {
    if (!validated || !username) return undefined;
    let opened = false;
    const controller = new AbortController();
    setSystemStatus('connecting');
    const handleOpen = () => {
      setSystemStatus('connected');
      if (opened) {
        reconcileLocks().catch(() => {});
      }
      opened = true;
    };

    const handleMessage = (message) => {
      if (!String(message.data || '').trim()) return;
      try {
        const payload = JSON.parse(message.data);
        const event = {
          ...payload,
          eventType: payload.eventType || message.event || 'message',
        };
        if (event.eventType === 'SYSTEM_SNAPSHOT') {
          const snapshot = normalizeSystemSnapshot(event.resources);
          const nextMaps = buildActivityMapsFromSnapshot(event.resources, mapsRef.current);
          mapsRef.current = nextMaps;
          setActivityMaps(nextMaps);
          setSnapshotRevision((current) => current + 1);
          updateOperations((current) => reconcileOperationsWithSnapshot(current, snapshot));
          const activeIds = new Set(
            [...snapshot.wildflyProfiles, ...snapshot.jarProfiles].map((activity) => activity.activeOperationId).filter(Boolean),
          );
          const terminalIds = new Set(
            snapshot.jarProfiles
              .filter((activity) => activity.terminalAvailable === true)
              .map((activity) => activity.terminalDeploymentId)
              .filter(Boolean),
          );
          setViewingOperation((current) => {
            const operationId = deploymentIdOf(current);
            if (!operationId || activeIds.has(operationId) || terminalIds.has(operationId)) return current;
            const resourceKey = String(current?.resourceKey || '');
            if (current?.resourceType === 'JAR' || resourceKey.startsWith('JAR:')) return null;
            return isOperationTerminal(operationsRef.current[operationId]) ? current : null;
          });
          setPresenceState(replacePresence(event.resources?.onlineUsers));
          const snapshotLocks = Array.isArray(event.resources?.locks) ? event.resources.locks : [];
          setLockState(replaceLocks(snapshotLocks));
          snapshotLocks.forEach(rememberLockLabel);
          setLastSystemEvent(event);
          return;
        }
        if (event.eventType === 'USER_PRESENCE_CHANGED') {
          setPresenceState((current) => reducePresence(current, event));
          return;
        }
        if (event.eventType === 'LOCK_CHANGED') {
          rememberLockLabel(event.resources?.lock);
          setLockState((current) => reduceLocks(current, event));
          return;
        }
        if (event.eventType === 'OPERATION_FINISHED') {
          const details = event.resources || {};
          const operationId = String(details.operationId || event.deploymentId || '');
          const outcome = details.outcome || event.state;
          const key = `${operationId}:${outcome}`;
          const section = String(details.section || '').toUpperCase();
          const resourceKey = details.resourceKey || event.resourceKey;
          const resourceId = String(resourceKey || '').replace(/^(WILDFLY_PROFILE|JAR|FRONTEND_PROFILE):/, '');
          const frontendHotfix =
            section === 'HOTFIX' &&
            Object.values(mapsRef.current.frontendProfileActivityMap).some((profile) => profile.profileUuid === resourceId);
          let reconciliation = Promise.resolve(null);
          if ((section === 'WAR' || (details.resourceType === 'WILDFLY_PROFILE' && !frontendHotfix)) && resourceKey) {
            reconciliation = Promise.all([
              reconcileResourceActivity(`WILDFLY_PROFILE:${resourceId}`).catch(() => null),
              reconcileProfileActivity(resourceId).catch(() => null),
            ]).then(([runtime, profile]) => profile || runtime);
          } else if ((section === 'JAR' || details.resourceType === 'JAR') && resourceKey) {
            reconciliation = reconcileResourceActivity(resourceKey).catch(() => null);
          }
          if (operationId && outcome && !completionKeysRef.current.includes(key)) {
            completionKeysRef.current = [...completionKeysRef.current, key].slice(-100);
            if (normalizeUsername(event.username || details.username) !== normalizeUsername(username)) {
              void reconciliation.then((resolvedResource) => {
                const toast = formatCompletionNotification(event, {
                  activityMaps: mapsRef.current,
                  lockLabels: lockLabelsRef.current,
                  resolvedResource,
                });
                setOperationToasts((current) => [...current, toast].slice(-5));
              });
            }
          }
          setLastSystemEvent(event);
          void reconciliation;
          return;
        }
        if (event.eventType === 'OPERATION_PROGRESS') {
          updateOperations((current) => reduceOperationProgress(current, event));
          if (event.resources?.status === 'COMPLETED') setLastSystemEvent(event);
          return;
        }
        if (event.eventType === 'PROFILE_LOG') {
          const profileId = eventProfileId(event);
          if (!profileId || typeof event.line !== 'string') return;
          setProfileLogLines((current) => ({
            ...current,
            [profileId]: [...(current[profileId] || []).slice(-999), event],
          }));
          return;
        }
        if (UPLOAD_EVENT_TYPES.has(event.eventType)) {
          setLastSystemEvent(event);
          return;
        }
        if (!systemEvents.includes(event.eventType)) return;
        const jarEvent = eventResourceType(event) === 'JAR';
        setActivityMaps((current) => ({
          wildflyProfileActivityMap: jarEvent
            ? current.wildflyProfileActivityMap
            : mergeActivityMap(current.wildflyProfileActivityMap, event),
          jarProfileActivityMap: jarEvent
            ? mergeActivityMap(current.jarProfileActivityMap, event)
            : current.jarProfileActivityMap,
        }));
        setLastSystemEvent(event);
        if (event.eventType === 'PROFILE_LOG_UNAVAILABLE') {
          const profileId = eventProfileId(event);
          setViewingOperation((current) =>
            current?.resourceType === 'WILDFLY_PROFILE' && current.profileId === profileId
              ? { ...current, profileLogUnavailable: true }
              : current,
          );
        }
        if (event.eventType === 'TERMINAL_AVAILABLE' && eventResourceType(event) === 'WILDFLY_PROFILE') {
          reconcileProfileActivity(eventProfileId(event)).catch(() => {});
        }
        const jarResourceKey = jarResourceKeyForReconciliation(event);
        if (jarResourceKey) reconcileResourceActivity(jarResourceKey).catch(() => {});
        const deploymentId = deploymentIdOf(event);
        if (deploymentId)
          updateOperations((current) => ({
            ...current,
            [deploymentId]: mergeOperationEventRecord(current[deploymentId], event),
          }));
      } catch {
        /* ignore malformed or unsupported event payloads; stream state is unchanged */
      }
    };

    void fetchEventSource(eventUrl('/system/events'), {
      method: 'GET',
      headers: techDriveHeaders(username),
      signal: controller.signal,
      openWhenHidden: true,
      onopen: async (response) => {
        if (!response.ok) throw new Error(`System event stream returned ${response.status}`);
        handleOpen();
      },
      onmessage: handleMessage,
      onclose: () => {
        if (!controller.signal.aborted) {
          setSystemStatus('reconnecting');
          throw new Error('System event stream closed');
        }
      },
      onerror: () => {
        if (!controller.signal.aborted) setSystemStatus('reconnecting');
        return 3000;
      },
    }).catch(() => {
      if (!controller.signal.aborted) setSystemStatus('reconnecting');
    });
    return () => controller.abort();
  }, [
    username,
    validated,
    reconcileLocks,
    reconcileProfileActivity,
    reconcileResourceActivity,
    rememberLockLabel,
    updateOperations,
  ]);

  const changeUser = useCallback(() => {
    sessionStorage.removeItem(PORTAL_USERNAME_SESSION_KEY);
    setValidated(false);
    setUsername('');
    setActivityMaps({ wildflyProfileActivityMap: {}, jarProfileActivityMap: {}, frontendProfileActivityMap: {} });
    updateOperations({});
    setViewingOperation(null);
    setProfileLogLines({});
    setPresenceState(replacePresence([]));
    setLockState(replaceLocks([]));
    setOperationToasts([]);
    completionKeysRef.current = [];
    lastActivityReportRef.current = null;
    lockLabelsRef.current = {};
    lockLabelOrderRef.current = [];
    setValidationState('idle');
    setSystemStatus('disconnected');
    setSnapshotRevision(0);
  }, [updateOperations]);

  const registerOperation = useCallback(
    (operation, resourceKey, label) => {
      const record = { ...withDeploymentIdentity(operation), resourceKey, label, registered: true };
      updateOperations((current) => registerOperationInMap(current, operation, resourceKey, label));
      setViewingOperation(record);
      return record;
    },
    [updateOperations],
  );

  const onlineUsers = useMemo(() => sortOnlineUsers(presenceState.users, username), [presenceState.users, username]);
  const findConflictingLock = useCallback(
    (scopes) => findLockConflict(lockState.locks, username, scopes),
    [lockState.locks, username],
  );

  const value = useMemo(
    () => ({
      username,
      validated,
      validationState,
      validationError,
      acceptUser,
      changeUser,
      ...activityMaps,
      mergeActivity,
      replaceProfileActivities,
      reconcileProfileActivity,
      reconcileResourceActivity,
      systemStatus,
      snapshotRevision,
      lastSystemEvent,
      operations,
      registerOperation,
      viewingOperation,
      setViewingOperation,
      profileLogLines,
      clearProfileLogs,
      onlineUsers,
      locks: lockState.locks,
      findConflictingLock,
      reconcileLocks,
      reportInteraction,
      operationToasts,
      dismissOperationToast,
    }),
    [
      username,
      validated,
      validationState,
      validationError,
      acceptUser,
      changeUser,
      activityMaps,
      mergeActivity,
      replaceProfileActivities,
      reconcileProfileActivity,
      reconcileResourceActivity,
      systemStatus,
      snapshotRevision,
      lastSystemEvent,
      operations,
      registerOperation,
      viewingOperation,
      profileLogLines,
      clearProfileLogs,
      onlineUsers,
      lockState.locks,
      findConflictingLock,
      reconcileLocks,
      reportInteraction,
      operationToasts,
      dismissOperationToast,
    ],
  );
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal() {
  const value = useContext(PortalContext);
  if (!value) throw new Error('usePortal must be used within PortalProvider');
  return value;
}

export function useOptionalPortal() {
  return useContext(PortalContext);
}

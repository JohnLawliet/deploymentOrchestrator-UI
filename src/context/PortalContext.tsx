import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import type { EventSourceMessage } from '@microsoft/fetch-event-source';
import {
  BACKEND_OFFLINE_TOAST,
  eventUrl,
  getLocks,
  getProfiles,
  getRuntimeResource,
  isBackendUnavailable,
  onBackendUnavailable,
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
import { deploymentIdOf } from '@/lib/deploymentIdentity';
import { normalizeDashboardProfile, normalizeRuntimeActivity, normalizeSystemSnapshot } from '@/lib/runtimeActivity';
import {
  applyOperationFinished,
  finishRegisteredOperationOnLifecycle,
  isOperationTerminal,
  reduceTrackedOperationProgress,
  registerOperationInMap,
} from '@/lib/operationProgress';
import { getStoredPortalUsername, PORTAL_USERNAME_SESSION_KEY } from '@/lib/portalSession';
import { UPLOAD_EVENT_TYPES } from '@/lib/uploadContract';
import { formatCompletionNotification } from '@/lib/operationNotifications';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type {
  FrontendProfileActivity,
  LockInfo,
  Profile,
  SystemEvent,
  SystemSnapshot,
  UserPresence,
  WildflyProfileActivity,
  JarProfileActivity,
  ProfileLogEvent,
  RuntimeResource,
} from '@/types/api-contracts';
import type {
  FrontendProfileActivityModel,
  OperationMap,
  OperationRecord,
  OperationToast,
  SystemToast,
  ProfileLogMap,
  RuntimeActivityModel,
} from '@/types/frontend';
import { errorMessage } from '@/types/frontend';

type ActivityMaps = {
  wildflyProfileActivityMap: Record<string, RuntimeActivityModel>;
  jarProfileActivityMap: Record<string, RuntimeActivityModel>;
  frontendProfileActivityMap: Record<string, FrontendProfileActivityModel>;
};
type RuntimeActivity = RuntimeActivityModel;
type LockScope = { resourceKey?: string; section?: string; profile?: string; mode?: 'READ' | 'WRITE' };
export type PortalEvent = SystemEvent | ProfileLogEvent;
type ValidationState = 'idle' | 'validating' | 'valid' | 'invalid';
type SystemStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
type PortalContextValue = ActivityMaps & {
  username: string;
  validated: boolean;
  validationState: ValidationState;
  validationError: string;
  acceptUser: (username: string) => Promise<boolean>;
  changeUser: () => void;
  mergeActivity: (activity: Partial<RuntimeActivityModel> & { id?: string }, resourceType?: string | null) => void;
  replaceProfileActivities: (profiles: Profile[]) => RuntimeActivityModel[];
  reconcileProfileActivity: (profileId?: string) => Promise<RuntimeActivityModel | RuntimeActivityModel[] | null>;
  reconcileResourceActivity: (resourceKey: string) => Promise<RuntimeActivityModel | null>;
  systemStatus: SystemStatus;
  snapshotRevision: number;
  lastSystemEvent: PortalEvent | null;
  operations: OperationMap;
  registerOperation: (operation: Partial<OperationRecord>, resourceKey: string, label: string) => OperationRecord;
  viewingOperation: OperationRecord | null;
  setViewingOperation: Dispatch<SetStateAction<OperationRecord | null>>;
  profileLogLines: ProfileLogMap;
  clearProfileLogs: (profileId: string) => void;
  onlineUsers: UserPresence[];
  locks: Record<string, LockInfo>;
  findConflictingLock: (scopes: LockScope | LockScope[]) => LockInfo | null;
  reconcileLocks: () => Promise<LockInfo[]>;
  reportInteraction: () => boolean;
  operationToasts: OperationToast[];
  dismissOperationToast: (id: string) => void;
  systemToasts: SystemToast[];
  dismissSystemToast: (id: string) => void;
};

const PortalContext = createContext<PortalContextValue | null>(null);

/**
 * Progress is private to the initiating user.  Older servers do not always
 * include a username on progress events, so a locally accepted operation is
 * the only safe fallback in that case.
 */
export function isOwnedOperationEvent(
  event: Pick<SystemEvent, 'deploymentId' | 'username'>,
  currentUsername: string,
  operations: OperationMap,
  fallbackUsername?: string | null,
): boolean {
  const eventUsername = normalizeUsername(event.username || fallbackUsername);
  if (eventUsername) return eventUsername === normalizeUsername(currentUsername);
  const deploymentId = String(event.deploymentId || '');
  return Boolean(deploymentId && operations[deploymentId]?.initiatedByCurrentSession);
}

const allowedSystemEventTypes: Set<SystemEvent['eventType']> = new Set([
  'SYSTEM_SNAPSHOT',
  'FRONTEND_ASSOCIATION_UPDATED',
  'RUNTIME_RECONCILIATION_ISSUES',
  'RUNTIME_RECONCILIATION_RECOVERED',
  'OPERATION_PROGRESS',
  'USER_PRESENCE_CHANGED',
  'LOCK_CHANGED',
  'OPERATION_FINISHED',
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
  'UPLOAD_OPERATION_UPDATED',
  'UPLOAD_OPERATION_FAILED',
  'UPLOAD_OPERATION_COMPLETED',
  'UPLOAD_RESTART_STARTED',
  'UPLOAD_RESTART_COMPLETED',
  'UPLOAD_ITEM_PROCESSING',
  'UPLOAD_ITEM_SUCCEEDED',
  'UPLOAD_ITEM_FAILED',
  'UPLOAD_ITEM_ROLLED_BACK',
  'UPLOAD_ITEM_ROLLBACK_FAILED',
]);
const frontendWarningEvents = new Set<SystemEvent['eventType']>([
  'FRONTEND_INACTIVE',
  'FRONTEND_PROFILE_UNRESOLVED',
  'FRONTEND_CONFIGURATION_INVALID',
]);
const jarReconciliationEvents = new Set<SystemEvent['eventType']>([
  'RESOURCE_ACTIVE',
  'RESOURCE_FAILED',
  'DEPLOYMENT_SUCCEEDED',
  'DEPLOYMENT_FAILED',
]);
const eventStatuses = {
  RESOURCE_STARTING: 'STARTING',
  RESOURCE_DEPLOYING: 'DEPLOYING',
  RESOURCE_ACTIVE: 'ACTIVE',
  RESOURCE_STOPPING: 'STOPPING',
  RESOURCE_INACTIVE: 'INACTIVE',
  RESOURCE_FAILED: 'FAILED',
};
const resourceStates = new Set(['INACTIVE', 'STARTING', 'ACTIVE', 'STOPPING', 'DEPLOYING', 'FAILED']);
const systemEventScopes = new Set<SystemEvent['scope']>(['SYSTEM', 'RESOURCE', 'USER', 'OPERATION']);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isNullableString = (value: unknown): value is string | null => value == null || typeof value === 'string';
const isNullableNumber = (value: unknown): value is number | null => value == null || typeof value === 'number';
const isFrontendProfileActivity = (value: unknown): value is FrontendProfileActivity =>
  isRecord(value) &&
  typeof value.profileUuid === 'string' &&
  typeof value.profileName === 'string' &&
  typeof value.port === 'number';
const isJarProfileActivity = (value: unknown): value is JarProfileActivity =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  Object.prototype.hasOwnProperty.call(value, 'frontendProfile') &&
  (value.frontendProfile === null || isFrontendProfileActivity(value.frontendProfile));
const isProfileLogEvent = (value: unknown): value is ProfileLogEvent =>
  isRecord(value) &&
  typeof value.profileId === 'string' &&
  typeof value.timestamp === 'string' &&
  typeof value.line === 'string' &&
  typeof value.replay === 'boolean' &&
  isNullableString(value.boundaryReason);
const isSystemEvent = (value: unknown): value is SystemEvent => {
  if (
    !isRecord(value) ||
    !allowedSystemEventTypes.has(value.eventType as SystemEvent['eventType']) ||
    !systemEventScopes.has(value.scope as SystemEvent['scope'])
  )
    return false;
  if (
    typeof value.timestamp !== 'string' ||
    !isNullableString(value.deploymentId) ||
    !isNullableString(value.resourceKey) ||
    !isNullableString(value.resourceType) ||
    !isNullableString(value.state) ||
    !isNullableNumber(value.pid) ||
    !isNullableString(value.activeOperationId) ||
    !isNullableNumber(value.deployCount) ||
    !isNullableNumber(value.consecutiveFailures) ||
    !isNullableNumber(value.failedDeployCount) ||
    !isNullableString(value.lastResult) ||
    !isNullableString(value.username) ||
    !isNullableString(value.message) ||
    !isNullableString(value.application) ||
    !isNullableString(value.readiness) ||
    !isNullableString(value.readinessReason)
  )
    return false;
  const resources = value.resources;
  switch (value.eventType) {
    case 'SYSTEM_SNAPSHOT':
      return (
        isRecord(resources) &&
        Array.isArray(resources.wildflyProfiles) &&
        Array.isArray(resources.jarProfiles) &&
        Array.isArray(resources.frontendProfiles) &&
        Array.isArray(resources.onlineUsers) &&
        Array.isArray(resources.locks)
      );
    case 'FRONTEND_ASSOCIATION_UPDATED':
      return (
        value.scope === 'SYSTEM' &&
        isRecord(resources) &&
        typeof resources.deploymentId === 'string' &&
        typeof resources.jarProfileUuid === 'string' &&
        typeof resources.frontendProfileUuid === 'string' &&
        isFrontendProfileActivity(resources.frontendProfile) &&
        isJarProfileActivity(resources.jarProfile)
      );
    case 'RUNTIME_RECONCILIATION_ISSUES':
      return Array.isArray(resources);
    case 'RUNTIME_RECONCILIATION_RECOVERED':
      return resources === null;
    case 'OPERATION_PROGRESS':
      return (
        isRecord(resources) &&
        typeof resources.phaseCode === 'string' &&
        typeof resources.status === 'string' &&
        isNullableNumber(resources.progressPercentage) &&
        isNullableString(resources.component)
      );
    case 'USER_PRESENCE_CHANGED':
      return isRecord(resources) && typeof resources.username === 'string' && typeof resources.status === 'string';
    case 'LOCK_CHANGED':
      return isRecord(resources) && isRecord(resources.lock) && typeof resources.action === 'string';
    case 'OPERATION_FINISHED':
      return (
        isRecord(resources) &&
        typeof resources.operationId === 'string' &&
        typeof resources.section === 'string' &&
        typeof resources.resourceKey === 'string' &&
        typeof resources.outcome === 'string'
      );
    case 'WAR_PREFLIGHT_READY':
      return isRecord(resources) && typeof resources.ready === 'boolean';
    case 'FRONTEND_PROFILE_UNRESOLVED':
    case 'FRONTEND_INACTIVE':
    case 'FRONTEND_CONFIGURATION_INVALID':
      return typeof resources === 'string';
    default:
      return resources === null || isRecord(resources);
  }
};
export const parseSseEvent = (message: EventSourceMessage): PortalEvent | null => {
  if (!message.data.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(message.data);
    if (message.event === 'PROFILE_LOG') return isProfileLogEvent(parsed) ? parsed : null;
    if (!isRecord(parsed)) return null;
    const payload: unknown = { ...parsed, eventType: parsed.eventType ?? message.event };
    return isSystemEvent(payload) ? payload : null;
  } catch {
    return null;
  }
};
const mapById = <T extends { id: string }>(items: T[]): Record<string, T> =>
  Object.fromEntries(items.map((item) => [item.id, item]));
export const mapFrontendProfiles = (items: FrontendProfileActivityModel[]): Record<string, FrontendProfileActivityModel> =>
  Object.fromEntries(items.map((item) => [item.profileUuid, item]));

export function buildActivityMapsFromSnapshot(resources: SystemSnapshot, currentMaps: Partial<ActivityMaps> = {}): ActivityMaps {
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
    jarProfileActivityMap: Array.isArray(resources?.jarProfiles) ? mapById(snapshot.jarProfiles) : current.jarProfileActivityMap,
    frontendProfileActivityMap: Array.isArray(resources?.frontendProfiles)
      ? mapFrontendProfiles(snapshot.frontendProfiles)
      : current.frontendProfileActivityMap,
  };
}

type FrontendAssociationEvent = Extract<SystemEvent, { eventType: 'FRONTEND_ASSOCIATION_UPDATED' }>;

const sameJsonValue = (left: unknown, right: unknown) => left === right || JSON.stringify(left) === JSON.stringify(right);

export function applyFrontendAssociationUpdate(current: ActivityMaps, event: FrontendAssociationEvent): ActivityMaps {
  const { frontendProfile, jarProfile } = event.resources;
  const normalizedJar = normalizeRuntimeActivity(jarProfile);
  if (!normalizedJar) return current;
  const jarActivity: RuntimeActivityModel = { ...normalizedJar, frontendProfile: jarProfile.frontendProfile };
  const frontendChanged = !sameJsonValue(current.frontendProfileActivityMap[frontendProfile.profileUuid], frontendProfile);
  const jarChanged = !sameJsonValue(current.jarProfileActivityMap[jarProfile.id], jarActivity);
  if (!frontendChanged && !jarChanged) return current;
  return {
    ...current,
    frontendProfileActivityMap: frontendChanged
      ? { ...current.frontendProfileActivityMap, [frontendProfile.profileUuid]: frontendProfile }
      : current.frontendProfileActivityMap,
    jarProfileActivityMap: jarChanged
      ? { ...current.jarProfileActivityMap, [jarProfile.id]: jarActivity }
      : current.jarProfileActivityMap,
  };
}

export function shouldRetainOperationAfterSnapshot(
  operationId: string,
  operation: OperationRecord | undefined,
  activeIds: Set<string>,
): boolean {
  if (!operation) return false;
  // Keep registered in-flight ops until the snapshot catches up or they go terminal.
  return activeIds.has(operationId) || isOperationTerminal(operation) || !!operation.registered;
}

export function reconcileViewingOperationWithSnapshot(
  current: OperationRecord | null,
  activeIds: Set<string>,
  terminalIds: Set<string>,
  operations: OperationMap,
): OperationRecord | null {
  if (!current) return null;
  const operationId = deploymentIdOf(current);
  if (!operationId || activeIds.has(operationId) || terminalIds.has(operationId)) return current;
  const resourceKey = String(current.resourceKey || '');
  if (current.resourceType === 'JAR' || resourceKey.startsWith('JAR:')) return null;
  return shouldRetainOperationAfterSnapshot(operationId, operations[operationId], activeIds) ? current : null;
}

export function reconcileOperationsWithSnapshot(
  operations: OperationMap,
  snapshot: ReturnType<typeof normalizeSystemSnapshot>,
): OperationMap {
  const activeIds = new Set(
    [...snapshot.wildflyProfiles, ...snapshot.jarProfiles]
      .map((activity) => activity.activeOperationId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  return Object.fromEntries(
    Object.entries(operations).filter(([operationId, operation]) =>
      shouldRetainOperationAfterSnapshot(operationId, operation, activeIds),
    ),
  );
}
const eventResourceType = (event: SystemEvent): string =>
  event.resourceType || (String(event.resourceKey || '').startsWith('JAR:') ? 'JAR' : 'WILDFLY_PROFILE');
const eventResourceId = (event: SystemEvent): string =>
  String(eventResourceType(event) === 'JAR' ? event.resourceKey || '' : event.resourceKey || '').replace(
    /^(WILDFLY_PROFILE|JAR):/,
    '',
  );
const eventProfileId = (event: SystemEvent) => String(eventResourceId(event) || '');

export const isFrontendWarningEvent = (eventType: SystemEvent['eventType']) => frontendWarningEvents.has(eventType);

export function jarResourceKeyForReconciliation(event: SystemEvent): string | null {
  if (!event?.resourceKey || !jarReconciliationEvents.has(event.eventType) || eventResourceType(event) !== 'JAR') return null;
  return event.resourceType ? `${event.resourceType}:${eventResourceId(event)}` : event.resourceKey;
}

export function mergeOperationEventRecord(currentRecord: OperationRecord | undefined, event: SystemEvent): OperationRecord {
  const deploymentId = deploymentIdOf(event);
  const jarTerminalEvent = eventResourceType(event) === 'JAR';
  const auxiliaryEvent = isFrontendWarningEvent(event.eventType) || event.eventType === 'DEPLOYMENT_LOG_AVAILABLE';
  const terminalAvailabilityConfirmed =
    jarTerminalEvent && event.eventType === 'TERMINAL_AVAILABLE'
      ? true
      : jarTerminalEvent && event.eventType === 'TERMINAL_CLOSED'
        ? false
        : currentRecord?.terminalAvailabilityConfirmed;
  const restoredResourceState =
    event.eventType === 'RESOURCE_ACTIVE'
      ? 'ACTIVE'
      : event.eventType === 'RESOURCE_INACTIVE'
        ? 'INACTIVE'
        : event.eventType === 'DEPLOYMENT_FAILED' && (event.state === 'ACTIVE' || event.state === 'INACTIVE')
          ? event.state
          : (currentRecord?.restoredResourceState ?? null);
  return {
    ...(currentRecord ?? { deploymentId }),
    deploymentId,
    resourceKey: event.resourceKey ?? currentRecord?.resourceKey,
    resourceType: event.resourceType ?? currentRecord?.resourceType,
    profileId: eventResourceId(event) || currentRecord?.profileId,
    statusEvent: auxiliaryEvent ? currentRecord?.statusEvent : event.eventType,
    message: auxiliaryEvent ? currentRecord?.message : (event.message ?? currentRecord?.message),
    state: event.state ?? currentRecord?.state,
    logAvailable: event.eventType === 'DEPLOYMENT_LOG_AVAILABLE' || currentRecord?.logAvailable,
    frontendWarning: isFrontendWarningEvent(event.eventType) ? event.message : currentRecord?.frontendWarning,
    ...(terminalAvailabilityConfirmed !== undefined ? { terminalAvailabilityConfirmed } : {}),
    restoredResourceState,
  };
}

export function mergeActivityMap(map: Record<string, RuntimeActivity>, event: SystemEvent): Record<string, RuntimeActivity> {
  const id = eventResourceId(event);
  if (!id) return map;
  const deploymentId = deploymentIdOf(event);
  if (event.eventType === 'TERMINAL_AVAILABLE') {
    if (eventResourceType(event) === 'WILDFLY_PROFILE') {
      return {
        ...map,
        [id]: {
          ...map[id],
          id,
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
        ...map[id],
        id,
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
  const payload: Partial<RuntimeActivity> = {};
  const candidateStatus =
    event.state || (event.eventType in eventStatuses ? eventStatuses[event.eventType as keyof typeof eventStatuses] : undefined);
  const status =
    candidateStatus && resourceStates.has(candidateStatus) ? (candidateStatus as RuntimeActivityModel['status']) : undefined;
  const hasActiveOperationId = Object.prototype.hasOwnProperty.call(event, 'activeOperationId');
  return {
    ...map,
    [id]: {
      ...(map[id] ?? { id }),
      id,
      ...payload,
      ...(status ? { status } : {}),
      ...(event.pid !== undefined ? { pid: event.pid } : {}),
      ...(event.deployCount !== undefined ? { deployCount: event.deployCount } : {}),
      ...(event.failedDeployCount !== undefined ? { failedDeployCount: event.failedDeployCount } : {}),
      ...(event.consecutiveFailures !== undefined ? { consecutiveFailures: event.consecutiveFailures } : {}),
      ...(event.lastResult !== undefined ? { lastResult: event.lastResult } : {}),
      ...(event.timestamp ? { lastUpdatedOn: event.timestamp } : {}),
      ...(hasActiveOperationId ? { activeOperationId: event.activeOperationId } : {}),
    },
  };
}

export function PortalProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string>(getStoredPortalUsername);
  const [validated, setValidated] = useState(false);
  const [validationState, setValidationState] = useState<ValidationState>(username ? 'validating' : 'idle');
  const [validationError, setValidationError] = useState('');
  const [activityMaps, setActivityMaps] = useState<ActivityMaps>({
    wildflyProfileActivityMap: {},
    jarProfileActivityMap: {},
    frontendProfileActivityMap: {},
  });
  const [systemStatus, setSystemStatus] = useState<SystemStatus>('disconnected');
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const [lastSystemEvent, setLastSystemEvent] = useState<PortalEvent | null>(null);
  const [operations, setOperations] = useState<OperationMap>({});
  const [viewingOperation, setViewingOperationState] = useState<OperationRecord | null>(null);
  const [profileLogLines, setProfileLogLines] = useState<ProfileLogMap>({});
  const [presenceState, setPresenceState] = useState(() => replacePresence([]));
  const [lockState, setLockState] = useState(() => replaceLocks([]));
  const [operationToasts, setOperationToasts] = useState<OperationToast[]>([]);
  const [systemToasts, setSystemToasts] = useState<SystemToast[]>([]);
  const mapsRef = useRef(activityMaps);
  const operationsRef = useRef(operations);
  const viewingOperationRef = useRef(viewingOperation);
  const completionKeysRef = useRef<string[]>([]);
  const lastActivityReportRef = useRef<number | null>(null);
  const lockLabelsRef = useRef<Record<string, string>>({});
  const lockLabelOrderRef = useRef<string[]>([]);
  const systemToastSequenceRef = useRef(0);
  const validatedRef = useRef(validated);
  useEffect(() => {
    mapsRef.current = activityMaps;
  }, [activityMaps]);
  useEffect(() => {
    operationsRef.current = operations;
  }, [operations]);
  useEffect(() => {
    viewingOperationRef.current = viewingOperation;
  }, [viewingOperation]);
  useEffect(() => {
    validatedRef.current = validated;
  }, [validated]);
  const updateOperations = useCallback((updater: OperationMap | ((current: OperationMap) => OperationMap)) => {
    setOperations((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      operationsRef.current = next;
      return next;
    });
  }, []);
  const setViewingOperation = useCallback<Dispatch<SetStateAction<OperationRecord | null>>>((updater) => {
    setViewingOperationState((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      viewingOperationRef.current = next;
      return next;
    });
  }, []);

  const mergeActivity = useCallback((activity: Partial<RuntimeActivityModel> & { id?: string }, resourceType?: string | null) => {
    const id = activity.id;
    if (!id) return;
    const jar = resourceType === 'JAR' || 'applicationName' in activity;
    const key = jar ? 'jarProfileActivityMap' : 'wildflyProfileActivityMap';
    setActivityMaps((current) => {
      const existing = current[key][id];
      return { ...current, [key]: { ...current[key], [id]: { ...existing, ...activity, id } } };
    });
  }, []);

  const replaceProfileActivities = useCallback((profiles: Profile[]) => {
    const activities = profiles
      .map(normalizeDashboardProfile)
      .filter((activity): activity is RuntimeActivityModel => activity !== null);
    setActivityMaps((current) => ({
      ...current,
      wildflyProfileActivityMap: mapById(activities),
    }));
    return activities;
  }, []);

  const reconcileResourceActivity = useCallback(
    async (resourceKey: string): Promise<RuntimeActivityModel | null> => {
      if (!resourceKey) return null;
      const resource = await getRuntimeResource(resourceKey);
      const activity = normalizeRuntimeActivity(resource);
      if (activity) mergeActivity(activity, resource.resourceType);
      return activity;
    },
    [mergeActivity],
  );

  const reconcileProfileActivity = useCallback(
    async (profileId?: string): Promise<RuntimeActivityModel | RuntimeActivityModel[] | null> => {
      const activities = replaceProfileActivities(await getProfiles());
      return profileId ? activities.find((activity) => activity.id === profileId) || null : activities;
    },
    [replaceProfileActivities],
  );

  const rememberLockLabel = useCallback((lock: LockInfo | null | undefined) => {
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

  const dismissOperationToast = useCallback((id: string) => {
    setOperationToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismissSystemToast = useCallback((id: string) => {
    setSystemToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showSystemToast = useCallback((message: string | null, variant: SystemToast['variant']) => {
    if (!message?.trim()) return;
    const id = `system-${Date.now()}-${systemToastSequenceRef.current++}`;
    setSystemToasts((current) => {
      if (message === BACKEND_OFFLINE_TOAST && current.some((toast) => toast.message === BACKEND_OFFLINE_TOAST)) {
        return current;
      }
      return [...current, { id, message, variant }].slice(-5);
    });
  }, []);

  const clearProfileLogs = useCallback((profileId: string) => {
    if (!profileId) return;
    setProfileLogLines((current) => ({ ...current, [profileId]: [] }));
  }, []);

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
    setSystemToasts([]);
    completionKeysRef.current = [];
    lastActivityReportRef.current = null;
    lockLabelsRef.current = {};
    lockLabelOrderRef.current = [];
    setValidationState('idle');
    setSystemStatus('disconnected');
    setSnapshotRevision(0);
  }, [setViewingOperation, updateOperations]);

  const handleBackendUnavailable = useCallback(() => {
    if (validatedRef.current) changeUser();
    showSystemToast(BACKEND_OFFLINE_TOAST, 'warning');
  }, [changeUser, showSystemToast]);

  const acceptUser = useCallback(
    async (candidate: string): Promise<boolean> => {
      const entered = candidate.trim();
      if (!entered) {
        setValidationError('Enter your username.');
        return false;
      }
      setValidationState('validating');
      setValidationError('');
      try {
        const response = await validateUser(entered);
        for (const notice of response.notices ?? []) {
          showSystemToast(notice, 'warning');
        }
        sessionStorage.setItem(PORTAL_USERNAME_SESSION_KEY, entered);
        setUsername(entered);
        setValidated(true);
        setValidationState('valid');
        return true;
      } catch (error) {
        sessionStorage.removeItem(PORTAL_USERNAME_SESSION_KEY);
        setValidated(false);
        setValidationState('invalid');
        setValidationError(errorMessage(error, 'Unable to validate username.'));
        return false;
      }
    },
    [showSystemToast],
  );

  useEffect(() => {
    if (username && !validated) acceptUser(username);
  }, [acceptUser, username, validated]);

  useEffect(() => {
    if (!validated || !username) return undefined;
    const pointerOptions: AddEventListenerOptions = { passive: true };
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
    return onBackendUnavailable(() => {
      handleBackendUnavailable();
    });
  }, [handleBackendUnavailable]);

  useEffect(() => {
    if (!validated || !username) return undefined;
    const timer = window.setInterval(() => {
      validateUser(username).catch((error) => {
        if (isBackendUnavailable(error)) handleBackendUnavailable();
      });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [handleBackendUnavailable, username, validated]);

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

    const handleMessage = (message: EventSourceMessage) => {
      const event = parseSseEvent(message);
      if (!event) return;
      if ('profileId' in event) {
        setProfileLogLines((current) => ({
          ...current,
          [event.profileId]: [...(current[event.profileId] || []).slice(-999), event],
        }));
        return;
      }
      try {
        if (event.scope === 'SYSTEM') {
          if (event.eventType === 'RUNTIME_RECONCILIATION_ISSUES') showSystemToast(event.message, 'warning');
          if (event.eventType === 'RUNTIME_RECONCILIATION_RECOVERED') showSystemToast(event.message, 'success');
          if (event.eventType !== 'SYSTEM_SNAPSHOT' && event.eventType !== 'FRONTEND_ASSOCIATION_UPDATED') return;
        }
        if (event.eventType === 'SYSTEM_SNAPSHOT') {
          const snapshot = normalizeSystemSnapshot(event.resources);
          const nextMaps = buildActivityMapsFromSnapshot(event.resources, mapsRef.current);
          mapsRef.current = nextMaps;
          setActivityMaps(nextMaps);
          setSnapshotRevision((current) => current + 1);
          updateOperations((current) => reconcileOperationsWithSnapshot(current, snapshot));
          const activeIds = new Set(
            [...snapshot.wildflyProfiles, ...snapshot.jarProfiles]
              .map((activity) => activity.activeOperationId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0),
          );
          const terminalIds = new Set(
            snapshot.jarProfiles
              .filter((activity) => activity.terminalAvailable === true)
              .map((activity) => activity.terminalDeploymentId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0),
          );
          setViewingOperation((current) =>
            reconcileViewingOperationWithSnapshot(current, activeIds, terminalIds, operationsRef.current),
          );
          setPresenceState(replacePresence(event.resources?.onlineUsers));
          const snapshotLocks = Array.isArray(event.resources?.locks) ? event.resources.locks : [];
          setLockState(replaceLocks(snapshotLocks));
          snapshotLocks.forEach(rememberLockLabel);
          setLastSystemEvent(event);
          return;
        }
        if (event.eventType === 'FRONTEND_ASSOCIATION_UPDATED') {
          setActivityMaps((current) => {
            const nextMaps = applyFrontendAssociationUpdate(current, event);
            mapsRef.current = nextMaps;
            return nextMaps;
          });
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
          const ownedOperation = isOwnedOperationEvent(event, username, operationsRef.current, details.username);
          const viewedDeploymentId = deploymentIdOf(viewingOperationRef.current);
          const trackedOperationId = viewedDeploymentId
            ? operationId === viewedDeploymentId
              ? operationId
              : ''
            : operationsRef.current[operationId]?.registered
              ? operationId
              : '';
          const resourceId = String(resourceKey || '').replace(/^(WILDFLY_PROFILE|JAR|FRONTEND_PROFILE):/, '');
          const frontendHotfix =
            section === 'HOTFIX' &&
            Object.values(mapsRef.current.frontendProfileActivityMap).some((profile) => profile.profileUuid === resourceId);
          let reconciliation: Promise<RuntimeActivityModel | RuntimeActivityModel[] | null> = Promise.resolve(null);
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
            if (!ownedOperation) {
              void reconciliation.then((resolvedResource) => {
                const toast = formatCompletionNotification(event, {
                  activityMaps: mapsRef.current,
                  lockLabels: lockLabelsRef.current,
                  resolvedResource: Array.isArray(resolvedResource) ? (resolvedResource[0] ?? null) : resolvedResource,
                });
                setOperationToasts((current) => [...current, toast].slice(-5));
              });
            }
          }
          if (ownedOperation && trackedOperationId && outcome) {
            updateOperations((current) =>
              applyOperationFinished(current, trackedOperationId, String(outcome), details.summary || event.message),
            );
          }
          setLastSystemEvent(event);
          void reconciliation;
          return;
        }
        if (event.eventType === 'OPERATION_PROGRESS') {
          if (!isOwnedOperationEvent(event, username, operationsRef.current)) return;
          const eventDeploymentId = String(event.deploymentId || '');
          if (!eventDeploymentId) return;
          const viewedDeploymentId = deploymentIdOf(viewingOperationRef.current);
          const trackedOperationId = viewedDeploymentId
            ? eventDeploymentId === viewedDeploymentId
              ? viewedDeploymentId
              : ''
            : operationsRef.current[eventDeploymentId]?.registered
              ? eventDeploymentId
              : '';
          if (!trackedOperationId) return;
          updateOperations((current) => reduceTrackedOperationProgress(current, trackedOperationId, event));
          if (event.resources?.status === 'FAILED' && eventResourceType(event) === 'WILDFLY_PROFILE') {
            const profileId = eventProfileId(event);
            void Promise.all([
              reconcileResourceActivity(`WILDFLY_PROFILE:${profileId}`).catch(() => null),
              reconcileProfileActivity(profileId).catch(() => null),
            ]);
          }
          if (event.resources?.status === 'COMPLETED') setLastSystemEvent(event);
          return;
        }
        if (UPLOAD_EVENT_TYPES.has(event.eventType)) {
          setLastSystemEvent(event);
          return;
        }
        if (!allowedSystemEventTypes.has(event.eventType)) return;
        const jarEvent = eventResourceType(event) === 'JAR';
        setActivityMaps((current) => ({
          ...current,
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
          const profileId = eventProfileId(event);
          setViewingOperation((current) =>
            current?.resourceType === 'WILDFLY_PROFILE' && current.profileId === profileId
              ? { ...current, profileLogUnavailable: false }
              : current,
          );
          reconcileProfileActivity(profileId).catch(() => {});
        }
        const jarResourceKey = jarResourceKeyForReconciliation(event);
        if (jarResourceKey) reconcileResourceActivity(jarResourceKey).catch(() => {});
        const deploymentId = deploymentIdOf(event);
        const viewedDeploymentId = deploymentIdOf(viewingOperationRef.current);
        const trackedLifecycleOperationId = viewedDeploymentId
          ? deploymentId === viewedDeploymentId
            ? deploymentId
            : ''
          : deploymentId && operationsRef.current[deploymentId]?.registered
            ? deploymentId
            : '';
        updateOperations((current) => {
          const merged = trackedLifecycleOperationId && current[trackedLifecycleOperationId]
            ? {
                ...current,
                [trackedLifecycleOperationId]: mergeOperationEventRecord(current[trackedLifecycleOperationId], event),
              }
            : current;
          return finishRegisteredOperationOnLifecycle(merged, event);
        });
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
        if (controller.signal.aborted) return;
        if (opened) {
          handleBackendUnavailable();
          throw new Error('System event stream closed');
        }
        setSystemStatus('reconnecting');
        throw new Error('System event stream closed');
      },
      onerror: () => {
        if (controller.signal.aborted) return;
        if (opened) {
          handleBackendUnavailable();
          throw new Error('System event stream disconnected');
        }
        setSystemStatus('reconnecting');
        return 3000;
      },
    }).catch(() => {
      if (controller.signal.aborted) return;
      if (opened) {
        handleBackendUnavailable();
        return;
      }
      setSystemStatus('reconnecting');
    });
    return () => controller.abort();
  }, [
    changeUser,
    handleBackendUnavailable,
    username,
    validated,
    reconcileLocks,
    reconcileProfileActivity,
    reconcileResourceActivity,
    rememberLockLabel,
    showSystemToast,
    setViewingOperation,
    updateOperations,
  ]);

  const registerOperation = useCallback(
    (operation: Partial<OperationRecord>, resourceKey: string, label: string): OperationRecord => {
      const record: OperationRecord = {
        ...operation,
        username,
        initiatedByCurrentSession: true,
        deploymentId: deploymentIdOf(operation),
        resourceKey,
        label,
        registered: true,
      };
      updateOperations((current) => registerOperationInMap(current, record, resourceKey, label));
      setViewingOperation(record);
      return record;
    },
    [setViewingOperation, updateOperations, username],
  );

  const onlineUsers = useMemo(() => sortOnlineUsers(presenceState.users, username), [presenceState.users, username]);
  const findConflictingLock = useCallback(
    (scopes: LockScope | LockScope[]) => findLockConflict(lockState.locks, username, scopes),
    [lockState.locks, username],
  );

  const value = useMemo<PortalContextValue>(
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
      systemToasts,
      dismissSystemToast,
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
      setViewingOperation,
      profileLogLines,
      clearProfileLogs,
      onlineUsers,
      lockState.locks,
      findConflictingLock,
      reconcileLocks,
      reportInteraction,
      operationToasts,
      dismissOperationToast,
      systemToasts,
      dismissSystemToast,
    ],
  );
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal(): PortalContextValue {
  const value = useContext(PortalContext);
  if (!value) throw new Error('usePortal must be used within PortalProvider');
  return value;
}

export function useOptionalPortal(): PortalContextValue | null {
  return useContext(PortalContext);
}

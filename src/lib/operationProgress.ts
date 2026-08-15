import type { DeploymentStatus, OperationProgress, SystemEvent } from '@/types/api-contracts';
import type { OperationMap, OperationProgressState, OperationRecord, OperationStatus } from '@/types/frontend';
import { isFailureProgress } from './qcWarProgress';
import { isProfilePowerOperation } from './profilePowerProgress';

type OperationProgressEvent = Extract<SystemEvent, { eventType: 'OPERATION_PROGRESS' }>;
type ProgressStep = Omit<OperationProgress, 'status'> & { status: string | null; timestamp: string; message: string | null };
type ReconciliationRecord = Partial<OperationProgress> & {
  message?: string | null;
  timestamp?: string;
  lastUpdatedOn?: string | null;
};

export const DEPLOYMENT_STATUSES: ReadonlySet<DeploymentStatus> = new Set([
  'QUEUED',
  'VALIDATING',
  'LOCKING',
  'PREPARING',
  'DEPLOYING',
  'RESTARTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const TERMINAL_DEPLOYMENT_STATUSES: ReadonlySet<OperationStatus> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

const TERMINAL_LIFECYCLE_EVENTS = new Set([
  'RESOURCE_ACTIVE',
  'RESOURCE_FAILED',
  'RESOURCE_INACTIVE',
  'DEPLOYMENT_SUCCEEDED',
  'DEPLOYMENT_FAILED',
]);
const UNREGISTERED_TTL_MS = 15 * 60 * 1000;
const MAX_UNREGISTERED_OPERATIONS = 100;
const MAX_EVENT_KEYS = 200;
const MAX_STEPS = 100;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isNullablePercentage = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));
const isTerminalDeploymentStatus = (value: string | null | undefined): boolean =>
  value === 'COMPLETED' || value === 'FAILED' || value === 'CANCELLED';

function isOperationProgressEvent(event: unknown): event is OperationProgressEvent {
  if (!isObject(event) || event.eventType !== 'OPERATION_PROGRESS' || !isObject(event.resources)) return false;
  const progress = event.resources;
  return (
    typeof event.timestamp === 'string' &&
    typeof event.deploymentId === 'string' &&
    !!event.deploymentId &&
    isNullableString(event.resourceKey) &&
    isNullableString(event.resourceType) &&
    isNullableString(event.state) &&
    (event.pid === null || (typeof event.pid === 'number' && Number.isFinite(event.pid))) &&
    isNullableString(event.username) &&
    isNullableString(event.message) &&
    typeof progress.phaseCode === 'string' &&
    !!progress.phaseCode &&
    typeof progress.status === 'string' &&
    isNullablePercentage(progress.progressPercentage) &&
    isNullableString(progress.component)
  );
}

export function parseOperationProgressData(data: string): OperationProgressEvent | null {
  let event: unknown;
  try {
    event = JSON.parse(data);
  } catch {
    return null;
  }

  return isOperationProgressEvent(event) ? event : null;
}

function eventKey(event: OperationProgressEvent): string {
  const progress = event.resources;
  return JSON.stringify([
    event.timestamp,
    event.resourceKey,
    event.resourceType,
    deploymentIdOf(event),
    event.username,
    event.message,
    progress.phaseCode,
    progress.status,
    progress.progressPercentage,
    progress.component,
  ]);
}

function withBoundedItem<T>(items: T[], item: T, limit: number): T[] {
  const next = [...items, item];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

function pruneUnregisteredOperations(operations: OperationMap, now = Date.now()): OperationMap {
  const next = { ...operations };
  const unregistered = Object.entries(next)
    .filter(([, operation]) => operation?.progress && !operation.registered)
    .sort(([, left], [, right]) => (right.progress?.receivedAt ?? 0) - (left.progress?.receivedAt ?? 0));

  unregistered.forEach(([operationId, operation], index) => {
    const expired = now - (operation.progress?.receivedAt ?? 0) > UNREGISTERED_TTL_MS;
    if (expired || index >= MAX_UNREGISTERED_OPERATIONS) delete next[operationId];
  });
  return next;
}

export function reduceOperationProgress(operations: OperationMap, event: OperationProgressEvent, now = Date.now()): OperationMap {
  const deploymentId = event.deploymentId;
  if (!deploymentId) return operations;
  const existing = operations[deploymentId] || { deploymentId };
  const previous = existing.progress;
  const key = eventKey(event);
  if (previous?.eventKeys?.includes(key)) return operations;

  const supplied = event.resources;
  if (previous?.deploymentOutcome === 'SUCCEEDED') return operations;
  const status = supplied.status || previous?.status || null;
  const progressPercentage =
    supplied.phaseCode === 'COMPLETED' || status === 'COMPLETED'
      ? 100
      : supplied.progressPercentage === null
        ? (previous?.progressPercentage ?? null)
        : Math.max(previous?.progressPercentage ?? 0, supplied.progressPercentage);
  const failure = isFailureProgress(supplied);
  const rollbackStarted = supplied.phaseCode === 'ROLLBACK_STARTED';
  const rollbackCompleted = supplied.phaseCode === 'ROLLBACK_COMPLETED';
  const rollbackState = rollbackStarted
    ? 'RESTORING'
    : rollbackCompleted || (supplied.phaseCode === 'COMPLETED' && previous?.rollbackState === 'RESTORING')
      ? 'RESTORED'
      : failure && previous?.rollbackState === 'RESTORING'
        ? 'FAILED'
        : (previous?.rollbackState ?? null);
  const deploymentOutcome =
    failure ? 'FAILED' : supplied.phaseCode === 'COMPLETED' || status === 'COMPLETED' ? 'SUCCEEDED' : (previous?.deploymentOutcome ?? null);
  const step: ProgressStep = {
    timestamp: event.timestamp,
    phaseCode: supplied.phaseCode,
    message: event.message,
    status,
    progressPercentage,
    component: supplied.component,
  };
  const progress: OperationProgressState = {
    phaseCode: supplied.phaseCode,
    status,
    progressPercentage,
    component: supplied.component,
    message: event.message,
    timestamp: event.timestamp,
    resourceKey: event.resourceKey,
    resourceType: event.resourceType,
    username: event.username,
    firstReceivedAt: previous?.firstReceivedAt || now,
    receivedAt: now,
    revision: (previous?.revision || 0) + 1,
    eventKeys: withBoundedItem(previous?.eventKeys ?? [], key, MAX_EVENT_KEYS),
    steps: withBoundedItem(previous?.steps ?? [], step, MAX_STEPS),
    deploymentOutcome,
    failureMessage: previous?.failureMessage ?? (failure && event.message ? event.message : null),
    rollbackState,
    rollbackMessage: rollbackStarted || rollbackCompleted ? event.message : (previous?.rollbackMessage ?? null),
    rollbackFailureMessage:
      failure && previous?.rollbackState === 'RESTORING' && event.message
        ? event.message
        : (previous?.rollbackFailureMessage ?? null),
  };

  return pruneUnregisteredOperations(
    {
      ...operations,
      [deploymentId]: {
        ...existing,
        deploymentId,
        resourceKey: event.resourceKey ?? existing.resourceKey,
        resourceType: event.resourceType ?? existing.resourceType,
        progress,
      },
    },
    now,
  );
}

export function registerOperationInMap(
  operations: OperationMap,
  operation: Partial<OperationRecord>,
  resourceKey: string,
  label: string,
  now = Date.now(),
): OperationMap {
  const deploymentId = deploymentIdOf(operation);
  if (!deploymentId) return operations;
  const existing = operations[deploymentId] || { deploymentId };
  const registeredOperation = { ...operation };
  if (operation.resourceType === 'JAR' || String(resourceKey || '').startsWith('JAR:')) {
    delete registeredOperation.logAvailable;
  }
  return {
    ...operations,
    [deploymentId]: {
      ...existing,
      ...registeredOperation,
      deploymentId,
      resourceKey,
      label,
      registered: true,
      startTime: existing.startTime || new Date(now).toISOString(),
      ...(existing.progress ? { progress: existing.progress } : {}),
      ...(existing.terminalAvailabilityConfirmed !== undefined
        ? { terminalAvailabilityConfirmed: existing.terminalAvailabilityConfirmed }
        : {}),
      ...(existing.logAvailable !== undefined ? { logAvailable: existing.logAvailable } : {}),
    },
  };
}

export function reconcileOperationProgress(
  operations: OperationMap,
  operationId: string,
  record: ReconciliationRecord,
  expectedRevision: number,
  now = Date.now(),
): OperationMap {
  const existing = operations[operationId];
  if (!existing || (existing.progress?.revision || 0) !== expectedRevision) return operations;

  const previous = existing.progress;
  if (!previous || previous.deploymentOutcome === 'SUCCEEDED') return operations;
  const phaseCode = typeof record.phaseCode === 'string' && record.phaseCode ? record.phaseCode : previous.phaseCode;
  const status =
    record.status === null || record.status === undefined
      ? (previous.status ?? null)
      : typeof record.status === 'string' && record.status
        ? record.status
        : (previous.status ?? null);
  const progressPercentage =
    record.progressPercentage === null
      ? (previous.progressPercentage ?? null)
      : typeof record.progressPercentage === 'number' && Number.isFinite(record.progressPercentage)
        ? Math.max(previous.progressPercentage ?? 0, record.progressPercentage)
        : (previous.progressPercentage ?? null);
  const message = typeof record.message === 'string' ? record.message : previous.message;
  if (!phaseCode && !status && progressPercentage === null && !message) return operations;

  const timestamp =
    typeof record.timestamp === 'string'
      ? record.timestamp
      : typeof record.lastUpdatedOn === 'string'
        ? record.lastUpdatedOn
        : new Date(now).toISOString();
  const key = JSON.stringify(['reconcile', timestamp, phaseCode, status, progressPercentage, message]);
  const duplicate = previous.eventKeys?.includes(key);
  const step: ProgressStep = {
    timestamp,
    phaseCode: phaseCode || 'UNKNOWN',
    message: message || '',
    status,
    progressPercentage,
    component: previous.component || '',
  };

  return {
    ...operations,
    [operationId]: {
      ...existing,
      progress: {
        ...previous,
        phaseCode,
        status,
        progressPercentage,
        message,
        timestamp,
        receivedAt: now,
        revision: (previous.revision || 0) + 1,
        eventKeys: duplicate ? previous.eventKeys || [] : withBoundedItem(previous.eventKeys || [], key, MAX_EVENT_KEYS),
        steps: duplicate ? previous.steps || [] : withBoundedItem(previous.steps || [], step, MAX_STEPS),
      },
    },
  };
}

export function applyOperationFinished(
  operations: OperationMap,
  operationId: string,
  outcome: string,
  message?: string | null,
  now = Date.now(),
): OperationMap {
  if (!operationId) return operations;
  const existing = operations[operationId] || { deploymentId: operationId };
  const previous = existing.progress;
  if (previous?.deploymentOutcome === 'SUCCEEDED') return operations;

  const normalized = String(outcome || '').toUpperCase();
  const failed = normalized === 'FAILED';
  const succeeded = normalized === 'COMPLETED' || normalized === 'SUCCEEDED' || normalized === 'ACTIVE';
  if (!failed && !succeeded) return operations;

  const status = failed ? 'FAILED' : 'COMPLETED';
  const phaseCode = failed ? 'FAILED' : 'COMPLETED';
  const progressPercentage = failed ? (previous?.progressPercentage ?? null) : 100;
  const timestamp = new Date(now).toISOString();
  const key = JSON.stringify(['finished', operationId, status, message ?? '']);
  const step: ProgressStep = {
    timestamp,
    phaseCode,
    message: message ?? null,
    status,
    progressPercentage,
    component: previous?.component ?? null,
  };
  const progress: OperationProgressState = {
    phaseCode,
    status,
    progressPercentage,
    component: previous?.component ?? null,
    message: message ?? previous?.message ?? null,
    timestamp,
    resourceKey: previous?.resourceKey ?? existing.resourceKey ?? null,
    resourceType: previous?.resourceType ?? existing.resourceType ?? null,
    username: previous?.username ?? null,
    firstReceivedAt: previous?.firstReceivedAt || now,
    receivedAt: now,
    revision: (previous?.revision || 0) + 1,
    eventKeys: withBoundedItem(previous?.eventKeys ?? [], key, MAX_EVENT_KEYS),
    steps: withBoundedItem(previous?.steps ?? [], step, MAX_STEPS),
    deploymentOutcome: failed ? 'FAILED' : 'SUCCEEDED',
    failureMessage: failed ? (message ?? previous?.failureMessage ?? null) : (previous?.failureMessage ?? null),
    rollbackState: previous?.rollbackState ?? null,
    rollbackMessage: previous?.rollbackMessage ?? null,
    rollbackFailureMessage: previous?.rollbackFailureMessage ?? null,
  };

  return {
    ...operations,
    [operationId]: {
      ...existing,
      deploymentId: operationId,
      status,
      progress,
    },
  };
}

const REGISTERED_LIFECYCLE_FINISH_EVENTS = new Set(['RESOURCE_ACTIVE', 'RESOURCE_INACTIVE', 'DEPLOYMENT_SUCCEEDED']);

function isTrackedRuntimeResource(resourceType: string | null | undefined, resourceKey: string): boolean {
  return (
    resourceType === 'JAR' ||
    resourceType === 'WILDFLY_PROFILE' ||
    resourceKey.startsWith('JAR:') ||
    resourceKey.startsWith('WILDFLY_PROFILE:')
  );
}

function isProfilePowerRecord(operation: OperationRecord | undefined): boolean {
  return operation?.resourceType === 'WILDFLY_PROFILE' && isProfilePowerOperation(operation.operationType);
}

export function finishRegisteredOperationOnLifecycle(
  operations: OperationMap,
  event: Pick<SystemEvent, 'eventType' | 'deploymentId' | 'resourceKey' | 'resourceType' | 'message'>,
  now = Date.now(),
): OperationMap {
  if (!REGISTERED_LIFECYCLE_FINISH_EVENTS.has(event.eventType)) return operations;
  const resourceKey = event.resourceKey ?? '';
  if (!isTrackedRuntimeResource(event.resourceType, resourceKey)) return operations;

  const deploymentId = deploymentIdOf(event);
  if (deploymentId && operations[deploymentId]) {
    if (isProfilePowerRecord(operations[deploymentId])) return operations;
    return applyOperationFinished(operations, deploymentId, 'COMPLETED', event.message, now);
  }

  const match = Object.values(operations).find(
    (operation) =>
      operation.registered &&
      !isOperationTerminal(operation) &&
      !isProfilePowerRecord(operation) &&
      operation.resourceKey === resourceKey &&
      isTrackedRuntimeResource(operation.resourceType, String(operation.resourceKey || '')),
  );
  const matchedId = deploymentIdOf(match);
  return matchedId ? applyOperationFinished(operations, matchedId, 'COMPLETED', event.message, now) : operations;
}

export function isOperationTerminal(operation: OperationRecord | null | undefined): boolean {
  const progress = operation?.progress;
  if (progress?.deploymentOutcome === 'SUCCEEDED' || progress?.deploymentOutcome === 'FAILED') return true;
  if (progress?.rollbackState === 'RESTORING' || progress?.rollbackState === 'RESTORED') return false;
  const status = progress?.status || operation?.status;
  if (isTerminalDeploymentStatus(status)) return true;
  return TERMINAL_LIFECYCLE_EVENTS.has(operation?.statusEvent ?? '');
}

export function activeRegisteredOperations(operations: OperationMap): OperationRecord[] {
  return Object.values(operations).filter((operation) => operation.registered && !isOperationTerminal(operation));
}

import { deploymentIdOf } from './deploymentIdentity';

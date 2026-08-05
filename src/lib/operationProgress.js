export const DEPLOYMENT_STATUSES = new Set([
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

const TERMINAL_DEPLOYMENT_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

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

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNullableString = (value) => value === null || typeof value === 'string';
const isNullablePercentage = (value) => value === null || (typeof value === 'number' && Number.isFinite(value));

export function parseOperationProgressData(data) {
  let event;
  try {
    event = JSON.parse(data);
  } catch {
    return null;
  }

  const progress = event?.resources;
  const deploymentId = deploymentIdOf(event);
  if (
    !isObject(event) ||
    event.eventType !== 'OPERATION_PROGRESS' ||
    typeof event.timestamp !== 'string' ||
    !isNullableString(event.resourceKey) ||
    typeof event.resourceType !== 'string' ||
    typeof deploymentId !== 'string' ||
    !deploymentId ||
    event.state !== null ||
    event.pid !== null ||
    typeof event.username !== 'string' ||
    typeof event.message !== 'string' ||
    !isObject(progress) ||
    typeof progress.phaseCode !== 'string' ||
    !progress.phaseCode ||
    !(progress.status === null || DEPLOYMENT_STATUSES.has(progress.status)) ||
    !isNullablePercentage(progress.progressPercentage) ||
    typeof progress.component !== 'string'
  )
    return null;

  return event;
}

function eventKey(event) {
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

function withBoundedItem(items, item, limit) {
  const next = [...items, item];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

function pruneUnregisteredOperations(operations, now = Date.now()) {
  const next = { ...operations };
  const unregistered = Object.entries(next)
    .filter(([, operation]) => operation?.progress && !operation.registered)
    .sort(([, left], [, right]) => (right.progress.receivedAt || 0) - (left.progress.receivedAt || 0));

  unregistered.forEach(([operationId, operation], index) => {
    const expired = now - (operation.progress.receivedAt || 0) > UNREGISTERED_TTL_MS;
    if (expired || index >= MAX_UNREGISTERED_OPERATIONS) delete next[operationId];
  });
  return next;
}

export function reduceOperationProgress(operations, event, now = Date.now()) {
  const deploymentId = deploymentIdOf(event);
  const existing = operations[deploymentId] || { deploymentId };
  const previous = existing.progress;
  const key = eventKey(event);
  if (previous?.eventKeys?.includes(key)) return operations;

  const supplied = event.resources;
  if (TERMINAL_DEPLOYMENT_STATUSES.has(previous?.status)) return operations;
  const status = supplied.status ?? previous?.status ?? null;
  const progressPercentage = status === 'COMPLETED' ? 100 : (supplied.progressPercentage ?? previous?.progressPercentage ?? null);
  const step = {
    timestamp: event.timestamp,
    phaseCode: supplied.phaseCode,
    message: event.message,
    status,
    progressPercentage,
    component: supplied.component,
  };
  const progress = {
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
    eventKeys: withBoundedItem(previous?.eventKeys || [], key, MAX_EVENT_KEYS),
    steps: withBoundedItem(previous?.steps || [], step, MAX_STEPS),
  };

  return pruneUnregisteredOperations(
    {
      ...operations,
      [deploymentId]: { ...existing, ...withDeploymentIdentity(event), deploymentId, progress },
    },
    now,
  );
}

export function registerOperationInMap(operations, operation, resourceKey, label, now = Date.now()) {
  const deploymentId = deploymentIdOf(operation);
  if (!deploymentId) return operations;
  const existing = operations[deploymentId] || {};
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
      startedAt: existing.startedAt || new Date(now).toISOString(),
      ...(existing.progress ? { progress: existing.progress } : {}),
      ...(existing.terminalAvailabilityConfirmed !== undefined
        ? { terminalAvailabilityConfirmed: existing.terminalAvailabilityConfirmed }
        : {}),
      ...(existing.logAvailable !== undefined ? { logAvailable: existing.logAvailable } : {}),
    },
  };
}

export function reconcileOperationProgress(operations, operationId, record, expectedRevision, now = Date.now()) {
  const existing = operations[operationId];
  if (!existing || !isObject(record) || (existing.progress?.revision || 0) !== expectedRevision) return operations;

  const previous = existing.progress || {};
  if (TERMINAL_DEPLOYMENT_STATUSES.has(previous.status)) return operations;
  const phaseCode = typeof record.phaseCode === 'string' && record.phaseCode ? record.phaseCode : previous.phaseCode;
  const status =
    record.status === null
      ? (previous.status ?? null)
      : DEPLOYMENT_STATUSES.has(record.status)
        ? record.status
        : (previous.status ?? null);
  const progressPercentage =
    record.progressPercentage === null
      ? (previous.progressPercentage ?? null)
      : typeof record.progressPercentage === 'number' && Number.isFinite(record.progressPercentage)
        ? record.progressPercentage
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
  const step = {
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

export function isOperationTerminal(operation) {
  const status = operation?.progress?.status || operation?.status;
  if (TERMINAL_DEPLOYMENT_STATUSES.has(status)) return true;
  return TERMINAL_LIFECYCLE_EVENTS.has(operation?.statusEvent || operation?.eventType);
}

export function activeRegisteredOperations(operations) {
  return Object.values(operations).filter((operation) => operation.registered && !isOperationTerminal(operation));
}

import { deploymentIdOf, withDeploymentIdentity } from './deploymentIdentity';

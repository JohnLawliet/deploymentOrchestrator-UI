import type { LockInfo, SystemEvent, UserPresence } from '@/types/api-contracts';

export type PresenceState = { users: Record<string, UserPresence>; revisions: Record<string, number> };
export type LockState = { locks: Record<string, LockInfo>; revisions: Record<string, number> };
export type LockScope = { resourceKey?: string; section?: string; profile?: string; mode?: 'READ' | 'WRITE' };
type PresenceEvent = Extract<SystemEvent, { eventType: 'USER_PRESENCE_CHANGED' }>;
type LockEvent = Extract<SystemEvent, { eventType: 'LOCK_CHANGED' }>;

export const normalizeUsername = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const revisionOf = (value: Pick<UserPresence | LockInfo, 'revision'> | null | undefined): number => {
  const revision = value?.revision;
  return Number.isFinite(Number(revision)) ? Number(revision) : 0;
};
const activePresence = (value: UserPresence | null | undefined): boolean =>
  value?.status === 'ACTIVE' || value?.status === 'IDLE';

export function replacePresence(items: UserPresence[]): PresenceState {
  const users: Record<string, UserPresence> = {};
  const revisions: Record<string, number> = {};
  for (const item of items) {
    const key = normalizeUsername(item?.username);
    if (!key) continue;
    revisions[key] = revisionOf(item);
    if (activePresence(item)) users[key] = item;
  }
  return { users, revisions };
}

export function reducePresence(state: PresenceState, event: PresenceEvent): PresenceState {
  const item = event.resources;
  const key = normalizeUsername(item.username || event.username);
  if (!key) return state;
  const status = String(event.state || item.status || '').toUpperCase() as UserPresence['status'];
  if (status !== 'ACTIVE' && status !== 'IDLE' && status !== 'OFFLINE') return state;
  const revision = revisionOf(item);
  if (revision < (state.revisions[key] ?? -1)) return state;
  const revisions = { ...state.revisions, [key]: revision };
  const users = { ...state.users };
  if (status === 'OFFLINE') delete users[key];
  else users[key] = { ...item, status };
  return { users, revisions };
}

export function replaceLocks(items: LockInfo[]): LockState {
  const locks: Record<string, LockInfo> = {};
  const revisions: Record<string, number> = {};
  for (const item of items) {
    if (!item?.resourceKey) continue;
    revisions[item.resourceKey] = revisionOf(item);
    if (!isExpiredLock(item)) locks[item.resourceKey] = item;
  }
  return { locks, revisions };
}

export function reduceLocks(state: LockState, event: LockEvent): LockState {
  const item = event.resources.lock;
  const resourceKey = item.resourceKey || event.resourceKey;
  if (!resourceKey) return state;
  const revision = revisionOf(item);
  if (revision < (state.revisions[resourceKey] ?? -1)) return state;
  const action = event.resources.action;
  const locks = { ...state.locks };
  if (action === 'RELEASED' || action === 'EXPIRED' || !item || isExpiredLock(item)) delete locks[resourceKey];
  else locks[resourceKey] = item;
  return { locks, revisions: { ...state.revisions, [resourceKey]: revision } };
}

export function removeExpiredLocks(state: LockState, now = Date.now()): LockState {
  let changed = false;
  const locks = { ...state.locks };
  for (const [key, lock] of Object.entries(locks)) {
    if (isExpiredLock(lock, now)) {
      delete locks[key];
      changed = true;
    }
  }
  return changed ? { ...state, locks } : state;
}

export function isExpiredLock(lock: LockInfo | null | undefined, now = Date.now()): boolean {
  const expiresAt = lock?.expiresAt ? new Date(lock.expiresAt).getTime() : 0;
  return expiresAt > 0 && expiresAt <= now;
}

const normalized = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();
const sameLogicalScope = (lock: LockInfo, scope: LockScope): boolean => {
  if (scope.resourceKey && lock.resourceKey === scope.resourceKey) return true;
  const section = normalized(scope.section);
  const lockSection = normalized(lock.section);
  const profile = normalized(scope.profile);
  const lockProfile = normalized(lock.profile);
  if (!profile || !lockProfile) return false;
  if (section === lockSection && ['uat', 'hotfix', 'upload'].includes(section)) return profile === lockProfile;
  const fileSections = new Set(['file', 'download']);
  return fileSections.has(section) && fileSections.has(lockSection) && profile === lockProfile;
};

export function findConflictingLock(
  locks: Record<string, LockInfo>,
  currentUsername: string,
  scopes: LockScope | LockScope[],
): LockInfo | null {
  const candidates = Array.isArray(scopes) ? scopes : [scopes];
  const current = normalizeUsername(currentUsername);
  return (
    Object.values(locks).find((lock) => {
      if (!lock || isExpiredLock(lock) || normalizeUsername(lock.owner) === current) return false;
      return candidates.some(
        (scope) =>
          scope &&
          sameLogicalScope(lock, scope) &&
          (String(scope.mode || 'WRITE').toUpperCase() === 'WRITE' || String(lock.mode || 'WRITE').toUpperCase() === 'WRITE'),
      );
    }) || null
  );
}

export function sortOnlineUsers(users: Record<string, UserPresence>, currentUsername: string): UserPresence[] {
  const current = normalizeUsername(currentUsername);
  return Object.values(users)
    .filter(activePresence)
    .sort((left, right) => {
      const leftCurrent = normalizeUsername(left.username) === current;
      const rightCurrent = normalizeUsername(right.username) === current;
      if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
      return String(left.username).localeCompare(String(right.username), undefined, { sensitivity: 'base' });
    });
}

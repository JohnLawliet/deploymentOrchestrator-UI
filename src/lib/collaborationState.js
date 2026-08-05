export const normalizeUsername = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const revisionOf = (value) => (Number.isFinite(Number(value?.revision)) ? Number(value.revision) : 0);
const activePresence = (value) => value?.status === 'ACTIVE' || value?.status === 'IDLE';

export function replacePresence(items) {
  const users = {};
  const revisions = {};
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeUsername(item?.username);
    if (!key) continue;
    revisions[key] = revisionOf(item);
    if (activePresence(item)) users[key] = item;
  }
  return { users, revisions };
}

export function reducePresence(state, event) {
  const item = event?.resources;
  const key = normalizeUsername(item?.username || event?.username);
  if (!key) return state;
  const revision = revisionOf(item);
  if (revision < (state.revisions[key] ?? -1)) return state;
  const revisions = { ...state.revisions, [key]: revision };
  const users = { ...state.users };
  if ((item?.status || event?.state) === 'OFFLINE') delete users[key];
  else if (item) users[key] = { ...item, status: item.status || event.state };
  return { users, revisions };
}

export function replaceLocks(items) {
  const locks = {};
  const revisions = {};
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.resourceKey) continue;
    revisions[item.resourceKey] = revisionOf(item);
    if (!isExpiredLock(item)) locks[item.resourceKey] = item;
  }
  return { locks, revisions };
}

export function reduceLocks(state, event) {
  const item = event?.resources?.lock;
  const resourceKey = item?.resourceKey || event?.resourceKey;
  if (!resourceKey) return state;
  const revision = revisionOf(item);
  if (revision < (state.revisions[resourceKey] ?? -1)) return state;
  const action = event?.resources?.action || event?.state;
  const locks = { ...state.locks };
  if (action === 'RELEASED' || action === 'EXPIRED' || !item || isExpiredLock(item)) delete locks[resourceKey];
  else locks[resourceKey] = item;
  return { locks, revisions: { ...state.revisions, [resourceKey]: revision } };
}

export function removeExpiredLocks(state, now = Date.now()) {
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

export function isExpiredLock(lock, now = Date.now()) {
  const expiresAt = lock?.expiresAt ? new Date(lock.expiresAt).getTime() : 0;
  return expiresAt > 0 && expiresAt <= now;
}

const normalized = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();
const sameLogicalScope = (lock, scope) => {
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

export function findConflictingLock(locks, currentUsername, scopes) {
  const candidates = Array.isArray(scopes) ? scopes : [scopes];
  const current = normalizeUsername(currentUsername);
  return (
    Object.values(locks || {}).find((lock) => {
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

export function sortOnlineUsers(users, currentUsername) {
  const current = normalizeUsername(currentUsername);
  return Object.values(users || {})
    .filter(activePresence)
    .sort((left, right) => {
      const leftCurrent = normalizeUsername(left.username) === current;
      const rightCurrent = normalizeUsername(right.username) === current;
      if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
      return String(left.username).localeCompare(String(right.username), undefined, { sensitivity: 'base' });
    });
}

import { describe, expect, it } from 'vitest';
import {
  findConflictingLock,
  normalizeUsername,
  reduceLocks,
  reducePresence,
  removeExpiredLocks,
  replaceLocks,
  replacePresence,
  sortOnlineUsers,
} from './collaborationState';

const user = (username, status, revision, extra = {}) => ({ username, status, revision, ...extra });
const lock = (resourceKey, mode, revision, extra = {}) => ({
  resourceKey,
  mode,
  revision,
  owner: 'Mary Smith',
  expiresAt: '2099-01-01T00:00:00Z',
  ...extra,
});

describe('presence collaboration state', () => {
  it('normalizes backend usernames and replaces an early event with the authoritative snapshot', () => {
    expect(normalizeUsername(' John_Smith-Test ')).toBe('johnsmithtest');
    const early = reducePresence(replacePresence([]), { state: 'IDLE', resources: user('John Smith', 'IDLE', 8) });
    expect(early.users.johnsmith.status).toBe('IDLE');
    const snapshot = replacePresence([user('John Smith', 'ACTIVE', 7)]);
    expect(snapshot.users.johnsmith.status).toBe('ACTIVE');
    expect(snapshot.revisions.johnsmith).toBe(7);
  });

  it('accepts equal/newer transitions, removes OFFLINE users, and retains revision tombstones', () => {
    let state = replacePresence([user('John Smith', 'ACTIVE', 3)]);
    state = reducePresence(state, { state: 'IDLE', resources: user('John Smith', 'IDLE', 3) });
    expect(state.users.johnsmith.status).toBe('IDLE');
    state = reducePresence(state, { state: 'OFFLINE', resources: user('John Smith', 'OFFLINE', 4) });
    expect(state.users.johnsmith).toBeUndefined();
    expect(reducePresence(state, { state: 'ACTIVE', resources: user('John Smith', 'ACTIVE', 3) })).toBe(state);
  });

  it('orders the current connected user first and handles idle/null activity entries', () => {
    const state = replacePresence([
      user('zara', 'ACTIVE', 1),
      user('John Smith', 'IDLE', 2, { lastActivity: null }),
      user('Amy', 'ACTIVE', 1),
      user('Gone', 'OFFLINE', 3),
    ]);
    expect(sortOnlineUsers(state.users, 'john_smith').map((item) => item.username)).toEqual(['John Smith', 'Amy', 'zara']);
  });
});

describe('shared lock collaboration state', () => {
  it('reduces acquire, claim, release, expiry, and rejects older revisions', () => {
    let state = replaceLocks([]);
    state = reduceLocks(state, { state: 'ACQUIRED', resources: { action: 'ACQUIRED', lock: lock('profile:one', 'WRITE', 3) } });
    state = reduceLocks(state, {
      state: 'CLAIMED',
      resources: { action: 'CLAIMED', lock: lock('profile:one', 'WRITE', 4, { deploymentId: 'next' }) },
    });
    expect(state.locks['profile:one'].deploymentId).toBe('next');
    const unchanged = reduceLocks(state, {
      state: 'ACQUIRED',
      resources: { action: 'ACQUIRED', lock: lock('profile:one', 'WRITE', 2) },
    });
    expect(unchanged).toBe(state);
    state = reduceLocks(state, { state: 'RELEASED', resources: { action: 'RELEASED', lock: lock('profile:one', 'WRITE', 5) } });
    expect(state.locks['profile:one']).toBeUndefined();
    expect(state.revisions['profile:one']).toBe(5);
  });

  it('removes locally expired locks without discarding their revision', () => {
    const current = {
      locks: { 'file:one': lock('file:one', 'WRITE', 9, { expiresAt: '2026-08-04T10:00:00Z' }) },
      revisions: { 'file:one': 9 },
    };
    expect(removeExpiredLocks(current, Date.parse('2026-08-04T10:00:01Z'))).toEqual({ locks: {}, revisions: { 'file:one': 9 } });
  });

  it('disables only other-user overlapping READ/WRITE actions', () => {
    const locks = {
      exact: lock('profile:one', 'WRITE', 1),
      download: lock('logical:download:1', 'READ', 2, { section: 'DOWNLOAD', profile: 'qc' }),
      file: lock('logical:file:1', 'WRITE', 3, { section: 'FILE', profile: 'qc' }),
      uat: lock('logical:uat:1', 'WRITE', 4, { section: 'UAT', profile: 'jenkins/orders' }),
    };
    expect(findConflictingLock(locks, 'Mary_Smith', { resourceKey: 'profile:one', mode: 'WRITE' })).toBeNull();
    expect(findConflictingLock(locks, 'John', { resourceKey: 'profile:one', mode: 'READ' })?.resourceKey).toBe('profile:one');
    expect(
      findConflictingLock({ download: locks.download }, 'John', { section: 'DOWNLOAD', profile: 'qc', mode: 'READ' }),
    ).toBeNull();
    expect(
      findConflictingLock({ file: locks.file }, 'John', { section: 'DOWNLOAD', profile: 'qc', mode: 'READ' })?.resourceKey,
    ).toBe('logical:file:1');
    expect(
      findConflictingLock({ uat: locks.uat }, 'John', { section: 'UAT', profile: 'jenkins/orders', mode: 'WRITE' })?.resourceKey,
    ).toBe('logical:uat:1');
    expect(
      findConflictingLock({ uat: locks.uat }, 'John', { section: 'UAT', profile: 'jenkins/other', mode: 'WRITE' }),
    ).toBeNull();
  });
});

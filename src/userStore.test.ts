import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, ManagedPortalUser, UserProfile } from '@/types/api-contracts';

const api = vi.hoisted(() => ({
  loginUser: vi.fn(),
  getCurrentPortalSession: vi.fn(),
  logoutPortalSession: vi.fn(),
  getCurrentUserProfile: vi.fn(),
  updateCurrentUserProfile: vi.fn(),
  changeCurrentUserPassword: vi.fn(),
  uploadCurrentUserAvatar: vi.fn(),
  removeCurrentUserAvatar: vi.fn(),
  getPortalUsers: vi.fn(),
  createPortalUser: vi.fn(),
  removePortalUser: vi.fn(),
  updatePortalUserRole: vi.fn(),
}));

vi.mock('@/lib/contractApi', () => api);

import {
  canManageRoles,
  canRemoveUser,
  hasAdminAccess,
  isSuperAdmin,
  normalizeAuthUser,
  useUserStore,
} from './userStore';

const authUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: 'user-1',
  username: 'alex',
  displayName: 'Alex User',
  userType: 'USER',
  avatarUrl: null,
  ...overrides,
});

const profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  ...authUser(),
  techDriveName: 'alex',
  aboutMe: 'Release coordinator',
  profileUpdatedAt: '2026-09-16T08:00:00Z',
  activity: {
    applications: ['Orders'],
    deployments: { success: 2, failure: 1 },
    hotfixes: { success: 1, failure: 0 },
  },
  ...overrides,
});

const managedUser = (overrides: Partial<ManagedPortalUser> = {}): ManagedPortalUser => ({
  ...authUser(),
  techDriveName: 'alex',
  createdAt: '2026-09-16T08:00:00Z',
  active: true,
  ...overrides,
});

beforeEach(() => {
  useUserStore.getState().clearUser();
  vi.clearAllMocks();
});

afterEach(() => {
  useUserStore.getState().clearUser();
  sessionStorage.clear();
});

describe('user authentication store', () => {
  it('uses the backend auth user when present', () => {
    const supplied = authUser({ userType: 'SUPERADMIN' });
    expect(
      normalizeAuthUser({
        valid: true,
        normalizedUsername: 'legacy',
        isAdmin: false,
        authUser: supplied,
        admissionStatus: 'ADMITTED',
        maxOnlineUsers: 5,
        onlineCount: 1,
        queuePosition: 0,
        onlineUsers: [],
        notices: [],
      }),
    ).toEqual(supplied);
  });

  it('normalizes legacy responses without inferring superadmin access', () => {
    expect(
      normalizeAuthUser({
        username: 'Jane_Doe',
        isAdmin: true,
        admissionStatus: 'ADMITTED',
        maxOnlineUsers: 5,
        onlineCount: 1,
        queuePosition: 0,
      }),
    ).toEqual({
      id: 'legacy:janedoe',
      username: 'Jane_Doe',
      displayName: 'Jane Doe',
      userType: 'ADMIN',
      avatarUrl: null,
    });
  });

  it('stores login identity and clears it on logout', async () => {
    const user = authUser({ userType: 'ADMIN' });
    api.loginUser.mockResolvedValue({
      valid: true,
      normalizedUsername: user.username,
      isAdmin: true,
      authUser: user,
      admissionStatus: 'ADMITTED',
      maxOnlineUsers: 5,
      onlineCount: 1,
      queuePosition: 0,
      onlineUsers: [],
      notices: [],
    });
    api.logoutPortalSession.mockResolvedValue(undefined);

    await useUserStore.getState().login('alex', 'secret');
    expect(useUserStore.getState().authUser).toEqual(user);
    expect(sessionStorage.getItem('qc-deployment-username')).toBe('alex');

    await useUserStore.getState().logout();
    expect(useUserStore.getState().authUser).toBeNull();
    expect(sessionStorage.getItem('qc-deployment-username')).toBeNull();
  });

  it('restores a cookie session into the canonical user state', async () => {
    const user = authUser({ userType: 'SUPERADMIN' });
    api.getCurrentPortalSession.mockResolvedValue({
      username: user.username,
      isAdmin: true,
      authUser: user,
      admissionStatus: 'ADMITTED',
      maxOnlineUsers: 5,
      onlineCount: 1,
      queuePosition: 0,
    });

    await useUserStore.getState().restoreSession();
    expect(useUserStore.getState()).toMatchObject({ authUser: user, authStatus: 'authenticated' });
  });

  it('does not write identity when login is rejected', async () => {
    api.loginUser.mockRejectedValue(Object.assign(new Error('Invalid credentials'), { status: 403 }));

    await expect(useUserStore.getState().login('alex', 'wrong')).rejects.toMatchObject({ status: 403 });
    expect(useUserStore.getState().authUser).toBeNull();
    expect(sessionStorage.getItem('qc-deployment-username')).toBeNull();
  });

  it('does not write identity when a success body still marks valid false', async () => {
    api.loginUser.mockResolvedValue({
      valid: false,
      normalizedUsername: 'alex',
      isAdmin: true,
      admissionStatus: 'ADMITTED',
      maxOnlineUsers: 5,
      onlineCount: 1,
      queuePosition: 0,
      onlineUsers: [],
      notices: [],
    });

    await expect(useUserStore.getState().login('alex', 'secret')).rejects.toThrow(
      'This username is not permitted to use the portal or incorrect credentials given',
    );
    expect(useUserStore.getState().authUser).toBeNull();
  });
});

describe('user capabilities and actions', () => {
  it('centralizes role capabilities and tiered removals', () => {
    const standard = authUser();
    const admin = authUser({ id: 'admin', userType: 'ADMIN' });
    const superAdmin = authUser({ id: 'root', userType: 'SUPERADMIN' });
    const targetUser = managedUser({ id: 'target-user', userType: 'USER' });
    const targetAdmin = managedUser({ id: 'target-admin', userType: 'ADMIN' });
    const targetSuperAdmin = managedUser({ id: 'target-root', userType: 'SUPERADMIN' });

    expect(hasAdminAccess(standard)).toBe(false);
    expect(hasAdminAccess(admin)).toBe(true);
    expect(isSuperAdmin(superAdmin)).toBe(true);
    expect(canManageRoles(admin)).toBe(false);
    expect(canManageRoles(superAdmin)).toBe(true);
    expect(canRemoveUser(admin, targetUser)).toBe(true);
    expect(canRemoveUser(admin, targetAdmin)).toBe(false);
    expect(canRemoveUser(superAdmin, targetAdmin)).toBe(true);
    expect(canRemoveUser(superAdmin, targetSuperAdmin)).toBe(false);
    expect(canRemoveUser(superAdmin, { ...targetUser, id: superAdmin.id })).toBe(false);
  });

  it('keeps profile and auth summaries synchronized', async () => {
    const updated = profile({ displayName: 'Alex Updated', avatarUrl: 'data:image/jpeg;base64,abc' });
    api.getCurrentUserProfile.mockResolvedValue(updated);

    await useUserStore.getState().loadProfile();
    expect(useUserStore.getState().profile).toEqual(updated);
    expect(useUserStore.getState().authUser).toMatchObject({
      displayName: 'Alex Updated',
      avatarUrl: 'data:image/jpeg;base64,abc',
    });
  });

  it('updates the managed-user directory through store actions', async () => {
    const user = managedUser({ id: 'target', username: 'target' });
    const promoted = { ...user, userType: 'ADMIN' as const };
    api.getPortalUsers.mockResolvedValue([user]);
    api.updatePortalUserRole.mockResolvedValue(promoted);
    api.removePortalUser.mockResolvedValue(undefined);

    await useUserStore.getState().loadUsers();
    await useUserStore.getState().changeRole(user.id, { userType: 'ADMIN' });
    expect(useUserStore.getState().managedUsers).toEqual([promoted]);

    await useUserStore.getState().removeUser(user.id);
    expect(useUserStore.getState().managedUsers).toEqual([]);
  });
});

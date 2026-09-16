import { create } from 'zustand';
import {
  changeCurrentUserPassword,
  createPortalUser,
  getCurrentPortalSession,
  getCurrentUserProfile,
  getPortalUsers,
  loginUser,
  logoutPortalSession,
  removeCurrentUserAvatar,
  removePortalUser,
  updateCurrentUserProfile,
  updatePortalUserRole,
  uploadCurrentUserAvatar,
} from '@/lib/contractApi';
import { normalizeUsername } from '@/lib/collaborationState';
import { PORTAL_USERNAME_SESSION_KEY } from '@/lib/portalSession';
import type {
  AuthUser,
  ChangeUserPasswordRequest,
  CreatePortalUserRequest,
  ManagedPortalUser,
  PortalSessionResponse,
  UpdatePortalUserRoleRequest,
  UpdateUserProfileRequest,
  UserProfile,
  UserType,
  UserValidationResponse,
} from '@/types/api-contracts';

export type UserAuthStatus = 'idle' | 'restoring' | 'validating' | 'authenticated' | 'loggingOut' | 'error';
type AuthResponse = UserValidationResponse | PortalSessionResponse;

const displayNameFromUsername = (username: string): string =>
  username
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ') || username;

export function normalizeAuthUser(response: AuthResponse, fallbackUsername = ''): AuthUser {
  const supplied = response.authUser;
  if (supplied?.id && supplied.username) return supplied;
  const responseUsername = 'normalizedUsername' in response ? response.normalizedUsername : response.username;
  const username = String(responseUsername || fallbackUsername).trim();
  if (!username) throw new Error('The backend did not return a portal user.');
  return {
    id: `legacy:${normalizeUsername(username)}`,
    username,
    displayName: displayNameFromUsername(username),
    userType: response.isAdmin ? 'ADMIN' : 'USER',
    avatarUrl: null,
  };
}

type UserCapabilities = Pick<AuthUser, 'id' | 'userType'>;

export const hasAdminAccess = (user: Pick<AuthUser, 'userType'> | null | undefined): boolean =>
  user?.userType === 'ADMIN' || user?.userType === 'SUPERADMIN';
export const isSuperAdmin = (user: Pick<AuthUser, 'userType'> | null | undefined): boolean =>
  user?.userType === 'SUPERADMIN';
export const canManageUsers = hasAdminAccess;
export const canManageRoles = isSuperAdmin;
export function canRemoveUser(
  actor: UserCapabilities | null | undefined,
  target: Pick<ManagedPortalUser, 'id' | 'userType'>,
): boolean {
  if (!actor || actor.id === target.id || target.userType === 'SUPERADMIN') return false;
  return actor.userType === 'SUPERADMIN' || (actor.userType === 'ADMIN' && target.userType === 'USER');
}

type UserStore = {
  authUser: AuthUser | null;
  profile: UserProfile | null;
  managedUsers: ManagedPortalUser[];
  authStatus: UserAuthStatus;
  profilePending: boolean;
  directoryPending: boolean;
  userError: string;
  login(username: string, password: string): Promise<UserValidationResponse>;
  restoreSession(): Promise<PortalSessionResponse>;
  logout(): Promise<void>;
  setAuthUser(user: AuthUser | null): void;
  clearUser(): void;
  loadProfile(): Promise<UserProfile>;
  updateProfile(payload: UpdateUserProfileRequest): Promise<UserProfile>;
  changePassword(payload: ChangeUserPasswordRequest): Promise<void>;
  uploadAvatar(file: File): Promise<UserProfile>;
  removeAvatar(): Promise<UserProfile>;
  loadUsers(): Promise<ManagedPortalUser[]>;
  addUser(payload: CreatePortalUserRequest): Promise<ManagedPortalUser>;
  removeUser(userId: string): Promise<void>;
  changeRole(userId: string, payload: UpdatePortalUserRoleRequest): Promise<ManagedPortalUser>;
  hasAdminAccess(): boolean;
  isSuperAdmin(): boolean;
  canManageUsers(): boolean;
  canManageRoles(): boolean;
  canRemoveUser(target: Pick<ManagedPortalUser, 'id' | 'userType'>): boolean;
};

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const writeStoredUsername = (user: AuthUser | null) => {
  if (typeof sessionStorage === 'undefined') return;
  if (user?.username) sessionStorage.setItem(PORTAL_USERNAME_SESSION_KEY, user.username);
  else sessionStorage.removeItem(PORTAL_USERNAME_SESSION_KEY);
};

export const useUserStore = create<UserStore>((set, get) => {
  const applyUser = (user: AuthUser | null) => {
    writeStoredUsername(user);
    set({ authUser: user, authStatus: user ? 'authenticated' : 'idle', userError: '' });
  };
  const applyProfile = (profile: UserProfile) => {
    set({
      profile,
      authUser: {
        id: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        userType: profile.userType,
        avatarUrl: profile.avatarUrl,
      },
      profilePending: false,
      userError: '',
    });
    writeStoredUsername(profile);
    return profile;
  };

  return {
    authUser: null,
    profile: null,
    managedUsers: [],
    authStatus: 'idle',
    profilePending: false,
    directoryPending: false,
    userError: '',
    login: async (username, password) => {
      set({ authStatus: 'validating', userError: '' });
      try {
        const response = await loginUser(username, password);
        if (response.valid === false) {
          throw new Error('This username is not permitted to use the portal or incorrect credentials given');
        }
        applyUser(normalizeAuthUser(response, username));
        return response;
      } catch (error) {
        applyUser(null);
        set({ authStatus: 'error', userError: errorText(error, 'Unable to sign in.') });
        throw error;
      }
    },
    restoreSession: async () => {
      set({ authStatus: 'restoring', userError: '' });
      try {
        const response = await getCurrentPortalSession();
        applyUser(normalizeAuthUser(response));
        return response;
      } catch (error) {
        applyUser(null);
        set({ authStatus: 'error', userError: errorText(error, 'Unable to restore the portal session.') });
        throw error;
      }
    },
    logout: async () => {
      set({ authStatus: 'loggingOut', userError: '' });
      try {
        await logoutPortalSession();
        get().clearUser();
      } catch (error) {
        if ((error as { status?: number })?.status === 401) {
          get().clearUser();
          return;
        }
        set({ authStatus: 'authenticated', userError: errorText(error, 'Unable to log out.') });
        throw error;
      }
    },
    setAuthUser: applyUser,
    clearUser: () => {
      writeStoredUsername(null);
      set({
        authUser: null,
        profile: null,
        managedUsers: [],
        authStatus: 'idle',
        profilePending: false,
        directoryPending: false,
        userError: '',
      });
    },
    loadProfile: async () => {
      set({ profilePending: true, userError: '' });
      try {
        return applyProfile(await getCurrentUserProfile());
      } catch (error) {
        set({ profilePending: false, userError: errorText(error, 'Unable to load your profile.') });
        throw error;
      }
    },
    updateProfile: async (payload) => {
      set({ profilePending: true, userError: '' });
      try {
        return applyProfile(await updateCurrentUserProfile(payload));
      } catch (error) {
        set({ profilePending: false, userError: errorText(error, 'Unable to update your profile.') });
        throw error;
      }
    },
    changePassword: async (payload) => {
      set({ profilePending: true, userError: '' });
      try {
        await changeCurrentUserPassword(payload);
        set({ profilePending: false });
      } catch (error) {
        set({ profilePending: false, userError: errorText(error, 'Unable to change your password.') });
        throw error;
      }
    },
    uploadAvatar: async (file) => {
      set({ profilePending: true, userError: '' });
      try {
        return applyProfile(await uploadCurrentUserAvatar(file));
      } catch (error) {
        set({ profilePending: false, userError: errorText(error, 'Unable to update your profile image.') });
        throw error;
      }
    },
    removeAvatar: async () => {
      set({ profilePending: true, userError: '' });
      try {
        return applyProfile(await removeCurrentUserAvatar());
      } catch (error) {
        set({ profilePending: false, userError: errorText(error, 'Unable to remove your profile image.') });
        throw error;
      }
    },
    loadUsers: async () => {
      set({ directoryPending: true, userError: '' });
      try {
        const users = await getPortalUsers();
        set({ managedUsers: users, directoryPending: false });
        return users;
      } catch (error) {
        set({ directoryPending: false, userError: errorText(error, 'Unable to load portal users.') });
        throw error;
      }
    },
    addUser: async (payload) => {
      set({ directoryPending: true, userError: '' });
      try {
        const user = await createPortalUser(payload);
        set((state) => ({ managedUsers: [...state.managedUsers, user], directoryPending: false }));
        return user;
      } catch (error) {
        set({ directoryPending: false, userError: errorText(error, 'Unable to add this user.') });
        throw error;
      }
    },
    removeUser: async (userId) => {
      set({ directoryPending: true, userError: '' });
      try {
        await removePortalUser(userId);
        set((state) => ({
          managedUsers: state.managedUsers.filter((user) => user.id !== userId),
          directoryPending: false,
        }));
      } catch (error) {
        set({ directoryPending: false, userError: errorText(error, 'Unable to remove this user.') });
        throw error;
      }
    },
    changeRole: async (userId, payload) => {
      set({ directoryPending: true, userError: '' });
      try {
        const user = await updatePortalUserRole(userId, payload);
        set((state) => ({
          managedUsers: state.managedUsers.map((item) => (item.id === userId ? user : item)),
          directoryPending: false,
        }));
        return user;
      } catch (error) {
        set({ directoryPending: false, userError: errorText(error, 'Unable to update this user role.') });
        throw error;
      }
    },
    hasAdminAccess: () => hasAdminAccess(get().authUser),
    isSuperAdmin: () => isSuperAdmin(get().authUser),
    canManageUsers: () => canManageUsers(get().authUser),
    canManageRoles: () => canManageRoles(get().authUser),
    canRemoveUser: (target) => canRemoveUser(get().authUser, target),
  };
});

export const selectAuthUser = (state: UserStore): AuthUser | null => state.authUser;
export const selectUsername = (state: UserStore): string => state.authUser?.username ?? '';
export const selectHasAdminAccess = (state: UserStore): boolean => hasAdminAccess(state.authUser);
export const selectIsSuperAdmin = (state: UserStore): boolean => isSuperAdmin(state.authUser);
export const selectCanManageUsers = (state: UserStore): boolean => canManageUsers(state.authUser);
export const selectCanManageRoles = (state: UserStore): boolean => canManageRoles(state.authUser);

export const userTypeLabel = (userType: UserType): string =>
  userType === 'SUPERADMIN' ? 'Superadmin' : userType === 'ADMIN' ? 'Admin' : 'User';

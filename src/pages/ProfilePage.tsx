import { useMemo, useState } from 'react';
import { Camera, Check, Pencil, Search, ShieldCheck, Trash2, UserPlus, UserRound, X } from 'lucide-react';
import { usePortal } from '@/context/PortalContext';
import { Page } from '@/components/PagePrimitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { canManageRoles, canManageUsers, canRemoveUser, selectAuthUser, useUserStore } from '@/userStore';
import type { UserType } from '@/types/api-contracts';

export type UserRole = UserType;

type ProfileDetails = {
  fullName: string;
  techDriveName: string;
  role: UserRole;
  lastUpdated: string;
  aboutMe: string;
  avatarUrl: string | null;
};

type ManagedUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
};

type ProfileActivity = {
  applications: string[];
  deployments: { success: number; failure: number };
  hotfixes: { success: number; failure: number };
};

type ProfilePageContentProps = {
  username: string;
  initialProfile?: ProfileDetails;
  initialUsers?: ManagedUser[];
  activity?: ProfileActivity;
};

const fixtureActivity: ProfileActivity = {
  applications: ['Accounts Portal', 'Orders API', 'Notification Service', 'QC Admin'],
  deployments: { success: 47, failure: 3 },
  hotfixes: { success: 12, failure: 1 },
};

const fixtureUsers: ManagedUser[] = [
  { id: 'user-amy', username: 'amy.wong', name: 'Amy Wong', role: 'ADMIN' },
  { id: 'user-david', username: 'david.lee', name: 'David Lee', role: 'USER' },
  { id: 'user-priya', username: 'priya.shah', name: 'Priya Shah', role: 'USER' },
  { id: 'user-superadmin', username: 'superadmin', name: 'System Administrator', role: 'SUPERADMIN' },
];

const nameFromUsername = (username: string): string =>
  username
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Portal User';

const roleVariant = (role: UserRole): 'default' | 'secondary' | 'muted' =>
  role === 'SUPERADMIN' ? 'default' : role === 'ADMIN' ? 'secondary' : 'muted';

function ReadableInput({ editing, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { editing: boolean }) {
  return (
    <Input
      readOnly={!editing}
      className={cn(
        !editing &&
          'border-transparent bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

function OutcomeMetric({ label, success, failure }: { label: string; success: number; failure: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/35 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-3 flex items-baseline gap-3">
        <span className="text-2xl font-semibold text-green-700">{success}</span>
        <span className="text-sm text-muted-foreground">successful</span>
      </div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-lg font-semibold text-red-700">{failure}</span>
        <span className="text-sm text-muted-foreground">failed</span>
      </div>
    </div>
  );
}

function PersonalDetailsCard({
  initialProfile,
  onSave,
}: {
  initialProfile: ProfileDetails;
  onSave?: (profile: ProfileDetails) => void;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [draft, setDraft] = useState(initialProfile);
  const [editing, setEditing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const beginEditing = () => {
    setDraft(profile);
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraft(profile);
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setEditing(false);
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.fullName.trim() || !draft.techDriveName.trim()) {
      setError('Name and TechDrive name are required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    const saved = { ...draft, lastUpdated: new Date().toISOString() };
    setProfile(saved);
    setDraft(saved);
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setEditing(false);
    onSave?.(saved);
  };

  const selectAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDraft((current) => ({ ...current, avatarUrl: String(reader.result || '') }));
    reader.readAsDataURL(file);
  };

  const displayed = editing ? draft : profile;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div>
          <CardTitle>Personal details</CardTitle>
          <CardDescription className="mt-1">Your account identity and profile information.</CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          {editing ? (
            <>
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={cancelEditing}>
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button type="submit" form="profile-details-form" size="sm" className="gap-2">
                <Check className="h-3.5 w-3.5" />
                Save
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={beginEditing}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form id="profile-details-form" onSubmit={save}>
          <div className="grid gap-6 md:grid-cols-[10rem_minmax(0,1fr)] lg:gap-8">
            <div className="flex flex-col items-center gap-3 md:items-start">
              <div className="grid h-32 w-32 place-items-center overflow-hidden rounded-full border border-border bg-muted">
                {displayed.avatarUrl ? (
                  <img src={displayed.avatarUrl} alt={`${displayed.fullName} profile`} className="h-full w-full object-cover" />
                ) : (
                  <UserRound className="h-14 w-14 text-muted-foreground" aria-hidden="true" />
                )}
              </div>
              {editing && (
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-primary">
                  <Camera className="h-4 w-4" />
                  Change image
                  <input className="sr-only" type="file" accept="image/*" onChange={selectAvatar} />
                </label>
              )}
            </div>

            <div className="min-w-0 space-y-5">
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Name</span>
                  <ReadableInput
                    editing={editing}
                    aria-label="Name"
                    value={displayed.fullName}
                    onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">TechDrive name</span>
                  <ReadableInput
                    editing={editing}
                    aria-label="TechDrive name"
                    value={displayed.techDriveName}
                    onChange={(event) => setDraft((current) => ({ ...current, techDriveName: event.target.value }))}
                  />
                </label>
                <div>
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">User type</span>
                  <div className="flex h-10 items-center">
                    <Badge variant={roleVariant(displayed.role)}>{displayed.role}</Badge>
                  </div>
                </div>
                <div className="sm:col-span-2 xl:col-span-3">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Last profile update</span>
                  <p className="mt-2 text-sm">
                    {new Date(displayed.lastUpdated).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                </div>
              </div>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">About me</span>
                <textarea
                  aria-label="About me"
                  readOnly={!editing}
                  rows={3}
                  value={displayed.aboutMe}
                  onChange={(event) => setDraft((current) => ({ ...current, aboutMe: event.target.value }))}
                  className={cn(
                    'mt-2 w-full resize-y rounded-md border border-border bg-input px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    !editing &&
                      'resize-none border-transparent bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0',
                  )}
                />
              </label>

              {editing && (
                <fieldset className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
                  <legend className="sr-only">Change password</legend>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">New password</span>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Confirm new password</span>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Leave both password fields empty to keep your current password.
                  </p>
                </fieldset>
              )}
              {error && (
                <p className="text-sm text-red-700" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ActivitySummaryCard({ activity }: { activity: ProfileActivity }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deployment activity</CardTitle>
        <CardDescription>Applications and outcomes associated with this user.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(12rem,1fr)_minmax(12rem,1fr)]">
        <div className="rounded-md border border-border p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Deployed applications</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {activity.applications.map((application) => (
              <Badge key={application} variant="outline" className="max-w-full truncate">
                {application}
              </Badge>
            ))}
            {!activity.applications.length && <span className="text-sm text-muted-foreground">No deployments yet.</span>}
          </div>
        </div>
        <OutcomeMetric label="Deployments" {...activity.deployments} />
        <OutcomeMetric label="Hotfixes pushed" {...activity.hotfixes} />
      </CardContent>
    </Card>
  );
}

function RoleManagementCard({
  currentUserId,
  users,
  onRoleChange,
}: {
  currentUserId: string;
  users: ManagedUser[];
  onRoleChange: (userId: string, role: UserRole) => void;
}) {
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState('');
  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return users;
    return users.filter((user) => `${user.name} ${user.username} ${user.role}`.toLocaleLowerCase().includes(normalized));
  }, [query, users]);

  const changeRole = async (user: ManagedUser) => {
    const nextRole: UserRole = user.role === 'ADMIN' ? 'USER' : 'ADMIN';
    const action = nextRole === 'ADMIN' ? 'promote' : 'demote';
    if (
      !window.confirm(
        `${action === 'promote' ? 'Promote' : 'Demote'} ${user.name} ${action === 'promote' ? 'to' : 'from'} admin?`,
      )
    ) {
      return;
    }
    setPending(user.username);
    setNotice('');
    await Promise.resolve();
    onRoleChange(user.id, nextRole);
    setPending('');
    setNotice(`${user.name} is now ${nextRole === 'ADMIN' ? 'an admin' : 'a user'}.`);
  };

  return (
    <Card data-testid="role-management-card">
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            User role management
          </CardTitle>
          <CardDescription className="mt-1">Promote users to admin or return admins to standard access.</CardDescription>
        </div>
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search users</span>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search users"
            placeholder="Search users"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </label>
      </CardHeader>
      <CardContent>
        {notice && (
          <p className="mb-4 flex items-center gap-2 text-sm text-green-700" role="status">
            <Check className="h-4 w-4" />
            {notice}
          </p>
        )}
        <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {filteredUsers.map((user) => {
            const canChange =
              canManageRoles({ userType: 'SUPERADMIN' }) &&
              user.role !== 'SUPERADMIN' &&
              user.id !== currentUserId;
            return (
              <div
                key={user.username}
                className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center"
                data-testid={`managed-user-${user.username}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.username}</p>
                </div>
                <div>
                  <Badge variant={roleVariant(user.role)}>{user.role}</Badge>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={user.role === 'ADMIN' ? 'outline' : 'default'}
                  disabled={!canChange || pending === user.username}
                  onClick={() => void changeRole(user)}
                  className="w-full sm:w-36"
                >
                  {pending === user.username ? 'Updating…' : user.role === 'ADMIN' ? 'Demote to user' : 'Promote to admin'}
                </Button>
              </div>
            );
          })}
          {!filteredUsers.length && <p className="p-8 text-center text-sm text-muted-foreground">No users match your search.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

type NewUserDraft = {
  name: string;
  username: string;
  techDriveName: string;
  initialPassword: string;
  role: Exclude<UserRole, 'SUPERADMIN'>;
};

const emptyNewUser: NewUserDraft = {
  name: '',
  username: '',
  techDriveName: '',
  initialPassword: '',
  role: 'USER',
};

function UserAccessCard({
  actor,
  users,
  onAdd,
  onRemove,
}: {
  actor: { id: string; userType: UserRole };
  users: ManagedUser[];
  onAdd: (user: ManagedUser) => void;
  onRemove: (userId: string) => void;
}) {
  const [draft, setDraft] = useState<NewUserDraft>(emptyNewUser);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const managesRoles = canManageRoles(actor);

  const addUser = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const values = {
      name: draft.name.trim(),
      username: draft.username.trim(),
      techDriveName: draft.techDriveName.trim(),
      initialPassword: draft.initialPassword,
    };
    if (!values.name || !values.username || !values.techDriveName || !values.initialPassword) {
      setError('Complete every field before adding a user.');
      return;
    }
    if (users.some((user) => user.username.toLocaleLowerCase() === values.username.toLocaleLowerCase())) {
      setError('A user with this username already exists.');
      return;
    }
    const role = managesRoles ? draft.role : 'USER';
    onAdd({
      id: `fixture:${values.username.toLocaleLowerCase()}`,
      username: values.username,
      name: values.name,
      role,
    });
    setDraft(emptyNewUser);
    setNotice(`${values.name} was added as ${role === 'ADMIN' ? 'an admin' : 'a user'}.`);
  };

  const removeUser = async (user: ManagedUser) => {
    if (!canRemoveUser(actor, { id: user.id, userType: user.role })) return;
    if (!window.confirm(`Remove ${user.name} from the application?`)) return;
    setPending(user.id);
    setError('');
    setNotice('');
    await Promise.resolve();
    onRemove(user.id);
    setPending('');
    setNotice(`${user.name} was removed.`);
  };

  return (
    <Card data-testid="user-access-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-primary" />
          User access
        </CardTitle>
        <CardDescription>Add users to the application or remove accounts within your access level.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={addUser} className="grid gap-4 rounded-md border border-border bg-muted/20 p-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-2">
            <span className="text-sm font-medium">Full name</span>
            <Input
              aria-label="New user full name"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">Username</span>
            <Input
              aria-label="New user username"
              autoComplete="off"
              value={draft.username}
              onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">TechDrive name</span>
            <Input
              aria-label="New user TechDrive name"
              autoComplete="off"
              value={draft.techDriveName}
              onChange={(event) => setDraft((current) => ({ ...current, techDriveName: event.target.value }))}
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">Initial password</span>
            <Input
              aria-label="New user initial password"
              type="password"
              autoComplete="new-password"
              value={draft.initialPassword}
              onChange={(event) => setDraft((current) => ({ ...current, initialPassword: event.target.value }))}
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">User type</span>
            <select
              aria-label="New user type"
              className="form-control"
              value={managesRoles ? draft.role : 'USER'}
              disabled={!managesRoles}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  role: event.target.value === 'ADMIN' ? 'ADMIN' : 'USER',
                }))
              }
            >
              <option value="USER">User</option>
              {managesRoles && <option value="ADMIN">Admin</option>}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-3 md:col-span-2 xl:col-span-5">
            <Button type="submit" size="sm" className="gap-2">
              <UserPlus className="h-4 w-4" />
              Add user
            </Button>
            {error && (
              <p className="text-sm text-red-700" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="flex items-center gap-2 text-sm text-green-700" role="status">
                <Check className="h-4 w-4" />
                {notice}
              </p>
            )}
          </div>
        </form>

        <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {users.map((user) => {
            const removable = canRemoveUser(actor, { id: user.id, userType: user.role });
            return (
              <div
                key={user.id}
                className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center"
                data-testid={`access-user-${user.username}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.username}</p>
                </div>
                <Badge variant={roleVariant(user.role)}>{user.role}</Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 sm:w-28"
                  disabled={!removable || pending === user.id}
                  onClick={() => void removeUser(user)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {pending === user.id ? 'Removing…' : 'Remove'}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function ProfilePageContent({
  username,
  initialProfile,
  initialUsers = fixtureUsers,
  activity = fixtureActivity,
}: ProfilePageContentProps) {
  const [users, setUsers] = useState(initialUsers);
  const profile =
    initialProfile ??
    ({
      fullName: nameFromUsername(username),
      techDriveName: username,
      role: 'SUPERADMIN',
      lastUpdated: '2026-09-12T09:30:00Z',
      aboutMe: 'I coordinate application deployments and support release activity across QC environments.',
      avatarUrl: null,
    } satisfies ProfileDetails);
  const currentUserId = users.find((user) => user.username.toLocaleLowerCase() === username.toLocaleLowerCase())?.id ?? `auth:${username}`;
  const actor = { id: currentUserId, userType: profile.role };

  return (
    <Page title="Profile" description="Manage your personal information and review deployment activity.">
      <div className="space-y-5">
        <PersonalDetailsCard initialProfile={profile} />
        <ActivitySummaryCard activity={activity} />
        {canManageUsers(actor) && (
          <UserAccessCard
            actor={actor}
            users={users}
            onAdd={(user) => setUsers((current) => [...current, user])}
            onRemove={(userId) => setUsers((current) => current.filter((user) => user.id !== userId))}
          />
        )}
        {canManageRoles(actor) && (
          <RoleManagementCard
            currentUserId={currentUserId}
            users={users}
            onRoleChange={(userId, role) =>
              setUsers((current) => current.map((user) => (user.id === userId ? { ...user, role } : user)))
            }
          />
        )}
      </div>
    </Page>
  );
}

export default function ProfilePage() {
  const authUser = useUserStore(selectAuthUser);
  const { username: portalUsername } = usePortal();
  const username = authUser?.username || portalUsername;
  return (
    <ProfilePageContent
      username={username}
      initialProfile={
        authUser
          ? {
              fullName: authUser.displayName,
              techDriveName: authUser.username,
              role: authUser.userType,
              lastUpdated: new Date().toISOString(),
              aboutMe: '',
              avatarUrl: authUser.avatarUrl,
            }
          : undefined
      }
    />
  );
}

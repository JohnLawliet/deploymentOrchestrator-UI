import { useState } from 'react';
import { Loader2, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { normalizeUsername } from '@/lib/collaborationState';
import type { UserPresence } from '@/types/api-contracts';

const activitySummary = (user: UserPresence) => {
  const activityTime = user.lastActivityTime || user.lastSeenAt;
  return [
    user.lastActivity || 'No recent activity',
    user.lastActivityStatus,
    activityTime ? new Date(activityTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
};

export default function OnlineUsersList({
  users,
  currentUsername,
  isAdmin = false,
  onForceLogout,
  emptyMessage = 'No connected users.',
}: {
  users: UserPresence[];
  currentUsername: string;
  isAdmin?: boolean;
  onForceLogout?: (username: string) => Promise<boolean>;
  emptyMessage?: string;
}) {
  const [pendingUsername, setPendingUsername] = useState('');

  const forceLogout = async (username: string) => {
    if (!onForceLogout || pendingUsername) return;
    setPendingUsername(username);
    try {
      await onForceLogout(username);
    } finally {
      setPendingUsername('');
    }
  };

  return (
    <div className="space-y-1" data-testid="online-users-list">
      {users.map((user) => {
        const canForceLogout =
          isAdmin && Boolean(onForceLogout) && normalizeUsername(user.username) !== normalizeUsername(currentUsername);
        const row = (
          <div className="rounded-md border border-border/70 px-2.5 py-2 text-left">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${user.status === 'ACTIVE' ? 'bg-green-500' : 'bg-amber-400'}`} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{user.username}</span>
              <span className="text-[10px] text-muted-foreground">{user.status}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-muted-foreground" title={activitySummary(user)}>
              {activitySummary(user)}
            </p>
          </div>
        );

        if (!canForceLogout) return <div key={`${user.username}:${user.revision}`}>{row}</div>;
        return (
          <Popover key={`${user.username}:${user.revision}`}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="block w-full rounded-md hover:bg-muted"
                aria-label={`Actions for ${user.username}`}
              >
                {row}
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="center" sideOffset={8} className="z-[200] w-44 p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-xs text-red-700 hover:text-red-700"
                disabled={Boolean(pendingUsername)}
                onClick={() => void forceLogout(user.username)}
              >
                {pendingUsername === user.username ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserX className="h-3.5 w-3.5" />
                )}
                Force logout
              </Button>
            </PopoverContent>
          </Popover>
        );
      })}
      {!users.length && <p className="px-2 py-3 text-xs text-muted-foreground">{emptyMessage}</p>}
    </div>
  );
}

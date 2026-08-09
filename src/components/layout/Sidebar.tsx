import { NavLink } from 'react-router-dom';
import {
  Rocket,
  FolderDown,
  LayoutDashboard,
  Server,
  ChevronRight,
  PackageOpen,
  Wrench,
  UserRound,
  TableProperties,
  Factory,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePortal } from '@/context/PortalContext';
import { isOperationTerminal } from '@/lib/operationProgress';

const APP_NAME = import.meta.env.VITE_APP_NAME || 'Deployment Orchestrator';

const navItems = [
  {
    label: 'Dashboard',
    to: 'dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'Deploy JAR',
    to: 'deploy-jar',
    icon: Rocket,
  },
  {
    label: 'Deploy WAR',
    to: 'deploy-war',
    icon: PackageOpen,
  },
  {
    label: 'Download files',
    to: 'downloads',
    icon: FolderDown,
  },
  {
    label: 'Create UAT build',
    to: 'create-uat-build',
    icon: Factory,
  },
  {
    label: 'Upload',
    to: 'upload',
    icon: Wrench,
  },
  {
    label: 'Tables',
    to: 'tables',
    icon: TableProperties,
  },
];

export default function Sidebar() {
  const { username, changeUser, systemStatus, operations, onlineUsers = [] } = usePortal();
  const activeOperations = Object.values(operations).filter((item) => !isOperationTerminal(item)).length;
  return (
    <aside
      style={{ width: 'var(--sidebar-width, 240px)', minWidth: 'var(--sidebar-width, 240px)' }}
      className="sticky top-0 flex h-screen flex-col self-start bg-card border-r border-border"
    >
      {/* Branding */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
          <Server className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight truncate">{APP_NAME}</p>
          <p className="text-xs text-muted-foreground">QC Server</p>
        </div>
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="px-3 py-4 space-y-1">
        <p className="text-xs font-medium text-muted-foreground px-2 pb-2 uppercase tracking-wider">Navigation</p>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 w-full rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-primary' : '')} />
                  <span className="flex-1">{item.label}</span>
                  {isActive && <ChevronRight className="w-3.5 h-3.5 text-primary" />}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <Separator />
      <section aria-labelledby="online-users-heading" className="flex min-h-0 flex-1 flex-col px-3 py-3">
        <div className="flex items-center justify-between px-2 pb-2">
          <p id="online-users-heading" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Online users
          </p>
          <span className="text-xs text-muted-foreground">{onlineUsers.length}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" data-testid="online-users-list">
          {onlineUsers.map((user) => (
            <div key={`${user.username}:${user.revision}`} className="rounded-md border border-border/70 px-2.5 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${user.status === 'ACTIVE' ? 'bg-green-500' : 'bg-amber-400'}`} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{user.username}</span>
                <span className="text-[10px] text-muted-foreground">{user.status}</span>
              </div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground" title={user.lastActivity || ''}>
                {user.lastActivity
                  ? [
                      user.lastActivity,
                      user.lastActivityStatus,
                      user.lastActivityTime
                        ? new Date(user.lastActivityTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'No recent activity'}
              </p>
            </div>
          ))}
          {!onlineUsers.length && <p className="px-2 py-3 text-xs text-muted-foreground">No connected users.</p>}
        </div>
      </section>

      {/* Footer */}
      <Separator />
      <div className="px-4 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${systemStatus === 'connected' ? 'bg-green-400' : systemStatus === 'reconnecting' ? 'bg-amber-400 animate-pulse' : 'bg-muted-foreground'}`}
          />
          <span className="text-xs text-muted-foreground">System stream: {systemStatus}</span>
        </div>
        {activeOperations > 0 && <p className="text-xs text-primary">{activeOperations} operation(s) in progress</p>}
        <div className="rounded-md border border-border p-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" className="h-auto w-full min-w-0 justify-start gap-2 px-2 py-1.5 font-normal">
                <UserRound className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm truncate">{username}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent side="right" align="end" sideOffset={8} className="z-[100] w-40 p-1">
              <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={changeUser}>
                Change user
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </aside>
  );
}

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
import OnlineUsersList from '@/components/OnlineUsersList';

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
  const { username, changeUser, forceLogoutUser, isAdmin, systemStatus, operations, onlineUsers = [] } = usePortal();
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
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <OnlineUsersList users={onlineUsers} currentUsername={username} isAdmin={isAdmin} onForceLogout={forceLogoutUser} />
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
              <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => void changeUser()}>
                Log out
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </aside>
  );
}

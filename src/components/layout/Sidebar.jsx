import { NavLink } from 'react-router-dom'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { usePortal } from '@/context/PortalContext'
import { isOperationTerminal } from '@/lib/operationProgress'

const APP_NAME = import.meta.env.VITE_APP_NAME || 'Deployment Orchestrator'

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
        label: 'Tables',
        to: 'tables',
        icon: TableProperties,
    },
]

export default function Sidebar() {
    const { username, changeUser, systemStatus, operations } = usePortal()
    const activeOperations = Object.values(operations).filter((item) => !isOperationTerminal(item)).length
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
                    <p className="text-sm font-semibold text-foreground leading-tight truncate">
                        {APP_NAME}
                    </p>
                    <p className="text-xs text-muted-foreground">QC Server</p>
                </div>
            </div>

            <Separator />

            {/* Navigation */}
            <nav className="flex-1 px-3 py-4 space-y-1">
                <p className="text-xs font-medium text-muted-foreground px-2 pb-2 uppercase tracking-wider">
                    Navigation
                </p>
                {navItems.map((item) => {
                    const Icon = item.icon
                    return (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) =>
                                cn(
                                    'group flex items-center gap-3 w-full rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150',
                                    isActive
                                        ? 'bg-primary/10 text-primary border border-primary/20'
                                        : 'text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent'
                                )
                            }
                        >
                            {({ isActive }) => (
                                <>
                                    <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-primary' : '')} />
                                    <span className="flex-1">{item.label}</span>
                                    {isActive && (
                                        <ChevronRight className="w-3.5 h-3.5 text-primary" />
                                    )}
                                </>
                            )}
                        </NavLink>
                    )
                })}
                <div className="flex items-center gap-3 w-full rounded-md px-3 py-2.5 text-sm text-muted-foreground/50 border border-transparent cursor-not-allowed" title="Deferred to a later phase">
                    <Wrench className="w-4 h-4" /><span>Upload hotfix</span><span className="ml-auto text-[10px]">LATER</span>
                </div>
            </nav>

            {/* Footer */}
            <Separator />
            <div className="px-4 py-4 space-y-3">
                <div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${systemStatus === 'connected' ? 'bg-green-400' : systemStatus === 'reconnecting' ? 'bg-amber-400 animate-pulse' : 'bg-muted-foreground'}`} /><span className="text-xs text-muted-foreground">System stream: {systemStatus}</span></div>
                {activeOperations > 0 && <p className="text-xs text-primary">{activeOperations} operation(s) in progress</p>}
                <div className="rounded-md border border-border p-2.5">
                    <div className="flex items-center gap-2 min-w-0"><UserRound className="w-4 h-4 text-primary shrink-0" /><span className="text-sm truncate flex-1">{username}</span></div>
                    <Button variant="ghost" size="sm" className="w-full mt-2 text-xs" onClick={changeUser}>Change user</Button>
                </div>
            </div>
        </aside>
    )
}

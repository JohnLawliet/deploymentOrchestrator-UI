import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import UsernameGate from '@/components/UsernameGate'
import OperationPanel from '@/components/OperationPanel'
import { usePortal } from '@/context/PortalContext'

export default function AppLayout() {
    const { validated, setViewingOperation } = usePortal()
    const location = useLocation()
    const previousPathRef = useRef(location.pathname)

    useEffect(() => {
        if (previousPathRef.current !== location.pathname) {
            setViewingOperation(null)
            previousPathRef.current = location.pathname
        }
    }, [location.pathname, setViewingOperation])

    if (!validated) return <UsernameGate />
    return (
        <div className="flex min-h-screen bg-background">
            <Sidebar />
            <main className="flex-1 min-w-0">
                <Outlet />
            </main>
            <OperationPanel />
        </div>
    )
}

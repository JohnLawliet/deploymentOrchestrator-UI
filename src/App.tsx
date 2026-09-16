import { useEffect, useRef } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import UsernameGate from '@/components/UsernameGate';
import SystemToastQueue from '@/components/SystemToastQueue';
import PortalDashboardPage from '@/pages/PortalDashboardPage';
import JarDeployPage from '@/pages/JarDeploymentPage';
import WarDeployPage from '@/pages/WarDeploymentPage';
import DownloadsPage from '@/pages/DownloadsPage';
import TablesPage from '@/pages/TablesPage';
import UatBuildPage from '@/pages/UatBuildPage';
import UploadPage from '@/pages/UploadPage';
import QueuePage from '@/pages/QueuePage';
import ProfilePage from '@/pages/ProfilePage';
import { usePortal } from '@/context/PortalContext';
import { selectIsSuperAdmin, useUserStore } from '@/userStore';

type RedirectState = {
  from?: {
    pathname?: unknown;
    search?: unknown;
    hash?: unknown;
  };
};

function destinationFrom(state: unknown): string | null {
  const from = (state as RedirectState | null)?.from;
  if (!from || typeof from.pathname !== 'string' || !from.pathname.startsWith('/') || from.pathname.startsWith('//')) {
    return null;
  }
  const search = typeof from.search === 'string' ? from.search : '';
  const hash = typeof from.hash === 'string' ? from.hash : '';
  return `${from.pathname}${search}${hash}`;
}

function ValidationScreen() {
  return (
    <>
      <main className="min-h-screen grid place-items-center p-6 bg-background">
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Validating…
        </p>
      </main>
      <SystemToastQueue />
    </>
  );
}

function LoginRoute() {
  const { sessionPhase } = usePortal();
  const location = useLocation();

  if (sessionPhase === 'restoring' || sessionPhase === 'validating') return <ValidationScreen />;
  if (sessionPhase === 'queued') return <Navigate to="/queue" replace />;
  if (sessionPhase === 'admitted') return <Navigate to={destinationFrom(location.state) || '/dashboard'} replace />;
  return (
    <>
      <UsernameGate />
      <SystemToastQueue />
    </>
  );
}

function ProtectedRoute() {
  const { sessionPhase } = usePortal();
  const location = useLocation();

  if (sessionPhase === 'admitted') return <Outlet />;
  if (sessionPhase === 'queued') return <Navigate to="/queue" replace />;
  if (sessionPhase === 'restoring' || sessionPhase === 'validating' || sessionPhase === 'loggingOut') return <ValidationScreen />;
  return <Navigate to="/" replace state={{ from: location }} />;
}

function QueueRoute() {
  const { sessionPhase } = usePortal();
  if (sessionPhase === 'queued' || sessionPhase === 'loggingOut') return <QueuePage />;
  if (sessionPhase === 'admitted') return <Navigate to="/dashboard" replace />;
  if (sessionPhase === 'restoring' || sessionPhase === 'validating') return <ValidationScreen />;
  return <Navigate to="/" replace />;
}

function SuperAdminRoute() {
  const superAdmin = useUserStore(selectIsSuperAdmin);
  return superAdmin ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

function UnknownRoute() {
  const { sessionPhase } = usePortal();
  if (sessionPhase === 'restoring' || sessionPhase === 'validating') return <ValidationScreen />;
  return <Navigate to={sessionPhase === 'admitted' ? '/dashboard' : sessionPhase === 'queued' ? '/queue' : '/'} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LoginRoute />} />
      <Route path="queue" element={<QueueRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="dashboard" element={<PortalDashboardPage />} />
          <Route path="deploy-jar" element={<JarDeployPage />} />
          <Route path="deploy-war" element={<WarDeployPage />} />
          <Route path="downloads" element={<DownloadsPage />} />
          <Route path="create-uat-build" element={<UatBuildPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="tables" element={<TablesPage />} />
          <Route element={<SuperAdminRoute />}>
            <Route path="profile" element={<ProfilePage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<UnknownRoute />} />
    </Routes>
  );
}

function App() {
  const { reportInteraction, setViewingOperation } = usePortal();
  const location = useLocation();
  const previousPathRef = useRef(location.pathname);

  useEffect(() => {
    if (previousPathRef.current !== location.pathname) {
      reportInteraction?.();
      setViewingOperation(null);
      previousPathRef.current = location.pathname;
    }
  }, [location.pathname, reportInteraction, setViewingOperation]);

  return <AppRoutes />;
}

export default App;

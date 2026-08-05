import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import PortalDashboardPage from '@/pages/PortalDashboardPage';
import JarDeployPage from '@/pages/JarDeploymentPage';
import WarDeployPage from '@/pages/WarDeploymentPage';
import DownloadsPage from '@/pages/DownloadsPage';
import TablesPage from '@/pages/TablesPage';
import UatBuildPage from '@/pages/UatBuildPage';
import UploadPage from '@/pages/UploadPage';
import { PortalProvider } from '@/context/PortalContext';

const basePath = import.meta.env.VITE_BASE_PATH || '/deploymentOrchestrator';

function App() {
  return (
    <PortalProvider>
      <BrowserRouter basename={basePath}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<PortalDashboardPage />} />
            <Route path="deploy-jar" element={<JarDeployPage />} />
            <Route path="deploy-war" element={<WarDeployPage />} />
            <Route path="downloads" element={<DownloadsPage />} />
            <Route path="create-uat-build" element={<UatBuildPage />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="tables" element={<TablesPage />} />
            <Route path="*" element={<Navigate to="dashboard" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </PortalProvider>
  );
}

export default App;

import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import OperationProgressPanel from '@/components/OperationProgressPanel';
import OperationToastQueue from '@/components/OperationToastQueue';
import SystemToastQueue from '@/components/SystemToastQueue';

export default function AppLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
      <OperationProgressPanel />
      <OperationToastQueue />
      <SystemToastQueue />
    </div>
  );
}

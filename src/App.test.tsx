import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const portal = vi.hoisted(() => ({
  validated: false,
  username: '',
  validationState: 'idle' as 'idle' | 'validating' | 'valid' | 'invalid',
  reportInteraction: vi.fn(),
  setViewingOperation: vi.fn(),
}));

vi.mock('@/context/PortalContext', () => ({
  usePortal: () => portal,
}));
vi.mock('@/components/layout/Sidebar', () => ({
  default: () => <aside>Sidebar</aside>,
}));
vi.mock('@/components/UsernameGate', () => ({
  default: () => <div>Username gate</div>,
}));
vi.mock('@/components/OperationProgressPanel', () => ({
  default: () => null,
}));
vi.mock('@/components/OperationToastQueue', () => ({
  default: () => null,
}));
vi.mock('@/components/SystemToastQueue', () => ({
  default: () => null,
}));
vi.mock('@/pages/PortalDashboardPage', () => ({
  default: () => <div>Dashboard page</div>,
}));
vi.mock('@/pages/JarDeploymentPage', () => ({
  default: () => <div>JAR page</div>,
}));
vi.mock('@/pages/WarDeploymentPage', () => ({
  default: () => <div>WAR page</div>,
}));
vi.mock('@/pages/DownloadsPage', () => ({
  default: () => <div>Downloads page</div>,
}));
vi.mock('@/pages/TablesPage', () => ({
  default: () => <div>Tables page</div>,
}));
vi.mock('@/pages/UatBuildPage', () => ({
  default: () => <div>UAT page</div>,
}));
vi.mock('@/pages/UploadPage', () => ({
  default: () => <div>Upload page</div>,
}));

import { AppRoutes } from './App';

describe('AppRoutes', () => {
  beforeEach(() => {
    portal.validated = false;
    portal.username = '';
    portal.validationState = 'idle';
    portal.reportInteraction.mockReset();
    portal.setViewingOperation.mockReset();
  });

  afterEach(cleanup);

  it('sends unauthenticated unknown paths to the login gate', () => {
    render(
      <MemoryRouter initialEntries={['/not-a-page']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByText('Username gate')).toBeInTheDocument();
  });

  it('sends authenticated unknown paths to the dashboard', () => {
    portal.validated = true;
    render(
      <MemoryRouter initialEntries={['/not-a-page']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
    expect(screen.queryByText('Username gate')).not.toBeInTheDocument();
  });

  it('keeps a direct protected URL while a stored session is being revalidated', () => {
    portal.username = 'john_smith';
    portal.validationState = 'validating';
    const view = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Validating…');
    expect(screen.queryByText('Username gate')).not.toBeInTheDocument();

    portal.validated = true;
    portal.validationState = 'valid';
    view.rerender(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
    expect(screen.queryByText('Username gate')).not.toBeInTheDocument();
  });

  it('returns a manually signed-in user to the protected route that sent them to login', () => {
    const view = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByText('Username gate')).toBeInTheDocument();

    portal.validated = true;
    portal.validationState = 'valid';
    view.rerender(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });

  it('sends authenticated users from the login root to the dashboard', () => {
    portal.validated = true;
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });
});

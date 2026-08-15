import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
vi.mock('./Sidebar', () => ({
  default: () => <aside>Sidebar</aside>,
}));
vi.mock('@/components/SystemToastQueue', () => ({
  default: () => <div>System toasts</div>,
}));
vi.mock('@/components/OperationProgressPanel', () => ({
  default: () => <div>Operation panel</div>,
}));
vi.mock('@/components/OperationToastQueue', () => ({
  default: () => <div>Operation toasts</div>,
}));

import AppLayout from './AppLayout';

describe('AppLayout', () => {
  afterEach(cleanup);

  it('renders the authenticated application shell around its routed content', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<div>Dashboard page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
    expect(screen.getByText('Operation panel')).toBeInTheDocument();
    expect(screen.getByText('Operation toasts')).toBeInTheDocument();
    expect(screen.getByText('System toasts')).toBeInTheDocument();
  });
});

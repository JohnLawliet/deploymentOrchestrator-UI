import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

const portal = vi.hoisted(() => ({
  setViewingOperation: vi.fn(),
  validated: true,
}));

vi.mock('@/context/PortalContext', () => ({
  usePortal: () => portal,
}));
vi.mock('./Sidebar', () => ({
  default: () => <aside>Sidebar</aside>,
}));
vi.mock('@/components/UsernameGate', () => ({
  default: () => <div>Username gate</div>,
}));
vi.mock('@/components/OperationProgressPanel', () => ({
  default: () => <div>Operation panel</div>,
}));

import AppLayout from './AppLayout';

describe('AppLayout output drawer lifecycle', () => {
  beforeEach(() => {
    portal.setViewingOperation.mockReset();
    portal.validated = true;
  });

  afterEach(cleanup);

  it('dismisses the viewed operation when application navigation changes routes', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Link to="/downloads">Open downloads</Link>} />
            <Route path="/downloads" element={<div>Downloads page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(portal.setViewingOperation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link', { name: 'Open downloads' }));

    expect(await screen.findByText('Downloads page')).toBeInTheDocument();
    await waitFor(() => expect(portal.setViewingOperation).toHaveBeenCalledWith(null));
  });
});

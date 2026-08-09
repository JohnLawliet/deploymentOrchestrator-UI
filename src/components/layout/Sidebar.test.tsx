import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { userPresence } from '@/test/factories';
import type { UserPresence } from '@/types/api-contracts';

type SidebarPortalMock = { changeUser: ReturnType<typeof vi.fn>; username: string; onlineUsers: UserPresence[] };

const portal = vi.hoisted((): SidebarPortalMock => ({
  changeUser: vi.fn(),
  username: 'jonty',
  onlineUsers: [],
}));

vi.mock('@/context/PortalContext', () => ({
  usePortal: () => ({
    username: portal.username,
    changeUser: portal.changeUser,
    systemStatus: 'connected',
    operations: {},
    onlineUsers: portal.onlineUsers,
  }),
}));

import Sidebar from './Sidebar';

describe('Sidebar Upload navigation', () => {
  afterEach(() => {
    cleanup();
    portal.username = 'jonty';
    portal.onlineUsers = [];
  });

  it('replaces the deferred hotfix item with an active Upload link', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Upload' })).toHaveAttribute('href', '/upload');
    expect(screen.queryByText('Upload hotfix')).not.toBeInTheDocument();
    expect(screen.queryByText('LATER')).not.toBeInTheDocument();
  });

  it('opens the user menu from the displayed name and changes user from the menu', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Change user' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'jonty' }));
    await user.click(screen.getByRole('button', { name: 'Change user' }));

    expect(portal.changeUser).toHaveBeenCalledOnce();
  });

  it('renders current user first, idle state, compact activity, and null activity cleanly', () => {
    portal.username = 'John_Smith';
    portal.onlineUsers = [
      userPresence({ username: 'John Smith', status: 'IDLE', revision: 2, lastActivity: null }),
      userPresence({
        username: 'amy',
        status: 'ACTIVE',
        revision: 1,
        lastActivity: 'jar:orders',
        lastActivityStatus: 'COMPLETED',
        lastActivityTime: '2026-08-04T10:00:00Z',
      }),
    ];
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    const list = screen.getByTestId('online-users-list');
    const names = Array.from(list.querySelectorAll('.font-medium')).map((item) => item.textContent);
    expect(names).toEqual(['John Smith', 'amy']);
    expect(screen.getByText('IDLE')).toBeVisible();
    expect(screen.getByText('No recent activity')).toBeVisible();
    expect(screen.getByText(/jar:orders · COMPLETED/)).toBeVisible();
    expect(list).toHaveClass('overflow-y-auto');
  });
});

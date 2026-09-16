import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { userPresence } from '@/test/factories';
import type { UserPresence } from '@/types/api-contracts';

type SidebarPortalMock = {
  changeUser: ReturnType<typeof vi.fn>;
  forceLogoutUser: ReturnType<typeof vi.fn>;
  isAdmin: boolean;
  username: string;
  onlineUsers: UserPresence[];
};

const portal = vi.hoisted((): SidebarPortalMock => ({
  changeUser: vi.fn(),
  forceLogoutUser: vi.fn(),
  isAdmin: false,
  username: 'jonty',
  onlineUsers: [],
}));
const userState = vi.hoisted(() => ({
  authUser: { username: 'jonty', userType: 'USER' as 'USER' | 'ADMIN' | 'SUPERADMIN' },
}));

vi.mock('@/context/PortalContext', () => ({
  usePortal: () => ({
    username: portal.username,
    changeUser: portal.changeUser,
    forceLogoutUser: portal.forceLogoutUser,
    isAdmin: portal.isAdmin,
    systemStatus: 'connected',
    operations: {},
    onlineUsers: portal.onlineUsers,
  }),
}));
vi.mock('@/userStore', () => ({
  selectUsername: (state: typeof userState) => state.authUser.username,
  selectHasAdminAccess: (state: typeof userState) =>
    state.authUser.userType === 'ADMIN' || state.authUser.userType === 'SUPERADMIN',
  selectIsSuperAdmin: (state: typeof userState) => state.authUser.userType === 'SUPERADMIN',
  useUserStore: (selector: (state: typeof userState) => unknown) => selector(userState),
}));

import Sidebar from './Sidebar';

function LocationDisplay() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

describe('Sidebar Upload navigation', () => {
  afterEach(() => {
    cleanup();
    portal.username = 'jonty';
    portal.onlineUsers = [];
    portal.isAdmin = false;
    userState.authUser = { username: 'jonty', userType: 'USER' };
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

  it('opens the user menu from the displayed name and logs out from the menu', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'jonty' }));
    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(portal.changeUser).toHaveBeenCalledOnce();
  });

  it('opens the profile page from the account menu', async () => {
    userState.authUser.userType = 'SUPERADMIN';
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar />
        <LocationDisplay />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'jonty' }));
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/profile');
  });

  it('renders current user first, idle state, compact activity, and null activity cleanly', () => {
    portal.username = 'John_Smith';
    userState.authUser.username = 'John_Smith';
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
    expect(screen.getByText(/No recent activity/)).toBeVisible();
    expect(screen.getByText(/jar:orders · COMPLETED/)).toBeVisible();
    expect(list.parentElement).toHaveClass('overflow-y-auto');
  });

  it('shows force logout beside other users only for admins', async () => {
    portal.isAdmin = true;
    portal.username = 'admin';
    userState.authUser = { username: 'admin', userType: 'ADMIN' };
    portal.onlineUsers = [userPresence({ username: 'admin' }), userPresence({ username: 'amy' })];
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Actions for admin' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for amy' }));
    await user.click(screen.getByRole('button', { name: 'Force logout' }));
    expect(portal.forceLogoutUser).toHaveBeenCalledWith('amy');
  });

  it('hides the profile entry from non-superadmins', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'jonty' }));
    expect(screen.queryByRole('button', { name: 'Profile' })).not.toBeInTheDocument();
  });
});

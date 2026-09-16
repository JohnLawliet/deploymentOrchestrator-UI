import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfilePageContent, type UserRole } from './ProfilePage';

const profile = (role: UserRole = 'SUPERADMIN') => ({
  fullName: 'Jamie Rivera',
  techDriveName: 'jamie.rivera',
  role,
  lastUpdated: '2026-09-12T09:30:00Z',
  aboutMe: 'Release coordinator',
  avatarUrl: null,
});

const users = [
  { id: 'user-jamie', username: 'jamie.rivera', name: 'Jamie Rivera', role: 'SUPERADMIN' as const },
  { id: 'user-amy', username: 'amy.wong', name: 'Amy Wong', role: 'ADMIN' as const },
  { id: 'user-david', username: 'david.lee', name: 'David Lee', role: 'USER' as const },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ProfilePageContent', () => {
  it('shows profile details and activity without exposing a password', () => {
    render(<ProfilePageContent username="jamie.rivera" initialProfile={profile()} />);

    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Jamie Rivera');
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
    expect(screen.getByText('Accounts Portal')).toBeInTheDocument();
    expect(screen.getByText('47')).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('edits, validates, and saves personal details safely', async () => {
    const user = userEvent.setup();
    render(<ProfilePageContent username="jamie.rivera" initialProfile={profile()} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const name = screen.getByLabelText('Name');
    expect(name).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText('New password')).toHaveValue('');

    fireEvent.change(name, { target: { value: 'Jamie R.' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-secret' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The new passwords do not match.');

    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByLabelText('Name')).toHaveValue('Jamie R.');
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('discards unsaved profile and avatar changes', async () => {
    const user = userEvent.setup();
    render(<ProfilePageContent username="jamie.rivera" initialProfile={profile()} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('About me'));
    await user.type(screen.getByLabelText('About me'), 'Unsaved biography');
    await user.upload(screen.getByLabelText('Change image'), new File(['avatar'], 'avatar.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByAltText('Jamie Rivera profile')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('About me')).toHaveValue('Release coordinator');
    expect(screen.queryByAltText('Jamie Rivera profile')).not.toBeInTheDocument();
  });

  it('only renders role management for superadmins', () => {
    const { rerender } = render(
      <ProfilePageContent username="jamie.rivera" initialProfile={profile('ADMIN')} initialUsers={users} />,
    );
    expect(screen.queryByRole('heading', { name: /User role management/ })).not.toBeInTheDocument();

    rerender(<ProfilePageContent username="jamie.rivera" initialProfile={profile()} initialUsers={users} />);
    expect(screen.getByRole('heading', { name: /User role management/ })).toBeInTheDocument();
  });

  it('filters users and confirms each role change', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ProfilePageContent username="jamie.rivera" initialProfile={profile()} initialUsers={users} />);

    const roleCard = screen.getByTestId('role-management-card');
    await user.type(within(roleCard).getByLabelText('Search users'), 'David');
    expect(within(roleCard).getByText('David Lee')).toBeInTheDocument();
    expect(within(roleCard).queryByText('Amy Wong')).not.toBeInTheDocument();

    const david = within(roleCard).getByTestId('managed-user-david.lee');
    await user.click(within(david).getByRole('button', { name: 'Promote to admin' }));

    expect(confirm).toHaveBeenCalledWith('Promote David Lee to admin?');
    await waitFor(() => expect(within(david).getByRole('button', { name: 'Demote to user' })).toBeInTheDocument());
    expect(within(roleCard).getByRole('status')).toHaveTextContent('David Lee is now an admin.');
  });

  it('keeps a role unchanged when confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ProfilePageContent username="jamie.rivera" initialProfile={profile()} initialUsers={users} />);

    const amy = within(screen.getByTestId('role-management-card')).getByTestId('managed-user-amy.wong');
    fireEvent.click(within(amy).getByRole('button', { name: 'Demote to user' }));
    expect(within(amy).getByRole('button', { name: 'Demote to user' })).toBeInTheDocument();
  });

  it('gives admins user-only creation and removal permissions', () => {
    render(<ProfilePageContent username="amy.wong" initialProfile={profile('ADMIN')} initialUsers={users} />);

    const accessCard = screen.getByTestId('user-access-card');
    expect(within(accessCard).getByLabelText('New user type')).toBeDisabled();
    expect(within(accessCard).queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument();
    expect(
      within(within(accessCard).getByTestId('access-user-david.lee')).getByRole('button', { name: 'Remove' }),
    ).toBeEnabled();
    expect(
      within(within(accessCard).getByTestId('access-user-amy.wong')).getByRole('button', { name: 'Remove' }),
    ).toBeDisabled();
    expect(
      within(within(accessCard).getByTestId('access-user-jamie.rivera')).getByRole('button', { name: 'Remove' }),
    ).toBeDisabled();
  });

  it('adds an admin and synchronizes both superadmin user lists', () => {
    render(<ProfilePageContent username="jamie.rivera" initialProfile={profile()} initialUsers={users} />);

    const accessCard = screen.getByTestId('user-access-card');
    fireEvent.change(within(accessCard).getByLabelText('New user full name'), { target: { value: 'Sam Taylor' } });
    fireEvent.change(within(accessCard).getByLabelText('New user username'), { target: { value: 'sam.taylor' } });
    fireEvent.change(within(accessCard).getByLabelText('New user TechDrive name'), { target: { value: 'sam.taylor' } });
    fireEvent.change(within(accessCard).getByLabelText('New user initial password'), { target: { value: 'temporary' } });
    fireEvent.change(within(accessCard).getByLabelText('New user type'), { target: { value: 'ADMIN' } });
    fireEvent.click(within(accessCard).getByRole('button', { name: 'Add user' }));

    expect(within(accessCard).getByText('Sam Taylor')).toBeInTheDocument();
    expect(within(screen.getByTestId('role-management-card')).getByText('Sam Taylor')).toBeInTheDocument();
    expect(within(accessCard).getByRole('status')).toHaveTextContent('Sam Taylor was added as an admin.');
  });

  it('validates duplicate users and synchronizes confirmed removals', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ProfilePageContent username="jamie.rivera" initialProfile={profile()} initialUsers={users} />);

    const accessCard = screen.getByTestId('user-access-card');
    fireEvent.change(within(accessCard).getByLabelText('New user full name'), { target: { value: 'Duplicate David' } });
    fireEvent.change(within(accessCard).getByLabelText('New user username'), { target: { value: 'DAVID.LEE' } });
    fireEvent.change(within(accessCard).getByLabelText('New user TechDrive name'), { target: { value: 'david.lee' } });
    fireEvent.change(within(accessCard).getByLabelText('New user initial password'), { target: { value: 'temporary' } });
    fireEvent.click(within(accessCard).getByRole('button', { name: 'Add user' }));
    expect(within(accessCard).getByRole('alert')).toHaveTextContent('already exists');

    const david = within(accessCard).getByTestId('access-user-david.lee');
    fireEvent.click(within(david).getByRole('button', { name: 'Remove' }));
    expect(confirm).toHaveBeenCalledWith('Remove David Lee from the application?');
    await waitFor(() => expect(within(accessCard).queryByText('David Lee')).not.toBeInTheDocument());
    expect(within(screen.getByTestId('role-management-card')).queryByText('David Lee')).not.toBeInTheDocument();
  });
});

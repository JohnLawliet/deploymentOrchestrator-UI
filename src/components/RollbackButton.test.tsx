import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getWarSnapshots: vi.fn(),
  isLockConflict: vi.fn(() => false),
  rollbackWar: vi.fn(),
}));
const portal = vi.hoisted(() => ({
  operations: {},
  registerOperation: vi.fn(),
  username: 'deploy-user',
}));

vi.mock('@/lib/contractApi', () => api);
vi.mock('@/context/PortalContext', () => ({
  usePortal: () => portal,
}));

import RollbackButton from './RollbackButton';

describe('RollbackButton', () => {
  beforeEach(() => {
    api.getWarSnapshots.mockReset();
    api.rollbackWar.mockReset();
    portal.operations = {};
    portal.registerOperation.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('reports when a profile has no rollback snapshots', async () => {
    api.getWarSnapshots.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<RollbackButton profileId="profile-1" profileName="coinDCX" />);

    await user.click(screen.getByRole('button', { name: /Rollback to previous version/i }));
    expect(await screen.findByText("Profile doesn't have rollback snapshots.")).toBeVisible();
    expect(api.getWarSnapshots).toHaveBeenCalledWith('profile-1');
  });

  it('can open in controlled tutorial mode to inspect snapshots without selecting a rollback', async () => {
    api.getWarSnapshots.mockResolvedValue([{ snapshotId: 42, createdAt: '2026-08-12T10:00:00Z' }]);
    render(<RollbackButton profileId="profile-1" profileName="coinDCX" open tourTarget="dashboard-tutorial-rollback" />);

    expect(await screen.findByRole('button', { name: /42/ })).toBeVisible();
    expect(api.getWarSnapshots).toHaveBeenCalledWith('profile-1');
    expect(api.rollbackWar).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Rollback to previous version/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('lists snapshots and starts rollback from the selected entry', async () => {
    api.getWarSnapshots.mockResolvedValue([{ snapshotId: 42, createdAt: '2026-08-12T10:00:00Z' }]);
    api.rollbackWar.mockResolvedValue({ operationId: 'rollback-operation', status: 'STARTING' });
    const user = userEvent.setup();
    render(<RollbackButton profileId="profile-1" profileName="coinDCX" />);

    await user.click(screen.getByRole('button', { name: /Rollback to previous version/i }));
    await user.click(await screen.findByRole('button', { name: /42/ }));

    await waitFor(() => {
      expect(api.rollbackWar).toHaveBeenCalledWith(42);
    });
    expect(portal.registerOperation).toHaveBeenCalledWith(
      {
        operationId: 'rollback-operation',
        status: 'STARTING',
        operationType: 'WAR_ROLLBACK',
      },
      'WILDFLY_PROFILE:profile-1',
      'Rollback WAR · coinDCX',
    );
  });
});

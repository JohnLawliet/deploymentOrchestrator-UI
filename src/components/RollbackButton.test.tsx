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

  it('reports when a profile has no eligible snapshots', async () => {
    api.getWarSnapshots.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<RollbackButton profileId="profile-1" profileName="coinDCX" />);

    await user.click(screen.getByRole('button', { name: /Rollback to previous version/i }));

    expect(await screen.findByText('No snapshots found')).toBeInTheDocument();
    expect(api.getWarSnapshots).toHaveBeenCalledWith('profile-1');
  });

  it('starts rollback for the selected snapshot and registers its operation', async () => {
    api.getWarSnapshots.mockResolvedValue([{ snapshotId: 'snapshot-uuid', createdAt: '2026-07-26T13:24:11Z' }]);
    api.rollbackWar.mockResolvedValue({ operationId: 'rollback-operation', status: 'STARTING' });
    const user = userEvent.setup();
    render(<RollbackButton profileId="profile-1" profileName="coinDCX" />);

    await user.click(screen.getByRole('button', { name: /Rollback to previous version/i }));
    await user.click(await screen.findByRole('button', { name: /snapshot-uuid/i }));

    await waitFor(() => {
      expect(api.rollbackWar).toHaveBeenCalledWith('snapshot-uuid');
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

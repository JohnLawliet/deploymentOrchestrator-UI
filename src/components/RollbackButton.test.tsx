import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
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
    api.rollbackWar.mockReset();
    portal.operations = {};
    portal.registerOperation.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('is unavailable without a current backend snapshot ID', () => {
    render(<RollbackButton profileId="profile-1" profileName="coinDCX" backupSnapshotId={null} />);

    expect(screen.getByRole('button', { name: /Rollback to previous version/i })).toBeDisabled();
  });

  it('starts rollback with the current backend snapshot ID and registers its operation', async () => {
    api.rollbackWar.mockResolvedValue({ operationId: 'rollback-operation', status: 'STARTING' });
    const user = userEvent.setup();
    render(<RollbackButton profileId="profile-1" profileName="coinDCX" backupSnapshotId={42} />);

    await user.click(screen.getByRole('button', { name: /Rollback to previous version/i }));

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

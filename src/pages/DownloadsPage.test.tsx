import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findConflictingLock, type LockScope } from '@/lib/collaborationState';
import { lockInfo, systemEvent } from '@/test/factories';
import type { LockInfo, SystemEvent } from '@/types/api-contracts';

const api = vi.hoisted(() => ({
  getFileRoots: vi.fn(),
  listFiles: vi.fn(),
  downloadSelection: vi.fn(),
  downloadSingle: vi.fn(),
  saveBlob: vi.fn(),
  isLockConflict: vi.fn(() => false),
  createDirectory: vi.fn(),
  deleteFiles: vi.fn(),
  extractFile: vi.fn(),
  renameFile: vi.fn(),
  preflightFileMove: vi.fn(),
  moveFiles: vi.fn(),
}));

const portal = vi.hoisted(() => ({
  lastSystemEvent: null as SystemEvent | null,
  locks: {} as Record<string, LockInfo>,
  findConflictingLock: vi.fn((_scopes: LockScope | LockScope[]) => null as LockInfo | null),
}));

vi.mock('@/lib/contractApi', () => ({
  EXTRACTION_UNCONFIRMED_MESSAGE: 'The extraction result could not be confirmed. Refresh the directory before trying again.',
  getFileRoots: api.getFileRoots,
  listFiles: api.listFiles,
  downloadSelection: api.downloadSelection,
  downloadSingle: api.downloadSingle,
  saveBlob: api.saveBlob,
  isLockConflict: api.isLockConflict,
  createDirectory: api.createDirectory,
  deleteFiles: api.deleteFiles,
  extractFile: api.extractFile,
  renameFile: api.renameFile,
  preflightFileMove: api.preflightFileMove,
  moveFiles: api.moveFiles,
}));

vi.mock('@/context/PortalContext', () => ({
  usePortal: () => portal,
  useOptionalPortal: () => portal,
}));

vi.mock('@/components/PageTutorial', () => ({
  default: () => <button type="button">Tutorial</button>,
}));

vi.mock('@/components/FileMoveDrawer', () => ({
  default: () => null,
}));

import DownloadsPage from './DownloadsPage';

const lockChangedEvent = () =>
  systemEvent<Extract<SystemEvent, { eventType: 'LOCK_CHANGED' }>>({
    eventType: 'LOCK_CHANGED',
    state: 'ACQUIRED',
    resources: {
      action: 'ACQUIRED',
      lock: lockInfo({
        resourceKey: 'logical:download:qc',
        section: 'DOWNLOAD',
        profile: 'qc',
        mode: 'READ',
        owner: 'Mary Smith',
      }),
    },
  });

describe('DownloadsPage', () => {
  beforeEach(() => {
    portal.lastSystemEvent = null;
    portal.locks = {};
    portal.findConflictingLock.mockImplementation((scopes) => findConflictingLock(portal.locks, 'John', scopes));
    api.getFileRoots.mockResolvedValue([{ key: 'qc', path: '/qc' }]);
    api.listFiles.mockResolvedValue([
      { name: 'wildfly-26.1.3', type: 'directory', locked: false },
      { name: 'sibling.xml', type: 'file', locked: false },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.values(api).forEach((value) => {
      if (typeof value === 'function' && 'mockReset' in value) value.mockReset();
    });
    portal.findConflictingLock.mockReset();
  });

  it('refetches the QC file list when lastSystemEvent is LOCK_CHANGED', async () => {
    const view = render(<DownloadsPage />);
    await screen.findByLabelText('Select wildfly-26.1.3');
    expect(api.listFiles).toHaveBeenCalledTimes(1);

    portal.lastSystemEvent = lockChangedEvent();
    view.rerender(<DownloadsPage />);

    await waitFor(() => expect(api.listFiles).toHaveBeenCalledTimes(2));
  });

  it("keeps Download selection enabled for another user's DOWNLOAD READ lock", async () => {
    portal.locks = {
      download: lockInfo({
        resourceKey: 'logical:download:1',
        section: 'DOWNLOAD',
        profile: 'qc',
        mode: 'READ',
        owner: 'Mary Smith',
        expiresAt: '2099-01-01T00:00:00Z',
      }),
    };
    const user = userEvent.setup();
    render(<DownloadsPage />);

    await user.click(await screen.findByLabelText('Select sibling.xml'));

    expect(screen.getByRole('button', { name: 'Download selection' })).toBeEnabled();
    expect(screen.queryByText(/Locked by Mary Smith/)).not.toBeInTheDocument();
  });

  it('disables Download selection for another user’s FILE WRITE lock', async () => {
    portal.locks = {
      file: lockInfo({
        resourceKey: 'logical:file:1',
        section: 'FILE',
        profile: 'qc',
        mode: 'WRITE',
        owner: 'Mary Smith',
        expiresAt: '2099-01-01T00:00:00Z',
      }),
    };
    const user = userEvent.setup();
    render(<DownloadsPage />);

    await user.click(await screen.findByLabelText('Select sibling.xml'));

    expect(screen.getByRole('button', { name: 'Download selection' })).toBeDisabled();
    expect(screen.getAllByText('Locked by Mary Smith').length).toBeGreaterThan(0);
  });
});

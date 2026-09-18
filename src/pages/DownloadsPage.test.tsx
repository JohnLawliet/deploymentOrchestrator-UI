import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findConflictingLock, type LockScope } from '@/lib/collaborationState';
import { lockInfo, systemEvent } from '@/test/factories';
import type { LockInfo, SystemEvent } from '@/types/api-contracts';

const api = vi.hoisted(() => ({
  getFileRoots: vi.fn(),
  listFiles: vi.fn(),
  listPreparedDownloads: vi.fn(),
  prepareArchiveDownload: vi.fn(),
  startPreparedArchiveTransfer: vi.fn(),
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
  listPreparedDownloads: api.listPreparedDownloads,
  prepareArchiveDownload: api.prepareArchiveDownload,
  startPreparedArchiveTransfer: api.startPreparedArchiveTransfer,
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
    api.listPreparedDownloads.mockResolvedValue([]);
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

  it('saves a single regular file through the blob download helper', async () => {
    const result = { blob: new Blob(['jar']), filename: 'sibling.xml' };
    api.downloadSingle.mockResolvedValue(result);
    const user = userEvent.setup();
    render(<DownloadsPage />);

    await user.click(await screen.findByLabelText('Select sibling.xml'));
    await user.click(screen.getByRole('button', { name: 'Download selection' }));

    await waitFor(() => expect(api.saveBlob).toHaveBeenCalledWith(result));
    expect(api.downloadSingle).toHaveBeenCalledWith('qc', 'sibling.xml');
    expect(api.prepareArchiveDownload).not.toHaveBeenCalled();
    expect(api.startPreparedArchiveTransfer).not.toHaveBeenCalled();
  });

  it('shows Preparing download... only while the archive POST runs, then starts the browser transfer', async () => {
    let resolvePrepare: ((value: { downloadToken: string }) => void) | undefined;
    api.prepareArchiveDownload.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePrepare = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<DownloadsPage />);

    await user.click(await screen.findByLabelText('Select wildfly-26.1.3'));
    await user.click(screen.getByRole('button', { name: 'Download selection' }));

    expect(await screen.findByRole('button', { name: 'Preparing download...' })).toBeDisabled();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(document.querySelector('[role="progressbar"]')).toBeNull();

    resolvePrepare?.({ downloadToken: 'opaque-token' });

    await waitFor(() => expect(api.startPreparedArchiveTransfer).toHaveBeenCalledWith('opaque-token'));
    expect(api.prepareArchiveDownload).toHaveBeenCalledWith('qc', ['wildfly-26.1.3']);
    expect(api.downloadSingle).not.toHaveBeenCalled();
    expect(api.saveBlob).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download selection' })).toBeDisabled());
  });

  it('retries an UNFINISHED archive with the token URL and does not POST prepare again', async () => {
    api.listPreparedDownloads.mockResolvedValue([
      {
        downloadToken: 'retry-token',
        fileName: 'qc-download.zip',
        size: 2048,
        status: 'UNFINISHED',
        createdAt: '2026-09-18T00:00:00Z',
      },
    ]);
    const user = userEvent.setup();
    render(<DownloadsPage />);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(api.startPreparedArchiveTransfer).toHaveBeenCalledWith('retry-token');
    expect(api.prepareArchiveDownload).not.toHaveBeenCalled();
  });

  it('disables retry while a prepared archive is DOWNLOADING', async () => {
    api.listPreparedDownloads.mockResolvedValue([
      {
        downloadToken: 'busy-token',
        fileName: 'qc-download.zip',
        size: 10,
        status: 'DOWNLOADING',
        createdAt: '2026-09-18T00:00:00Z',
      },
    ]);
    render(<DownloadsPage />);

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeDisabled();
  });
});

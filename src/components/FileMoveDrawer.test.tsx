import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileMoveProgressDto, SystemEvent } from '@/types/api-contracts';

const preflightFileMove = vi.hoisted(() => vi.fn());
const moveFiles = vi.hoisted(() => vi.fn());
const listFiles = vi.hoisted(() => vi.fn());
const getProfiles = vi.hoisted(() => vi.fn());
const getFileRoots = vi.hoisted(() => vi.fn());

vi.mock('@/lib/contractApi', () => ({
  EXTRACTION_UNCONFIRMED_MESSAGE: 'extraction unconfirmed',
  preflightFileMove,
  moveFiles,
  listFiles,
  getProfiles,
  getFileRoots,
  deleteFiles: vi.fn(),
  extractFile: vi.fn(),
  renameFile: vi.fn(),
  isLockConflict: (error: unknown) =>
    typeof error === 'object' && error !== null && (error as { status?: number }).status === 423,
}));

const portalState = vi.hoisted(() => ({
  lastSystemEvent: null as SystemEvent | null,
}));
const userState = vi.hoisted(() => ({ isAdmin: false }));

vi.mock('@/context/PortalContext', () => ({
  useOptionalPortal: () => ({
    lastSystemEvent: portalState.lastSystemEvent,
    findConflictingLock: () => null,
  }),
}));
vi.mock('@/userStore', () => ({
  selectHasAdminAccess: (state: typeof userState) => state.isAdmin,
  useUserStore: (selector: (state: typeof userState) => unknown) => selector(userState),
}));

import FileMoveDrawer from './FileMoveDrawer';

describe('FileMoveDrawer', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    preflightFileMove.mockReset();
    moveFiles.mockReset();
    listFiles.mockReset();
    getProfiles.mockReset();
    getFileRoots.mockReset();
    userState.isAdmin = false;
    portalState.lastSystemEvent = null;
  });

  beforeEach(() => {
    getProfiles.mockResolvedValue([]);
    getFileRoots.mockResolvedValue([{ key: 'qc', path: 'D:/qc' }]);
  });

  it('blocks admin-required preflight for non-admin users without executing', async () => {
    listFiles.mockResolvedValue([{ name: 'backup', type: 'directory' }]);
    preflightFileMove.mockResolvedValue({
      totalCount: 1,
      moves: [],
      conflicts: [],
      adminRequired: true,
    });
    const onFinished = vi.fn();
    const user = userEvent.setup();
    render(<FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/a.jar']} onClose={vi.fn()} onFinished={onFinished} />);

    await user.click(await screen.findByRole('button', { name: 'Move here' }));
    expect(await screen.findAllByText(/requires an administrator/i)).not.toHaveLength(0);
    expect(moveFiles).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('asks for overwrite confirmation then executes with overwriteConfirmed true', async () => {
    listFiles.mockResolvedValue([{ name: 'backup', type: 'directory' }]);
    preflightFileMove.mockResolvedValue({
      totalCount: 1,
      moves: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'lib/a.jar',
          destinationRootKey: 'qc',
          destinationPath: 'backup/a.jar',
          overwrite: true,
        },
      ],
      conflicts: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'lib/a.jar',
          destinationRootKey: 'qc',
          destinationPath: 'backup/a.jar',
          name: 'a.jar',
        },
      ],
      adminRequired: false,
    });
    moveFiles.mockResolvedValue({
      operationId: 'move-1',
      totalCount: 1,
      completed: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'lib/a.jar',
          destinationRootKey: 'qc',
          destinationPath: 'backup/a.jar',
          status: 'COMPLETED',
          message: null,
        },
      ],
      failed: [],
    });
    const onFinished = vi.fn();
    const user = userEvent.setup();
    render(<FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/a.jar']} onClose={vi.fn()} onFinished={onFinished} />);

    await user.click(await screen.findByRole('button', { name: 'Move here' }));
    expect(await screen.findByText(/will be overwritten/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Overwrite and move' }));

    await waitFor(() =>
      expect(moveFiles).toHaveBeenCalledWith({
        source: { rootKey: 'qc', paths: ['lib/a.jar'] },
        destination: { rootKey: 'qc', path: '.' },
        overwriteConfirmed: true,
        archiveFormat: 'NONE',
      }),
    );
    expect(onFinished).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'move-1', completed: expect.any(Array) }));
  });

  it('sends explicit defaults for same-root Move as-is', async () => {
    listFiles.mockResolvedValue([]);
    preflightFileMove.mockResolvedValue({ totalCount: 1, moves: [], conflicts: [], adminRequired: false });
    moveFiles.mockResolvedValue({
      operationId: 'move-plain',
      totalCount: 1,
      completed: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'lib/a.jar',
          destinationRootKey: 'qc',
          destinationPath: 'a.jar',
          status: 'COMPLETED',
          message: null,
        },
      ],
      failed: [],
    });
    const user = userEvent.setup();
    render(<FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/a.jar']} onClose={vi.fn()} onFinished={vi.fn()} />);

    expect(await screen.findByLabelText('Transfer mode')).toHaveValue('NONE');
    await user.click(screen.getByRole('button', { name: 'Move here' }));
    await waitFor(() =>
      expect(preflightFileMove).toHaveBeenCalledWith({
        source: { rootKey: 'qc', paths: ['lib/a.jar'] },
        destination: { rootKey: 'qc', path: '.' },
        overwriteConfirmed: false,
        archiveFormat: 'NONE',
      }),
    );
    await waitFor(() =>
      expect(moveFiles).toHaveBeenCalledWith({
        source: { rootKey: 'qc', paths: ['lib/a.jar'] },
        destination: { rootKey: 'qc', path: '.' },
        overwriteConfirmed: false,
        archiveFormat: 'NONE',
      }),
    );
  });

  it('sends archiveFormat when same-root archive is selected', async () => {
    listFiles.mockResolvedValue([]);
    preflightFileMove.mockResolvedValue({ totalCount: 1, moves: [], conflicts: [], adminRequired: false });
    moveFiles.mockResolvedValue({
      operationId: 'move-zip',
      totalCount: 1,
      completed: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'lib/a.jar',
          destinationRootKey: 'qc',
          destinationPath: 'a.zip',
          status: 'COMPLETED',
          message: null,
        },
      ],
      failed: [],
    });
    const user = userEvent.setup();
    render(<FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/a.jar']} onClose={vi.fn()} onFinished={vi.fn()} />);

    await user.selectOptions(await screen.findByLabelText('Transfer mode'), 'ZIP');
    await user.click(screen.getByRole('button', { name: 'Move here' }));
    await waitFor(() =>
      expect(preflightFileMove).toHaveBeenCalledWith({
        source: { rootKey: 'qc', paths: ['lib/a.jar'] },
        destination: { rootKey: 'qc', path: '.' },
        overwriteConfirmed: false,
        archiveFormat: 'ZIP',
      }),
    );
  });

  it('keeps relative source paths and renders one backend-generated archive for multiple sources', async () => {
    listFiles.mockResolvedValue([]);
    preflightFileMove.mockResolvedValue({
      totalCount: 1,
      moves: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'one/web.xml',
          destinationRootKey: 'qc',
          destinationPath: 'archive-1789387200000.zip',
          overwrite: false,
        },
      ],
      conflicts: [],
      adminRequired: false,
    });
    moveFiles.mockResolvedValue({
      operationId: 'move-combined',
      totalCount: 1,
      completed: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'one/web.xml',
          destinationRootKey: 'qc',
          destinationPath: 'archive-1789387200000.zip',
          status: 'COMPLETED',
          message: null,
        },
      ],
      failed: [],
    });
    const user = userEvent.setup();
    render(
      <FileMoveDrawer
        open
        sourceRootKey="qc"
        sourcePaths={['one/web.xml', 'two/web.xml']}
        onClose={vi.fn()}
        onFinished={vi.fn()}
      />,
    );

    await user.selectOptions(await screen.findByLabelText('Transfer mode'), 'ZIP');
    await user.click(screen.getByRole('button', { name: 'Move here' }));

    await waitFor(() =>
      expect(preflightFileMove).toHaveBeenCalledWith({
        source: { rootKey: 'qc', paths: ['one/web.xml', 'two/web.xml'] },
        destination: { rootKey: 'qc', path: '.' },
        overwriteConfirmed: false,
        archiveFormat: 'ZIP',
      }),
    );
    expect(await screen.findByText('archive-1789387200000.zip')).toBeVisible();
    expect(screen.queryByText('Completed (2)')).not.toBeInTheDocument();
  });

  it('uses the normalized one-item preflight plan for overlapping selections', async () => {
    listFiles.mockResolvedValue([]);
    preflightFileMove.mockResolvedValue({
      totalCount: 1,
      moves: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'applications/App.war',
          destinationRootKey: 'qc',
          destinationPath: 'App.zip',
          overwrite: true,
        },
      ],
      conflicts: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'applications/App.war',
          destinationRootKey: 'qc',
          destinationPath: 'App.zip',
          name: 'App.zip',
        },
      ],
      adminRequired: false,
    });
    const paths = ['applications/App.war/WEB-INF/web.xml', 'applications/App.war'];
    const user = userEvent.setup();
    render(<FileMoveDrawer open sourceRootKey="qc" sourcePaths={paths} onClose={vi.fn()} onFinished={vi.fn()} />);

    await user.selectOptions(await screen.findByLabelText('Transfer mode'), 'ZIP');
    await user.click(screen.getByRole('button', { name: 'Move here' }));

    expect(await screen.findByText(/1 planned item\(s\)/)).toBeVisible();
    expect(screen.getAllByText('App.zip').length).toBeGreaterThan(0);
    expect(preflightFileMove).toHaveBeenCalledWith({
      source: { rootKey: 'qc', paths },
      destination: { rootKey: 'qc', path: '.' },
      overwriteConfirmed: false,
      archiveFormat: 'ZIP',
    });
    expect(moveFiles).not.toHaveBeenCalled();
  });

  it('defaults qc→techDrive to Zip and never offers Move as-is', async () => {
    userState.isAdmin = true;
    listFiles.mockResolvedValue([]);
    preflightFileMove.mockResolvedValue({
      totalCount: 1,
      moves: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'lib/a.jar',
          destinationRootKey: 'techDrive',
          destinationPath: 'quarantine/a.zip',
          overwrite: false,
        },
      ],
      conflicts: [],
      adminRequired: false,
    });
    moveFiles.mockResolvedValue({
      operationId: 'move-td',
      totalCount: 1,
      completed: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'lib/a.jar',
          destinationRootKey: 'techDrive',
          destinationPath: 'quarantine/a.zip',
          status: 'COMPLETED',
          message: null,
        },
      ],
      failed: [],
    });
    const user = userEvent.setup();
    render(<FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/a.jar']} onClose={vi.fn()} onFinished={vi.fn()} />);

    await user.selectOptions(await screen.findByLabelText('Destination root'), 'techDrive');
    const transferMode = await screen.findByLabelText('Transfer mode');
    expect(transferMode).toHaveValue('ZIP');
    expect(screen.queryByRole('option', { name: 'Move as-is' })).not.toBeInTheDocument();
    expect(screen.getByText(/archived as a single file before transfer/i)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Move here' }));
    await waitFor(() =>
      expect(preflightFileMove).toHaveBeenCalledWith({
        source: { rootKey: 'qc', paths: ['lib/a.jar'] },
        destination: { rootKey: 'techDrive', path: '.' },
        overwriteConfirmed: false,
        archiveFormat: 'ZIP',
      }),
    );
  });

  it('shows phase label during archive progress', async () => {
    listFiles.mockResolvedValue([]);
    preflightFileMove.mockResolvedValue({ totalCount: 1, moves: [], conflicts: [], adminRequired: false });
    let resolveMove: (value: unknown) => void = () => undefined;
    moveFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMove = resolve;
        }),
    );
    const user = userEvent.setup();
    const { rerender } = render(
      <FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/a.jar']} onClose={vi.fn()} onFinished={vi.fn()} />,
    );

    await user.selectOptions(await screen.findByLabelText('Transfer mode'), 'ZIP');
    await user.click(screen.getByRole('button', { name: 'Move here' }));
    await waitFor(() => expect(moveFiles).toHaveBeenCalled());

    portalState.lastSystemEvent = {
      scope: 'OPERATION',
      eventType: 'OPERATION_PROGRESS',
      timestamp: '2026-09-10T00:00:00Z',
      deploymentId: 'move-zip-live',
      resourceKey: 'FILE:qc->qc',
      resourceType: 'FILE',
      state: null,
      pid: null,
      activeOperationId: null,
      deployCount: null,
      consecutiveFailures: null,
      failedDeployCount: null,
      lastResult: null,
      username: 'alice',
      message: null,
      application: null,
      readiness: null,
      readinessReason: null,
      resources: {
        operationId: 'move-zip-live',
        totalCount: 1,
        completedCount: 0,
        failedCount: 0,
        pendingCount: 1,
        progressPercentage: 25,
        currentSourcePath: 'lib/a.jar',
        currentDestinationPath: 'a.zip',
        phaseCode: 'FILE_MOVE_ZIPPING',
        completed: [],
        failed: [],
        pending: [],
      },
    };
    rerender(<FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/a.jar']} onClose={vi.fn()} onFinished={vi.fn()} />);
    expect(await screen.findByText('Zipping')).toBeVisible();

    resolveMove({
      operationId: 'move-zip-live',
      totalCount: 1,
      completed: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'lib/a.jar',
          destinationRootKey: 'qc',
          destinationPath: 'a.zip',
          status: 'COMPLETED',
          message: null,
        },
      ],
      failed: [],
    });
    await waitFor(() => {
      expect(screen.getByText('Destination path(s)')).toBeVisible();
      expect(screen.getByText('a.zip')).toBeVisible();
    });
  });

  it('keeps multi-source plain-move progress phase-driven', async () => {
    listFiles.mockResolvedValue([]);
    preflightFileMove.mockResolvedValue({ totalCount: 2, moves: [], conflicts: [], adminRequired: false });
    let resolveMove: (value: unknown) => void = () => undefined;
    moveFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMove = resolve;
        }),
    );
    const user = userEvent.setup();
    const { rerender } = render(
      <FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/a.jar', 'lib/b.jar']} onClose={vi.fn()} onFinished={vi.fn()} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Move here' }));
    await waitFor(() => expect(moveFiles).toHaveBeenCalled());

    const progress: FileMoveProgressDto = {
      operationId: 'move-live',
      totalCount: 2,
      completedCount: 1,
      failedCount: 0,
      pendingCount: 1,
      progressPercentage: 50,
      currentSourcePath: 'lib/a.jar',
      currentDestinationPath: './a.jar',
      phaseCode: 'FILE_MOVE_TRANSFERRING',
      completed: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'lib/a.jar',
          destinationRootKey: 'qc',
          destinationPath: 'a.jar',
          status: 'COMPLETED',
          message: null,
        },
      ],
      failed: [],
      pending: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'lib/b.jar',
          destinationRootKey: 'qc',
          destinationPath: 'b.jar',
          status: 'PENDING',
          message: null,
        },
      ],
    };
    portalState.lastSystemEvent = {
      scope: 'OPERATION',
      eventType: 'OPERATION_PROGRESS',
      timestamp: '2026-09-10T00:00:00Z',
      deploymentId: 'move-live',
      resourceKey: 'FILE:qc->qc',
      resourceType: 'FILE',
      state: null,
      pid: null,
      activeOperationId: null,
      deployCount: null,
      consecutiveFailures: null,
      failedDeployCount: null,
      lastResult: null,
      username: 'alice',
      message: null,
      application: null,
      readiness: null,
      readinessReason: null,
      resources: progress,
    };
    rerender(
      <FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/a.jar', 'lib/b.jar']} onClose={vi.fn()} onFinished={vi.fn()} />,
    );
    expect(await screen.findByText('Transferring')).toBeVisible();
    expect(screen.queryByText('Item 1 of 2')).not.toBeInTheDocument();
    expect(screen.getByText('70%')).toBeVisible();

    resolveMove({
      operationId: 'move-live',
      totalCount: 2,
      completed: [
        ...progress.completed,
        {
          sourceRootKey: 'qc',
          sourcePath: 'lib/b.jar',
          destinationRootKey: 'qc',
          destinationPath: 'b.jar',
          status: 'COMPLETED',
          message: null,
        },
      ],
      failed: [],
    });
    await waitFor(() => expect(screen.getByText('Destination path(s)')).toBeVisible());
    expect(screen.getByText('a.jar')).toBeVisible();
    expect(screen.getByText('b.jar')).toBeVisible();
    expect(screen.getByText('Completed (2)')).toBeVisible();
  });

  it('offers overwrite retry when execute returns TARGET_EXISTS', async () => {
    listFiles.mockResolvedValue([]);
    preflightFileMove.mockResolvedValue({ totalCount: 1, moves: [], conflicts: [], adminRequired: false });
    moveFiles.mockRejectedValueOnce(
      Object.assign(new Error('Target exists'), {
        status: 409,
        code: 'TARGET_EXISTS',
        paths: ['backup/a.jar'],
        users: [],
      }),
    );
    const user = userEvent.setup();
    render(<FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/a.jar']} onClose={vi.fn()} onFinished={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Move here' }));
    expect(await screen.findByRole('button', { name: 'Overwrite and move' })).toBeVisible();
    expect(screen.getByText((content) => content.includes('a.jar'))).toBeVisible();
  });

  it('hides the destination-root select for non-admin QC users', async () => {
    listFiles.mockResolvedValue([]);
    render(<FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/a.jar']} onClose={vi.fn()} onFinished={vi.fn()} />);

    expect(await screen.findByText(/Destination root:/i)).toBeVisible();
    expect(screen.getByText('QC', { selector: 'p' })).toBeVisible();
    expect(screen.queryByLabelText('Destination root')).not.toBeInTheDocument();
    expect(screen.queryByText(/Moving to Tech Drive requires an administrator/i)).not.toBeInTheDocument();
  });

  it('re-enables Move here after destination changes from blockedAdmin', async () => {
    listFiles.mockImplementation((_root: string, path?: string) => {
      if (path === 'backup') return Promise.resolve([{ name: 'nested', type: 'directory' }]);
      return Promise.resolve([{ name: 'backup', type: 'directory' }]);
    });
    preflightFileMove.mockResolvedValue({
      totalCount: 1,
      moves: [],
      conflicts: [],
      adminRequired: true,
    });
    const user = userEvent.setup();
    render(<FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/a.jar']} onClose={vi.fn()} onFinished={vi.fn()} />);

    const moveHere = await screen.findByRole('button', { name: 'Move here' });
    await user.click(moveHere);
    expect(await screen.findByText(/Choose a destination inside the profile/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Move here' })).toBeDisabled();

    await user.click(await screen.findByRole('button', { name: 'backup' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move here' })).toBeEnabled());
  });

  it('confines destination browsing to the shared WildFly profile for non-admin QC moves', async () => {
    getProfiles.mockResolvedValue([
      {
        id: 'p1',
        name: 'CoinDCXP2P21X',
        profileDir: 'D:/qc/wildfly-26.1.3.Final_profiles/CoinDCXP2P21X',
        deploymentsDir: 'D:/qc/wildfly-26.1.3.Final_profiles/CoinDCXP2P21X/deployments',
      },
    ]);
    getFileRoots.mockResolvedValue([{ key: 'qc', path: 'D:/qc' }]);
    listFiles.mockImplementation((_root: string, path?: string) => {
      if (path === 'wildfly-26.1.3.Final_profiles/CoinDCXP2P21X') {
        return Promise.resolve([{ name: 'deployments', type: 'directory' }]);
      }
      return Promise.resolve([{ name: 'should-not-list-qc-root', type: 'directory' }]);
    });

    render(
      <FileMoveDrawer
        open
        sourceRootKey="qc"
        sourcePaths={['wildfly-26.1.3.Final_profiles/CoinDCXP2P21X/standalone.xml']}
        onClose={vi.fn()}
        onFinished={vi.fn()}
      />,
    );

    expect(await screen.findByRole('button', { name: 'deployments' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'should-not-list-qc-root' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(listFiles).toHaveBeenCalledWith('qc', 'wildfly-26.1.3.Final_profiles/CoinDCXP2P21X', expect.any(AbortSignal)),
    );
    expect(screen.getByText('wildfly-26.1.3.Final_profiles/CoinDCXP2P21X')).toBeVisible();
  });

  it('advances the progress bar from FILE_MOVE phases when backend percentage is 0', async () => {
    listFiles.mockResolvedValue([]);
    preflightFileMove.mockResolvedValue({ totalCount: 1, moves: [], conflicts: [], adminRequired: false });
    moveFiles.mockImplementation(() => new Promise(() => undefined));
    const user = userEvent.setup();
    const { rerender } = render(
      <FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/dir']} onClose={vi.fn()} onFinished={vi.fn()} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Move here' }));
    await waitFor(() => expect(moveFiles).toHaveBeenCalled());

    portalState.lastSystemEvent = {
      scope: 'OPERATION',
      eventType: 'OPERATION_PROGRESS',
      timestamp: '2026-09-10T00:00:00Z',
      deploymentId: 'move-phase',
      resourceKey: 'FILE:qc->qc',
      resourceType: 'FILE',
      state: null,
      pid: null,
      activeOperationId: null,
      deployCount: null,
      consecutiveFailures: null,
      failedDeployCount: null,
      lastResult: null,
      username: 'alice',
      message: null,
      application: null,
      readiness: null,
      readinessReason: null,
      resources: {
        operationId: 'move-phase',
        totalCount: 1,
        completedCount: 0,
        failedCount: 0,
        pendingCount: 1,
        progressPercentage: 0,
        currentSourcePath: 'lib/dir',
        currentDestinationPath: 'dir',
        phaseCode: 'FILE_MOVE_TRANSFERRING',
        completed: [],
        failed: [],
        pending: [],
      },
    };
    rerender(<FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/dir']} onClose={vi.fn()} onFinished={vi.fn()} />);

    expect(await screen.findByText('Transferring')).toBeVisible();
    expect(screen.getByLabelText('File move timeline')).toBeVisible();
    expect(screen.getByText('Progress:')).toBeVisible();
    expect(screen.getByText('70%')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70');
  });

  it('shows archive timeline phases and clamps bar to 100% after HTTP completion from stale SSE', async () => {
    listFiles.mockResolvedValue([]);
    preflightFileMove.mockResolvedValue({ totalCount: 1, moves: [], conflicts: [], adminRequired: false });
    let resolveMove: (value: unknown) => void = () => undefined;
    moveFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMove = resolve;
        }),
    );
    const user = userEvent.setup();
    const { rerender } = render(
      <FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/dir']} onClose={vi.fn()} onFinished={vi.fn()} />,
    );

    await user.selectOptions(await screen.findByLabelText('Transfer mode'), 'ZIP');
    await user.click(screen.getByRole('button', { name: 'Move here' }));
    await waitFor(() => expect(moveFiles).toHaveBeenCalled());

    portalState.lastSystemEvent = {
      scope: 'OPERATION',
      eventType: 'OPERATION_PROGRESS',
      timestamp: '2026-09-10T00:00:00Z',
      deploymentId: 'move-zip-stale',
      resourceKey: 'FILE:qc->qc',
      resourceType: 'FILE',
      state: null,
      pid: null,
      activeOperationId: null,
      deployCount: null,
      consecutiveFailures: null,
      failedDeployCount: null,
      lastResult: null,
      username: 'alice',
      message: null,
      application: null,
      readiness: null,
      readinessReason: null,
      resources: {
        operationId: 'move-zip-stale',
        totalCount: 1,
        completedCount: 0,
        failedCount: 0,
        pendingCount: 1,
        progressPercentage: 0,
        currentSourcePath: 'lib/dir',
        currentDestinationPath: 'dir.zip',
        phaseCode: 'FILE_MOVE_ZIPPING',
        completed: [],
        failed: [],
        pending: [],
      },
    };
    rerender(<FileMoveDrawer open sourceRootKey="qc" sourcePaths={['lib/dir']} onClose={vi.fn()} onFinished={vi.fn()} />);

    expect(await screen.findByLabelText('File move archive timeline')).toBeVisible();
    expect(screen.getByRole('button', { name: /Zip/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Transfer/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Cleanup/ })).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');

    resolveMove({
      operationId: 'move-zip-stale',
      totalCount: 1,
      completed: [
        {
          sourceRootKey: 'qc',
          sourcePath: 'lib/dir',
          destinationRootKey: 'qc',
          destinationPath: 'dir.zip',
          status: 'COMPLETED',
          message: null,
        },
      ],
      failed: [],
    });

    await waitFor(() => {
      expect(screen.getByText('Destination path(s)')).toBeVisible();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    });
  });
});

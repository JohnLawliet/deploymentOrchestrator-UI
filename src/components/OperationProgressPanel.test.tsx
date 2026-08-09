import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationMap, OperationRecord, ProfileLogMap } from '@/types/frontend';
import { operationProgressState, operationRecord, profileLogEvent } from '@/test/factories';

type MockFunction = ReturnType<typeof vi.fn>;
type PortalMock = {
  clearProfileLogs: MockFunction;
  operations: OperationMap;
  profileLogLines: ProfileLogMap;
  reconcileResourceActivity: MockFunction;
  setViewingOperation: MockFunction;
  viewingOperation: OperationRecord | null;
};

const stream = vi.hoisted(() => ({ options: null }));
const api = vi.hoisted(() => ({
  downloadTerminal: vi.fn(),
  getOperation: vi.fn(),
  saveBlob: vi.fn(),
  stopProfile: vi.fn(),
  subscribeProfileLogs: vi.fn(),
  unsubscribeProfileLogs: vi.fn(),
}));
const portal = vi.hoisted((): PortalMock => ({
  clearProfileLogs: vi.fn(),
  operations: {},
  profileLogLines: {},
  reconcileResourceActivity: vi.fn(),
  setViewingOperation: vi.fn(),
  viewingOperation: null,
}));

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn((_url, options) => {
    stream.options = options;
    return new Promise(() => {});
  }),
}));
vi.mock('@/lib/contractApi', () => api);
vi.mock('@/context/PortalContext', () => ({ usePortal: () => portal }));
vi.mock('@/components/RollbackButton', () => ({
  default: () => <button type="button">Rollback to previous version</button>,
}));

import OperationProgressPanel from './OperationProgressPanel';

describe('OperationProgressPanel revised output contracts', () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockClear?.());
    api.getOperation.mockResolvedValue({});
    api.subscribeProfileLogs.mockResolvedValue({});
    api.unsubscribeProfileLogs.mockResolvedValue({});
    api.downloadTerminal.mockResolvedValue({ blob: new Blob(['log']), filename: 'deployment.log' });
    portal.clearProfileLogs.mockReset();
    portal.operations = {};
    portal.profileLogLines = {};
    portal.setViewingOperation.mockReset();
    portal.viewingOperation = null;
    stream.options = null;
  });

  afterEach(cleanup);

  it('subscribes to WildFly profile logs and renders only the selected profile buffer', async () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'profile-output',
      resourceType: 'WILDFLY_PROFILE',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
      profileId: 'profile-1',
      outputRequested: true,
      status: 'ACTIVE',
      label: 'Profile output',
    });
    portal.profileLogLines = {
      'profile-1': [profileLogEvent({ profileId: 'profile-1', timestamp: '1', line: 'matching profile output' })],
      'profile-2': [profileLogEvent({ profileId: 'profile-2', timestamp: '2', line: 'other profile output' })],
    };

    render(<OperationProgressPanel />);

    await waitFor(() => expect(api.subscribeProfileLogs).toHaveBeenCalledWith('profile-1'));
    expect(portal.clearProfileLogs).toHaveBeenCalledWith('profile-1');
    expect(screen.getByText('matching profile output')).toBeInTheDocument();
    expect(screen.queryByText('other profile output')).not.toBeInTheDocument();
  });

  it('does not unsubscribe when collapsed and unsubscribes on close', async () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'profile-output',
      resourceType: 'WILDFLY_PROFILE',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
      profileId: 'profile-1',
      outputRequested: true,
      status: 'ACTIVE',
    });
    const user = userEvent.setup();
    const view = render(<OperationProgressPanel />);

    await user.click(screen.getByRole('button', { name: 'Collapse operation progress' }));
    expect(api.unsubscribeProfileLogs).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Hide operation progress' }));
    await waitFor(() => expect(api.unsubscribeProfileLogs).toHaveBeenCalledTimes(1));
    expect(api.unsubscribeProfileLogs).toHaveBeenCalledWith('profile-1');

    portal.viewingOperation = null;
    view.rerender(<OperationProgressPanel />);
    expect(api.unsubscribeProfileLogs).toHaveBeenCalledTimes(1);
  });

  it('never renders or connects to JAR command output and exposes an event-confirmed log', () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'deployment-1',
      resourceType: 'JAR',
      resourceKey: 'JAR:orders',
    });
    portal.operations = {
      'deployment-1': {
        deploymentId: 'deployment-1',
        terminalAvailabilityConfirmed: true,
        logAvailable: true,
        progress: operationProgressState({
          status: 'COMPLETED',
          phaseCode: 'RESTARTING',
          progressPercentage: 80,
          message: 'Deployment completed.',
        }),
      },
    };
    render(<OperationProgressPanel />);

    expect(screen.queryByText('Command output')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download full log' })).toBeVisible();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.queryByText('80%')).not.toBeInTheDocument();
    expect(screen.queryByText('Phase:')).not.toBeInTheDocument();
    expect(stream.options).toBeNull();
  });

  it('waits for DEPLOYMENT_LOG_AVAILABLE before showing a completed JAR download', () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'deployment-1',
      resourceType: 'JAR',
      resourceKey: 'JAR:orders',
    });
    portal.operations = {
      'deployment-1': {
        deploymentId: 'deployment-1',
        terminalAvailabilityConfirmed: true,
        progress: operationProgressState({
          status: 'COMPLETED',
          phaseCode: 'COMPLETE',
          progressPercentage: 100,
          message: 'Deployment completed.',
        }),
      },
    };

    render(<OperationProgressPanel />);

    expect(screen.queryByRole('button', { name: 'Download full log' })).not.toBeInTheDocument();
  });

  it('replaces stale progress with a backend lifecycle failure and exposes an available log', async () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'deployment-1',
      resourceType: 'JAR',
      resourceKey: 'JAR:orders',
    });
    portal.operations = {
      'deployment-1': {
        deploymentId: 'deployment-1',
        statusEvent: 'DEPLOYMENT_FAILED',
        message: 'The application did not become healthy before the deadline.',
        logAvailable: true,
        progress: operationProgressState({
          status: 'RESTARTING',
          phaseCode: 'RESTARTING',
          progressPercentage: 80,
          message: 'Restarting application',
        }),
      },
    };
    const user = userEvent.setup();
    render(<OperationProgressPanel />);

    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText('The application did not become healthy before the deadline.')).toBeInTheDocument();
    expect(screen.queryByText('80%')).not.toBeInTheDocument();
    expect(screen.queryByText('Phase:')).not.toBeInTheDocument();
    expect(screen.queryByText('Command output')).not.toBeInTheDocument();
    expect(stream.options).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Download full log' }));
    expect(api.downloadTerminal).toHaveBeenCalledWith('deployment-1');
    expect(api.saveBlob).toHaveBeenCalledWith(expect.objectContaining({ filename: 'deployment.log' }));
  });

  it('waits for DEPLOYMENT_LOG_AVAILABLE before showing a failed JAR download', () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'deployment-1',
      resourceType: 'JAR',
      resourceKey: 'JAR:orders',
    });
    portal.operations = {
      'deployment-1': {
        deploymentId: 'deployment-1',
        progress: operationProgressState({
          status: 'FAILED',
          phaseCode: 'RESTARTING',
          progressPercentage: 80,
          message: 'Launcher failed.',
        }),
      },
    };

    render(<OperationProgressPanel />);

    expect(screen.getByText('Launcher failed.')).toBeInTheDocument();
    expect(screen.queryByText('80%')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download full log' })).not.toBeInTheDocument();
  });

  it('shows the launcher-specific message when a JAR log download returns 404', async () => {
    api.downloadTerminal.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 404'), { status: 404 }));
    portal.viewingOperation = operationRecord({
      deploymentId: 'deployment-1',
      resourceType: 'JAR',
      resourceKey: 'JAR:orders',
    });
    portal.operations = {
      'deployment-1': {
        deploymentId: 'deployment-1',
        logAvailable: true,
        progress: operationProgressState({ status: 'FAILED', message: 'Launcher failed.' }),
      },
    };
    const user = userEvent.setup();
    render(<OperationProgressPanel />);

    await user.click(screen.getByRole('button', { name: 'Download full log' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No jarDeployment.log was produced because the application launcher did not start.',
    );
    expect(screen.queryByText(/status code 404/i)).not.toBeInTheDocument();
    expect(api.saveBlob).not.toHaveBeenCalled();
  });

  it('continues rendering operation progress steps without opening a WildFly terminal stream', () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'deployment-2',
      resourceType: 'WILDFLY_PROFILE',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
    });
    portal.operations = {
      'deployment-2': {
        deploymentId: 'deployment-2',
        progress: operationProgressState({
          status: 'RUNNING',
          phaseCode: 'DEPLOY_ARTIFACT',
          steps: [
            {
              timestamp: '1',
              phaseCode: 'PREPARE',
              message: 'Prepared deployment',
              status: 'PREPARING',
              progressPercentage: null,
              component: null,
            },
          ],
        }),
      },
    };

    render(<OperationProgressPanel />);

    expect(screen.getByText('Prepared deployment')).toBeInTheDocument();
    expect(screen.queryByText('Command output')).not.toBeInTheDocument();
    expect(stream.options).toBeNull();
  });
});

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventSourceMessage } from '@microsoft/fetch-event-source';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationMap, OperationRecord, ProfileLogMap } from '@/types/frontend';
import { operationProgressState, operationRecord, profileLogEvent } from '@/test/factories';

type MockFunction = ReturnType<typeof vi.fn>;
type StreamOptions = { onmessage?: (message: EventSourceMessage) => void; signal: AbortSignal };
type PortalMock = {
  clearProfileLogs: MockFunction;
  operations: OperationMap;
  profileLogLines: ProfileLogMap;
  reconcileResourceActivity: MockFunction;
  setViewingOperation: MockFunction;
  viewingOperation: OperationRecord | null;
};

const stream = vi.hoisted(() => ({ url: '', options: null as StreamOptions | null }));
const api = vi.hoisted(() => ({
  downloadTerminal: vi.fn(),
  getOperation: vi.fn(),
  resolvedTerminalEventUrl: vi.fn(
    (url: string | null | undefined, deploymentId: string) => url || `/api/terminals/${deploymentId}/events`,
  ),
  saveBlob: vi.fn(),
  stopProfile: vi.fn(),
  subscribeProfileLogs: vi.fn(),
  techDriveHeaders: vi.fn(() => ({})),
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
  fetchEventSource: vi.fn((url, options) => {
    stream.url = url;
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
    stream.url = '';
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

  it('streams JAR terminal output for a selected dashboard deployment and closes it with the drawer', async () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'deployment-1',
      resourceType: 'JAR',
      resourceKey: 'JAR:orders',
      outputRequested: true,
      terminalEventsUrl: '/api/terminals/deployment-1/events',
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
    const view = render(<OperationProgressPanel />);

    await waitFor(() => expect(stream.options).not.toBeNull());
    const options = stream.options;
    if (!options) throw new Error('Expected JAR terminal stream options.');
    expect(stream.url).toContain('/api/terminals/deployment-1/events');
    expect(screen.getByText('JAR output')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download full log' })).not.toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.queryByText('80%')).not.toBeInTheDocument();
    expect(screen.queryByText('Phase:')).not.toBeInTheDocument();

    await act(async () => {
      options.onmessage?.({
        id: 'jar-output-1',
        event: 'TERMINAL_OUTPUT',
        data: JSON.stringify({
          deploymentId: 'deployment-1',
          timestamp: '2026-08-11T12:00:00Z',
          line: 'JAR is ready',
          replayed: true,
        }),
      });
    });
    expect(screen.getByText('JAR is ready')).toBeInTheDocument();

    view.unmount();
    expect(options.signal.aborted).toBe(true);
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

  it('shows automatic rollback as a failed deployment restored to an active profile and enables its retained log', async () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'failed-war-1',
      resourceType: 'WILDFLY_PROFILE',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
      profileId: 'profile-1',
      label: 'Deploy WAR · orders',
    });
    portal.operations = {
      'failed-war-1': {
        deploymentId: 'failed-war-1',
        operationType: 'WAR_DEPLOY',
        logAvailable: true,
        restoredResourceState: 'ACTIVE',
        progress: operationProgressState({
          phaseCode: 'CLEANUP',
          status: 'FAILED',
          progressPercentage: 95,
          message: 'Cleaning up staging files.',
          deploymentOutcome: 'FAILED',
          rollbackState: 'RESTORED',
          failureMessage: 'WildFly deployment marker reported a missing dependency.',
        }),
      },
    };
    const user = userEvent.setup();
    render(<OperationProgressPanel />);

    expect(screen.getByText('Deployment failed. The previous deployment was restored and the profile is active.')).toBeVisible();
    expect(screen.getByText('WildFly deployment marker reported a missing dependency.')).toBeVisible();
    expect(screen.getByLabelText('QC WAR deployment timeline')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Download Logs' }));
    expect(api.downloadTerminal).toHaveBeenCalledWith('failed-war-1');
  });

  it.each([
    [403, 'You are not authorized to download this failed deployment log.'],
    [404, 'No retained failure log is available for this deployment.'],
    [409, 'The failure log is not ready yet. Try again shortly.'],
  ])('explains failed WAR log download status %s', async (status, expected) => {
    api.downloadTerminal.mockRejectedValueOnce(Object.assign(new Error('request failed'), { status }));
    portal.viewingOperation = operationRecord({
      deploymentId: 'failed-war-1',
      resourceType: 'WILDFLY_PROFILE',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
    });
    portal.operations = {
      'failed-war-1': {
        deploymentId: 'failed-war-1',
        operationType: 'WAR_DEPLOY',
        logAvailable: true,
        progress: operationProgressState({ deploymentOutcome: 'FAILED', status: 'FAILED', phaseCode: 'FAILED' }),
      },
    };
    const user = userEvent.setup();
    render(<OperationProgressPanel />);

    await user.click(screen.getByRole('button', { name: 'Download Logs' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
  });

  it('marks a failed manual rollback as requiring manual recovery', () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'rollback-1',
      resourceType: 'WILDFLY_PROFILE',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
    });
    portal.operations = {
      'rollback-1': {
        deploymentId: 'rollback-1',
        operationType: 'WAR_ROLLBACK',
        progress: operationProgressState({
          phaseCode: 'FAILED',
          status: 'FAILED',
          deploymentOutcome: 'FAILED',
          rollbackState: 'FAILED',
          rollbackFailureMessage: 'WAR rollback failed',
        }),
      },
    };
    render(<OperationProgressPanel />);

    expect(screen.getByText('Rollback failed. Manual recovery is required.')).toBeVisible();
  });

  it('advances WAR progress from polled deployment records while stuck on early live progress', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      portal.viewingOperation = operationRecord({
        deploymentId: 'war-poll-1',
        resourceType: 'WILDFLY_PROFILE',
        resourceKey: 'WILDFLY_PROFILE:profile-1',
        operationType: 'WAR_DEPLOY',
        label: 'Deploy WAR · orders',
      });
      portal.operations = {
        'war-poll-1': {
          deploymentId: 'war-poll-1',
          operationType: 'WAR_DEPLOY',
          resourceKey: 'WILDFLY_PROFILE:profile-1',
          registered: true,
          progress: operationProgressState({
            status: 'VALIDATING',
            phaseCode: 'VALIDATING',
            progressPercentage: 5,
            message: 'Validating',
          }),
        },
      };
      api.getOperation
        .mockResolvedValueOnce({
          deploymentId: 'war-poll-1',
          status: 'VALIDATING',
          progressPercentage: 5,
          type: 'QC_WAR',
        })
        .mockResolvedValue({
          deploymentId: 'war-poll-1',
          status: 'DEPLOYING',
          progressPercentage: 75,
          type: 'QC_WAR',
        });

      render(<OperationProgressPanel />);
      expect(await screen.findByText('5%')).toBeVisible();
      expect(screen.getAllByText('VALIDATING').length).toBeGreaterThan(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(await screen.findByText('DEPLOYING')).toBeVisible();
      expect(screen.getByText('75%')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stretches the progress header when profile and JAR output are unavailable', () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'war-layout-1',
      resourceType: 'WILDFLY_PROFILE',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
      operationType: 'WAR_DEPLOY',
      label: 'Deploy WAR · orders',
    });
    portal.operations = {
      'war-layout-1': {
        deploymentId: 'war-layout-1',
        operationType: 'WAR_DEPLOY',
        progress: operationProgressState({
          status: 'DEPLOYING',
          progressPercentage: 40,
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

    const { container } = render(<OperationProgressPanel />);
    const header = container.querySelector('[class*="flex-1"]');
    expect(header?.className).toMatch(/flex-1/);
    expect(header?.className).toMatch(/min-h-0/);
    const history = screen.getByLabelText('Operation progress history');
    expect(history).toHaveClass('flex-1');
    expect(history).not.toHaveClass('max-h-40');
    expect(screen.queryByText('Profile output')).not.toBeInTheDocument();
    expect(screen.queryByText('JAR output')).not.toBeInTheDocument();
  });

  it('shows the combined JAR and frontend timeline without replacing raw progress history', () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'jar-frontend-1',
      resourceType: 'JAR',
      resourceKey: 'JAR:orders',
      operationType: 'JAR_DEPLOY',
      frontendDeploymentRequested: true,
    });
    portal.operations = {
      'jar-frontend-1': {
        deploymentId: 'jar-frontend-1',
        resourceType: 'JAR',
        operationType: 'JAR_DEPLOY',
        frontendDeploymentRequested: true,
        progress: operationProgressState({
          phaseCode: 'FRONTEND_PUBLISHING',
          status: 'DEPLOYING',
          progressPercentage: 95,
          steps: [
            {
              timestamp: '1',
              phaseCode: 'LOCKS_VERIFIED',
              message: 'All deployment locks are secure.',
              status: 'LOCKING',
              progressPercentage: 15,
              component: 'JarDeploymentService',
            },
          ],
        }),
      },
    };

    render(<OperationProgressPanel />);

    expect(screen.getByLabelText('JAR deployment timeline')).toBeVisible();
    expect(screen.getByRole('button', { name: /Stage frontend files/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Publish frontend files/ }).closest('li')).toHaveClass('text-primary');
    expect(screen.getByText('All deployment locks are secure.')).toBeVisible();
  });

  it('omits frontend stages from a JAR-only timeline while retaining lock and verification steps', () => {
    portal.viewingOperation = operationRecord({
      deploymentId: 'jar-only-1',
      resourceType: 'JAR',
      resourceKey: 'JAR:orders',
      operationType: 'JAR_DEPLOY',
      frontendDeploymentRequested: false,
    });
    portal.operations = {
      'jar-only-1': {
        deploymentId: 'jar-only-1',
        resourceType: 'JAR',
        operationType: 'JAR_DEPLOY',
        frontendDeploymentRequested: false,
        progress: operationProgressState({ phaseCode: 'HEALTH_VERIFYING', status: 'DEPLOYING', progressPercentage: 90 }),
      },
    };

    render(<OperationProgressPanel />);

    expect(screen.getByLabelText('JAR deployment timeline')).toBeVisible();
    expect(screen.getByRole('button', { name: /Validate and secure locks/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Verify application health/ }).closest('li')).toHaveClass('text-primary');
    expect(screen.queryByRole('button', { name: /Stage frontend files/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish frontend files/ })).not.toBeInTheDocument();
  });

  it('shows timeline step descriptions in tooltips', async () => {
    const user = userEvent.setup();
    portal.viewingOperation = operationRecord({
      deploymentId: 'war-tooltip-1',
      resourceType: 'WILDFLY_PROFILE',
      resourceKey: 'WILDFLY_PROFILE:profile-a',
      profileId: 'profile-a',
      operationType: 'WAR_DEPLOY',
    });
    portal.operations = {
      'war-tooltip-1': {
        deploymentId: 'war-tooltip-1',
        resourceType: 'WILDFLY_PROFILE',
        operationType: 'WAR_DEPLOY',
        progress: operationProgressState({ phaseCode: 'WAR_EXTRACTING', status: 'DEPLOYING', progressPercentage: 20 }),
      },
    };

    render(<OperationProgressPanel />);

    await user.hover(screen.getByRole('button', { name: /Extract WAR/ }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Unpacks the selected Tech Drive WAR into a staging directory.',
    );
  });
});

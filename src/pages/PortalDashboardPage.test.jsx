import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getJars: vi.fn(),
  getProfiles: vi.fn(),
  isLockConflict: vi.fn(() => false),
  restartJar: vi.fn(),
  stopJar: vi.fn(),
  startProfile: vi.fn(),
  stopProfile: vi.fn(),
}));

const context = vi.hoisted(() => ({
  value: null,
}));
const rollback = vi.hoisted(() => ({ props: null }));
const jarRollback = vi.hoisted(() => ({ props: null }));

vi.mock('@/lib/contractApi', () => api);
vi.mock('@/context/PortalContext', () => ({
  usePortal: () => context.value,
}));
vi.mock('@/components/RollbackButton', () => ({
  default: (props) => {
    rollback.props = props;
    return (
      <button type="button" disabled={props.disabled}>
        Rollback to previous version
      </button>
    );
  },
}));
vi.mock('@/components/JarRollbackButton', () => ({
  default: (props) => {
    jarRollback.props = props;
    return (
      <button type="button" disabled={props.disabled}>
        Rollback JAR
      </button>
    );
  },
}));

import PortalDashboardPage, { shouldRefreshDashboardActivity } from './PortalDashboardPage';

const profile = {
  id: 'opaque/profile:42',
  name: 'payments-qc',
  application: 'payments',
  version: 'wildfly-26',
  status: 'ACTIVE',
  health: 'FUNCTIONAL',
  pid: 4210,
  activeOperationId: 'operation-2',
  serverLogAvailable: true,
  offset: 5020,
  applicationPort: 13100,
  managementPort: 15010,
  deployCount: 4,
  failedDeployCount: 2,
  consecutiveFailures: 0,
  lastDeploymentOn: '2026-07-26T13:20:00Z',
  lastSuccessfulDeploymentOn: '2026-07-25T11:00:00Z',
  lastUpdatedOn: '2026-07-26T13:24:11Z',
  lastResult: 'SUCCESS',
  hasBackup: true,
  backupSnapshotId: 'snapshot-1',
};

describe('PortalDashboardPage profile contract', () => {
  beforeEach(() => {
    api.getJars.mockResolvedValue({
      domain: 'http://127.0.0.1',
      jars: [],
    });
    api.getProfiles.mockResolvedValue([profile]);
    api.startProfile.mockResolvedValue({});
    api.stopProfile.mockResolvedValue({});
    api.restartJar.mockResolvedValue({ deploymentId: 'restart-1' });
    api.stopJar.mockResolvedValue({ deploymentId: 'stop-1' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    context.value = {
      username: 'admin-user',
      wildflyProfileActivityMap: {},
      jarProfileActivityMap: {},
      replaceProfileActivities: vi.fn(),
      reconcileResourceActivity: vi.fn(() => new Promise(() => {})),
      registerOperation: vi.fn(),
      setViewingOperation: vi.fn(),
      operations: {},
      lastSystemEvent: null,
      findConflictingLock: vi.fn(() => null),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the expanded profile payload without waiting for runtime reconciliation', async () => {
    const user = userEvent.setup();
    render(<PortalDashboardPage />);

    expect(await screen.findByText('payments-qc')).toBeVisible();
    expect(screen.getByText('4210')).toBeVisible();
    expect(screen.getByText('payments')).toBeVisible();
    expect(screen.getByText('5020')).toBeVisible();
    expect(screen.getByText('13100')).toBeVisible();
    expect(screen.getByText('15010')).toBeVisible();
    expect(screen.getByText('4')).toBeVisible();
    expect(screen.getByText('2')).toBeVisible();
    expect(screen.getByText('operation-2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'View output' })).toBeEnabled();
    expect(context.value.reconcileResourceActivity).not.toHaveBeenCalled();
    expect(rollback.props.profileId).toBe('opaque/profile:42');
    expect(rollback.props.profileName).toBe('payments-qc');
    expect(screen.getByTestId('profile-actions-primary-opaque/profile:42')).toContainElement(
      screen.getByRole('button', { name: 'View output' }),
    );
    expect(screen.getByTestId('profile-actions-secondary-opaque/profile:42')).toContainElement(
      screen.getByRole('button', { name: 'Rollback to previous version' }),
    );

    await user.click(screen.getByRole('button', { name: 'View output' }));

    expect(context.value.setViewingOperation).toHaveBeenCalledWith({
      deploymentId: 'operation-2',
      resourceKey: 'WILDFLY_PROFILE:opaque/profile:42',
      resourceType: 'WILDFLY_PROFILE',
      profileId: 'opaque/profile:42',
      outputRequested: true,
      status: 'ACTIVE',
      label: 'Profile · payments-qc',
    });

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(api.stopProfile).toHaveBeenCalledWith('opaque/profile:42');
  });

  it('renders null PID as unavailable and lets later live activity take precedence', async () => {
    api.getProfiles.mockResolvedValue([
      {
        ...profile,
        pid: null,
        activeOperationId: null,
        serverLogAvailable: false,
      },
    ]);
    const view = render(<PortalDashboardPage />);

    expect(await screen.findByText('ACTIVE')).toBeVisible();
    expect(screen.getByText('FUNCTIONAL')).toBeVisible();
    expect(screen.getByRole('button', { name: 'View output' })).toBeDisabled();

    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);

    context.value = {
      ...context.value,
      wildflyProfileActivityMap: {
        [profile.id]: {
          id: profile.id,
          status: 'ACTIVE',
          health: 'FUNCTIONAL',
          pid: 9001,
          activeOperationId: 'live-operation',
          serverLogAvailable: true,
        },
      },
    };
    view.rerender(<PortalDashboardPage />);

    expect(screen.getByText('9001')).toBeVisible();
    expect(screen.getByRole('button', { name: 'View output' })).toBeEnabled();
  });

  it.each([
    ['INACTIVE', 'Start', false],
    ['STARTING', /Starting/, true],
    ['STOPPING', /Stopping/, true],
    ['DEPLOYING', 'Start', true],
  ])('renders %s with its state-aware profile action', async (status, label, disabled) => {
    api.getProfiles.mockResolvedValue([{ ...profile, status, activeOperationId: null }]);
    const user = userEvent.setup();
    render(<PortalDashboardPage />);

    const action = await screen.findByRole('button', { name: label });
    if (disabled) {
      expect(action).toBeDisabled();
    } else {
      expect(action).toBeEnabled();
      await user.click(action);
      expect(api.startProfile).toHaveBeenCalledWith('opaque/profile:42');
    }
  });

  it('renders the latest JAR card contract and keeps retained output available while inactive', async () => {
    const user = userEvent.setup();
    api.getProfiles.mockResolvedValue([]);
    api.getJars.mockResolvedValue({
      domain: 'http://127.0.0.1',
      jars: [
        {
          id: 'opaque-jar-uuid',
          applicationName: 'Orders',
          jarName: 'orders.jar',
          applicationPort: 8181,
          pid: null,
          status: 'INACTIVE',
          health: 'FUNCTIONAL',
          activeOperationId: null,
          terminalDeploymentId: 'retained-output-1',
          terminalAvailable: true,
          frontendUrl: 'https://public.example/orders',
          frontendProfileUuid: 'frontend-uuid',
        },
      ],
    });
    context.value.jarProfileActivityMap = {
      'opaque-jar-uuid': {
        id: 'opaque-jar-uuid',
        applicationName: 'Orders',
        jarName: 'orders.jar',
        applicationPort: 8181,
        pid: null,
        status: 'INACTIVE',
        health: 'FUNCTIONAL',
        activeOperationId: null,
        terminalDeploymentId: 'retained-output-1',
        terminalAvailable: true,
        frontendUrl: 'https://public.example/orders',
        frontendProfileUuid: 'frontend-uuid',
        frontendProfile: {
          profileUuid: 'frontend-uuid',
          profileName: 'orders-ui',
          port: 443,
          frontendUrl: 'https://profile.example/orders',
          documentRoot: '/srv/www/orders',
          health: 'FUNCTIONAL',
          healthReason: null,
          directoryExists: true,
          running: true,
        },
      },
    };
    context.value.operations = {
      'retained-output-1': {
        deploymentId: 'retained-output-1',
        terminalAvailabilityConfirmed: true,
      },
    };

    render(<PortalDashboardPage />);

    expect(await screen.findByText('orders-ui')).toBeVisible();
    expect(screen.getByRole('link', { name: 'https://public.example/orders' })).toBeVisible();
    expect(screen.getByText('Java PID')).toBeVisible();
    expect(screen.getByText('8181')).toBeVisible();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(screen.getByText('/srv/www/orders')).toBeVisible();
    expect(screen.getByText('Available')).toBeVisible();
    expect(screen.getAllByText('Running')).toHaveLength(2);
    expect(screen.queryByText('Failed deployments')).not.toBeInTheDocument();
    expect(screen.queryByText('Consecutive failures')).not.toBeInTheDocument();
    expect(screen.queryByText('Last deployment')).not.toBeInTheDocument();
    expect(screen.queryByText('Last successful deployment')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest result')).not.toBeInTheDocument();
    expect(screen.queryByText('No deployable JAR applications were found.')).not.toBeInTheDocument();
    expect(context.value.reconcileResourceActivity).toHaveBeenCalledWith('JAR:opaque-jar-uuid');
    expect(screen.getByRole('button', { name: 'View output' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'View output' }));
    expect(context.value.setViewingOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 'retained-output-1',
        resourceType: 'JAR',
      }),
    );
    expect(jarRollback.props).toMatchObject({ resourceId: 'opaque-jar-uuid', applicationName: 'Orders' });

    await user.click(screen.getByRole('button', { name: 'Restart' }));
    expect(api.restartJar).toHaveBeenCalledWith('Orders');
  });

  it('stops an active managed JAR through a tracked dashboard operation', async () => {
    api.getProfiles.mockResolvedValue([]);
    api.getJars.mockResolvedValue({
      domain: 'http://127.0.0.1',
      jars: [
        {
          id: 'orders',
          applicationName: 'Orders',
          jarName: 'orders.jar',
          status: 'ACTIVE',
          health: 'FUNCTIONAL',
        },
      ],
    });
    const user = userEvent.setup();
    render(<PortalDashboardPage />);

    await user.click(await screen.findByRole('button', { name: 'Stop' }));

    expect(api.stopJar).toHaveBeenCalledWith('Orders');
    expect(context.value.registerOperation).toHaveBeenCalledWith({ deploymentId: 'stop-1' }, 'JAR:orders', 'Stop JAR · Orders');
  });

  it("disables another user's locked profile mutations and displays the lock metadata", async () => {
    context.value.findConflictingLock.mockReturnValue({
      resourceKey: `profile:${profile.id}`,
      owner: 'Mary Smith',
      reason: 'WAR preflight',
      section: 'WAR',
      profile: profile.name,
      expiresAt: '2099-01-01T00:00:00Z',
    });
    render(<PortalDashboardPage />);

    expect(await screen.findByText('Locked by Mary Smith')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rollback to previous version' })).toBeDisabled();
    expect(screen.getByText(/WAR preflight · WAR · payments-qc/)).toBeVisible();
  });

  it.each([
    [{ eventType: 'RESOURCE_ACTIVE' }, true],
    [{ eventType: 'DEPLOYMENT_SUCCEEDED' }, true],
    [{ eventType: 'RESOURCE_FAILED' }, true],
    [{ eventType: 'DEPLOYMENT_FAILED' }, true],
    [{ eventType: 'OPERATION_PROGRESS', resources: { status: 'COMPLETED' } }, true],
    [{ eventType: 'OPERATION_PROGRESS', resources: { status: 'FAILED' } }, true],
    [{ eventType: 'OPERATION_FINISHED', resources: { status: 'COMPLETED' } }, true],
    [{ eventType: 'RESOURCE_STARTING' }, false],
  ])('selects only required dashboard refresh signals', (event, expected) => {
    expect(shouldRefreshDashboardActivity(event)).toBe(expected);
  });

  it.each([
    ['HTTP_VERIFIED', 'Verified healthy'],
    ['PORT_VERIFIED', 'Healthy — process and port verified'],
  ])('renders the %s JAR readiness indicator', async (readinessStatus, label) => {
    api.getProfiles.mockResolvedValue([]);
    api.getJars.mockResolvedValue({
      domain: 'http://127.0.0.1',
      jars: [
        {
          id: 'orders',
          applicationName: 'Orders',
          status: 'ACTIVE',
          health: 'FUNCTIONAL',
          readinessStatus,
          readinessReason: 'Readiness probe detail.',
        },
      ],
    });

    render(<PortalDashboardPage />);

    expect(await screen.findByText(label)).toBeVisible();
    expect(screen.getByText('Readiness diagnostic: Readiness probe detail.')).toBeVisible();
  });

  it('shows a NOT_VERIFIED reason without a healthy indicator', async () => {
    api.getProfiles.mockResolvedValue([]);
    api.getJars.mockResolvedValue({
      domain: 'http://127.0.0.1',
      jars: [
        {
          id: 'orders',
          applicationName: 'Orders',
          status: 'ACTIVE',
          health: 'FUNCTIONAL',
          readinessStatus: 'NOT_VERIFIED',
          readinessReason: 'No health URL was configured.',
        },
      ],
    });

    render(<PortalDashboardPage />);

    expect(await screen.findByText('Readiness diagnostic: No health URL was configured.')).toBeVisible();
    expect(screen.queryByText('Verified healthy')).not.toBeInTheDocument();
    expect(screen.queryByText('Healthy — process and port verified')).not.toBeInTheDocument();
  });
});

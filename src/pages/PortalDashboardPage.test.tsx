import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationMap, OperationRecord, RuntimeActivityModel } from '@/types/frontend';
import type { RuntimeReadiness } from '@/types/api-contracts';

type DashboardContext = {
  username: string;
  wildflyProfileActivityMap: Record<string, RuntimeActivityModel>;
  jarProfileActivityMap: Record<string, RuntimeActivityModel>;
  replaceProfileActivities: ReturnType<typeof vi.fn>;
  reconcileResourceActivity: ReturnType<typeof vi.fn>;
  registerOperation: ReturnType<typeof vi.fn>;
  setViewingOperation: ReturnType<typeof vi.fn>;
  operations: OperationMap;
  lastSystemEvent: null;
  findConflictingLock: ReturnType<typeof vi.fn>;
};
type RollbackProps = {
  disabled?: boolean;
  profileId?: string;
  profileName?: string;
  open?: boolean;
  tourTarget?: string;
};
type TutorialProps = {
  steps: Array<{
    title: string;
    instruction: string;
    why?: string;
    media?: React.ReactNode;
    before?: (data: never) => Promise<void>;
  }>;
  onStart?: () => void;
  onReset?: () => void;
};

const api = vi.hoisted(() => ({
  getJars: vi.fn(),
  getProfiles: vi.fn(),
  isLockConflict: vi.fn(() => false),
  restartJar: vi.fn(),
  stopJar: vi.fn(),
  startProfile: vi.fn(),
  stopProfile: vi.fn(),
}));

const context = vi.hoisted((): { value: DashboardContext | null } => ({
  value: null,
}));
const rollback = vi.hoisted((): { props: RollbackProps | null } => ({ props: null }));
const jarRollback = vi.hoisted((): { props: RollbackProps | null } => ({ props: null }));
const tutorial = vi.hoisted((): { props: TutorialProps | null; open: boolean } => ({ props: null, open: false }));

vi.mock('@/lib/contractApi', () => api);
vi.mock('@/context/PortalContext', () => ({
  usePortal: () => context.value,
}));
vi.mock('@/components/RollbackButton', () => ({
  default: (props: RollbackProps) => {
    rollback.props = props;
    return (
      <div data-tour={props.tourTarget}>
        <button type="button" disabled={props.disabled}>
          Rollback to previous version
        </button>
        {props.open && <div data-tour={`${props.tourTarget}-popover`}>Rollback snapshots</div>}
      </div>
    );
  },
}));
vi.mock('@/components/JarRollbackButton', () => ({
  default: (props: RollbackProps) => {
    jarRollback.props = props;
    return (
      <button type="button" disabled={props.disabled}>
        Rollback JAR
      </button>
    );
  },
}));
vi.mock('@/components/PageTutorial', () => ({
  default: (props: TutorialProps) => {
    tutorial.props = props;
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            tutorial.open = true;
            props.onStart?.();
          }}
        >
          Tutorial
        </button>
        {tutorial.open &&
          props.steps.map((step) => (
            <section key={step.title}>
              <p>{step.instruction}</p>
              {step.why && <p>{step.why}</p>}
              {step.media}
            </section>
          ))}
      </div>
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
};

describe('PortalDashboardPage profile contract', () => {
  beforeEach(() => {
    tutorial.props = null;
    tutorial.open = false;
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
    expect(context.value!.reconcileResourceActivity).not.toHaveBeenCalled();
    expect(rollback.props!.profileId).toBe('opaque/profile:42');
    expect(rollback.props!.profileName).toBe('payments-qc');
    expect(screen.getByTestId('profile-actions-primary-opaque/profile:42')).toContainElement(
      screen.getByRole('button', { name: 'View output' }),
    );
    expect(screen.getByTestId('profile-actions-secondary-opaque/profile:42')).toContainElement(
      screen.getByRole('button', { name: 'Rollback to previous version' }),
    );

    await user.click(screen.getByRole('button', { name: 'View output' }));

    expect(context.value!.setViewingOperation).toHaveBeenCalledWith({
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

  it('automatically filters, selects, expands, opens rollback read-only, and restores the dashboard view', async () => {
    api.getProfiles.mockResolvedValue([{ ...profile, status: 'INACTIVE', serverLogAvailable: false }]);
    const user = userEvent.setup();
    render(<PortalDashboardPage />);

    await screen.findByText('payments-qc');
    const details = screen.getByText('PID').closest('[id]');
    expect(details).toHaveAttribute('hidden');

    await user.click(screen.getByRole('button', { name: 'Tutorial' }));
    await waitFor(() => expect(tutorial.props?.steps).toHaveLength(7));
    expect(screen.getByText(/immediate profile directories beneath configured WildFly roots/i)).toBeVisible();

    const filterStep = tutorial.props!.steps[1].before?.({} as never);
    await waitFor(() =>
      expect(document.querySelector<HTMLInputElement>('[data-tour="dashboard-tutorial-search-input"]')).toHaveValue(
        'payments-qc',
      ),
    );
    await filterStep;

    const expandStep = tutorial.props!.steps[2].before?.({} as never);
    await waitFor(() => expect(details).not.toHaveAttribute('hidden'));
    await expandStep;
    expect(screen.getByText(/ACTIVE requires a PID plus reachable application and management ports/i)).toBeVisible();

    const rollbackStep = tutorial.props!.steps[5].before?.({} as never);
    expect(await screen.findByText('Rollback snapshots')).toBeVisible();
    await rollbackStep;
    expect(api.startProfile).not.toHaveBeenCalled();
    expect(api.stopProfile).not.toHaveBeenCalled();

    await act(async () => {
      tutorial.props!.onReset?.();
    });
    await waitFor(() => expect(details).toHaveAttribute('hidden'));
    expect(document.querySelector('[data-tour="dashboard-tutorial-search-input"]')).not.toBeInTheDocument();
  });

  it('keeps a truthful fallback and the dummy JAR card when profile inventory is empty', async () => {
    api.getProfiles.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<PortalDashboardPage />);

    await screen.findByText('No valid WildFly launchers were discovered.');
    await user.click(screen.getByRole('button', { name: 'Tutorial' }));

    expect(screen.getByText('No profile is available to demonstrate.')).toBeVisible();
    const jarStep = tutorial.props!.steps[1].before?.({} as never);
    expect(await screen.findByText('Example orders service')).toBeVisible();
    expect(screen.getByText('ASSOCIATED FRONTEND')).toBeVisible();
    expect(screen.getByText('Tutorial example — no live deployment is selected.')).toBeVisible();
    await jarStep;
    expect(screen.getByText(/View output needs a retained attachable terminal/i)).toBeVisible();
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

    const currentContext = context.value;
    if (!currentContext) throw new Error('Expected dashboard context.');
    context.value = {
      ...currentContext,
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
    context.value!.jarProfileActivityMap = {
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
    context.value!.operations = {
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
    expect(context.value!.reconcileResourceActivity).toHaveBeenCalledWith('JAR:opaque-jar-uuid');
    expect(screen.getByRole('button', { name: 'View output' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'View output' }));
    expect(context.value!.setViewingOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 'retained-output-1',
        resourceType: 'JAR',
      }),
    );
    expect(jarRollback.props).toMatchObject({ resourceId: 'opaque-jar-uuid', applicationName: 'Orders', disabled: false });

    await user.click(screen.getByRole('button', { name: 'Restart' }));
    expect(api.restartJar).toHaveBeenCalledWith('Orders');
  });

  it('keeps rollback available without backup metadata on the profile', async () => {
    api.getProfiles.mockResolvedValue([{ ...profile }]);
    api.getJars.mockResolvedValue({
      domain: 'http://127.0.0.1',
      jars: [
        {
          id: 'orders',
          applicationName: 'Orders',
          jarName: 'orders.jar',
          status: 'INACTIVE',
          health: 'FUNCTIONAL',
        },
      ],
    });
    render(<PortalDashboardPage />);

    expect(await screen.findByText('payments-qc')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rollback to previous version' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rollback JAR' })).toBeEnabled();
    expect(rollback.props).toMatchObject({ disabled: false });
    expect(jarRollback.props).toMatchObject({ disabled: false });
  });

  it('paginates filtered WildFly cards using the configured page size', async () => {
    api.getProfiles.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) => ({
        ...profile,
        id: `profile-${index + 1}`,
        name: `profile-${index + 1}`,
      })),
    );
    const user = userEvent.setup();
    render(<PortalDashboardPage />);

    expect(await screen.findByLabelText('WildFly profile page')).toHaveTextContent('Page 1 of 2');
    expect(screen.queryByText('profile-21')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('WildFly profile page')).toHaveTextContent('Page 2 of 2');
    expect(screen.getByText('profile-21')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
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
    expect(context.value!.registerOperation).toHaveBeenCalledWith({ deploymentId: 'stop-1' }, 'JAR:orders', 'Stop JAR · Orders');
  });

  it("disables another user's locked profile mutations and displays the lock metadata", async () => {
    context.value!.findConflictingLock.mockReturnValue({
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

  it.each<[RuntimeReadiness, string]>([
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
          readiness: readinessStatus,
          readinessReason: 'Readiness probe detail.',
        },
      ],
    });
    context.value!.jarProfileActivityMap = {
      orders: { id: 'orders', applicationName: 'Orders', readinessStatus, readinessReason: 'Readiness probe detail.' },
    };

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
          readiness: 'NOT_VERIFIED',
          readinessReason: 'No health URL was configured.',
        },
      ],
    });
    context.value!.jarProfileActivityMap = {
      orders: {
        id: 'orders',
        applicationName: 'Orders',
        readinessStatus: 'NOT_VERIFIED',
        readinessReason: 'No health URL was configured.',
      },
    };

    render(<PortalDashboardPage />);

    expect(await screen.findByText('Readiness diagnostic: No health URL was configured.')).toBeVisible();
    expect(screen.queryByText('Verified healthy')).not.toBeInTheDocument();
    expect(screen.queryByText('Healthy — process and port verified')).not.toBeInTheDocument();
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventSourceMessage, FetchEventSourceInit, fetchEventSource } from '@microsoft/fetch-event-source';
import type { ApiRequestError } from '@/lib/contractApi';
import type { OperationFinished, SystemEvent } from '@/types/api-contracts';
import { frontendProfileActivity, jarProfileActivity, lockInfo, systemEvent, userPresence } from '../test/factories';

type LockConflictHandler = (error: ApiRequestError) => void;
type BackendUnavailableHandler = (error: ApiRequestError) => void;

const api = vi.hoisted(() => ({
  getLocks: vi.fn(),
  getOperation: vi.fn(),
  getProfiles: vi.fn(),
  getRuntimeResource: vi.fn(),
  lockConflictHandler: null as LockConflictHandler | null,
  backendUnavailableHandler: null as BackendUnavailableHandler | null,
  reportUserActivity: vi.fn(),
  validateUser: vi.fn(),
}));
const stream = vi.hoisted(() => ({ fetchEventSource: vi.fn<typeof fetchEventSource>() }));

vi.mock('@microsoft/fetch-event-source', () => ({ fetchEventSource: stream.fetchEventSource }));
vi.mock('@/lib/contractApi', () => ({
  BACKEND_OFFLINE_TOAST: 'The backend is offline.',
  eventUrl: (path: string) => `/deploymentOrchestrator/api${path}`,
  getLocks: api.getLocks,
  getOperation: api.getOperation,
  getProfiles: api.getProfiles,
  getRuntimeResource: api.getRuntimeResource,
  isBackendUnavailable: (error: { status?: number } | null | undefined) => error?.status === 503,
  onBackendUnavailable: (handler: BackendUnavailableHandler) => {
    api.backendUnavailableHandler = handler;
    return () => {
      api.backendUnavailableHandler = null;
    };
  },
  onLockConflict: (handler: LockConflictHandler) => {
    api.lockConflictHandler = handler;
    return () => {
      api.lockConflictHandler = null;
    };
  },
  reportUserActivity: api.reportUserActivity,
  techDriveHeaders: (username?: string) => (username ? { 'X-TechDrive-Username': username } : {}),
  validateUser: api.validateUser,
}));

import { PortalProvider, usePortal } from './PortalContext';

function Harness() {
  const portal = usePortal();
  return (
    <div>
      <span data-testid="users">{portal.onlineUsers.map((user) => `${user.username}:${user.status}`).join(',')}</span>
      <span data-testid="locks">{Object.keys(portal.locks).join(',')}</span>
      <span data-testid="toasts">{portal.operationToasts.map((toast) => toast.id).join(',')}</span>
      <span data-testid="system-toasts">{portal.systemToasts.map((toast) => `${toast.variant}:${toast.message}`).join(',')}</span>
      <span data-testid="system-status">{portal.systemStatus}</span>
      <span data-testid="validated">{String(portal.validated)}</span>
      <span data-testid="username">{portal.username}</span>
      <span data-testid="validation-error">{portal.validationError}</span>
      <span data-testid="frontend-profiles">{JSON.stringify(portal.frontendProfileActivityMap)}</span>
      <span data-testid="jar-profiles">{JSON.stringify(portal.jarProfileActivityMap)}</span>
      <button type="button" onClick={portal.reportInteraction}>
        Interact
      </button>
    </div>
  );
}

const operationFinished = (overrides: Partial<OperationFinished> = {}): OperationFinished => ({
  operationId: 'operation-test',
  username: 'test-user',
  section: 'TEST',
  resourceKey: 'JAR:test',
  resourceType: 'JAR',
  outcome: 'COMPLETED',
  completedAt: '2026-08-09T00:00:00Z',
  summary: 'Test operation completed',
  ...overrides,
});

const streamOptions = (): FetchEventSourceInit => {
  const call = stream.fetchEventSource.mock.calls[0];
  if (!call) throw new Error('Expected an event stream connection.');
  return call[1];
};

const send = (options: FetchEventSourceInit, payload: SystemEvent) => {
  const onmessage = options.onmessage;
  if (!onmessage) throw new Error('Expected an event stream message handler.');
  const message: EventSourceMessage = { id: '', data: JSON.stringify(payload), event: payload.eventType };
  act(() => onmessage(message));
};

const openStream = async (options: FetchEventSourceInit) => {
  const onopen = options.onopen;
  if (!onopen) throw new Error('Expected an event stream open handler.');
  await act(() => onopen(new Response(null, { status: 200 })));
};

const failStream = (options: FetchEventSourceInit) => {
  const onerror = options.onerror;
  if (!onerror) throw new Error('Expected an event stream error handler.');
  act(() => {
    try {
      onerror(new Error('network'));
    } catch {
      /* logout throws to stop SSE retry */
    }
  });
};

const lockConflictError = (): ApiRequestError =>
  Object.assign(new Error('Lock conflict'), {
    paths: [],
    users: [],
    details: null,
  });

describe('PortalProvider collaboration contracts', () => {
  beforeEach(() => {
    sessionStorage.setItem('qc-deployment-username', 'John Smith');
    api.validateUser.mockResolvedValue({});
    api.getProfiles.mockResolvedValue([]);
    api.getLocks.mockResolvedValue([]);
    api.getRuntimeResource.mockResolvedValue(null);
    api.getOperation.mockResolvedValue({});
    api.reportUserActivity.mockResolvedValue(undefined);
    stream.fetchEventSource.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.restoreAllMocks();
    api.getLocks.mockReset();
    api.getOperation.mockReset();
    api.getProfiles.mockReset();
    api.getRuntimeResource.mockReset();
    api.reportUserActivity.mockReset();
    api.validateUser.mockReset();
    api.lockConflictHandler = null;
    api.backendUnavailableHandler = null;
    stream.fetchEventSource.mockReset();
    vi.useRealTimers();
  });

  it('hydrates authoritative snapshots and applies revision-safe presence and lock transitions', async () => {
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const options = streamOptions();

    send(
      options,
      systemEvent({
        eventType: 'USER_PRESENCE_CHANGED',
        state: 'IDLE',
        resources: userPresence({ username: 'Mary Smith', status: 'IDLE', revision: 8 }),
      }),
    );
    send(
      options,
      systemEvent({
        eventType: 'SYSTEM_SNAPSHOT',
        resources: {
          wildflyProfiles: [],
          jarProfiles: [],
          frontendProfiles: [],
          onlineUsers: [userPresence({ username: 'Mary Smith', status: 'ACTIVE', revision: 7 })],
          locks: [
            lockInfo({
              resourceKey: 'profile:one',
              owner: 'Mary Smith',
              mode: 'WRITE',
              revision: 4,
              expiresAt: '2099-01-01T00:00:00Z',
            }),
          ],
        },
      }),
    );
    expect(screen.getByTestId('users')).toHaveTextContent('Mary Smith:ACTIVE');
    expect(screen.getByTestId('locks')).toHaveTextContent('profile:one');
    expect(screen.getByTestId('system-toasts')).toBeEmptyDOMElement();

    send(
      options,
      systemEvent({
        eventType: 'USER_PRESENCE_CHANGED',
        state: 'IDLE',
        resources: userPresence({ username: 'Mary Smith', status: 'IDLE', revision: 6 }),
      }),
    );
    expect(screen.getByTestId('users')).toHaveTextContent('Mary Smith:ACTIVE');
    send(
      options,
      systemEvent({
        eventType: 'USER_PRESENCE_CHANGED',
        state: 'OFFLINE',
        resources: userPresence({ username: 'Mary Smith', status: 'OFFLINE', revision: 9 }),
      }),
    );
    send(
      options,
      systemEvent({
        eventType: 'LOCK_CHANGED',
        state: 'RELEASED',
        resources: { action: 'RELEASED', lock: lockInfo({ resourceKey: 'profile:one', revision: 5 }) },
      }),
    );
    expect(screen.getByTestId('users')).toBeEmptyDOMElement();
    expect(screen.getByTestId('locks')).toBeEmptyDOMElement();
  });

  it('applies portal-wide frontend association updates once without lifecycle reconciliation', async () => {
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const options = streamOptions();
    const frontend = frontendProfileActivity({ profileUuid: 'frontend-2', profileName: 'payments-ui', jarProfileUuid: 'jar-2' });
    const nestedFrontend = frontendProfileActivity({ ...frontend, profileName: 'nested-payments-ui' });
    const jar = jarProfileActivity({
      id: 'jar-2',
      applicationName: 'payments',
      frontendProfileUuid: 'frontend-2',
      frontendProfile: nestedFrontend,
    });
    const event = systemEvent({
      eventType: 'FRONTEND_ASSOCIATION_UPDATED',
      deploymentId: 'deployment-2',
      resources: {
        deploymentId: 'deployment-2',
        jarProfileUuid: 'jar-2',
        frontendProfileUuid: 'frontend-2',
        frontendProfile: frontend,
        jarProfile: jar,
      },
    });

    send(options, event);
    const frontendState = screen.getByTestId('frontend-profiles').textContent;
    const jarState = screen.getByTestId('jar-profiles').textContent;
    expect(frontendState).toContain('frontend-2');
    expect(jarState).toContain('jar-2');
    expect(jarState).toContain('nested-payments-ui');
    expect(api.getRuntimeResource).not.toHaveBeenCalled();

    send(options, event);
    expect(screen.getByTestId('frontend-profiles')).toHaveTextContent(frontendState || '');
    expect(screen.getByTestId('jar-profiles')).toHaveTextContent(jarState || '');
    expect(api.getRuntimeResource).not.toHaveBeenCalled();
  });

  it('suppresses initiator toasts, deduplicates other-user completions, and reconciles targeted resources', async () => {
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const options = streamOptions();
    const own = systemEvent({
      eventType: 'OPERATION_FINISHED',
      username: 'john_smith',
      state: 'COMPLETED',
      resources: operationFinished({
        operationId: 'own',
        username: 'john_smith',
        section: 'JAR',
        resourceKey: 'JAR:orders',
        resourceType: 'JAR',
        outcome: 'COMPLETED',
        summary: 'Done',
      }),
    });
    const other = systemEvent({
      eventType: 'OPERATION_FINISHED',
      username: 'Mary Smith',
      state: 'FAILED',
      resources: operationFinished({
        operationId: 'other',
        username: 'Mary Smith',
        section: 'WAR',
        resourceKey: 'WILDFLY_PROFILE:one',
        resourceType: 'WILDFLY_PROFILE',
        outcome: 'FAILED',
        summary: 'Failed',
      }),
    });

    send(options, own);
    send(options, other);
    send(options, other);
    await waitFor(() => expect(screen.getByTestId('toasts')).toHaveTextContent('other:FAILED'));
    expect(screen.getByTestId('toasts')).not.toHaveTextContent('own:COMPLETED');
    await waitFor(() => {
      expect(api.getRuntimeResource).toHaveBeenCalledWith('JAR:orders');
      expect(api.getRuntimeResource).toHaveBeenCalledWith('WILDFLY_PROFILE:one');
      expect(api.getProfiles).toHaveBeenCalled();
    });
  });

  it('surfaces Tech Drive share notices as warning toasts without blocking login', async () => {
    api.validateUser.mockResolvedValue({
      valid: true,
      normalizedUsername: 'johnsmith',
      notices: ['unable to access techdrive'],
    });

    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('validated')).toHaveTextContent('true'));
    expect(screen.getByTestId('system-toasts')).toHaveTextContent('warning:unable to access techdrive');
  });

  it('surfaces Tech Drive directory-created notices as warning toasts', async () => {
    api.validateUser.mockResolvedValue({
      valid: true,
      normalizedUsername: 'johnsmith',
      notices: ["directory isn't present so the directory with same name has been created"],
    });

    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('validated')).toHaveTextContent('true'));
    expect(screen.getByTestId('system-toasts')).toHaveTextContent(
      "warning:directory isn't present so the directory with same name has been created",
    );
  });

  it('does not toast when validate notices are empty or omitted', async () => {
    api.validateUser.mockResolvedValue({ valid: true, normalizedUsername: 'johnsmith' });

    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('validated')).toHaveTextContent('true'));
    expect(screen.getByTestId('system-toasts')).toBeEmptyDOMElement();
  });

  it('keeps login failed and skips notice toasts when validateUser rejects', async () => {
    api.validateUser.mockRejectedValue(new Error('Unknown user.'));

    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('validated')).toHaveTextContent('false'));
    expect(screen.getByTestId('validation-error')).toHaveTextContent('Unknown user.');
    expect(screen.getByTestId('system-toasts')).toBeEmptyDOMElement();
  });

  it('shows live SYSTEM reconciliation alerts without changing resource or operation state', async () => {
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const options = streamOptions();
    const initialResourceRequests = api.getRuntimeResource.mock.calls.length;
    const initialProfileRequests = api.getProfiles.mock.calls.length;

    for (const resources of [
      [],
      [{ profile: 'orders', issues: ['unhealthy'] }],
      [{ profile: 'orders' }, { profile: 'billing' }],
    ]) {
      send(
        options,
        systemEvent({
          scope: 'SYSTEM',
          eventType: 'RUNTIME_RECONCILIATION_ISSUES',
          message: 'Runtime reconciliation found issues.',
          resources,
        }),
      );
    }
    send(
      options,
      systemEvent({
        scope: 'SYSTEM',
        eventType: 'RUNTIME_RECONCILIATION_RECOVERED',
        message: 'Runtime reconciliation recovered.',
        resources: null,
      }),
    );

    expect(screen.getByTestId('system-toasts')).toHaveTextContent('warning:Runtime reconciliation found issues.');
    expect(screen.getByTestId('system-toasts')).toHaveTextContent('success:Runtime reconciliation recovered.');
    expect(screen.getByTestId('toasts')).toBeEmptyDOMElement();
    expect(api.getRuntimeResource).toHaveBeenCalledTimes(initialResourceRequests);
    expect(api.getProfiles).toHaveBeenCalledTimes(initialProfileRequests);
  });

  it('throttles real interaction and reconciles locks after reconnect and HTTP 423', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100000);
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const options = streamOptions();

    fireEvent.click(screen.getByRole('button', { name: 'Interact' }));
    now.mockReturnValue(120000);
    fireEvent.click(screen.getByRole('button', { name: 'Interact' }));
    now.mockReturnValue(130000);
    fireEvent.click(screen.getByRole('button', { name: 'Interact' }));
    expect(api.reportUserActivity).toHaveBeenCalledTimes(2);

    await openStream(options);
    await openStream(options);
    await waitFor(() => expect(api.getLocks).toHaveBeenCalledTimes(1));
    const lockConflictHandler = api.lockConflictHandler;
    if (!lockConflictHandler) throw new Error('Expected a lock-conflict handler.');
    await act(() => lockConflictHandler(lockConflictError()));
    await waitFor(() => expect(api.getLocks).toHaveBeenCalledTimes(2));
  });

  it('logs out after a connected stream drops instead of reconnecting', async () => {
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const options = streamOptions();
    await openStream(options);
    expect(screen.getByTestId('system-status')).toHaveTextContent('connected');

    const onmessage = options.onmessage;
    if (!onmessage) throw new Error('Expected an event stream message handler.');
    act(() => onmessage({ id: '', data: '', event: '' }));
    act(() => onmessage({ id: '', data: '{bad json', event: 'message' }));
    expect(screen.getByTestId('system-status')).toHaveTextContent('connected');

    failStream(options);
    expect(screen.getByTestId('system-status')).toHaveTextContent('disconnected');
    expect(screen.getByTestId('validated')).toHaveTextContent('false');
    expect(screen.getByTestId('username')).toBeEmptyDOMElement();
    expect(sessionStorage.getItem('qc-deployment-username')).toBeNull();
    expect(screen.getByTestId('system-toasts')).toHaveTextContent('warning:The backend is offline.');
  });

  it('logs out and toasts when axios reports the backend unavailable', async () => {
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('validated')).toHaveTextContent('true'));
    const handler = api.backendUnavailableHandler;
    if (!handler) throw new Error('Expected a backend-unavailable handler.');
    act(() => handler(Object.assign(new Error('offline'), { status: 503, paths: [], users: [], details: null })));
    expect(screen.getByTestId('validated')).toHaveTextContent('false');
    expect(sessionStorage.getItem('qc-deployment-username')).toBeNull();
    expect(screen.getByTestId('system-toasts')).toHaveTextContent('warning:The backend is offline.');
  });

  it('logs out from the liveness poll when validateUser returns 503', async () => {
    vi.useFakeTimers();
    const unavailable = Object.assign(new Error('offline'), { status: 503, paths: [], users: [], details: null });
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('validated')).toHaveTextContent('true');
    api.validateUser.mockRejectedValue(unavailable);
    await act(async () => {
      vi.advanceTimersByTime(15000);
      await Promise.resolve();
    });
    expect(screen.getByTestId('validated')).toHaveTextContent('false');
    expect(screen.getByTestId('system-toasts')).toHaveTextContent('warning:The backend is offline.');
  });
});

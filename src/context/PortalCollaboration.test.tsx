import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventSourceMessage, FetchEventSourceInit, fetchEventSource } from '@microsoft/fetch-event-source';
import type { ApiRequestError } from '@/lib/contractApi';
import type { OperationFinished, SystemEvent } from '@/types/api-contracts';
import { frontendProfileActivity, jarProfileActivity, lockInfo, systemEvent, userPresence } from '../test/factories';

type LockConflictHandler = (error: ApiRequestError) => void;
type BackendUnavailableHandler = (error: ApiRequestError) => void;
type SessionUnauthorizedHandler = (error: ApiRequestError) => void;

const api = vi.hoisted(() => ({
  getLocks: vi.fn(),
  getCurrentPortalSession: vi.fn(),
  getOperation: vi.fn(),
  getProfiles: vi.fn(),
  getRuntimeResource: vi.fn(),
  lockConflictHandler: null as LockConflictHandler | null,
  backendUnavailableHandler: null as BackendUnavailableHandler | null,
  sessionUnauthorizedHandler: null as SessionUnauthorizedHandler | null,
  logoutPortalSession: vi.fn(),
  forceLogoutPortalUser: vi.fn(),
  reportUserActivity: vi.fn(),
  loginUser: vi.fn(),
}));
const stream = vi.hoisted(() => ({ fetchEventSource: vi.fn<typeof fetchEventSource>() }));

vi.mock('@microsoft/fetch-event-source', () => ({ fetchEventSource: stream.fetchEventSource }));
vi.mock('@/lib/contractApi', () => ({
  BACKEND_OFFLINE_TOAST: 'The backend is offline.',
  eventUrl: (path: string) => `/deploymentOrchestrator/api${path}`,
  getLocks: api.getLocks,
  getCurrentPortalSession: api.getCurrentPortalSession,
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
  onSessionUnauthorized: (handler: SessionUnauthorizedHandler) => {
    api.sessionUnauthorizedHandler = handler;
    return () => {
      api.sessionUnauthorizedHandler = null;
    };
  },
  logoutPortalSession: api.logoutPortalSession,
  forceLogoutPortalUser: api.forceLogoutPortalUser,
  reportUserActivity: api.reportUserActivity,
  setApiAdmissionStatus: vi.fn(),
  techDriveHeaders: (username?: string) => ({
    ...(username ? { 'X-TechDrive-Username': username } : {}),
    'X-Portal-Tab-Id': 'tab-test-1',
  }),
  loginUser: api.loginUser,
}));

import { PortalProvider, usePortal } from './PortalContext';
import { useUserStore } from '@/userStore';

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
      <span data-testid="session-phase">{portal.sessionPhase}</span>
      <span data-testid="username">{portal.username}</span>
      <span data-testid="validation-error">{portal.validationError}</span>
      <span data-testid="frontend-profiles">{JSON.stringify(portal.frontendProfileActivityMap)}</span>
      <span data-testid="jar-profiles">{JSON.stringify(portal.jarProfileActivityMap)}</span>
      <span data-testid="last-system-event">
        {portal.lastSystemEvent && 'eventType' in portal.lastSystemEvent ? portal.lastSystemEvent.eventType : ''}
      </span>
      <button type="button" onClick={portal.reportInteraction}>
        Interact
      </button>
      <button type="button" onClick={portal.changeUser}>
        Log out
      </button>
      <button type="button" onClick={() => void portal.acceptUser('John Smith')}>
        Sign in
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

const streamOptions = (path = '/system/events'): FetchEventSourceInit => {
  const call = stream.fetchEventSource.mock.calls.find(([url]) => String(url).includes(path));
  if (!call) throw new Error(`Expected an event stream connection to ${path}.`);
  return call[1];
};

const queueStatusMessage = (payload: Record<string, unknown>): EventSourceMessage => ({
  id: '',
  event: 'PORTAL_QUEUE_STATUS',
  data: JSON.stringify(payload),
});

const sendQueueStatus = (options: FetchEventSourceInit, payload: Record<string, unknown>) => {
  const onmessage = options.onmessage;
  if (!onmessage) throw new Error('Expected a queue stream message handler.');
  act(() => onmessage(queueStatusMessage(payload)));
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
    useUserStore.getState().clearUser();
    sessionStorage.setItem('qc-deployment-username', 'John Smith');
    api.getCurrentPortalSession.mockResolvedValue({
      username: 'John Smith',
      isAdmin: false,
      admissionStatus: 'ADMITTED',
      maxOnlineUsers: 5,
      onlineCount: 1,
      queuePosition: 0,
    });
    api.loginUser.mockResolvedValue({
      valid: true,
      normalizedUsername: 'John Smith',
      isAdmin: false,
      admissionStatus: 'ADMITTED',
      maxOnlineUsers: 5,
      onlineCount: 1,
      queuePosition: 0,
      onlineUsers: [],
      notices: [],
    });
    api.logoutPortalSession.mockResolvedValue(undefined);
    api.forceLogoutPortalUser.mockResolvedValue(undefined);
    api.getProfiles.mockResolvedValue([]);
    api.getLocks.mockResolvedValue([]);
    api.getRuntimeResource.mockResolvedValue(null);
    api.getOperation.mockResolvedValue({});
    api.reportUserActivity.mockResolvedValue(undefined);
    stream.fetchEventSource.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    cleanup();
    useUserStore.getState().clearUser();
    sessionStorage.clear();
    vi.restoreAllMocks();
    api.getLocks.mockReset();
    api.getCurrentPortalSession.mockReset();
    api.getOperation.mockReset();
    api.getProfiles.mockReset();
    api.getRuntimeResource.mockReset();
    api.reportUserActivity.mockReset();
    api.logoutPortalSession.mockReset();
    api.forceLogoutPortalUser.mockReset();
    api.loginUser.mockReset();
    api.lockConflictHandler = null;
    api.backendUnavailableHandler = null;
    api.sessionUnauthorizedHandler = null;
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
        resources: userPresence({ username: 'Mary Smith', status: 'ACTIVE', revision: 9 }),
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
    expect(screen.getByTestId('last-system-event')).toHaveTextContent('LOCK_CHANGED');
  });

  it('publishes LOCK_CHANGED acquire and release on lastSystemEvent', async () => {
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const options = streamOptions();
    const downloadLock = lockInfo({
      resourceKey: 'logical:download:qc',
      owner: 'Mary Smith',
      section: 'DOWNLOAD',
      profile: 'qc',
      mode: 'READ',
      revision: 3,
      expiresAt: '2099-01-01T00:00:00Z',
    });

    send(
      options,
      systemEvent({
        eventType: 'LOCK_CHANGED',
        state: 'ACQUIRED',
        resources: { action: 'ACQUIRED', lock: downloadLock },
      }),
    );
    expect(screen.getByTestId('locks')).toHaveTextContent('logical:download:qc');
    expect(screen.getByTestId('last-system-event')).toHaveTextContent('LOCK_CHANGED');

    send(
      options,
      systemEvent({
        eventType: 'LOCK_CHANGED',
        state: 'RELEASED',
        resources: { action: 'RELEASED', lock: { ...downloadLock, revision: 4 } },
      }),
    );
    expect(screen.getByTestId('locks')).toBeEmptyDOMElement();
    expect(screen.getByTestId('last-system-event')).toHaveTextContent('LOCK_CHANGED');
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
    api.getCurrentPortalSession.mockRejectedValueOnce(Object.assign(new Error('No session'), { status: 401 }));
    api.loginUser.mockResolvedValue({
      valid: true,
      normalizedUsername: 'johnsmith',
      isAdmin: false,
      admissionStatus: 'ADMITTED',
      maxOnlineUsers: 5,
      onlineCount: 1,
      queuePosition: 0,
      onlineUsers: [],
      notices: ['unable to access techdrive'],
    });

    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('anonymous'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTestId('validated')).toHaveTextContent('true'));
    expect(screen.getByTestId('system-toasts')).toHaveTextContent('warning:unable to access techdrive');
  });

  it('surfaces Tech Drive directory-created notices as warning toasts', async () => {
    api.getCurrentPortalSession.mockRejectedValueOnce(Object.assign(new Error('No session'), { status: 401 }));
    api.loginUser.mockResolvedValue({
      valid: true,
      normalizedUsername: 'johnsmith',
      isAdmin: false,
      admissionStatus: 'ADMITTED',
      maxOnlineUsers: 5,
      onlineCount: 1,
      queuePosition: 0,
      onlineUsers: [],
      notices: ["directory isn't present so the directory with same name has been created"],
    });

    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('anonymous'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTestId('validated')).toHaveTextContent('true'));
    expect(screen.getByTestId('system-toasts')).toHaveTextContent(
      "warning:directory isn't present so the directory with same name has been created",
    );
  });

  it('does not toast when validate notices are empty or omitted', async () => {
    api.getCurrentPortalSession.mockRejectedValueOnce(Object.assign(new Error('No session'), { status: 401 }));
    api.loginUser.mockResolvedValue({
      valid: true,
      normalizedUsername: 'johnsmith',
      isAdmin: false,
      admissionStatus: 'ADMITTED',
      maxOnlineUsers: 5,
      onlineCount: 1,
      queuePosition: 0,
      onlineUsers: [],
    });

    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('anonymous'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTestId('validated')).toHaveTextContent('true'));
    expect(screen.getByTestId('system-toasts')).toBeEmptyDOMElement();
  });

  it('keeps login failed and skips notice toasts when loginUser rejects', async () => {
    api.getCurrentPortalSession.mockRejectedValueOnce(Object.assign(new Error('No session'), { status: 401 }));
    api.loginUser.mockRejectedValue(new Error('Unknown user.'));

    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('anonymous'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
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

  it('keeps the portal session while a connected stream reconnects', async () => {
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
    expect(screen.getByTestId('system-status')).toHaveTextContent('reconnecting');
    expect(screen.getByTestId('validated')).toHaveTextContent('true');
    expect(screen.getByTestId('username')).toHaveTextContent('John Smith');
    expect(sessionStorage.getItem('qc-deployment-username')).toBe('John Smith');
    expect(screen.getByTestId('system-toasts')).toHaveTextContent('warning:The backend is offline.');
  });

  it('closes the system stream synchronously on self-logout without reconnecting', async () => {
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const options = streamOptions();
    await openStream(options);

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(options.signal?.aborted).toBe(true));
    expect(api.logoutPortalSession).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByTestId('validated')).toHaveTextContent('false'));
    expect(screen.getByTestId('username')).toBeEmptyDOMElement();
    expect(sessionStorage.getItem('qc-deployment-username')).toBeNull();
    expect(() => options.onclose?.()).not.toThrow();
    expect(() => options.onerror?.(new Error('network'))).not.toThrow();
    expect(stream.fetchEventSource).toHaveBeenCalledTimes(1);
  });

  it('retains the session and toasts when the backend is temporarily unavailable', async () => {
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('validated')).toHaveTextContent('true'));
    const handler = api.backendUnavailableHandler;
    if (!handler) throw new Error('Expected a backend-unavailable handler.');
    act(() => handler(Object.assign(new Error('offline'), { status: 503, paths: [], users: [], details: null })));
    expect(screen.getByTestId('validated')).toHaveTextContent('true');
    expect(sessionStorage.getItem('qc-deployment-username')).toBe('John Smith');
    expect(screen.getByTestId('system-toasts')).toHaveTextContent('warning:The backend is offline.');
  });

  it('treats the current user OFFLINE event as mandatory session revocation', async () => {
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
        username: 'john_smith',
        state: 'OFFLINE',
        resources: userPresence({ username: 'John Smith', status: 'ACTIVE', revision: 10 }),
      }),
    );
    expect(screen.getByTestId('validated')).toHaveTextContent('false');
    expect(screen.getByTestId('username')).toBeEmptyDOMElement();
    expect(options.signal?.aborted).toBe(true);
  });

  it('opens queue SSE while queued and does not open system SSE or report activity', async () => {
    api.getCurrentPortalSession.mockResolvedValueOnce({
      username: 'John Smith',
      isAdmin: false,
      admissionStatus: 'QUEUED',
      maxOnlineUsers: 2,
      onlineCount: 2,
      queuePosition: 1,
      onlineUsers: [],
    });
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    expect(stream.fetchEventSource.mock.calls.some(([url]) => String(url).includes('/users/queue/events'))).toBe(true);
    expect(stream.fetchEventSource.mock.calls.some(([url]) => String(url).includes('/system/events'))).toBe(false);
    expect(screen.getByTestId('session-phase')).toHaveTextContent('queued');
    expect(screen.getByTestId('username')).toHaveTextContent('John Smith');

    fireEvent.click(screen.getByRole('button', { name: 'Interact' }));
    expect(api.reportUserActivity).not.toHaveBeenCalled();
  });

  it('keeps a queued session when login returns QUEUED and opens only the queue stream', async () => {
    api.getCurrentPortalSession.mockRejectedValueOnce(Object.assign(new Error('No session'), { status: 401 }));
    api.loginUser.mockResolvedValueOnce({
      valid: true,
      normalizedUsername: 'John Smith',
      isAdmin: false,
      admissionStatus: 'QUEUED',
      maxOnlineUsers: 2,
      onlineCount: 2,
      queuePosition: 1,
      onlineUsers: [],
      notices: [],
    });

    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('anonymous'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('queued'));
    expect(screen.getByTestId('username')).toHaveTextContent('John Smith');
    expect(useUserStore.getState().authUser).toMatchObject({
      username: 'John Smith',
      userType: 'USER',
      avatarUrl: null,
    });
    expect(stream.fetchEventSource.mock.calls.some(([url]) => String(url).includes('/users/queue/events'))).toBe(true);
    expect(stream.fetchEventSource.mock.calls.some(([url]) => String(url).includes('/system/events'))).toBe(false);
  });

  it('admits the user from queue SSE and then opens the system stream', async () => {
    api.getCurrentPortalSession.mockResolvedValueOnce({
      username: 'John Smith',
      isAdmin: false,
      admissionStatus: 'QUEUED',
      maxOnlineUsers: 5,
      onlineCount: 5,
      queuePosition: 2,
      onlineUsers: [],
    });
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const queueOptions = streamOptions('/users/queue/events');
    await openStream(queueOptions);
    sendQueueStatus(queueOptions, {
      username: 'John Smith',
      isAdmin: false,
      admissionStatus: 'ADMITTED',
      maxOnlineUsers: 5,
      onlineCount: 5,
      queuePosition: 0,
      onlineUsers: [],
    });
    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('admitted'));
    await waitFor(() =>
      expect(stream.fetchEventSource.mock.calls.some(([url]) => String(url).includes('/system/events'))).toBe(true),
    );
  });

  it('restores queued identity from GET /users/me without admitting', async () => {
    const avatarUrl = 'data:image/jpeg;base64,queued';
    api.getCurrentPortalSession.mockResolvedValueOnce({
      username: 'Mary Smith',
      isAdmin: true,
      authUser: {
        id: 'user-mary',
        username: 'Mary Smith',
        displayName: 'Mary Smith',
        userType: 'SUPERADMIN',
        avatarUrl,
      },
      admissionStatus: 'QUEUED',
      maxOnlineUsers: 8,
      onlineCount: 8,
      queuePosition: 2,
      onlineUsers: [],
    });

    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('queued'));
    expect(screen.getByTestId('username')).toHaveTextContent('Mary Smith');
    expect(useUserStore.getState().authUser).toEqual({
      id: 'user-mary',
      username: 'Mary Smith',
      displayName: 'Mary Smith',
      userType: 'SUPERADMIN',
      avatarUrl,
    });
    expect(stream.fetchEventSource.mock.calls.some(([url]) => String(url).includes('/users/queue/events'))).toBe(true);
    expect(stream.fetchEventSource.mock.calls.some(([url]) => String(url).includes('/system/events'))).toBe(false);
  });

  it('keeps login identity when queue SSE admits the user without authUser', async () => {
    const avatarUrl = 'data:image/jpeg;base64,abc';
    api.getCurrentPortalSession.mockResolvedValueOnce({
      username: 'Mary Smith',
      isAdmin: true,
      authUser: {
        id: 'user-root',
        username: 'Mary Smith',
        displayName: 'Mary Smith',
        userType: 'SUPERADMIN',
        avatarUrl,
      },
      admissionStatus: 'QUEUED',
      maxOnlineUsers: 5,
      onlineCount: 5,
      queuePosition: 2,
      onlineUsers: [],
    });

    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('queued'));
    expect(useUserStore.getState().authUser).toMatchObject({
      id: 'user-root',
      userType: 'SUPERADMIN',
      avatarUrl,
      displayName: 'Mary Smith',
    });

    const queueOptions = streamOptions('/users/queue/events');
    await openStream(queueOptions);
    sendQueueStatus(queueOptions, {
      username: 'Mary Smith',
      isAdmin: true,
      admissionStatus: 'ADMITTED',
      maxOnlineUsers: 5,
      onlineCount: 4,
      queuePosition: 0,
      onlineUsers: [],
    });

    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('admitted'));
    expect(useUserStore.getState().authUser).toEqual({
      id: 'user-root',
      username: 'Mary Smith',
      displayName: 'Mary Smith',
      userType: 'SUPERADMIN',
      avatarUrl,
    });
    await waitFor(() =>
      expect(stream.fetchEventSource.mock.calls.some(([url]) => String(url).includes('/system/events'))).toBe(true),
    );
  });
});

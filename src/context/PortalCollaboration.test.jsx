import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getLocks: vi.fn(),
  getOperation: vi.fn(),
  getProfiles: vi.fn(),
  getRuntimeResource: vi.fn(),
  lockConflictHandler: null,
  reportUserActivity: vi.fn(),
  validateUser: vi.fn(),
}));
const stream = vi.hoisted(() => ({ fetchEventSource: vi.fn() }));

vi.mock('@microsoft/fetch-event-source', () => ({ fetchEventSource: stream.fetchEventSource }));
vi.mock('@/lib/contractApi', () => ({
  eventUrl: (path) => `/deploymentOrchestrator/api${path}`,
  getLocks: api.getLocks,
  getOperation: api.getOperation,
  getProfiles: api.getProfiles,
  getRuntimeResource: api.getRuntimeResource,
  onLockConflict: (handler) => {
    api.lockConflictHandler = handler;
    return () => {
      api.lockConflictHandler = null;
    };
  },
  reportUserActivity: api.reportUserActivity,
  techDriveHeaders: (username) => ({ 'X-TechDrive-Username': username }),
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
      <span data-testid="system-status">{portal.systemStatus}</span>
      <button type="button" onClick={portal.reportInteraction}>
        Interact
      </button>
    </div>
  );
}

const send = (options, payload) => act(() => options.onmessage({ data: JSON.stringify(payload), event: payload.eventType }));

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
    Object.values(api).forEach((value) => {
      if (typeof value?.mockReset === 'function') value.mockReset();
    });
    stream.fetchEventSource.mockReset();
  });

  it('hydrates authoritative snapshots and applies revision-safe presence and lock transitions', async () => {
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const options = stream.fetchEventSource.mock.calls[0][1];

    send(options, {
      eventType: 'USER_PRESENCE_CHANGED',
      state: 'IDLE',
      resources: { username: 'Mary Smith', status: 'IDLE', revision: 8 },
    });
    send(options, {
      eventType: 'SYSTEM_SNAPSHOT',
      resources: {
        wildflyProfiles: [],
        jarProfiles: [],
        frontendProfiles: [],
        onlineUsers: [{ username: 'Mary Smith', status: 'ACTIVE', revision: 7 }],
        locks: [
          { resourceKey: 'profile:one', owner: 'Mary Smith', mode: 'WRITE', revision: 4, expiresAt: '2099-01-01T00:00:00Z' },
        ],
      },
    });
    expect(screen.getByTestId('users')).toHaveTextContent('Mary Smith:ACTIVE');
    expect(screen.getByTestId('locks')).toHaveTextContent('profile:one');

    send(options, {
      eventType: 'USER_PRESENCE_CHANGED',
      state: 'IDLE',
      resources: { username: 'Mary Smith', status: 'IDLE', revision: 6 },
    });
    expect(screen.getByTestId('users')).toHaveTextContent('Mary Smith:ACTIVE');
    send(options, {
      eventType: 'USER_PRESENCE_CHANGED',
      state: 'OFFLINE',
      resources: { username: 'Mary Smith', status: 'OFFLINE', revision: 9 },
    });
    send(options, {
      eventType: 'LOCK_CHANGED',
      state: 'RELEASED',
      resources: { action: 'RELEASED', lock: { resourceKey: 'profile:one', revision: 5 } },
    });
    expect(screen.getByTestId('users')).toBeEmptyDOMElement();
    expect(screen.getByTestId('locks')).toBeEmptyDOMElement();
  });

  it('suppresses initiator toasts, deduplicates other-user completions, and reconciles targeted resources', async () => {
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const options = stream.fetchEventSource.mock.calls[0][1];
    const own = {
      eventType: 'OPERATION_FINISHED',
      username: 'john_smith',
      state: 'COMPLETED',
      resources: {
        operationId: 'own',
        username: 'john_smith',
        section: 'JAR',
        resourceKey: 'JAR:orders',
        resourceType: 'JAR',
        outcome: 'COMPLETED',
        summary: 'Done',
      },
    };
    const other = {
      eventType: 'OPERATION_FINISHED',
      username: 'Mary Smith',
      state: 'FAILED',
      resources: {
        operationId: 'other',
        username: 'Mary Smith',
        section: 'WAR',
        resourceKey: 'WILDFLY_PROFILE:one',
        resourceType: 'WILDFLY_PROFILE',
        outcome: 'FAILED',
        summary: 'Failed',
      },
    };

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

  it('throttles real interaction and reconciles locks after reconnect and HTTP 423', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100000);
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const options = stream.fetchEventSource.mock.calls[0][1];

    fireEvent.click(screen.getByRole('button', { name: 'Interact' }));
    now.mockReturnValue(120000);
    fireEvent.click(screen.getByRole('button', { name: 'Interact' }));
    now.mockReturnValue(130000);
    fireEvent.click(screen.getByRole('button', { name: 'Interact' }));
    expect(api.reportUserActivity).toHaveBeenCalledTimes(2);

    await act(() => options.onopen({ ok: true }));
    await act(() => options.onopen({ ok: true }));
    await waitFor(() => expect(api.getLocks).toHaveBeenCalledTimes(1));
    await act(() => api.lockConflictHandler());
    await waitFor(() => expect(api.getLocks).toHaveBeenCalledTimes(2));
  });

  it('ignores heartbeat and malformed messages without changing connection state', async () => {
    render(
      <PortalProvider>
        <Harness />
      </PortalProvider>,
    );
    await waitFor(() => expect(stream.fetchEventSource).toHaveBeenCalled());
    const options = stream.fetchEventSource.mock.calls[0][1];
    await act(() => options.onopen({ ok: true }));
    expect(screen.getByTestId('system-status')).toHaveTextContent('connected');

    act(() => options.onmessage({ data: '', event: '' }));
    act(() => options.onmessage({ data: '{bad json', event: 'message' }));
    expect(screen.getByTestId('system-status')).toHaveTextContent('connected');

    act(() => options.onerror(new Error('network')));
    expect(screen.getByTestId('system-status')).toHaveTextContent('reconnecting');
    await act(() => options.onopen({ ok: true }));
    expect(screen.getByTestId('system-status')).toHaveTextContent('connected');
  });
});

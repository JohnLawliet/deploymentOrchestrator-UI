import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const streams = [];
const api = vi.hoisted(() => ({
  convertUatBuild: vi.fn(),
  getFileRoots: vi.fn(),
  getWarApplications: vi.fn(),
  isLockConflict: vi.fn(() => false),
  preflightUatBuild: vi.fn(),
  releaseUatBuildLock: vi.fn(),
  techDriveHeaders: vi.fn((username) => ({ 'X-TechDrive-Username': username })),
  uatBuildOperationEventUrl: vi.fn((id) => `/api/uat-builds/operations/${encodeURIComponent(id)}`),
}));

vi.mock('@/lib/contractApi', () => api);
vi.mock('@/context/PortalContext', () => ({ usePortal: () => ({ username: 'jonty' }) }));
vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn((url, options) => {
    streams.push({ url, options });
    return new Promise(() => {});
  }),
}));
vi.mock('@/components/FileBrowser', () => ({
  default: ({ rootKey, onSelectionChange }) => (
    <button type="button" onClick={() => onSelectionChange([rootKey === 'techDrive' ? 'orders/uat.war' : 'orders/exploded'])}>
      Select {rootKey}
    </button>
  ),
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, disabled }) => (
    <select value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }) => <>{children}</>,
  SelectItem: ({ value, children }) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

import { fetchEventSource } from '@microsoft/fetch-event-source';
import UatBuildPage, { allDuplicatesSelected, techDrivePath } from './UatBuildPage';

const preflight = {
  lockId: 'lock-1',
  lockExpiresAt: new Date(Date.now() + 180000).toISOString(),
  ready: false,
  decisionRequired: true,
  warnings: ['Check generated configuration.'],
  missingFromJenkinsFiles: ['WEB-INF/lib/uat-only.jar'],
  missingUatFiles: [],
  duplicateFiles: { 'web.xml': ['WEB-INF/web.xml', 'legacy/web.xml'] },
  automaticallyResolved: { 'application.properties': 'WEB-INF/classes/application.properties' },
};

describe('UAT duplicate validation', () => {
  it('requires a returned candidate for every duplicate filename', () => {
    expect(allDuplicatesSelected({}, {})).toBe(true);
    expect(allDuplicatesSelected(preflight.duplicateFiles, {})).toBe(false);
    expect(allDuplicatesSelected(preflight.duplicateFiles, { 'web.xml': 'elsewhere/web.xml' })).toBe(false);
    expect(allDuplicatesSelected(preflight.duplicateFiles, { 'web.xml': 'WEB-INF/web.xml' })).toBe(true);
  });
});

describe('UAT OPM path', () => {
  it('joins the Tech Drive root, username, and output path without duplicate separators', () => {
    expect(techDrivePath({ path: '/tech/' }, 'jonty', '/orders/uat.war')).toBe('/tech/jonty/orders/uat.war');
  });
});

describe('UatBuildPage', () => {
  beforeEach(() => {
    streams.length = 0;
    sessionStorage.clear();
    vi.clearAllMocks();
    api.getWarApplications.mockResolvedValue([{ application: 'orders', environments: ['qc'] }]);
    api.getFileRoots.mockResolvedValue({ techDrive: { path: '/tech' }, jenkinsBuild: { path: '/jenkins' } });
    api.preflightUatBuild.mockResolvedValue(preflight);
    api.releaseUatBuildLock.mockResolvedValue({});
    api.convertUatBuild.mockResolvedValue({ operationId: 'operation/1', status: 'RUNNING' });
  });

  afterEach(cleanup);

  async function selectInputs(user) {
    render(<UatBuildPage />);
    await screen.findByText('orders');
    await user.click(screen.getByRole('button', { name: 'Select techDrive' }));
    await user.click(screen.getByRole('button', { name: 'Select jenkinsBuild' }));
  }

  async function runPreflight(user, { additionalConfig = false } = {}) {
    await selectInputs(user);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    if (additionalConfig) await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: 'Inspect and lock' }));
    await screen.findByText(/Write lock:/);
  }

  async function selectDuplicateAndConvert(user) {
    await runPreflight(user);
    await user.selectOptions(screen.getByRole('combobox'), 'WEB-INF/web.xml');
    await user.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
  }

  it('sends the default and selected additionalConfigRequired values', async () => {
    const user = userEvent.setup();
    await runPreflight(user);
    expect(api.preflightUatBuild).toHaveBeenCalledWith(expect.objectContaining({ additionalConfigRequired: false }));
    cleanup();
    vi.clearAllMocks();
    api.getWarApplications.mockResolvedValue([{ application: 'orders', environments: ['qc'] }]);
    api.getFileRoots.mockResolvedValue({ techDrive: {}, jenkinsBuild: {} });
    api.preflightUatBuild.mockResolvedValue(preflight);
    await runPreflight(userEvent.setup(), { additionalConfig: true });
    expect(api.preflightUatBuild).toHaveBeenCalledWith(expect.objectContaining({ additionalConfigRequired: true }));
  });

  it('releases and invalidates preflight when the additional configuration choice changes', async () => {
    const user = userEvent.setup();
    await runPreflight(user);
    await user.click(screen.getByRole('button', { name: /Select build inputs/ }));
    await user.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(api.releaseUatBuildLock).toHaveBeenCalledWith('lock-1'));
    expect(screen.getByText(/Inputs changed/)).toBeVisible();
  });

  it('renders the revised response and lets nonblocking UAT-only files convert', async () => {
    const user = userEvent.setup();
    await runPreflight(user);
    expect(screen.getByText('WEB-INF/lib/uat-only.jar')).toBeVisible();
    expect(screen.getByText(/copied from UAT automatically/)).toBeVisible();
    expect(screen.getByText('application.properties → WEB-INF/classes/application.properties')).toBeVisible();
    expect(screen.getByText('Check generated configuration.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Convert' })).toBeDisabled();

    await user.selectOptions(screen.getByRole('combobox'), 'WEB-INF/web.xml');
    expect(screen.getByRole('button', { name: 'Convert' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Convert' }));

    expect(api.convertUatBuild).toHaveBeenCalledWith({
      lockId: 'lock-1',
      duplicateSelections: { 'web.xml': 'WEB-INF/web.xml' },
    });
  });

  it('blocks conversion when required UAT files are missing', async () => {
    api.preflightUatBuild.mockResolvedValue({ ...preflight, duplicateFiles: {}, missingUatFiles: ['WEB-INF/web.xml'] });
    const user = userEvent.setup();
    await runPreflight(user);
    expect(screen.getByText('Missing required UAT files')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Convert' })).toBeDisabled();
  });

  it('uses one authenticated operation stream and completes directly from its payload', async () => {
    const user = userEvent.setup();
    await selectDuplicateAndConvert(user);
    expect(streams[0].url).toBe('/api/uat-builds/operations/operation%2F1');
    expect(streams[0].options.headers).toEqual({ 'X-TechDrive-Username': 'jonty', Accept: 'text/event-stream' });
    expect(sessionStorage.getItem('uat-build-operation:jonty')).toBe('operation/1');

    await act(() => streams[0].options.onopen({ ok: true }));
    act(() =>
      streams[0].options.onmessage({
        event: 'UAT_BUILD_RUNNING',
        data: JSON.stringify({ operationId: 'operation/1', status: 'RUNNING', message: 'Packaging' }),
      }),
    );
    expect(screen.getByText('Packaging')).toBeVisible();

    act(() =>
      streams[0].options.onmessage({
        event: 'UAT_BUILD_COMPLETED',
        data: JSON.stringify({
          operationId: 'operation/1',
          status: 'COMPLETED',
          outputPath: 'orders/uat.war',
          warFileName: 'uat.war',
          sha256: 'abc123',
          message: 'Done',
          code: null,
        }),
      }),
    );
    const expectedMessage =
      'Scan the war from below location and place in <clientName> SFTP.\n\ntechDrive: /tech/jonty/orders/uat.war\nHash: abc123';
    const message = await screen.findByText(/Scan the war from below location/);
    expect(message.textContent).toBe(expectedMessage);
    const clipboardSpy = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: 'Copy OPM message' }));
    expect(clipboardSpy).toHaveBeenCalledWith(expectedMessage);
    expect(streams[0].options.signal.aborted).toBe(true);
    expect(sessionStorage.getItem('uat-build-operation:jonty')).toBeNull();
    expect(fetchEventSource).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed, mismatched, and unsupported events then handles failure', async () => {
    await selectDuplicateAndConvert(userEvent.setup());
    act(() => {
      streams[0].options.onmessage({ event: 'UAT_BUILD_COMPLETED', data: '{bad' });
      streams[0].options.onmessage({ event: 'OTHER', data: '{}' });
      streams[0].options.onmessage({ event: 'UAT_BUILD_COMPLETED', data: JSON.stringify({ operationId: 'other' }) });
    });
    expect(streams[0].options.signal.aborted).toBe(false);
    act(() =>
      streams[0].options.onmessage({
        event: 'UAT_BUILD_FAILED',
        data: JSON.stringify({ operationId: 'operation/1', status: 'FAILED', message: 'Packaging failed', code: 'UAT_42' }),
      }),
    );
    expect(await screen.findByText('Packaging failed · UAT_42')).toBeVisible();
    expect(streams[0].options.signal.aborted).toBe(true);
  });

  it('restores the operation stream and cleans it up on unmount without duplicates', async () => {
    sessionStorage.setItem('uat-build-operation:jonty', 'restored/1');
    const view = render(<UatBuildPage />);
    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
    expect(streams[0].url).toBe('/api/uat-builds/operations/restored%2F1');
    act(() => streams[0].options.onerror(new Error('timeout')));
    expect(screen.getAllByText(/reconnecting/i).length).toBeGreaterThan(0);
    expect(streams[0].options.onerror()).toBe(3000);
    expect(fetchEventSource).toHaveBeenCalledTimes(1);
    view.rerender(<UatBuildPage />);
    expect(fetchEventSource).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(streams[0].options.signal.aborted).toBe(true);
  });
});

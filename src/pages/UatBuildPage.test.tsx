import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { FileRoot, UatPreflightResponse } from '@/types/api-contracts';

type StreamOptions = {
  headers: Record<string, string>;
  signal: AbortSignal;
  onopen: (response: { ok: boolean }) => void;
  onmessage: (message: { event: string; data: string }) => void;
  onerror: (error?: Error) => number | void;
};
type Stream = { url: string; options: StreamOptions };
type FileBrowserMockProps = { rootKey: 'techDrive' | 'jenkinsBuild'; onSelectionChange: (paths: string[]) => void };
type SelectMockProps = {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  open?: boolean;
};

const streams: Stream[] = [];
const api = vi.hoisted(() => ({
  convertUatBuild: vi.fn(),
  downloadAdditionalConfigSample: vi.fn(),
  getFileRoots: vi.fn(),
  getWarApplications: vi.fn(),
  isLockConflict: vi.fn(() => false),
  preflightUatBuild: vi.fn(),
  releaseUatBuildLock: vi.fn(),
  saveBlob: vi.fn(),
  techDriveHeaders: vi.fn((username: string) => ({ 'X-TechDrive-Username': username })),
  uatBuildOperationEventUrl: vi.fn((id: string) => `/api/uat-builds/operations/${encodeURIComponent(id)}`),
}));

type PageTutorialProps = {
  onStart?: () => void;
  onReset?: () => void;
  onStepPrepare?: (index: number) => void | Promise<void>;
};

vi.mock('@/lib/contractApi', () => api);
vi.mock('@/context/PortalContext', () => ({ usePortal: () => ({ username: 'jonty' }) }));
vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn((url: string, options: StreamOptions) => {
    streams.push({ url, options });
    return new Promise(() => {});
  }),
}));
vi.mock('@/components/FileBrowser', () => ({
  default: ({ rootKey, onSelectionChange }: FileBrowserMockProps) => (
    <>
      <button type="button" onClick={() => onSelectionChange([rootKey === 'techDrive' ? 'orders/uat.war' : 'orders/exploded'])}>
        Select {rootKey}
      </button>
      {rootKey === 'techDrive' && (
        <button type="button" onClick={() => onSelectionChange(['orders/uat.zip'])}>
          Select ZIP
        </button>
      )}
    </>
  ),
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, disabled, open }: SelectMockProps) => (
    <select
      value={value}
      disabled={disabled}
      data-open={open ? 'true' : 'false'}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
vi.mock('@/components/PageTutorial', () => ({
  default: ({ onStart, onReset, onStepPrepare }: PageTutorialProps) => (
    <div>
      <button type="button" onClick={onStart}>
        Tutorial
      </button>
      {[0, 1, 2, 3, 4, 5, 6].map((step) => (
        <button type="button" key={step} onClick={() => void onStepPrepare?.(step)}>
          Tutorial step {step}
        </button>
      ))}
      <button type="button" onClick={onReset}>
        Reset tutorial
      </button>
    </div>
  ),
}));

import { fetchEventSource } from '@microsoft/fetch-event-source';
import UatBuildPage, { allDuplicatesSelected, techDrivePath } from './UatBuildPage';

const preflight: UatPreflightResponse = {
  lockId: 'lock-1',
  lockExpiresAt: new Date(Date.now() + 180000).toISOString(),
  lockTtlSeconds: 180,
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
    expect(techDrivePath({ key: 'techDrive', path: '/tech/' } satisfies FileRoot, 'jonty', '/orders/uat.war')).toBe(
      '/tech/jonty/orders/uat.war',
    );
  });
});

describe('UatBuildPage', () => {
  beforeEach(() => {
    streams.length = 0;
    sessionStorage.clear();
    vi.clearAllMocks();
    api.getWarApplications.mockResolvedValue([{ application: 'orders', environments: ['qc'] }]);
    api.getFileRoots.mockResolvedValue([
      { key: 'techDrive', path: '/tech' },
      { key: 'jenkinsBuild', path: '/jenkins' },
    ]);
    api.preflightUatBuild.mockResolvedValue(preflight);
    api.releaseUatBuildLock.mockResolvedValue({});
    api.convertUatBuild.mockResolvedValue({ operationId: 'operation/1', status: 'RUNNING' });
  });

  afterEach(cleanup);

  async function selectInputs(user: ReturnType<typeof userEvent.setup>) {
    render(<UatBuildPage />);
    await screen.findByText('orders');
    await user.click(screen.getByRole('button', { name: 'Select techDrive' }));
    await user.click(screen.getByRole('button', { name: 'Select jenkinsBuild' }));
  }

  async function runPreflight(
    user: ReturnType<typeof userEvent.setup>,
    { additionalConfig = false }: { additionalConfig?: boolean } = {},
  ) {
    await selectInputs(user);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    if (additionalConfig) await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: 'Inspect and lock' }));
    await screen.findByText(/Write lock:/);
  }

  async function selectDuplicateAndConvert(user: ReturnType<typeof userEvent.setup>) {
    await runPreflight(user);
    await user.selectOptions(screen.getByRole('combobox'), 'WEB-INF/web.xml');
    await user.click(screen.getByRole('button', { name: /^Convert/ }));
    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
  }

  it('sends the default and selected additionalConfigRequired values', async () => {
    const user = userEvent.setup();
    await runPreflight(user);
    expect(api.preflightUatBuild).toHaveBeenCalledWith(expect.objectContaining({ additionalConfigRequired: false }));
    cleanup();
    vi.clearAllMocks();
    api.getWarApplications.mockResolvedValue([{ application: 'orders', environments: ['qc'] }]);
    api.getFileRoots.mockResolvedValue([
      { key: 'techDrive', path: '/tech' },
      { key: 'jenkinsBuild', path: '/jenkins' },
    ]);
    api.preflightUatBuild.mockResolvedValue(preflight);
    await runPreflight(userEvent.setup(), { additionalConfig: true });
    expect(api.preflightUatBuild).toHaveBeenCalledWith(expect.objectContaining({ additionalConfigRequired: true }));
  });

  it('sends the selected ZIP unchanged as sourceWarPath', async () => {
    const user = userEvent.setup();
    await selectInputs(user);
    await user.click(screen.getByRole('button', { name: 'Select ZIP' }));
    await user.click(screen.getByRole('button', { name: 'Inspect and lock' }));
    await waitFor(() =>
      expect(api.preflightUatBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceWarPath: 'orders/uat.zip',
          jenkinsExplodedWarPath: 'orders/exploded',
        }),
      ),
    );
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
    expect(screen.getByRole('button', { name: /^Convert/ })).toBeDisabled();

    await user.selectOptions(screen.getByRole('combobox'), 'WEB-INF/web.xml');
    expect(screen.getByRole('button', { name: /^Convert/ })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /^Convert/ }));

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
    expect(screen.getByRole('button', { name: /^Convert/ })).toBeDisabled();
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

  it('walks the tutorial with sample findings and restores state without calling conversion APIs', async () => {
    const user = userEvent.setup();
    render(<UatBuildPage />);
    await screen.findByText('orders');

    await user.click(screen.getByRole('button', { name: 'Tutorial' }));
    expect(document.querySelector('[data-tour="uat-application"]')).toBeTruthy();
    expect(screen.getByRole('combobox')).toHaveAttribute('data-open', 'true');
    expect(screen.getByRole('combobox')).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Tutorial step 1' }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveAttribute('data-open', 'false'));
    expect(document.querySelector('[data-tour="uat-source"]')).toBeTruthy();
    expect(screen.getByText('tutorial/example.war')).toBeVisible();
    expect(screen.getByText('Download sample file')).toBeVisible();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download sample file' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Tutorial step 2' }));
    expect(document.querySelector('[data-tour="uat-jenkins"]')).toBeTruthy();
    expect(screen.getByText('tutorial/exploded')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Tutorial step 3' }));
    expect(document.querySelector('[data-tour="uat-inspect"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inspect and lock' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Tutorial step 4' }));
    await waitFor(() => expect(screen.getByText('Present in UAT but missing from Jenkins')).toBeVisible());
    expect(screen.getByText('WEB-INF/lib/uat-only.jar')).toBeVisible();
    expect(screen.getByText('application.properties → WEB-INF/classes/application.properties')).toBeVisible();
    expect(screen.getByText('Resolve duplicate: web.xml')).toBeVisible();
    expect(screen.getByRole('button', { name: /^Convert \(\d+\)$/ })).toBeDisabled();
    expect(api.preflightUatBuild).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Tutorial step 5' }));
    expect(document.querySelector('[data-tour="uat-convert"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Convert \(\d+\)$/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Tutorial step 6' }));
    await waitFor(() => expect(screen.getByText(/Scan the war from below location/)).toBeVisible());
    expect(screen.getByText(/Hash: a{64}/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Reset tutorial' }));
    expect(screen.queryByText('Present in UAT but missing from Jenkins')).not.toBeInTheDocument();
    expect(screen.queryByText('tutorial/example.war')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect and lock' })).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveAttribute('data-open', 'false');
    expect(api.preflightUatBuild).not.toHaveBeenCalled();
    expect(api.convertUatBuild).not.toHaveBeenCalled();
    expect(api.releaseUatBuildLock).not.toHaveBeenCalled();
  });
});

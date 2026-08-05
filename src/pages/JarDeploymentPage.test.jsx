import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  deployJar: vi.fn(),
  getJars: vi.fn(),
  getPortStatus: vi.fn(),
  isLockConflict: vi.fn(() => false),
}));
const portal = vi.hoisted(() => ({
  jarProfileActivityMap: {},
  frontendProfileActivityMap: {},
  operations: {},
  lastSystemEvent: null,
  snapshotRevision: 0,
  reconcileResourceActivity: vi.fn(() => Promise.resolve()),
  registerOperation: vi.fn(),
}));

vi.mock('@/lib/contractApi', () => api);
vi.mock('@/context/PortalContext', () => ({ usePortal: () => portal }));
vi.mock('@/components/FileBrowser', () => ({
  default: ({ onSelectionChange, selectableExtension }) =>
    selectableExtension === '.jar' ? (
      <button type="button" onClick={() => onSelectionChange(['tech/orders.jar'])}>
        Select test JAR
      </button>
    ) : (
      <button type="button" onClick={() => onSelectionChange(['tech/orders-ui/dist', 'tech/orders-ui/config.json'])}>
        Select frontend build
      </button>
    ),
}));
vi.mock('@/components/SearchableProfileSelect', () => ({
  default: ({
    profiles,
    value,
    onValueChange,
    onSelect,
    onCreate,
    onInputBlur,
    getKey,
    getLabel,
    inputAriaLabel,
    ariaLabel,
    createOptionLabel,
  }) => (
    <div>
      <input
        aria-label={onCreate ? ariaLabel : inputAriaLabel}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={() => onInputBlur?.()}
      />
      {onCreate && (
        <button type="button" disabled={!value} onClick={() => onCreate(value)}>
          {createOptionLabel}
        </button>
      )}
      {profiles.map((profile) => (
        <button type="button" key={getKey(profile)} onClick={() => onSelect(profile)}>
          Select {getLabel(profile)}
        </button>
      ))}
    </div>
  ),
}));

import JarDeploymentPage from './JarDeploymentPage';
import { generatedJarCommand } from '@/lib/jarContract';

describe('JAR contract helpers', () => {
  it('generates the exact application launcher command', () => {
    expect(generatedJarCommand('orders', '8087')).toBe('java -jar orders.jar --spring.profiles.active=qc --server.port=8087');
  });
});

describe('JarDeploymentPage port contract', () => {
  beforeEach(() => {
    api.getJars.mockResolvedValue({
      domain: 'http://192.168.40.192',
      jars: [
        {
          id: 'orders',
          applicationName: 'Orders',
          jarName: 'orders-target.jar',
        },
      ],
    });
    api.deployJar.mockResolvedValue({ deploymentId: 'deployment-1' });
    api.getPortStatus.mockReset();
    api.getPortStatus.mockResolvedValue({
      port: 8087,
      occupied: false,
      ownerType: 'NONE',
      sameApplication: false,
      deploymentAllowed: true,
      message: 'Port 8087 is available',
    });
    portal.jarProfileActivityMap = {};
    portal.frontendProfileActivityMap = {
      'frontend-uuid': {
        profileUuid: 'frontend-uuid',
        profileName: 'orders-ui',
        port: 3000,
        frontendUrl: 'http://orders.qc.local:3000',
        documentRoot: '/srv/www/orders',
        health: 'FUNCTIONAL',
        healthReason: null,
        directoryExists: true,
        running: true,
      },
    };
    portal.operations = {};
    portal.lastSystemEvent = null;
    portal.reconcileResourceActivity.mockClear();
    portal.registerOperation.mockClear();
  });

  afterEach(() => cleanup());

  const waitForAvailablePort = () =>
    waitFor(() => expect(screen.getByText('Port 8087 is available.')).toBeVisible(), { timeout: 2500 });

  const selectExistingJar = async (user) => {
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }));
  };

  it('checks a valid port only after the 800 ms debounce', async () => {
    const user = userEvent.setup();
    render(<JarDeploymentPage />);
    await selectExistingJar(user);
    await user.type(screen.getByLabelText('Port number (required)'), '8087');

    await new Promise((resolve) => window.setTimeout(resolve, 700));
    expect(api.getPortStatus).not.toHaveBeenCalled();
    await waitForAvailablePort();
    expect(api.getPortStatus).toHaveBeenCalledWith(8087, 'Orders', expect.any(AbortSignal));
  });

  it('shows the occupied process and blocks a nonmatching JAR port', async () => {
    api.getPortStatus.mockResolvedValueOnce({
      port: 8087,
      occupied: true,
      pid: 4242,
      ownerType: 'JAVA_JAR',
      jarName: 'other.jar',
      sameApplication: false,
      deploymentAllowed: false,
      message: 'Port 8087 is used by an unmanaged Java JAR process',
    });
    const user = userEvent.setup();
    render(<JarDeploymentPage />);
    await selectExistingJar(user);
    await user.type(screen.getByLabelText('Port number (required)'), '8087');

    expect(await screen.findByText(/PID 4242.*JAR: other.jar/s, {}, { timeout: 2500 })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deploy JAR' })).toBeDisabled();
  });

  it('supports first deployment with an empty catalogue and requires a valid port', async () => {
    api.getJars.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<JarDeploymentPage />);

    expect(await screen.findByText(/Select a JAR from Tech Drive to derive the application name/)).toBeVisible();
    const submit = screen.getByRole('button', { name: 'Deploy JAR' });
    expect(submit).toBeDisabled();
    expect(screen.queryByText('Port is required.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }));
    expect(screen.getByLabelText('Application name (required)')).toHaveValue('orders');

    await user.type(screen.getByLabelText('Port number (required)'), '65536');
    await user.tab();
    expect(screen.getByText(/whole number from 1 to 65535/)).toBeVisible();
    expect(submit).toBeDisabled();
  });

  it('derives and commits the application name when a JAR is selected', async () => {
    api.getJars.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<JarDeploymentPage />);

    await user.click(screen.getByRole('button', { name: 'Select test JAR' }));
    expect(screen.getByLabelText('Application name (required)')).toHaveValue('orders');
    await user.type(screen.getByLabelText('Port number (required)'), '8087');
    await waitForAvailablePort();

    expect(screen.getByRole('button', { name: 'Deploy JAR' })).toBeEnabled();
    expect(api.getPortStatus).toHaveBeenCalledWith(8087, 'orders', expect.any(AbortSignal));
  });

  it('auto-selects an existing catalogue application when the derived JAR name matches', async () => {
    const user = userEvent.setup();
    render(<JarDeploymentPage />);

    await user.click(screen.getByRole('button', { name: 'Select test JAR' }));
    expect(screen.getByLabelText('Application name (required)')).toHaveValue('Orders');
    await user.type(screen.getByLabelText('Port number (required)'), '8087');
    await waitForAvailablePort();

    expect(screen.getByRole('button', { name: 'Deploy JAR' })).toBeEnabled();
    expect(api.getPortStatus).toHaveBeenCalledWith(8087, 'Orders', expect.any(AbortSignal));
  });

  it('validates the port field independently from JAR selection', async () => {
    const user = userEvent.setup();
    render(<JarDeploymentPage />);

    expect(screen.queryByText(/must start with a letter or number/)).not.toBeInTheDocument();
    expect(screen.queryByText('Port is required.')).not.toBeInTheDocument();

    const portInput = screen.getByLabelText('Port number (required)');
    await user.click(portInput);
    await user.tab();
    expect(screen.getByText('Port is required.')).toBeVisible();
  });

  it('generates a read-only launcher from the derived application name and port', async () => {
    const user = userEvent.setup();
    render(<JarDeploymentPage />);
    await selectExistingJar(user);
    await user.type(screen.getByLabelText('Port number (required)'), '8087');
    await waitForAvailablePort();
    await user.click(screen.getByLabelText('Yes, include launcher settings'));

    const script = screen.getByLabelText('Generated launcher command');
    expect(script).toHaveValue('java -jar Orders.jar --spring.profiles.active=qc --server.port=8087');
    expect(script).toHaveAttribute('readonly');
  });

  it('requires a frontend choice and keeps frontend setup independent from launcher settings', async () => {
    const user = userEvent.setup();
    render(<JarDeploymentPage />);
    await selectExistingJar(user);
    await user.type(screen.getByLabelText('Port number (required)'), '8087');
    await waitForAvailablePort();

    expect(screen.getByRole('button', { name: 'Deploy JAR' })).toBeEnabled();
    expect(screen.queryByLabelText('Generated launcher command')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Include frontend'));
    await user.click(screen.getByLabelText('Deploy to frontend'));
    await user.click(screen.getByText('Select orders-ui'));
    await user.click(screen.getByRole('button', { name: 'Select frontend build' }));
    expect(screen.queryByLabelText('Generated launcher command')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deploy JAR' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }));
    await waitFor(() =>
      expect(api.deployJar).toHaveBeenCalledWith({
        applicationName: 'Orders',
        catalogueJarId: 'orders',
        sourcePath: 'tech/orders.jar',
        port: 8087,
        frontend: {
          mode: 'DEPLOY',
          profileUuid: 'frontend-uuid',
          sourceRootKey: 'techDrive',
          sourcePaths: ['tech/orders-ui/dist', 'tech/orders-ui/config.json'],
        },
      }),
    );
  });

  it('submits only the latest JAR contract with the selected frontend UUID', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<JarDeploymentPage />);
    await selectExistingJar(user);
    await user.type(screen.getByLabelText('Port number (required)'), '8087');
    await waitForAvailablePort();
    await user.click(screen.getByLabelText('Yes, include launcher settings'));
    await user.click(screen.getByLabelText('Include frontend'));
    await user.click(screen.getByLabelText('Deploy to frontend'));
    await user.click(screen.getByText('Select orders-ui'));
    await user.click(screen.getByRole('button', { name: 'Select frontend build' }));
    expect(screen.getByText('http://orders.qc.local:3000')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }));

    await waitFor(() =>
      expect(api.deployJar).toHaveBeenCalledWith({
        applicationName: 'Orders',
        catalogueJarId: 'orders',
        sourcePath: 'tech/orders.jar',
        port: 8087,
        script: {
          scriptLine: 'java -jar Orders.jar --spring.profiles.active=qc --server.port=8087',
        },
        frontend: {
          mode: 'DEPLOY',
          profileUuid: 'frontend-uuid',
          sourceRootKey: 'techDrive',
          sourcePaths: ['tech/orders-ui/dist', 'tech/orders-ui/config.json'],
        },
      }),
    );
    expect(portal.registerOperation).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: 'deployment-1', resourceType: 'JAR', applicationName: 'Orders' }),
      undefined,
      expect.stringMatching(/Deploy JAR.*Orders \+ orders-ui/),
    );
  });

  it('reuses an authoritative frontend association from an explicitly selected catalogue JAR', async () => {
    api.getJars.mockResolvedValue({
      jars: [
        {
          id: 'orders',
          applicationName: 'Orders',
          jarName: 'orders-target.jar',
          frontendProfile: {
            profileUuid: 'frontend-uuid',
            profileName: 'orders-ui',
            port: 443,
            frontendUrl: 'https://orders.example/app',
            documentRoot: '/srv/www/orders',
            associatedJar: { id: 'orders', applicationName: 'Orders', jarName: 'orders-target.jar' },
            lastDeployment: { deployedBy: 'Mary', deployedAt: '2026-08-04T10:00:00Z' },
          },
        },
      ],
    });
    const user = userEvent.setup();
    render(<JarDeploymentPage />);
    await selectExistingJar(user);
    await user.type(screen.getByLabelText('Port number (required)'), '8087');
    await waitForAvailablePort();

    expect(screen.getByText('orders-target.jar')).toBeVisible();
    expect(screen.getByText(/Mary/)).toBeVisible();
    await user.click(screen.getByLabelText('Include frontend'));
    await user.click(screen.getByLabelText('Use existing frontend association'));
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }));

    await waitFor(() =>
      expect(api.deployJar).toHaveBeenCalledWith(
        expect.objectContaining({
          catalogueJarId: 'orders',
          frontend: { mode: 'REUSE_ASSOCIATION', catalogueJarId: 'orders' },
        }),
      ),
    );
  });

  it('requires confirmation before reassigning a frontend profile owned by another JAR', async () => {
    portal.frontendProfileActivityMap['frontend-uuid'] = {
      ...portal.frontendProfileActivityMap['frontend-uuid'],
      jarProfileUuid: 'payments',
      applicationName: 'Payments',
      jarName: 'payments.jar',
    };
    const user = userEvent.setup();
    render(<JarDeploymentPage />);
    await selectExistingJar(user);
    await user.type(screen.getByLabelText('Port number (required)'), '8087');
    await waitForAvailablePort();
    await user.click(screen.getByLabelText('Include frontend'));
    await user.click(screen.getByLabelText('Deploy to frontend'));
    await user.click(screen.getByText('Select orders-ui'));
    await user.click(screen.getByRole('button', { name: 'Select frontend build' }));

    expect(screen.getByText(/currently associated with payments.jar/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deploy JAR' })).toBeDisabled();
    await user.click(screen.getByLabelText('Confirm frontend reassociation'));
    expect(screen.getByRole('button', { name: 'Deploy JAR' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }));

    await waitFor(() =>
      expect(api.deployJar).toHaveBeenCalledWith(
        expect.objectContaining({
          frontend: expect.objectContaining({ mode: 'DEPLOY', confirmReassociation: true }),
        }),
      ),
    );
  });

  it('clears a selected frontend UUID when it disappears from the snapshot', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<JarDeploymentPage />);
    await user.click(screen.getByLabelText('Include frontend'));
    await user.click(screen.getByLabelText('Deploy to frontend'));
    await user.click(screen.getByText('Select orders-ui'));

    portal.frontendProfileActivityMap = {};
    rerender(<JarDeploymentPage />);

    expect(
      await screen.findByText('The selected frontend profile is no longer available. Select another profile.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deploy JAR' })).toBeDisabled();
  });

  it('sends a trimmed health URL as an optional top-level property', async () => {
    const user = userEvent.setup();
    render(<JarDeploymentPage />);
    await selectExistingJar(user);
    await user.type(screen.getByLabelText('Port number (required)'), '8087');
    await waitForAvailablePort();
    await user.type(screen.getByLabelText('Health URL (optional)'), '  https://orders.example/actuator/health  ');
    expect(screen.getByLabelText('Include frontend')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }));

    await waitFor(() =>
      expect(api.deployJar).toHaveBeenCalledWith({
        applicationName: 'Orders',
        catalogueJarId: 'orders',
        sourcePath: 'tech/orders.jar',
        port: 8087,
        healthUrl: 'https://orders.example/actuator/health',
        frontend: { mode: 'NONE' },
      }),
    );
  });

  it('shows a non-executable JAR ApiError without opening an operation', async () => {
    api.deployJar.mockRejectedValueOnce(
      Object.assign(new Error('The selected JAR does not contain an executable launcher.'), {
        status: 400,
        code: 'JAR_NOT_EXECUTABLE',
      }),
    );
    const user = userEvent.setup();
    render(<JarDeploymentPage />);
    await selectExistingJar(user);
    await user.type(screen.getByLabelText('Port number (required)'), '8087');
    await waitForAvailablePort();
    expect(screen.getByLabelText('Include frontend')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }));

    const message = await screen.findByText('The selected JAR does not contain an executable launcher.');
    expect(message.tagName).toBe('STRONG');
    expect(portal.registerOperation).not.toHaveBeenCalled();
  });

  it('shows an INVALID_HEALTH_URL ApiError without opening an operation', async () => {
    api.deployJar.mockRejectedValueOnce(
      Object.assign(new Error('Health URL must use HTTP or HTTPS and resolve to an allowed host.'), {
        status: 400,
        code: 'INVALID_HEALTH_URL',
      }),
    );
    const user = userEvent.setup();
    render(<JarDeploymentPage />);
    await selectExistingJar(user);
    await user.type(screen.getByLabelText('Port number (required)'), '8087');
    await waitForAvailablePort();
    await user.type(screen.getByLabelText('Health URL (optional)'), 'file:///etc/passwd');
    expect(screen.getByLabelText('Include frontend')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }));

    const message = await screen.findByText('Health URL must use HTTP or HTTPS and resolve to an allowed host.');
    expect(message.tagName).toBe('STRONG');
    expect(portal.registerOperation).not.toHaveBeenCalled();
  });

  it('omits optional frontend script fields when they are not supplied', async () => {
    const user = userEvent.setup();
    render(<JarDeploymentPage />);
    await selectExistingJar(user);
    await user.type(screen.getByLabelText('Port number (required)'), '8087');
    await waitForAvailablePort();
    await user.click(screen.getByLabelText('Yes, include launcher settings'));
    expect(screen.getByLabelText('Include frontend')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }));

    await waitFor(() => expect(api.deployJar).toHaveBeenCalled());
    const payload = api.deployJar.mock.calls[0][0];
    expect(payload).not.toHaveProperty('healthUrl');
    expect(payload).not.toHaveProperty('frontendProfile');
    expect(payload).not.toHaveProperty('frontendProfileName');
    expect(payload.script).toEqual({
      scriptLine: 'java -jar Orders.jar --spring.profiles.active=qc --server.port=8087',
    });
    expect(payload.frontend).toEqual({ mode: 'NONE' });
    for (const obsolete of ['profileId', 'projectName', 'requiresScript', 'deleteBackup', 'deployerName']) {
      expect(payload).not.toHaveProperty(obsolete);
    }
  });

  it('renders associated frontend details for the selected JAR', async () => {
    portal.jarProfileActivityMap = {
      orders: {
        id: 'orders',
        applicationName: 'Orders',
        frontendUrl: 'https://fallback.example/orders',
        frontendProfileUuid: 'frontend-uuid',
        frontendProfile: {
          profileUuid: 'frontend-uuid',
          profileName: 'orders-ui',
          port: 443,
          frontendUrl: 'https://orders.example',
          documentRoot: '/srv/www/orders',
          health: 'NOT_FUNCTIONAL',
          healthReason: 'DocumentRoot is missing.',
          directoryExists: false,
          running: false,
        },
      },
    };

    const user = userEvent.setup();
    render(<JarDeploymentPage />);
    await selectExistingJar(user);

    expect(await screen.findByText('orders-ui')).toBeVisible();
    expect(screen.getByRole('link', { name: 'https://fallback.example/orders' })).toBeVisible();
    expect(screen.getByText('/srv/www/orders')).toBeVisible();
    expect(screen.getByText('Missing')).toBeVisible();
    expect(screen.getByText('NOT_FUNCTIONAL')).toBeVisible();
    expect(screen.getByText('DocumentRoot is missing.')).toBeVisible();
    expect(screen.getByText('Inactive')).toBeVisible();
    expect(portal.reconcileResourceActivity).toHaveBeenCalledWith('JAR:orders');
  });

  it('treats incomplete frontend data as no authoritative association', async () => {
    portal.jarProfileActivityMap = {
      orders: {
        id: 'orders',
        applicationName: 'Orders',
        frontendUrl: 'https://orders.example',
        frontendProfileUuid: 'missing-frontend-uuid',
        frontendProfile: { profileUuid: 'missing-frontend-uuid', profileName: 'incomplete-ui' },
      },
    };

    const user = userEvent.setup();
    render(<JarDeploymentPage />);
    await selectExistingJar(user);

    expect(
      await screen.findByText("JAR wasn't associated with frontend during deployment. Redeploy with frontend setup"),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: 'https://orders.example' })).not.toBeInTheDocument();
  });
});

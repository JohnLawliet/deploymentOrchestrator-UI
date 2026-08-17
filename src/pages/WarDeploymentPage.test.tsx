import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWarDeployStore } from '@/warDeployStore';

type TutorialProps = {
  disabled?: boolean;
  onStart?: () => void;
  onReset?: () => void;
  onStepPrepare?: (index: number) => void | Promise<void>;
};

const api = vi.hoisted(() => ({
  cancelWarPreflight: vi.fn(),
  deployWar: vi.fn(),
  downloadAdditionalConfigSample: vi.fn(),
  getProfileDatasources: vi.fn(),
  getProfiles: vi.fn(),
  getWarApplications: vi.fn(),
  isLockConflict: vi.fn(() => false),
  preflightWar: vi.fn(),
  saveBlob: vi.fn(),
}));
const portal = vi.hoisted(() => ({
  username: 'tester',
  wildflyProfileActivityMap: {},
  mergeActivity: vi.fn(),
  reconcileProfileActivity: vi.fn(() => Promise.resolve()),
  registerOperation: vi.fn(),
  findConflictingLock: vi.fn(() => null),
  lastSystemEvent: null,
  snapshotRevision: 0,
}));

vi.mock('@/lib/contractApi', () => api);
vi.mock('@/context/PortalContext', () => ({ usePortal: () => portal }));
vi.mock('@/components/FileBrowser', () => ({
  default: ({ selected, onSelectionChange }: { selected: string[]; onSelectionChange: (paths: string[]) => void }) => (
    <div>
      <span data-testid="war-browser-selection">{selected.join(', ')}</span>
      <button type="button" onClick={() => onSelectionChange(['tech/original.war'])}>
        Select original WAR
      </button>
    </div>
  ),
}));
vi.mock('@/components/PageTutorial', () => ({
  default: ({ disabled, onStart, onReset, onStepPrepare }: TutorialProps) => (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          onStart?.();
          void onStepPrepare?.(0);
        }}
      >
        Start WAR tutorial
      </button>
      {[1, 2, 3, 4, 5, 6].map((step) => (
        <button type="button" key={step} onClick={() => void onStepPrepare?.(step)}>
          Tutorial step {step + 1}
        </button>
      ))}
      <button type="button" onClick={onReset}>
        Finish WAR tutorial
      </button>
    </div>
  ),
}));

import WarDeploymentPage from './WarDeploymentPage';

const profile = {
  id: 'orders-qc',
  name: 'orders-qc',
  application: 'Orders',
  applicationVersion: 1,
  version: 'WildFly 30',
  profileDir: 'C:/wildfly/orders-qc',
  deploymentsDir: 'C:/wildfly/orders-qc/deployments',
  running: true,
  portOffset: 100,
  lastDeployedUser: null,
  status: 'ACTIVE',
  health: 'FUNCTIONAL',
  pid: 1234,
  activeOperationId: null,
  offset: 100,
  applicationPort: 8180,
  managementPort: 10090,
  deployCount: 0,
  consecutiveFailures: 0,
  failedDeployCount: 0,
  lastDeploymentOn: null,
  lastSuccessfulDeploymentOn: null,
  lastUpdatedOn: null,
  lastResult: null,
  serverLogAvailable: true,
};

describe('WarDeploymentPage tutorial', () => {
  beforeEach(() => {
    useWarDeployStore.getState().resetWarDeployment();
    api.getWarApplications.mockResolvedValue([
      { application: 'Orders', warFileName: 'orders.war', environments: ['qc'] },
      { application: 'Payments', warFileName: 'payments.war', environments: ['qc'] },
    ]);
    api.getProfiles.mockResolvedValue([profile]);
    api.getProfileDatasources.mockResolvedValue({
      name: 'OrdersDatasource',
      jndiName: 'java:/jdbc/orders',
      connectionUrl: 'jdbc:postgresql://qc-db/orders',
      username: 'orders_user',
      password: 'orders_password',
    });
    api.preflightWar.mockReset();
    api.cancelWarPreflight.mockReset();
    api.deployWar.mockReset();
    portal.findConflictingLock.mockClear();
  });

  afterEach(() => cleanup());

  it('demonstrates all WAR steps without mutating or submitting the user form', async () => {
    const user = userEvent.setup();
    render(<WarDeploymentPage />);
    const datasourceInputs = () =>
      within(document.querySelector('[data-tour="war-datasource"]')!).getAllByRole('textbox') as HTMLInputElement[];
    const sourceConfigCheckbox = () => within(document.querySelector('[data-tour="war-source-config"]')!).getByRole('checkbox');
    const preflightCheckbox = () => within(document.querySelector('[data-tour="war-preflight-toggle"]')!).getByRole('checkbox');

    await waitFor(() => expect(datasourceInputs()[1]).toHaveValue('java:/jdbc/orders'));
    expect(screen.getByText('Download sample file')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Select original WAR' }));
    expect(screen.getByTestId('war-browser-selection')).toHaveTextContent('tech/original.war');

    const tutorialControl = (name: string) => screen.getByRole('button', { name, hidden: true });
    const startTutorial = tutorialControl('Start WAR tutorial');
    await user.click(startTutorial);
    expect(startTutorial).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download sample file', hidden: true })).toBeDisabled();

    fireEvent.click(tutorialControl('Tutorial step 2'));
    expect(screen.getAllByText('orders-qc · offset 100').length).toBeGreaterThan(1);

    fireEvent.click(tutorialControl('Tutorial step 3'));
    expect(datasourceInputs()[1]).toHaveValue('java:/jdbc/example');
    expect(datasourceInputs()[2]).toHaveValue('jdbc:postgresql://qc-db.example.local:5432/example');

    fireEvent.click(tutorialControl('Tutorial step 4'));
    expect(screen.getByTestId('war-browser-selection')).toHaveTextContent('tutorial/example-application.war');
    expect(sourceConfigCheckbox()).toBeChecked();

    fireEvent.click(tutorialControl('Tutorial step 5'));
    expect(preflightCheckbox()).toBeChecked();

    fireEvent.click(tutorialControl('Tutorial step 6'));
    expect(screen.getByText('Automatically resolved')).toBeVisible();
    expect(screen.getByText('Resolve duplicate: application.properties')).toBeVisible();
    expect(screen.getByText('Resolve duplicate: CustomFilter.java')).toBeVisible();

    fireEvent.click(tutorialControl('Tutorial step 7'));
    expect(screen.getByRole('button', { name: /Deploy WAR \(59\)/ })).toBeDisabled();

    expect(api.preflightWar).not.toHaveBeenCalled();
    expect(api.cancelWarPreflight).not.toHaveBeenCalled();
    expect(api.deployWar).not.toHaveBeenCalled();

    fireEvent.click(tutorialControl('Finish WAR tutorial'));
    expect(screen.getByTestId('war-browser-selection')).toHaveTextContent('tech/original.war');
    expect(datasourceInputs()[1]).toHaveValue('java:/jdbc/orders');
    expect(sourceConfigCheckbox()).not.toBeChecked();
    expect(api.preflightWar).not.toHaveBeenCalled();
    expect(api.cancelWarPreflight).not.toHaveBeenCalled();
    expect(api.deployWar).not.toHaveBeenCalled();
  });
});

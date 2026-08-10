import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseTable } from '@/types/api-contracts';

type PageQuery = {
  name: string;
  label: string;
  description: string;
  method: string;
  path: string;
  allowed?: boolean;
  destructive: boolean;
  parameters: Array<{ name: string; location: string; required: boolean }>;
};

const api = vi.hoisted(() => ({
  executeDatabaseQuery: vi.fn(),
  getDatabaseTableRows: vi.fn(),
  getDatabaseTables: vi.fn(),
  isPortalIdentityParameter: (
    parameter: Pick<DatabaseTable['queries'][number]['parameters'][number], 'name'> | null | undefined,
  ) => {
    const name = String(parameter?.name || '').toLowerCase();
    return name === 'x-techdrive-username' || name === 'username';
  },
}));

vi.mock('@/lib/contractApi', () => api);
vi.mock('@/context/PortalContext', () => ({
  usePortal: () => ({ username: 'admin-user' }),
}));

import TablesPage from './TablesPage';

const basePage = {
  items: [{ id: 1, status: 'READY' }],
  page: 0,
  size: 50,
  total: 120,
};

function descriptorWith(queries: PageQuery[]) {
  return {
    name: 'deployment-records',
    label: 'Deployment Records',
    description: 'Deployment records',
    idField: 'id',
    permissions: { read: true, delete: true, truncate: true },
    columns: [
      { key: 'id', label: 'ID', type: 'number' },
      { key: 'status', label: 'Status' },
    ],
    queries,
  };
}

const truncateQuery = {
  name: 'truncate',
  label: 'Truncate table',
  description: 'Delete every deployment row.',
  method: 'DELETE',
  path: '/api/database/tables/deployment-records/truncate',
  allowed: true,
  destructive: true,
  parameters: [{ name: 'X-TechDrive-Username', location: 'HEADER', required: true }],
};

const deleteDeploymentQuery = {
  name: 'delete',
  label: 'Delete deployment',
  description: 'Delete one deployment.',
  method: 'DELETE',
  path: '/api/database/tables/deployment-records/{deploymentId}',
  allowed: true,
  destructive: true,
  parameters: [
    { name: 'username', location: 'QUERY', required: true },
    { name: 'deploymentId', location: 'PATH', required: true },
  ],
};

const detailQuery = {
  name: 'detail',
  label: 'Deployment detail',
  description: 'View deployment detail.',
  method: 'GET',
  path: '/api/database/tables/deployment-records/{deploymentId}',
  allowed: true,
  destructive: false,
  parameters: [
    { name: 'username', location: 'query', required: true },
    { name: 'deploymentId', location: 'path', required: true },
  ],
};

const latestProfileDescriptor = {
  name: 'latest-profile-deployments',
  label: 'Latest Profile Deployments',
  description: 'Latest deployment result for each WildFly profile',
  idField: 'profileUuid',
  permissions: { read: true },
  columns: [
    { key: 'profileUuid', label: 'Profile UUID' },
    { key: 'deploymentId', label: 'Deployment ID' },
    { key: 'type', label: 'Type' },
    { key: 'application', label: 'Application' },
    { key: 'username', label: 'Deployed By' },
    { key: 'status', label: 'Status' },
    { key: 'started', label: 'Started', type: 'datetime' },
    { key: 'finished', label: 'Finished', type: 'datetime' },
    { key: 'failureCause', label: 'Failure Cause' },
    { key: 'rollbackResult', label: 'Rollback Result' },
  ],
  queries: [],
};

const deploymentRecordsDescriptor = {
  ...descriptorWith([detailQuery]),
  idField: 'deploymentId',
  columns: [
    { key: 'deploymentId', label: 'Deployment ID' },
    { key: 'type', label: 'Type' },
    { key: 'sourcePath', label: 'Source Path' },
    { key: 'status', label: 'Status' },
    { key: 'failureCause', label: 'Failure Cause' },
  ],
};

const latestProfilePage = {
  items: [
    {
      profileUuid: 'profile-1',
      deploymentId: 'deployment-42',
      type: 'QC_WAR',
      application: 'payments',
      username: 'admin-user',
      status: 'COMPLETED',
      started: '2026-07-26T12:00:00Z',
      finished: '2026-07-26T12:01:00Z',
      failureCause: null,
      rollbackResult: null,
      operationId: 'legacy-operation',
      deploymentType: 'LEGACY_TYPE',
      failureReason: 'legacy failure',
      deployCount: 99,
      consecutiveFailures: 8,
    },
  ],
  page: 0,
  size: 50,
  total: 1,
};

async function renderPage(queries: PageQuery[] = [truncateQuery]) {
  api.getDatabaseTables.mockResolvedValue([descriptorWith(queries)]);
  const user = userEvent.setup();
  render(<TablesPage />);
  await screen.findByText('READY');
  return user;
}

async function openQuery(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByText(/Available Queries/));
  await user.click(screen.getByText(label));
}

describe('TablesPage metadata-driven queries', () => {
  beforeEach(() => {
    api.executeDatabaseQuery.mockReset();
    api.getDatabaseTableRows.mockReset();
    api.getDatabaseTables.mockReset();
    api.getDatabaseTableRows.mockResolvedValue(basePage);
    api.executeDatabaseQuery.mockResolvedValue({ success: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders an allowed destructive descriptor through the generic query catalogue', async () => {
    const user = await renderPage();
    await openQuery(user, 'Truncate table');

    expect(screen.getByText('Delete every deployment row.')).toBeVisible();
    expect(screen.queryByLabelText(/^X-TechDrive-Username/i)).not.toBeInTheDocument();
  });

  it('hides descriptors explicitly disallowed by metadata', async () => {
    await renderPage([{ ...truncateQuery, allowed: false }, detailQuery]);

    expect(screen.queryByText('Truncate table')).not.toBeInTheDocument();
    expect(screen.getByText(/Available Queries/)).toHaveTextContent('(1)');
  });

  it('hides descriptors whose metadata does not explicitly allow execution', async () => {
    const { allowed: _allowed, ...queryWithoutAllowed } = truncateQuery;
    await renderPage([queryWithoutAllowed, detailQuery]);

    expect(screen.queryByText('Truncate table')).not.toBeInTheDocument();
    expect(screen.getByText(/Available Queries/)).toHaveTextContent('(1)');
  });

  it('uses query allowed as the authority for delete and truncate actions', async () => {
    api.getDatabaseTables.mockResolvedValue([
      {
        ...descriptorWith([deleteDeploymentQuery, truncateQuery, detailQuery]),
        permissions: { read: true },
      },
    ]);
    render(<TablesPage />);

    await screen.findByText('READY');
    expect(screen.getByText('Delete deployment')).toBeInTheDocument();
    expect(screen.getByText('Truncate table')).toBeInTheDocument();
    expect(screen.getByText(/Available Queries/)).toHaveTextContent('(3)');
  });

  it('confirms with the descriptor label and selected table, then executes metadata parameters', async () => {
    const user = await renderPage();
    await openQuery(user, 'Truncate table');

    await user.click(screen.getByRole('button', { name: 'Execute' }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/"Truncate table".*"deployment-records"/));
    expect(api.executeDatabaseQuery).toHaveBeenCalledWith(truncateQuery, {}, expect.any(AbortSignal));
  });

  it('prevents duplicate mutation submissions while the first request is pending', async () => {
    api.executeDatabaseQuery.mockImplementation(() => new Promise(() => {}));
    const user = await renderPage();
    await openQuery(user, 'Truncate table');

    await user.dblClick(screen.getByRole('button', { name: 'Execute' }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(api.executeDatabaseQuery).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Executing…' })).toBeDisabled();
  });

  it('shows query API errors without refreshing the table', async () => {
    api.executeDatabaseQuery.mockRejectedValue(new Error('Database operation was rejected'));
    const user = await renderPage();
    const readsBeforeMutation = api.getDatabaseTableRows.mock.calls.length;
    await openQuery(user, 'Truncate table');

    await user.click(screen.getByRole('button', { name: 'Execute' }));

    expect(await screen.findByText('Database operation was rejected')).toBeVisible();
    expect(api.getDatabaseTableRows).toHaveBeenCalledTimes(readsBeforeMutation);
  });

  it('resets pagination and refreshes the selected table after any successful mutation', async () => {
    api.getDatabaseTableRows.mockImplementation((_table: string, page: number, size: number) =>
      Promise.resolve({
        ...basePage,
        page,
        size,
        items: [{ id: page * size + 1, status: page === 0 ? 'READY' : 'OLDER' }],
      }),
    );
    const user = await renderPage();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('OLDER');
    await openQuery(user, 'Truncate table');
    await user.click(screen.getByRole('button', { name: 'Execute' }));

    expect(await screen.findByText('Truncate table completed successfully.')).toBeVisible();
    await waitFor(() => {
      expect(api.getDatabaseTableRows).toHaveBeenLastCalledWith('deployment-records', 0, 50, expect.any(AbortSignal));
    });
  });

  it('preserves single-deployment deletion through the same generic mutation flow', async () => {
    const user = await renderPage([deleteDeploymentQuery]);
    await openQuery(user, 'Delete deployment');
    await user.type(screen.getByLabelText(/^deploymentId/i), '42');

    await user.click(screen.getByRole('button', { name: 'Execute' }));

    expect(api.executeDatabaseQuery).toHaveBeenCalledWith(deleteDeploymentQuery, { deploymentId: '42' }, expect.any(AbortSignal));
    expect(await screen.findByText('Delete deployment completed successfully.')).toBeVisible();
  });

  it('preserves read-only detail query result rendering', async () => {
    api.executeDatabaseQuery.mockResolvedValue({ deploymentId: 42, status: 'COMPLETE' });
    const user = await renderPage([detailQuery]);
    await openQuery(user, 'Deployment detail');
    await user.type(screen.getByLabelText(/^deploymentId/i), '42');

    await user.click(screen.getByRole('button', { name: 'Execute' }));

    expect(await screen.findByText('COMPLETE')).toBeVisible();
    expect(screen.getByText('Query results: Deployment detail')).toBeVisible();
  });

  it('renders a full-width, wrapping table selector and loads the selected table', async () => {
    const longLabelDescriptor = {
      ...deploymentRecordsDescriptor,
      name: 'deployment-history',
      label: 'Deployment History Archive',
    };
    api.getDatabaseTables.mockResolvedValue([latestProfileDescriptor, longLabelDescriptor]);
    api.getDatabaseTableRows.mockImplementation((table: string) =>
      Promise.resolve(table === 'latest-profile-deployments' ? latestProfilePage : basePage),
    );
    const user = userEvent.setup();
    render(<TablesPage />);

    const layout = await screen.findByTestId('tables-page-layout');
    const selector = screen.getByTestId('tables-selector');
    const historyButton = screen.getByRole('button', { name: 'Deployment History Archive' });

    expect(layout).toHaveClass('space-y-4');
    expect(selector).toHaveClass('flex', 'flex-wrap');
    expect(historyButton).toHaveClass('min-w-40');
    expect(historyButton.querySelector('span')).toHaveClass('break-words');

    await user.click(historyButton);

    await waitFor(() => {
      expect(api.getDatabaseTableRows).toHaveBeenLastCalledWith('deployment-history', 0, 50, expect.any(AbortSignal));
    });
    expect(screen.getByText('Deployment History Archive', { selector: 'h3' })).toBeVisible();
  });

  it('uses the revised latest-profile fields and opens the linked deployment detail', async () => {
    api.getDatabaseTables.mockResolvedValue([latestProfileDescriptor, deploymentRecordsDescriptor]);
    api.getDatabaseTableRows.mockImplementation((table: string) =>
      Promise.resolve(table === 'latest-profile-deployments' ? latestProfilePage : basePage),
    );
    api.executeDatabaseQuery.mockResolvedValue({
      deploymentId: 'deployment-42',
      type: 'QC_WAR',
      sourcePath: 'T:\\tech_drive\\payments\\payments-original.war',
      status: 'COMPLETED',
      failureCause: null,
    });
    const user = userEvent.setup();
    render(<TablesPage />);

    await user.click(await screen.findByRole('button', { name: 'deployment-42' }));

    expect(api.executeDatabaseQuery).toHaveBeenCalledWith(
      detailQuery,
      { deploymentId: 'deployment-42' },
      expect.any(AbortSignal),
    );
    expect(await screen.findByText('Query results: Deployment detail')).toBeVisible();
    expect(screen.getByText('T:\\tech_drive\\payments\\payments-original.war')).toBeVisible();
    expect(screen.queryByText('legacy-operation')).not.toBeInTheDocument();
    expect(screen.queryByText('LEGACY_TYPE')).not.toBeInTheDocument();
    expect(screen.queryByText('legacy failure')).not.toBeInTheDocument();
    expect(screen.queryByText('99')).not.toBeInTheDocument();
  });

  it('keeps deploymentId as a normal cell when deployment detail is unavailable', async () => {
    api.getDatabaseTables.mockResolvedValue([latestProfileDescriptor, { ...deploymentRecordsDescriptor, queries: [] }]);
    api.getDatabaseTableRows.mockResolvedValue(latestProfilePage);
    render(<TablesPage />);

    expect(await screen.findByTitle('deployment-42')).toBeVisible();
    expect(screen.queryByTitle('View deployment deployment-42')).not.toBeInTheDocument();
  });
});

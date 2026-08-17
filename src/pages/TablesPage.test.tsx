import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const FETCH_PAGE_SIZE = 200;

const api = vi.hoisted(() => {
  const getDatabaseTableRows = vi.fn();
  return {
    executeDatabaseQuery: vi.fn(),
    getDatabaseTableRows,
    getDatabaseTables: vi.fn(),
    DATABASE_TABLE_FETCH_PAGE_SIZE: 200,
    getAllDatabaseTableRows: vi.fn(async (table: string, signal?: AbortSignal) => {
      const items: Array<Record<string, unknown>> = [];
      let page = 0;
      let total = 0;
      while (true) {
        const response = await getDatabaseTableRows(table, page, 200, signal);
        const batch = Array.isArray(response.items) ? response.items : [];
        total = Number.isInteger(response.total) && response.total >= 0 ? response.total : items.length + batch.length;
        items.push(...batch);
        if (batch.length < 200 || items.length >= total) break;
        page += 1;
      }
      return { items, total: Math.max(total, items.length) };
    }),
    isPortalIdentityParameter: (
      parameter: Pick<DatabaseTable['queries'][number]['parameters'][number], 'name'> | null | undefined,
    ) => {
      const name = String(parameter?.name || '').toLowerCase();
      return name === 'x-techdrive-username' || name === 'username';
    },
  };
});

vi.mock('@/lib/contractApi', () => api);
vi.mock('@/context/PortalContext', () => ({
  usePortal: () => ({ username: 'admin-user' }),
}));

import TablesPage from './TablesPage';

const basePage = {
  items: [{ id: 1, status: 'READY' }],
  page: 0,
  size: FETCH_PAGE_SIZE,
  total: 1,
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
      { key: 'username', label: 'Deployed By' },
      { key: 'application', label: 'Application' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'profile', label: 'Profile' },
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
    { key: 'username', label: 'Deployed By' },
    { key: 'application', label: 'Application' },
    { key: 'sourcePath', label: 'Source Path' },
    { key: 'status', label: 'Status' },
    { key: 'profile', label: 'Profile' },
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
  size: FETCH_PAGE_SIZE,
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
    api.getAllDatabaseTableRows.mockClear();
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

  it('paginates client-side and refreshes the selected table after any successful mutation', async () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      status: index === 0 ? 'READY' : `ROW-${index + 1}`,
    }));
    api.getDatabaseTableRows.mockImplementation((_table: string, page: number, size: number) =>
      Promise.resolve({
        items: rows.slice(page * size, page * size + size),
        page,
        size,
        total: rows.length,
      }),
    );
    const user = await renderPage();

    expect(screen.getByText('READY')).toBeVisible();
    expect(screen.queryByText('ROW-14')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('ROW-14')).toBeVisible();
    expect(screen.queryByText('READY')).not.toBeInTheDocument();

    const readsBeforeMutation = api.getDatabaseTableRows.mock.calls.length;
    await openQuery(user, 'Truncate table');
    await user.click(screen.getByRole('button', { name: 'Execute' }));

    expect(await screen.findByText('Truncate table completed successfully.')).toBeVisible();
    await waitFor(() => {
      expect(api.getDatabaseTableRows.mock.calls.length).toBeGreaterThan(readsBeforeMutation);
      expect(api.getDatabaseTableRows).toHaveBeenLastCalledWith(
        'deployment-records',
        0,
        FETCH_PAGE_SIZE,
        expect.any(AbortSignal),
      );
    });
    expect(await screen.findByText('READY')).toBeVisible();
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
      expect(api.getDatabaseTableRows).toHaveBeenLastCalledWith(
        'deployment-history',
        0,
        FETCH_PAGE_SIZE,
        expect.any(AbortSignal),
      );
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

  it('prefetches every backend page so later rows are available for client filtering', async () => {
    const firstPage = Array.from({ length: FETCH_PAGE_SIZE }, (_, index) => ({
      id: index + 1,
      status: 'READY',
      username: 'alice',
      application: 'payments',
      type: 'QC_WAR',
      profile: 'profile-a',
    }));
    const secondPage = [
      {
        id: FETCH_PAGE_SIZE + 1,
        status: 'FAILED',
        username: 'bob',
        application: 'billing',
        type: 'QC_JAR',
        profile: 'profile-b',
      },
    ];
    api.getDatabaseTables.mockResolvedValue([descriptorWith([truncateQuery])]);
    api.getDatabaseTableRows.mockImplementation((_table: string, page: number) => {
      if (page === 0) {
        return Promise.resolve({ items: firstPage, page: 0, size: FETCH_PAGE_SIZE, total: FETCH_PAGE_SIZE + 1 });
      }
      return Promise.resolve({ items: secondPage, page: 1, size: FETCH_PAGE_SIZE, total: FETCH_PAGE_SIZE + 1 });
    });
    const user = userEvent.setup();
    render(<TablesPage />);

    await waitFor(() => {
      expect(api.getDatabaseTableRows).toHaveBeenCalledWith('deployment-records', 1, FETCH_PAGE_SIZE, expect.any(AbortSignal));
    });
    expect(await screen.findByText('1–13 of 201')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.change(await screen.findByLabelText('Filter by Status'), { target: { value: 'FAILED' } });
    await user.keyboard('{Escape}');

    expect(await screen.findByTitle('bob')).toBeVisible();
    expect(screen.queryByTitle('alice')).not.toBeInTheDocument();
    expect(screen.getByText('1–1 of 1')).toBeVisible();
  });

  it('filters deployment-records client-side and clears filters', async () => {
    api.getDatabaseTables.mockResolvedValue([descriptorWith([truncateQuery])]);
    api.getDatabaseTableRows.mockResolvedValue({
      items: [
        {
          id: 1,
          status: 'READY',
          username: 'alice',
          application: 'payments',
          type: 'QC_WAR',
          profile: 'profile-a',
        },
        {
          id: 2,
          status: 'FAILED',
          username: 'bob',
          application: 'billing',
          type: 'QC_JAR',
          profile: 'profile-b',
        },
      ],
      page: 0,
      size: FETCH_PAGE_SIZE,
      total: 2,
    });
    const user = userEvent.setup();
    render(<TablesPage />);

    expect(await screen.findByTitle('payments')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.change(await screen.findByLabelText('Filter by Deployed By'), { target: { value: 'bob' } });
    await user.keyboard('{Escape}');

    expect(await screen.findByTitle('billing')).toBeVisible();
    expect(screen.queryByTitle('payments')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters (1 active)' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Filters (1 active)' }));
    await user.click(await screen.findByRole('button', { name: 'Clear all' }));
    await user.keyboard('{Escape}');

    expect(await screen.findByTitle('payments')).toBeVisible();
    expect(screen.getByTitle('bob')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeVisible();
  });

  it('hides Filters for tables without a filter configuration', async () => {
    api.getDatabaseTables.mockResolvedValue([latestProfileDescriptor]);
    api.getDatabaseTableRows.mockResolvedValue(latestProfilePage);
    render(<TablesPage />);

    expect(await screen.findByText('deployment-42')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument();
  });
});

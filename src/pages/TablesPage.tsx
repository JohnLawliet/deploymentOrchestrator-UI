import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Database, Loader2, Lock, RefreshCw } from 'lucide-react';
import { executeDatabaseQuery, getDatabaseTableRows, getDatabaseTables, isPortalIdentityParameter } from '@/lib/contractApi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice, Page } from '@/components/PagePrimitives';
import type { ApiRequestError } from '@/lib/contractApi';
import type { DatabasePage, DatabaseRow, DatabaseTable } from '@/types/api-contracts';
type DatabaseQuery = DatabaseTable['queries'][number];
type DatabaseQueryValue = string | number | boolean | null | undefined;

type TablePage = DatabasePage<DatabaseRow> & { paginated: boolean };
type QueryRequestState = { key: string; loading: boolean; error: Error | ApiRequestError | null; success: string };
type ActiveQuery = { query: DatabaseQuery; key: string; params: Record<string, DatabaseQueryValue>; result: TablePage };
type LinkedRow = { tableName: string; query: DatabaseQuery; queryKey: string; values: Record<string, DatabaseQueryValue> };
class ValidationError extends Error {
  readonly isValidationError = true;
}

const FALLBACK_PAGE = 0;
const FALLBACK_SIZE = 50;
const MAXIMUM_SIZE = 200;

function validationError(message: string): ValidationError {
  return new ValidationError(message);
}

function validateMetadata(payload: DatabaseTable[]): DatabaseTable[] {
  if (!Array.isArray(payload)) throw validationError('The table metadata response must be an array.');
  const names = new Set();
  return payload.map((descriptor, index) => {
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
      throw validationError(`Table descriptor ${index + 1} is invalid.`);
    }
    if (typeof descriptor.name !== 'string' || !descriptor.name.trim()) {
      throw validationError(`Table descriptor ${index + 1} is missing a name.`);
    }
    if (names.has(descriptor.name)) throw validationError(`Table metadata contains duplicate name "${descriptor.name}".`);
    names.add(descriptor.name);
    if (!Array.isArray(descriptor.columns) || descriptor.columns.length === 0) {
      throw validationError(`Table "${descriptor.name}" does not define any columns.`);
    }
    const keys = new Set();
    descriptor.columns.forEach((column, columnIndex) => {
      if (!column || typeof column !== 'object' || typeof column.key !== 'string' || !column.key.trim()) {
        throw validationError(`Column ${columnIndex + 1} for table "${descriptor.name}" is missing a key.`);
      }
      if (keys.has(column.key))
        throw validationError(`Table "${descriptor.name}" contains duplicate column key "${column.key}".`);
      keys.add(column.key);
    });
    if (descriptor.queries !== undefined && !Array.isArray(descriptor.queries)) {
      throw validationError(`Queries for table "${descriptor.name}" must be an array.`);
    }
    (descriptor.queries || []).forEach((query, queryIndex) => {
      if (!query || typeof query !== 'object' || typeof query.method !== 'string' || typeof query.path !== 'string') {
        throw validationError(`Query ${queryIndex + 1} for table "${descriptor.name}" is invalid.`);
      }
      if (query.parameters !== undefined && !Array.isArray(query.parameters)) {
        throw validationError(`Parameters for query "${query.name || queryIndex + 1}" must be an array.`);
      }
      (query.parameters || []).forEach((parameter, parameterIndex) => {
        if (!parameter || typeof parameter.name !== 'string' || !parameter.name.trim()) {
          throw validationError(`Parameter ${parameterIndex + 1} for query "${query.name || queryIndex + 1}" is missing a name.`);
        }
      });
    });
    return {
      ...descriptor,
      label: descriptor.label || descriptor.name,
      description: descriptor.description || '',
      permissions: descriptor.permissions || {},
      queries: descriptor.queries || [],
    };
  });
}

function validatePage(payload: DatabasePage<DatabaseRow>): TablePage {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw validationError('The table page response is invalid.');
  }
  if (!Array.isArray(payload.items)) throw validationError('The table page response must contain an items array.');
  if (!Number.isInteger(payload.page) || payload.page < 0)
    throw validationError('The table page response has an invalid page value.');
  if (!Number.isInteger(payload.size) || payload.size < 0)
    throw validationError('The table page response has an invalid size value.');
  if (!Number.isInteger(payload.total) || payload.total < 0)
    throw validationError('The table page response has an invalid total value.');
  if (payload.size < 1 || payload.size > MAXIMUM_SIZE) {
    throw validationError(`The table page size must be between 1 and ${MAXIMUM_SIZE}.`);
  }
  return { ...payload, paginated: true };
}
function isDatabasePage(value: DatabaseRow | DatabasePage<DatabaseRow>): value is DatabasePage<DatabaseRow> {
  return (
    'items' in value &&
    Array.isArray(value.items) &&
    typeof value.page === 'number' &&
    typeof value.size === 'number' &&
    typeof value.total === 'number'
  );
}

function normalizeQueryResult(payload: DatabaseRow | DatabaseRow[] | DatabasePage<DatabaseRow> | void): TablePage {
  if (payload === null || payload === undefined) {
    return { items: [], page: 0, size: 1, total: 0, paginated: false };
  }
  if (Array.isArray(payload)) {
    return { items: payload, page: 0, size: Math.max(payload.length, 1), total: payload.length, paginated: false };
  }
  if (typeof payload !== 'object') throw validationError('The query response must be a page, array, object, or empty response.');
  if (isDatabasePage(payload)) return validatePage(payload);
  return { items: [payload], page: 0, size: 1, total: 1, paginated: false };
}

const integerValue = (value: string | number | null | undefined): number | null => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(numeric) ? numeric : null;
};
function pagingConfig(descriptor: DatabaseTable | null | undefined): { page: number; size: number; maximum: number } {
  const listQuery = descriptor?.queries?.find((query) => query?.name === 'list');
  const parameters = Array.isArray(listQuery?.parameters) ? listQuery.parameters : [];
  const pageParameter = parameters.find((parameter) => parameter?.name === 'page');
  const sizeParameter = parameters.find((parameter) => parameter?.name === 'size');
  const maximumValue = integerValue(sizeParameter?.maximum);
  const maximum = maximumValue !== null && maximumValue > 0 ? Math.min(maximumValue, MAXIMUM_SIZE) : MAXIMUM_SIZE;
  const requestedSizeValue = integerValue(sizeParameter?.defaultValue);
  const requestedSize = requestedSizeValue !== null && requestedSizeValue > 0 ? requestedSizeValue : FALLBACK_SIZE;
  const pageValue = integerValue(pageParameter?.defaultValue);
  return {
    page: pageValue !== null && pageValue >= 0 ? pageValue : FALLBACK_PAGE,
    size: Math.min(requestedSize, maximum),
    maximum,
  };
}

function queryPermissionAllowed(query: DatabaseQuery): boolean {
  return query?.allowed === true;
}

function errorKind(error: Error | ApiRequestError | null): 'validation' | 'forbidden' | 'general' {
  const status = error && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  if (error instanceof ValidationError || status === 400 || status === 422) return 'validation';
  if (status === 403) return 'forbidden';
  return 'general';
}

function safeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatValue(column: DatabaseTable['columns'][number], value: unknown): string {
  if (value === null || value === undefined) return '—';
  const type = String(column.type || 'string').toLowerCase();
  if (type === 'number') {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : safeText(value);
  }
  if (type === 'boolean') {
    if (value === true || value === 'true') return 'Yes';
    if (value === false || value === 'false') return 'No';
    return safeText(value);
  }
  if (type === 'date' || type === 'datetime') {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return safeText(value);
    return new Intl.DateTimeFormat(
      undefined,
      type === 'date' ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'medium' },
    ).format(date);
  }
  if (type === 'json') {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return JSON.stringify(parsed);
    } catch {
      return safeText(value);
    }
  }
  return safeText(value);
}

function StateNotice({
  error,
  onRetry,
  title: titleOverride,
}: {
  error: Error | ApiRequestError | null;
  onRetry?: () => void;
  title?: string;
}) {
  const kind = errorKind(error);
  const title =
    titleOverride ||
    (kind === 'forbidden'
      ? 'Access denied'
      : kind === 'validation'
        ? 'The backend response could not be used'
        : 'Unable to load table data');
  return (
    <Notice tone={kind === 'forbidden' ? 'warning' : 'error'}>
      <div>
        <strong>{title}</strong>
        <p className="mt-1">{error?.message || 'The request could not be completed.'}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={onRetry}>
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </Button>
        )}
      </div>
    </Notice>
  );
}

function parameterIsNumeric(parameter: DatabaseQuery['parameters'][number]): boolean {
  return (
    parameter?.name === 'page' ||
    parameter?.name === 'size' ||
    typeof parameter?.defaultValue === 'number' ||
    typeof parameter?.maximum === 'number'
  );
}

function parameterIsPath(parameter: DatabaseQuery['parameters'][number]): boolean {
  return String(parameter?.location || '').toLowerCase() === 'path';
}

function queryParameters(query: DatabaseQuery): DatabaseQuery['parameters'] {
  return (Array.isArray(query?.parameters) ? query.parameters : []).filter((parameter) => !isPortalIdentityParameter(parameter));
}

function initialQueryValues(query: DatabaseQuery): Record<string, DatabaseQueryValue> {
  return Object.fromEntries(queryParameters(query).map((parameter) => [parameter.name, parameter.defaultValue ?? '']));
}

function QueryAccordion({
  query,
  queryKey,
  activeValues,
  requestState,
  onExecute,
}: {
  query: DatabaseQuery;
  queryKey: string;
  activeValues: Record<string, DatabaseQueryValue> | null;
  requestState: QueryRequestState;
  onExecute: (query: DatabaseQuery, key: string, values: Record<string, DatabaseQueryValue>) => void;
}) {
  const parameters = useMemo(() => queryParameters(query), [query]);
  const [values, setValues] = useState<Record<string, DatabaseQueryValue>>(() => initialQueryValues(query));
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues((current) =>
      Object.fromEntries(
        parameters.map((parameter) => [parameter.name, current[parameter.name] ?? parameter.defaultValue ?? '']),
      ),
    );
  }, [parameters]);

  useEffect(() => {
    if (activeValues) setValues(activeValues);
  }, [activeValues]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    const prepared: Record<string, DatabaseQueryValue> = {};
    parameters.forEach((parameter) => {
      const value = values[parameter.name];
      const empty = value === '' || value === null || value === undefined;
      if ((parameter.required || parameterIsPath(parameter)) && empty) {
        nextErrors[parameter.name] = 'This parameter is required.';
        return;
      }
      if (empty) {
        prepared[parameter.name] = '';
        return;
      }
      if (parameterIsNumeric(parameter)) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          nextErrors[parameter.name] = 'Enter a valid number.';
          return;
        }
        if (parameter.maximum !== undefined && numeric > Number(parameter.maximum)) {
          nextErrors[parameter.name] = `Maximum value is ${parameter.maximum}.`;
          return;
        }
        prepared[parameter.name] = numeric;
      } else {
        prepared[parameter.name] = value;
      }
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onExecute(query, queryKey, prepared);
  };

  const executing = requestState.loading && requestState.key === queryKey;
  const requestError = requestState.key === queryKey ? requestState.error : null;
  const requestSuccess = requestState.key === queryKey ? requestState.success : '';
  return (
    <details className="group/query rounded-md border border-border bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <Badge variant="outline">{query.method || 'GET'}</Badge>
          <strong className="truncate text-sm">{query.label || query.name || 'Unnamed query'}</strong>
        </span>
        <span className="flex min-w-0 items-center justify-end gap-2">
          <code className="hidden truncate text-right text-xs text-primary sm:block">
            {query.path || 'No endpoint template supplied'}
          </code>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/query:rotate-180" />
        </span>
      </summary>
      <form className="space-y-4 border-t border-border p-3" noValidate onSubmit={submit}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {query.description && <p className="text-sm text-muted-foreground">{query.description}</p>}
            <code className="mt-1 block break-all text-xs text-primary sm:hidden">
              {query.path || 'No endpoint template supplied'}
            </code>
          </div>
          <Button type="submit" className="shrink-0 gap-2" disabled={requestState.loading}>
            {executing && <Loader2 className="h-4 w-4 animate-spin" />}
            {executing ? 'Executing…' : 'Execute'}
          </Button>
        </div>
        {/* {query.destructive && (
          <Notice tone="warning">
            <div>
              <strong>Irreversible action</strong>
              <p className="mt-1">This operation permanently deletes data and cannot be undone.</p>
            </div>
          </Notice>
        )} */}
        {parameters.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {parameters.map((parameter, index) => {
              const numeric = parameterIsNumeric(parameter);
              const inputId = `query-${queryKey}-${parameter.name}-${index}`;
              return (
                <label
                  className="block min-w-0 space-y-1.5"
                  htmlFor={inputId}
                  key={`${parameter.name}-${parameter.location}-${index}`}
                >
                  <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                    {parameter.name || 'Unnamed parameter'}
                    {(parameter.required || parameterIsPath(parameter)) && <span className="text-amber-700">Required</span>}
                    <span className="font-normal text-muted-foreground">({parameter.location || 'query'})</span>
                  </span>
                  <input
                    id={inputId}
                    className={`form-control ${errors[parameter.name] ? 'form-control-error' : ''}`}
                    type={numeric ? 'number' : 'text'}
                    value={String(values[parameter.name] ?? '')}
                    max={numeric && parameter.maximum !== null ? (integerValue(parameter.maximum) ?? undefined) : undefined}
                    required={parameter.required || parameterIsPath(parameter)}
                    onChange={(event) => {
                      setValues((current) => ({ ...current, [parameter.name]: event.target.value }));
                      setErrors((current) => ({ ...current, [parameter.name]: '' }));
                    }}
                  />
                  {errors[parameter.name] && (
                    <span className="field-error block" role="alert">
                      {errors[parameter.name]}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
        {requestError && <StateNotice error={requestError} />}
        {requestSuccess && <Notice tone="success">{requestSuccess}</Notice>}
      </form>
    </details>
  );
}

function QueryCatalogue({
  queries,
  activeQuery,
  requestState,
  onExecute,
}: {
  queries: DatabaseQuery[];
  activeQuery: ActiveQuery | null;
  requestState: QueryRequestState;
  onExecute: (query: DatabaseQuery, key: string, values: Record<string, DatabaseQueryValue>) => void;
}) {
  return (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          Available Queries <span className="ml-1 text-xs font-normal text-muted-foreground">({queries.length})</span>
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-border p-4">
        {queries.length === 0 && (
          <p className="text-sm text-muted-foreground">No whitelisted operations are available for this table.</p>
        )}
        {queries.map((query, index) => {
          const queryKey = query.name || `${query.method}-${query.path}-${index}`;
          return (
            <QueryAccordion
              key={queryKey}
              query={query}
              queryKey={queryKey}
              activeValues={activeQuery?.key === queryKey ? activeQuery.params : null}
              requestState={requestState}
              onExecute={onExecute}
            />
          );
        })}
      </div>
    </details>
  );
}

export default function TablesPage() {
  const [metadata, setMetadata] = useState<DatabaseTable[] | null>(null);
  const [metadataError, setMetadataError] = useState<Error | ApiRequestError | null>(null);
  const [metadataRefresh, setMetadataRefresh] = useState(0);
  const [selectedName, setSelectedName] = useState('');
  const [page, setPage] = useState(FALLBACK_PAGE);
  const [size, setSize] = useState(FALLBACK_SIZE);
  const [tablePage, setTablePage] = useState<TablePage | null>(null);
  const [tableError, setTableError] = useState<Error | ApiRequestError | null>(null);
  const [tableRefresh, setTableRefresh] = useState(0);
  const [expandedCells, setExpandedCells] = useState<Set<string>>(() => new Set());
  const [activeQuery, setActiveQuery] = useState<ActiveQuery | null>(null);
  const [queryRequest, setQueryRequest] = useState<QueryRequestState>({ key: '', loading: false, error: null, success: '' });
  const queryControllerRef = useRef<AbortController | null>(null);
  const linkedRowRef = useRef<LinkedRow | null>(null);
  const runQueryRef = useRef<
    ((query: DatabaseQuery, key: string, values: Record<string, DatabaseQueryValue>) => Promise<void>) | null
  >(null);

  useEffect(() => {
    const controller = new AbortController();
    setMetadata(null);
    setMetadataError(null);
    getDatabaseTables(controller.signal)
      .then(validateMetadata)
      .then((descriptors) => {
        setMetadata(descriptors);
        setSelectedName((current) => {
          const selection =
            descriptors.find((item) => item.name === current && item.permissions.read === true) ||
            descriptors.find((item) => item.permissions.read === true);
          if (selection) {
            const config = pagingConfig(selection);
            setPage(config.page);
            setSize(config.size);
          }
          return selection?.name || '';
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'CanceledError'))
          setMetadataError(error instanceof Error ? error : new Error('Unable to load table metadata.'));
      });
    return () => controller.abort();
  }, [metadataRefresh]);

  const descriptor = useMemo(() => metadata?.find((item) => item.name === selectedName) || null, [metadata, selectedName]);
  const availableQueries = useMemo(() => descriptor?.queries?.filter(queryPermissionAllowed) || [], [descriptor]);
  const deploymentDetailTarget = useMemo(() => {
    const target = metadata?.find((item) => item.name === 'deployment-records' && item.permissions.read === true);
    const query = target?.queries?.find((item) => item?.name === 'detail' && queryPermissionAllowed(item));
    return target && query ? { target, query } : null;
  }, [metadata]);
  const config = useMemo(() => pagingConfig(descriptor), [descriptor]);
  const sizeOptions = useMemo(() => {
    const values = [25, FALLBACK_SIZE, 100, MAXIMUM_SIZE, config.size, config.maximum];
    return [...new Set(values.filter((value) => value > 0 && value <= config.maximum))].sort((a, b) => a - b);
  }, [config]);

  useEffect(() => {
    queryControllerRef.current?.abort();
    queryControllerRef.current = null;
    setActiveQuery(null);
    setQueryRequest({ key: '', loading: false, error: null, success: '' });
    setExpandedCells(new Set());
    const linkedRow = linkedRowRef.current;
    if (linkedRow?.tableName === selectedName) {
      linkedRowRef.current = null;
      runQueryRef.current?.(linkedRow.query, linkedRow.queryKey, linkedRow.values);
    }
  }, [selectedName]);

  useEffect(() => () => queryControllerRef.current?.abort(), []);

  useEffect(() => {
    if (!descriptor || descriptor.permissions.read !== true) {
      setTablePage(null);
      return undefined;
    }
    const controller = new AbortController();
    setTablePage(null);
    setTableError(null);
    getDatabaseTableRows(descriptor.name, page, size, controller.signal)
      .then(validatePage)
      .then(setTablePage)
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'CanceledError'))
          setTableError(error instanceof Error ? error : new Error('Unable to load table rows.'));
      });
    return () => controller.abort();
  }, [descriptor, page, size, tableRefresh]);

  const selectTable = (item: DatabaseTable) => {
    if (item.permissions.read !== true) return;
    const nextConfig = pagingConfig(item);
    setSelectedName(item.name);
    setPage(nextConfig.page);
    setSize(nextConfig.size);
  };

  const runQuery = async (query: DatabaseQuery, queryKey: string, values: Record<string, DatabaseQueryValue>): Promise<void> => {
    if (queryControllerRef.current) return;
    if (!descriptor) return;
    const queryLabel = query.label || query.name || queryKey;
    if (
      query.destructive &&
      !window.confirm(
        `Execute destructive query "${queryLabel}" for table "${descriptor.name}"? This action permanently deletes data and cannot be undone.`,
      )
    )
      return;
    const controller = new AbortController();
    queryControllerRef.current = controller;
    setQueryRequest({ key: queryKey, loading: true, error: null, success: '' });
    try {
      const response = await executeDatabaseQuery(query, values, controller.signal);
      if (queryControllerRef.current !== controller) return;
      const method = String(query.method || 'GET').toUpperCase();
      const mutating = method !== 'GET' && method !== 'HEAD';
      if (mutating) {
        setActiveQuery(null);
        setExpandedCells(new Set());
        setPage(config.page);
        setTableRefresh((current) => current + 1);
        setQueryRequest({
          key: queryKey,
          loading: false,
          error: null,
          success: `${queryLabel} completed successfully.`,
        });
        return;
      }
      const result = normalizeQueryResult(response);
      const parameters = Array.isArray(query.parameters) ? query.parameters : [];
      const resolvedValues = {
        ...values,
        ...(result.paginated && parameters.some((parameter) => parameter.name === 'page') ? { page: result.page } : {}),
        ...(result.paginated && parameters.some((parameter) => parameter.name === 'size') ? { size: result.size } : {}),
      };
      setActiveQuery({ query, key: queryKey, params: resolvedValues, result });
      setExpandedCells(new Set());
      setQueryRequest({ key: queryKey, loading: false, error: null, success: '' });
    } catch (error: unknown) {
      if (queryControllerRef.current !== controller || (error instanceof Error && error.name === 'CanceledError')) return;
      setQueryRequest({
        key: queryKey,
        loading: false,
        error: error instanceof Error ? error : new Error('Unable to execute query.'),
        success: '',
      });
    } finally {
      if (queryControllerRef.current === controller) queryControllerRef.current = null;
    }
  };
  runQueryRef.current = runQuery;

  const openDeploymentDetail = (deploymentId: DatabaseQueryValue) => {
    if (!deploymentDetailTarget) return;
    const { target, query } = deploymentDetailTarget;
    const pathParameter = (query.parameters || []).find((parameter) => parameterIsPath(parameter));
    if (!pathParameter) return;
    linkedRowRef.current = {
      tableName: target.name,
      query,
      queryKey: query.name || `${query.method}-${query.path}`,
      values: {
        ...initialQueryValues(query),
        [pathParameter.name]: deploymentId,
      },
    };
    selectTable(target);
  };

  const resetQuery = () => {
    queryControllerRef.current?.abort();
    queryControllerRef.current = null;
    setActiveQuery(null);
    setQueryRequest({ key: '', loading: false, error: null, success: '' });
    setExpandedCells(new Set());
  };

  const displayPage = activeQuery?.result || tablePage;
  const totalPages = displayPage ? Math.ceil(displayPage.total / displayPage.size) : 0;
  const rangeStart = displayPage?.total ? displayPage.page * displayPage.size + 1 : 0;
  const rangeEnd = displayPage ? Math.min((displayPage.page + 1) * displayPage.size, displayPage.total) : 0;
  const activeParameters = Array.isArray(activeQuery?.query?.parameters) ? activeQuery.query.parameters : [];
  const activePageParameter = activeParameters.find((parameter) => parameter?.name === 'page');
  const activeSizeParameter = activeParameters.find((parameter) => parameter?.name === 'size');
  const activeMaximum =
    integerValue(activeSizeParameter?.maximum) !== null
      ? Math.min(integerValue(activeSizeParameter?.maximum) ?? MAXIMUM_SIZE, MAXIMUM_SIZE)
      : MAXIMUM_SIZE;
  const displayedSize = activeQuery ? Number(activeQuery.params.size ?? displayPage?.size ?? FALLBACK_SIZE) : size;
  const displayedPage = activeQuery ? Number(activeQuery.params.page ?? displayPage?.page ?? FALLBACK_PAGE) : page;
  const displayedSizeOptions = activeQuery
    ? [...new Set([25, 50, 100, 200, displayedSize, activeMaximum].filter((value) => value > 0 && value <= activeMaximum))].sort(
        (a, b) => a - b,
      )
    : sizeOptions;

  const changeGridPage = (nextPage: number) => {
    setExpandedCells(new Set());
    if (activeQuery) runQuery(activeQuery.query, activeQuery.key, { ...activeQuery.params, page: nextPage });
    else setPage(nextPage);
  };

  const changeGridSize = (nextSize: number) => {
    setExpandedCells(new Set());
    if (activeQuery)
      runQuery(activeQuery.query, activeQuery.key, {
        ...activeQuery.params,
        size: nextSize,
        ...(activePageParameter ? { page: 0 } : {}),
      });
    else {
      setSize(nextSize);
      setPage(config.page);
    }
  };

  const toggleCell = (cellKey: string) => {
    setExpandedCells((current) => {
      const next = new Set(current);
      if (next.has(cellKey)) next.delete(cellKey);
      else next.add(cellKey);
      return next;
    });
  };

  return (
    <Page title="Tables" description="View operational H2 data through backend-approved metadata and endpoints.">
      {metadataError && <StateNotice error={metadataError} onRetry={() => setMetadataRefresh((current) => current + 1)} />}
      {!metadata && !metadataError && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading table metadata…
        </p>
      )}
      {metadata?.length === 0 && (
        <div className="empty-state">
          <Database className="mx-auto mb-3 h-7 w-7" />
          No operational tables are available.
        </div>
      )}
      {metadata && metadata.length > 0 && (
        <div className="min-w-0 space-y-4" data-testid="tables-page-layout">
          <Card className="min-w-0">
            <CardHeader className="p-3">
              <CardTitle className="text-sm">Tables</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 p-3 pt-0" data-testid="tables-selector">
              {metadata.map((item) => {
                const readable = item.permissions.read === true;
                return (
                  <button
                    type="button"
                    key={item.name}
                    disabled={!readable}
                    title={readable ? item.description : 'You do not have permission to read this table.'}
                    onClick={() => selectTable(item)}
                    className={`flex min-w-40 flex-1 items-center gap-1.5 rounded-md border px-2 py-2 text-left text-xs transition-colors ${
                      selectedName === item.name
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : readable
                          ? 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                          : 'cursor-not-allowed border-transparent text-muted-foreground/45'
                    }`}
                  >
                    {!readable && <Lock className="h-3 w-3 shrink-0" />}
                    <span className="min-w-0 break-words">{item.label}</span>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <div className="min-w-0 space-y-4">
            {!descriptor && <Notice tone="warning">No readable table is available for this user.</Notice>}
            {descriptor && (
              <>
                <Card>
                  <CardHeader className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-lg">{descriptor.label}</CardTitle>
                        <CardDescription className="mt-1">{descriptor.description || descriptor.name}</CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={!displayPage || queryRequest.loading}
                        onClick={() =>
                          activeQuery
                            ? runQuery(activeQuery.query, activeQuery.key, activeQuery.params)
                            : setTableRefresh((current) => current + 1)
                        }
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Refresh
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 p-4 pt-0">
                    {activeQuery && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/10 p-3">
                        <div>
                          <p className="text-sm font-medium">
                            Query results: {activeQuery.query.label || activeQuery.query.name || activeQuery.key}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">The grid is showing the latest query response.</p>
                        </div>
                        <Button variant="outline" size="sm" disabled={queryRequest.loading} onClick={resetQuery}>
                          Reset
                        </Button>
                      </div>
                    )}
                    {!activeQuery && tableError && (
                      <StateNotice error={tableError} onRetry={() => setTableRefresh((current) => current + 1)} />
                    )}
                    {!displayPage && !tableError && (
                      <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading {descriptor.label}…
                      </p>
                    )}
                    {displayPage && displayPage.items.length === 0 && (
                      <div className="empty-state">
                        {activeQuery ? 'The query returned no rows.' : 'This table contains no rows for the current page.'}
                      </div>
                    )}
                    {displayPage && displayPage.items.length > 0 && (
                      <div className="overflow-x-auto rounded-md border border-border">
                        <table className="w-full min-w-max border-collapse text-sm">
                          <thead className="bg-muted/55 text-left text-xs text-muted-foreground">
                            <tr>
                              {descriptor.columns.map((column) => (
                                <th className="whitespace-nowrap border-b border-border px-3 py-2.5 font-medium" key={column.key}>
                                  {column.label || column.key}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {displayPage.items.map((row, index) => {
                              const id = row?.[descriptor.idField];
                              const rowKey = id === null || id === undefined ? `${displayPage.page}-${index}` : String(id);
                              return (
                                <tr className="border-b border-border/70 last:border-0 hover:bg-muted/20" key={rowKey}>
                                  {descriptor.columns.map((column) => {
                                    const value = formatValue(column, row?.[column.key]);
                                    const cellKey = `${rowKey}:${column.key}`;
                                    const cellExpanded = expandedCells.has(cellKey);
                                    const hasValue =
                                      row?.[column.key] !== null && row?.[column.key] !== undefined && value !== '';
                                    const linksToDeployment =
                                      hasValue && deploymentDetailTarget && column.key === deploymentDetailTarget.target.idField;
                                    return (
                                      <td className="max-w-xs px-3 py-2.5 align-top" key={column.key}>
                                        {linksToDeployment ? (
                                          <button
                                            type="button"
                                            className="block w-full max-w-xs truncate rounded-sm text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                            title={`View deployment ${value}`}
                                            onClick={() => openDeploymentDetail(row[column.key])}
                                          >
                                            {value}
                                          </button>
                                        ) : hasValue ? (
                                          <button
                                            type="button"
                                            className={`block w-full max-w-xs rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                              cellExpanded ? 'whitespace-pre-wrap break-all' : 'truncate'
                                            }`}
                                            title={cellExpanded ? 'Collapse cell' : value}
                                            aria-expanded={cellExpanded}
                                            onClick={() => toggleCell(cellKey)}
                                          >
                                            {value}
                                          </button>
                                        ) : (
                                          <span>{value}</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {displayPage && (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            {rangeStart}–{rangeEnd} of {displayPage.total}
                          </span>
                          {(!activeQuery || (displayPage.paginated && activeSizeParameter)) && (
                            <label className="flex items-center gap-2">
                              Rows
                              <select
                                className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
                                value={displayedSize}
                                disabled={queryRequest.loading}
                                onChange={(event) => changeGridSize(Number(event.target.value))}
                              >
                                {displayedSizeOptions.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                        {(!activeQuery || displayPage.paginated) && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              Page {totalPages ? displayPage.page + 1 : 0} of {totalPages}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="Previous page"
                              disabled={
                                queryRequest.loading || displayedPage <= 0 || Boolean(activeQuery && !activePageParameter)
                              }
                              onClick={() => changeGridPage(displayedPage - 1)}
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="Next page"
                              disabled={
                                queryRequest.loading ||
                                totalPages === 0 ||
                                displayedPage + 1 >= totalPages ||
                                Boolean(activeQuery && !activePageParameter)
                              }
                              onClick={() => changeGridPage(displayedPage + 1)}
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
                <QueryCatalogue
                  key={descriptor.name}
                  queries={availableQueries}
                  activeQuery={activeQuery}
                  requestState={queryRequest}
                  onExecute={runQuery}
                />
              </>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}

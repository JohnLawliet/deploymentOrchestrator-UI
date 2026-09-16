import axios from 'axios';
import type { AxiosResponse } from 'axios';
import { getPortalTabId, getStoredPortalUsername } from '@/lib/portalSession';
import type {
  ActivityCheckRequest,
  AdmissionStatus,
  ApiError,
  ApiHeaders,
  ApiRoutes,
  ChangeUserPasswordRequest,
  CreateDirectoryRequest,
  CreatePortalUserRequest,
  DatabaseRow,
  DatabaseTable,
  DeploymentRecord,
  DeploymentStartResponse,
  ExtractRequest,
  ExtractResponse,
  FileMovePreflightResponse,
  FileMoveResult,
  FileNode,
  FileRoot,
  LoginRequest,
  MoveRequest,
  JarCatalogueResponse,
  JarDeploymentRequest,
  JarBatFetchResponse,
  JarPreflightCheckResponse,
  JarSnapshotSummary,
  LockInfo,
  ManagedPortalUser,
  PortStatus,
  Profile,
  ProfilePowerResponse,
  RuntimeResource,
  RenameRequest,
  SnapshotRollbackRequest,
  UatConvertRequest,
  UatOperationResponse,
  UatPreflightRequest,
  UatPreflightResponse,
  UploadRequest,
  UploadResponse,
  UpdatePortalUserRoleRequest,
  UpdateUserProfileRequest,
  UserProfile,
  WarDeploymentRequest,
  WarDeploymentStartResponse,
  WarPreflightResponse,
  WarSnapshotSummary,
  WildFlyDatasource,
} from '@/types/api-contracts';

type RouteResponse<Route extends keyof ApiRoutes> = ApiRoutes[Route]['response'];
type DatabaseQuery = DatabaseTable['queries'][number];
type DatabaseQueryValue = string | number | boolean | null | undefined;

export interface ApiRequestError extends Error {
  status?: number;
  code?: string;
  deploymentId?: string | null;
  paths: string[];
  users: string[];
  details: unknown;
}

export interface DownloadResult {
  blob: Blob;
  filename: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isApiError = (value: unknown): value is ApiError =>
  isRecord(value) && typeof value.message === 'string' && typeof value.code === 'string';

// The portal can be hosted separately from the backend.  For example, Apache
// serves the UI at `/` while proxying the backend application at `/tms`.
// Keep the API context independent of the React/Vite base path for that case.
const contextPath = (import.meta.env.VITE_BASE_PATH || '/deploymentOrchestrator').replace(/\/$/, '');
const apiContextPath = (import.meta.env.VITE_API_CONTEXT_PATH || contextPath).replace(/\/$/, '');
const backendOrigin = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');
const apiBaseUrl = `${backendOrigin}${apiContextPath}/api`;
export const BACKEND_OFFLINE_MESSAGE = 'The backend is offline. Try again when the service is available.';
export const BACKEND_OFFLINE_TOAST = 'The backend is offline.';
export const DOWNLOAD_INCOMPLETE_MESSAGE = 'Download failed or incomplete; please retry';
export const DOWNLOAD_INTERRUPTED_MESSAGE = DOWNLOAD_INCOMPLETE_MESSAGE;
export const EXTRACTION_UNCONFIRMED_MESSAGE =
  'The extraction result could not be confirmed. Refresh the directory before trying again.';

const client = axios.create({
  baseURL: apiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});
const lockConflictListeners = new Set<(error: ApiRequestError) => void>();
const backendUnavailableListeners = new Set<(error: ApiRequestError) => void>();
const sessionUnauthorizedListeners = new Set<(error: ApiRequestError) => void>();
let portalAdmissionStatus: AdmissionStatus | null = null;
export const setApiAdmissionStatus = (status: AdmissionStatus | null) => {
  portalAdmissionStatus = status;
};
export const techDriveHeaders = (username = getStoredPortalUsername()): Partial<ApiHeaders> => {
  const tabId = getPortalTabId();
  return {
    ...(username ? { 'X-TechDrive-Username': username.trim() } : {}),
    ...(tabId ? { 'X-Portal-Tab-Id': tabId } : {}),
  };
};

export function isPortalIdentityParameter(
  parameter: Pick<DatabaseQuery['parameters'][number], 'name'> | null | undefined,
): boolean {
  const name = String(parameter?.name || '').toLowerCase();
  return name === 'x-techdrive-username' || name === 'username';
}

const looksLikeHtml = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  return /<!DOCTYPE|<html[\s>]/i.test(value.trim());
};

export function isBackendUnavailable(error: unknown): boolean {
  const axiosError = axios.isAxiosError(error) ? error : undefined;
  const response = axiosError?.response;
  const status = response?.status ?? (isRecord(error) && typeof error.status === 'number' ? error.status : undefined);
  const body = response?.data ?? (isRecord(error) ? error.details : undefined);
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (isApiError(body)) return false;
  if (status === 502 || status === 503 || status === 504) return true;
  if (looksLikeHtml(body) || looksLikeHtml(message)) return true;
  if (axiosError && response == null) return true;
  if (isRecord(error) && error.request != null && error.response == null && status == null) return true;
  return false;
}

client.interceptors.request.use((config) => {
  const url = String(config.url || '');
  const allowedWhileQueued = /^\/users\/(?:login|logout)(?:$|[?])|^\/users\/me(?:$|[?])/.test(url);
  if (portalAdmissionStatus === 'QUEUED' && !allowedWhileQueued) {
    const error = new Error('Portal admission is required before this request can be made.') as ApiRequestError;
    error.status = 409;
    error.code = 'PORTAL_ADMISSION_REQUIRED';
    error.paths = [];
    error.users = [];
    error.details = null;
    throw error;
  }
  const headers = techDriveHeaders();
  if (typeof config.headers?.set === 'function') {
    for (const [name, value] of Object.entries(headers)) {
      if (value && !config.headers.get(name)) config.headers.set(name, value);
    }
  } else {
    config.headers = axios.AxiosHeaders.from({ ...config.headers, ...headers });
  }
  return config;
});

function normalizedError(
  error: unknown,
  fallback = 'The request could not be completed',
  detailsOverride?: unknown,
): ApiRequestError {
  const response = axios.isAxiosError(error) ? error.response : undefined;
  const body = detailsOverride ?? response?.data;
  const payload = body instanceof Blob ? null : body;
  const rawMessage = isApiError(payload)
    ? payload.message
    : typeof payload === 'string'
      ? payload
      : error instanceof Error
        ? error.message
        : fallback;
  const message =
    isBackendUnavailable(error) || looksLikeHtml(payload) || looksLikeHtml(rawMessage) ? BACKEND_OFFLINE_MESSAGE : rawMessage;
  const result = new Error(message || fallback) as ApiRequestError;
  result.status = response?.status;
  result.code = isApiError(payload) ? payload.code : undefined;
  result.deploymentId = isApiError(payload) ? payload.deploymentId : undefined;
  result.paths = isApiError(payload) ? payload.paths : [];
  result.users = isApiError(payload) ? payload.users : [];
  result.details = payload;
  return result;
}

async function request<T>(
  promise: Promise<AxiosResponse<T>>,
  fallback: string,
  notifyLockConflict = true,
  notifySessionUnauthorized = true,
): Promise<T> {
  try {
    return (await promise).data;
  } catch (error) {
    if (axios.isCancel(error)) throw error;
    const result = normalizedError(error, fallback);
    if (notifyLockConflict && result.status === 423) lockConflictListeners.forEach((listener) => listener(result));
    if (notifySessionUnauthorized && result.status === 401) {
      sessionUnauthorizedListeners.forEach((listener) => listener(result));
    }
    if (isBackendUnavailable(error) || isBackendUnavailable(result)) {
      backendUnavailableListeners.forEach((listener) => listener(result));
    }
    throw result;
  }
}

function expectedBlobContentLength(headers: AxiosResponse<Blob>['headers']): number | null {
  const raw = headers?.['content-length'];
  if (raw == null || raw === '') return null;
  const text = String(Array.isArray(raw) ? raw[0] : raw).trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return null;
  return value;
}

async function blobRequest(promise: Promise<AxiosResponse<Blob>>): Promise<DownloadResult> {
  try {
    const response = await promise;
    const expectedLength = expectedBlobContentLength(response.headers);
    if (expectedLength != null && response.data.size !== expectedLength) {
      throw new Error(DOWNLOAD_INCOMPLETE_MESSAGE);
    }
    const disposition = response.headers['content-disposition'] || '';
    const utfName = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plainName = disposition.match(/filename="?([^";]+)"?/i);
    return { blob: response.data, filename: decodeURIComponent(utfName?.[1] || plainName?.[1] || 'download') };
  } catch (error: unknown) {
    if (error instanceof Error && error.message === DOWNLOAD_INCOMPLETE_MESSAGE) throw error;
    let parsedBody: unknown;
    const responseBody = axios.isAxiosError(error) ? error.response?.data : undefined;
    if (responseBody instanceof Blob) {
      try {
        parsedBody = JSON.parse(await responseBody.text());
      } catch {
        /* non-JSON error */
      }
    }
    if (axios.isCancel(error) || (isRecord(error) && error.request != null && error.response == null)) {
      throw new Error(DOWNLOAD_INCOMPLETE_MESSAGE);
    }
    const result = normalizedError(error, 'Download failed', parsedBody);
    if (result.status === 423) lockConflictListeners.forEach((listener) => listener(result));
    if (result.status === 401) sessionUnauthorizedListeners.forEach((listener) => listener(result));
    if (isBackendUnavailable(error) || isBackendUnavailable(result)) {
      backendUnavailableListeners.forEach((listener) => listener(result));
    }
    throw result;
  }
}

export const loginUser = (username: string, password: string): Promise<RouteResponse<'POST /api/users/login'>> =>
  request<RouteResponse<'POST /api/users/login'>>(
    client.post<RouteResponse<'POST /api/users/login'>>(
      '/users/login',
      { username, password } satisfies LoginRequest,
      {
        headers: techDriveHeaders(username),
      },
    ),
    'This username is not permitted to use the portal or incorrect credentials given',
    false,
    false,
  );
export const getCurrentPortalSession = (): Promise<RouteResponse<'GET /api/users/me'>> =>
  request<RouteResponse<'GET /api/users/me'>>(
    client.get<RouteResponse<'GET /api/users/me'>>('/users/me'),
    'Unable to restore the portal session',
    false,
    false,
  );
export const reportUserActivity = (): Promise<void> =>
  request<void>(client.post<void>('/users/activity'), 'Unable to report user activity');
export const logoutPortalSession = (): Promise<void> =>
  request<void>(client.post<void>('/users/logout'), 'Unable to log out', false);
export const forceLogoutPortalUser = (username: string): Promise<void> =>
  request<void>(
    client.post<void>(`/users/${encodeURIComponent(username)}/force-logout`),
    `Unable to force logout ${username}`,
    false,
  );
export const getCurrentUserProfile = (): Promise<UserProfile> =>
  request<UserProfile>(client.get<UserProfile>('/users/me/profile'), 'Unable to load your profile');
export const updateCurrentUserProfile = (payload: UpdateUserProfileRequest): Promise<UserProfile> =>
  request<UserProfile>(client.put<UserProfile>('/users/me/profile', payload), 'Unable to update your profile');
export const changeCurrentUserPassword = (payload: ChangeUserPasswordRequest): Promise<void> =>
  request<void>(client.put<void>('/users/me/password', payload), 'Unable to change your password');
export const uploadCurrentUserAvatar = (file: File): Promise<UserProfile> => {
  const body = new FormData();
  body.append('avatar', file);
  return request<UserProfile>(
    client.put<UserProfile>('/users/me/avatar', body, { headers: { 'Content-Type': 'multipart/form-data' } }),
    'Unable to update your profile image',
  );
};
export const removeCurrentUserAvatar = (): Promise<UserProfile> =>
  request<UserProfile>(client.delete<UserProfile>('/users/me/avatar'), 'Unable to remove your profile image');
export const getPortalUsers = (): Promise<ManagedPortalUser[]> =>
  request<ManagedPortalUser[]>(client.get<ManagedPortalUser[]>('/users'), 'Unable to load portal users');
export const createPortalUser = (payload: CreatePortalUserRequest): Promise<ManagedPortalUser> =>
  request<ManagedPortalUser>(client.post<ManagedPortalUser>('/users', payload), 'Unable to add this user');
export const removePortalUser = (userId: string): Promise<void> =>
  request<void>(
    client.delete<void>(`/users/${encodeURIComponent(userId)}`),
    'Unable to remove this user',
  );
export const updatePortalUserRole = (
  userId: string,
  payload: UpdatePortalUserRoleRequest,
): Promise<ManagedPortalUser> =>
  request<ManagedPortalUser>(
    client.put<ManagedPortalUser>(`/users/${encodeURIComponent(userId)}/role`, payload),
    'Unable to update this user role',
  );
export const getLocks = (): Promise<LockInfo[]> =>
  request<LockInfo[]>(client.get<LockInfo[]>('/locks'), 'Unable to reconcile shared locks', false);
export const onLockConflict = (listener: (error: ApiRequestError) => void): (() => void) => {
  lockConflictListeners.add(listener);
  return () => {
    lockConflictListeners.delete(listener);
  };
};
export const onBackendUnavailable = (listener: (error: ApiRequestError) => void): (() => void) => {
  backendUnavailableListeners.add(listener);
  return () => {
    backendUnavailableListeners.delete(listener);
  };
};
export const onSessionUnauthorized = (listener: (error: ApiRequestError) => void): (() => void) => {
  sessionUnauthorizedListeners.add(listener);
  return () => {
    sessionUnauthorizedListeners.delete(listener);
  };
};
export const getJars = (): Promise<JarCatalogueResponse> =>
  request<JarCatalogueResponse>(client.get<JarCatalogueResponse>('/dashboard/jars'), 'Unable to load JAR applications');
export const getWarApplications = (): Promise<RouteResponse<'GET /api/dashboard/war-applications'>> =>
  request<RouteResponse<'GET /api/dashboard/war-applications'>>(
    client.get<RouteResponse<'GET /api/dashboard/war-applications'>>('/dashboard/war-applications'),
    'Unable to load WAR applications',
  );
export const getProfiles = (): Promise<Profile[]> =>
  request<Profile[]>(client.get<Profile[]>('/dashboard/profiles'), 'Unable to load WildFly profiles');
export const getProfileDatasources = (profileId: string, signal?: AbortSignal): Promise<WildFlyDatasource> =>
  request<WildFlyDatasource>(
    client.get<WildFlyDatasource>(`/wildfly/profiles/${encodeURIComponent(profileId)}/datasources`, { signal }),
    'Unable to load datasources for this profile',
  );
export const getRuntimeResource = (resourceKey: string): Promise<RuntimeResource> =>
  request<RuntimeResource>(
    client.get<RuntimeResource>(`/resources/${encodeURIComponent(resourceKey)}`),
    'Unable to load runtime activity',
  );
export const getOperation = (id: string): Promise<DeploymentRecord> =>
  request<DeploymentRecord>(client.get<DeploymentRecord>(`/deployments/${encodeURIComponent(id)}`), 'Unable to load operation');
export const restartJar = (app: string): Promise<DeploymentStartResponse> =>
  request<DeploymentStartResponse>(
    client.post<DeploymentStartResponse>(`/dashboard/jars/${encodeURIComponent(app)}/restart`, null),
    'Unable to restart the application',
  );
export const stopJar = (app: string): Promise<DeploymentStartResponse> =>
  request<DeploymentStartResponse>(
    client.post<DeploymentStartResponse>(`/dashboard/jars/${encodeURIComponent(app)}/stop`, null),
    'Unable to stop the application',
  );
export const startProfile = (id: string): Promise<ProfilePowerResponse> =>
  request<ProfilePowerResponse>(
    client.post<ProfilePowerResponse>(`/profiles/${encodeURIComponent(id)}/start`),
    'Unable to start the profile',
  );
export const stopProfile = (id: string): Promise<ProfilePowerResponse> =>
  request<ProfilePowerResponse>(
    client.post<ProfilePowerResponse>(`/profiles/${encodeURIComponent(id)}/stop`),
    'Unable to stop the profile',
  );
export const deployJar = (payload: JarDeploymentRequest): Promise<DeploymentStartResponse> =>
  request<DeploymentStartResponse>(
    client.post<DeploymentStartResponse>('/deployments/qc/jar', payload),
    'JAR deployment was rejected',
  );
export const fetchJarBat = async (applicationName: string, signal?: AbortSignal): Promise<string> => {
  const response = await request<JarBatFetchResponse>(
    client.get<JarBatFetchResponse>('/deployments/qc/jar/fetch-bat', {
      params: { applicationName },
      signal,
    }),
    'Unable to fetch the existing launcher file',
  );
  if (typeof response.content === 'string') return response.content;
  throw new Error('The existing launcher file did not contain script text.');
};
export const getPortStatus = (port: number, applicationName?: string, signal?: AbortSignal): Promise<PortStatus> =>
  request<PortStatus>(
    client.get<PortStatus>(`/system/ports/${encodeURIComponent(port)}`, {
      params: applicationName ? { applicationName } : {},
      signal,
    }),
    'Unable to inspect the port',
  );
export const getJarSnapshots = (applicationName: string): Promise<JarSnapshotSummary[]> =>
  request<JarSnapshotSummary[]>(
    client.get<JarSnapshotSummary[]>('/deployments/qc/jar/snapshots', { params: { applicationName } }),
    'Unable to load JAR rollback snapshots',
  );
export const rollbackJar = (snapshotId: number): Promise<DeploymentStartResponse> =>
  request<DeploymentStartResponse>(
    client.post<DeploymentStartResponse>('/deployments/qc/jar/rollback', { snapshotId } satisfies SnapshotRollbackRequest),
    'JAR rollback was rejected',
  );
export const preflightWar = (payload: WarDeploymentRequest, signal?: AbortSignal): Promise<WarPreflightResponse> =>
  request<WarPreflightResponse>(
    client.post<WarPreflightResponse>('/deployments/qc/war/preflight', payload, { signal }),
    'WAR preflight failed',
  );
export const cancelWarPreflight = (profileId: string): Promise<void> =>
  request<void>(
    client.delete<void>(`/wildfly/profiles/${encodeURIComponent(profileId)}/preflight`),
    'Unable to cancel the profile reservation',
  );
export const deployWar = (payload: WarDeploymentRequest): Promise<WarDeploymentStartResponse> =>
  request<WarDeploymentStartResponse>(
    client.post<WarDeploymentStartResponse>('/deployments/qc/war', payload),
    'WAR deployment was rejected',
  );
export const getWarSnapshots = (profileId: string): Promise<WarSnapshotSummary[]> =>
  request<WarSnapshotSummary[]>(
    client.get<WarSnapshotSummary[]>('/deployments/qc/war/snapshots', { params: { profileId } }),
    'Unable to load rollback snapshots',
  );
export const rollbackWar = (snapshotId: number): Promise<DeploymentStartResponse> =>
  request<DeploymentStartResponse>(
    client.post<DeploymentStartResponse>('/deployments/qc/war/rollback', { snapshotId } satisfies SnapshotRollbackRequest),
    'WAR rollback was rejected',
  );
export const downloadTerminal = (deploymentId: string): Promise<DownloadResult> =>
  blobRequest(client.get<Blob>(`/terminals/${encodeURIComponent(deploymentId)}/download`, { responseType: 'blob', timeout: 0 }));
export const deleteTerminal = (deploymentId: string): Promise<void> =>
  request<void>(client.delete<void>(`/terminals/${encodeURIComponent(deploymentId)}`), 'Unable to close the terminal');
export const subscribeProfileLogs = (profileId: string): Promise<void> =>
  request<void>(
    client.put<void>(`/profiles/${encodeURIComponent(profileId)}/log-subscriptions`),
    'Unable to subscribe to profile logs',
  );
export const unsubscribeProfileLogs = (profileId: string): Promise<void> =>
  request<void>(
    client.delete<void>(`/profiles/${encodeURIComponent(profileId)}/log-subscriptions`),
    'Unable to unsubscribe from profile logs',
  );
export const getFileRoots = (): Promise<FileRoot[]> =>
  request<FileRoot[]>(client.get<FileRoot[]>('/files/roots'), 'Unable to load file roots');
export const listFiles = (rootKey: FileRoot['key'], path?: string, signal?: AbortSignal): Promise<FileNode[]> =>
  request<FileNode[]>(
    client.get<FileNode[]>('/files/list', { params: { rootKey, path }, signal }),
    'Unable to load this directory',
  );
export const downloadSingle = (rootKey: FileRoot['key'], path: string): Promise<DownloadResult> =>
  blobRequest(client.get<Blob>('/files/download', { params: { rootKey, path }, responseType: 'blob', timeout: 0 }));
export const downloadAdditionalConfigSample = (): Promise<DownloadResult> =>
  blobRequest(client.get<Blob>('/files/sample/additionalConfig', { responseType: 'blob', timeout: 0 }));
export const downloadSelection = (rootKey: FileRoot['key'], paths: string[]): Promise<DownloadResult> =>
  blobRequest(client.post<Blob>('/files/download', { rootKey, paths }, { responseType: 'blob', timeout: 0 }));
export const deleteFiles = (rootKey: FileRoot['key'], paths: string[]): Promise<void> =>
  request<void>(client.delete<void>('/files', { data: { rootKey, paths } }), 'Unable to delete the selected items');
export const createDirectory = (payload: CreateDirectoryRequest): Promise<FileNode> =>
  request<FileNode>(client.post<FileNode>('/files/directory', payload), 'Unable to create this folder');
export const renameFile = (payload: RenameRequest): Promise<void> =>
  request<void>(client.post<void>('/files/rename', payload), 'Unable to rename this file or folder');
export const extractFile = async (payload: ExtractRequest): Promise<ExtractResponse> => {
  try {
    return await request<ExtractResponse>(
      client.post<ExtractResponse>('/files/extract', payload, { timeout: 0 }),
      'Unable to extract this archive',
    );
  } catch (error) {
    if (!(error as ApiRequestError).status) throw new Error(EXTRACTION_UNCONFIRMED_MESSAGE);
    throw error;
  }
};
export const preflightFileMove = (payload: MoveRequest, signal?: AbortSignal): Promise<FileMovePreflightResponse> =>
  request<FileMovePreflightResponse>(
    client.post<FileMovePreflightResponse>('/files/move/preflight', payload, { signal }),
    'Unable to prepare the file move',
  );
export const moveFiles = (payload: MoveRequest, signal?: AbortSignal): Promise<FileMoveResult> =>
  request<FileMoveResult>(
    client.post<FileMoveResult>('/files/move', payload, { signal, timeout: 0 }),
    'Unable to move the selected items',
  );
export const preflightUatBuild = (payload: UatPreflightRequest, signal?: AbortSignal): Promise<UatPreflightResponse> =>
  request<UatPreflightResponse>(
    client.post<UatPreflightResponse>('/uat-builds/preflight', payload, { signal }),
    'Unable to inspect and lock the UAT build inputs',
  );
export const releaseUatBuildLock = (lockId: string): Promise<void> =>
  request<void>(client.delete<void>(`/uat-builds/locks/${encodeURIComponent(lockId)}`), 'Unable to release the UAT build lock');
export const convertUatBuild = (payload: UatConvertRequest): Promise<UatOperationResponse> =>
  request<UatOperationResponse>(
    client.post<UatOperationResponse>('/uat-builds/convert', payload),
    'Unable to start UAT build conversion',
  );
export const createUpload = (payload: UploadRequest): Promise<UploadResponse> =>
  request<UploadResponse>(client.post<UploadResponse>('/uploads', payload), 'The upload was rejected');
export const getUpload = (operationId: string): Promise<UploadResponse> =>
  request<UploadResponse>(
    client.get<UploadResponse>(`/uploads/${encodeURIComponent(operationId)}`),
    'Unable to load the upload operation',
  );
export const executeUpload = (operationId: string, selectedTargets?: Record<string, string> | null): Promise<UploadResponse> =>
  request<UploadResponse>(
    client.post<UploadResponse>(`/uploads/${encodeURIComponent(operationId)}/execute`, { selectedTargets }),
    'The hotfix could not be started',
  );
export const rollbackUploadItem = (operationId: string, sourcePath: string): Promise<UploadResponse> =>
  request<UploadResponse>(
    client.post<UploadResponse>(`/uploads/${encodeURIComponent(operationId)}/rollback`, { sourcePath }),
    'The item rollback could not be started',
  );
export const getDatabaseTables = (signal?: AbortSignal): Promise<DatabaseTable[]> =>
  request<DatabaseTable[]>(client.get<DatabaseTable[]>('/database/tables', { signal }), 'Unable to load database table metadata');
export const getDatabaseTableRows = (
  table: string,
  page?: number,
  size?: number,
  signal?: AbortSignal,
): Promise<{ items: DatabaseRow[]; page: number; size: number; total: number }> =>
  request<{ items: DatabaseRow[]; page: number; size: number; total: number }>(
    client.get<{ items: DatabaseRow[]; page: number; size: number; total: number }>(
      `/database/tables/${encodeURIComponent(table)}`,
      { params: { page, size }, signal },
    ),
    'Unable to load table data',
  );

/** Backend list MAX_PAGE_SIZE; used to prefetch an entire table in as few round-trips as possible. */
export const DATABASE_TABLE_FETCH_PAGE_SIZE = 200;

export const getAllDatabaseTableRows = async (
  table: string,
  signal?: AbortSignal,
): Promise<{ items: DatabaseRow[]; total: number }> => {
  const items: DatabaseRow[] = [];
  let page = 0;
  let total = 0;

  while (true) {
    const response = await getDatabaseTableRows(table, page, DATABASE_TABLE_FETCH_PAGE_SIZE, signal);
    const batch = Array.isArray(response.items) ? response.items : [];
    total = Number.isInteger(response.total) && response.total >= 0 ? response.total : items.length + batch.length;
    items.push(...batch);
    if (batch.length < DATABASE_TABLE_FETCH_PAGE_SIZE || items.length >= total) break;
    page += 1;
  }

  return { items, total: Math.max(total, items.length) };
};

function parameterLocation(
  parameter: DatabaseQuery['parameters'][number],
): Lowercase<DatabaseQuery['parameters'][number]['location']> {
  return parameter.location.toLowerCase() as Lowercase<DatabaseQuery['parameters'][number]['location']>;
}

function databaseQueryPath(
  template: string,
  parameters: DatabaseQuery['parameters'],
  values: Record<string, DatabaseQueryValue>,
): string {
  if (!template.trim()) throw new Error('The query endpoint template is missing.');
  let path = template.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//') || path.includes('\\')) {
    throw new Error('The query endpoint must use a backend API path.');
  }
  for (const parameter of parameters.filter((item) => parameterLocation(item) === 'path')) {
    const token = `{${parameter.name}}`;
    if (path.includes(token)) {
      const value = values[parameter.name];
      if (value === '' || value === null || value === undefined)
        throw new Error(`Path parameter "${parameter.name}" is required.`);
      path = path.split(token).join(encodeURIComponent(value));
    }
  }
  if (/{[^}]+}/.test(path)) throw new Error('The query endpoint has unresolved path parameters.');
  if (!path.startsWith('/')) path = `/${path}`;
  if (path === '/api') return '/';
  if (path.startsWith('/api/')) path = path.slice(4);
  if (path.split('/').includes('..')) throw new Error('The query endpoint path is invalid.');
  return path;
}

export function executeDatabaseQuery(
  query: DatabaseQuery,
  values: Record<string, DatabaseQueryValue>,
  signal?: AbortSignal,
): Promise<DatabaseRow | DatabaseRow[] | { items: DatabaseRow[]; page: number; size: number; total: number } | void> {
  const parameters = query.parameters;
  const params: Record<string, DatabaseQueryValue> = {};
  const headers: Record<string, string | number | boolean> = {};
  for (const parameter of parameters) {
    if (isPortalIdentityParameter(parameter)) continue;
    const value = values[parameter.name];
    const location = parameterLocation(parameter);
    if (value === '' || value === null || value === undefined || location === 'path') continue;
    if (location === 'header') headers[parameter.name] = value;
    else params[parameter.name] = value;
  }
  const method = String(query.method || 'GET').toUpperCase();
  if (!/^[A-Z]+$/.test(method)) return Promise.reject(new Error('The query HTTP method is invalid.'));
  let url;
  try {
    url = databaseQueryPath(query.path, parameters, values);
  } catch (error) {
    return Promise.reject(error);
  }
  return request<DatabaseRow | DatabaseRow[] | { items: DatabaseRow[]; page: number; size: number; total: number } | void>(
    client.request<DatabaseRow | DatabaseRow[] | { items: DatabaseRow[]; page: number; size: number; total: number } | void>({
      url,
      method,
      params,
      headers,
      signal,
    }),
    'Unable to execute database query',
  );
}

export function eventUrl(path: string): string {
  return `${apiBaseUrl}${path}`;
}

export function terminalEventUrl(deploymentId: string): string {
  return `${apiBaseUrl}/terminals/${encodeURIComponent(deploymentId)}/events`;
}

export function resolvedTerminalEventUrl(suppliedPath: string | null | undefined, deploymentId: string): string {
  const path = String(suppliedPath || '').trim();
  if (path.startsWith('/api/')) return `${backendOrigin}${apiContextPath}${path}`;
  if (path.startsWith(`${apiContextPath}/api/`)) return `${backendOrigin}${path}`;
  return terminalEventUrl(deploymentId);
}

export function uatBuildOperationEventUrl(operationId: string): string {
  return `${apiBaseUrl}/uat-builds/operations/${encodeURIComponent(operationId)}`;
}

export function saveBlob({ blob, filename }: DownloadResult): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const isLockConflict = (error: unknown): error is ApiRequestError => isRecord(error) && error.status === 423;

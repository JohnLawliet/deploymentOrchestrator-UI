import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseTable, JarDeploymentRequest, UatPreflightRequest, UploadRequest } from '@/types/api-contracts';

type RequestInterceptor = (config: { headers?: Record<string, string> }) => { headers: Record<string, string> };
type InterceptorState = { handler: RequestInterceptor | null };

const { client, interceptorState } = vi.hoisted(() => {
  const interceptorState: InterceptorState = { handler: null };
  return {
    interceptorState,
    client: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
      interceptors: {
        request: {
          use: vi.fn((handler) => {
            interceptorState.handler = handler;
          }),
        },
      },
    },
  };
});

vi.mock('axios', () => ({
  default: {
    create: () => client,
    isCancel: () => false,
    isAxiosError: (error: unknown) => typeof error === 'object' && error !== null && 'response' in error,
    AxiosHeaders: { from: (headers: Record<string, string>) => headers },
  },
}));

import {
  BACKEND_OFFLINE_MESSAGE,
  convertUatBuild,
  createUpload,
  deleteFiles,
  deployJar,
  downloadAdditionalConfigSample,
  downloadTerminal,
  executeDatabaseQuery,
  executeUpload,
  getDatabaseTableRows,
  getDatabaseTables,
  getCurrentPortalSession,
  getLocks,
  getPortalQueue,
  getJarSnapshots,
  getUpload,
  getProfiles,
  getPortStatus,
  getRuntimeResource,
  getWarSnapshots,
  isLockConflict,
  isBackendUnavailable,
  onLockConflict,
  onBackendUnavailable,
  onSessionUnauthorized,
  reportUserActivity,
  forceLogoutPortalUser,
  logoutPortalSession,
  resolvedTerminalEventUrl,
  rollbackJar,
  rollbackUploadItem,
  rollbackWar,
  preflightUatBuild,
  releaseUatBuildLock,
  renameFile,
  startProfile,
  stopJar,
  stopProfile,
  subscribeProfileLogs,
  terminalEventUrl,
  uatBuildOperationEventUrl,
  unsubscribeProfileLogs,
  validateUser,
} from './contractApi';

type DatabaseQuery = DatabaseTable['queries'][number];
const databaseParameter = (
  name: string,
  location: 'HEADER' | 'QUERY' | 'PATH',
  required: boolean,
): DatabaseQuery['parameters'][number] => ({
  name,
  location,
  required,
  type: 'STRING',
  defaultValue: null,
  minimum: null,
  maximum: null,
  description: '',
});
const databaseQuery = (overrides: Partial<DatabaseQuery> = {}): DatabaseQuery => ({
  name: 'test-query',
  label: 'Test query',
  method: 'GET',
  path: '/api/database/tables',
  description: '',
  destructive: false,
  allowed: true,
  parameters: [],
  ...overrides,
});
const requestHandler = (): RequestInterceptor => {
  if (!interceptorState.handler) throw new Error('Expected Axios request interceptor registration.');
  return interceptorState.handler;
};

describe('presence and lock contracts', () => {
  it('reports activity with an empty POST and reads the shared lock list', async () => {
    client.post.mockResolvedValueOnce({ data: undefined });
    client.get.mockResolvedValueOnce({ data: [{ resourceKey: 'profile:one' }] });

    await reportUserActivity();
    await expect(getLocks()).resolves.toEqual([{ resourceKey: 'profile:one' }]);
    expect(client.post).toHaveBeenCalledWith('/users/activity');
    expect(client.get).toHaveBeenCalledWith('/locks');
  });

  it('recognizes HTTP 423 and notifies reconciliation subscribers', async () => {
    const listener = vi.fn();
    const unsubscribe = onLockConflict(listener);
    client.post.mockRejectedValueOnce({
      response: {
        status: 423,
        data: {
          timestamp: '2026-08-09T00:00:00Z',
          status: 423,
          error: 'Locked',
          code: 'LOCK_CONFLICT',
          message: 'Locked by Mary',
          deploymentId: null,
          paths: [],
          users: ['Mary'],
        },
      },
    });

    await expect(stopProfile('profile-1')).rejects.toMatchObject({ status: 423, message: 'Locked by Mary' });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 423 }));
    expect(isLockConflict({ status: 423 })).toBe(true);
    expect(isLockConflict({ status: 409 })).toBe(false);
    unsubscribe();
  });

  it('treats Apache 503 HTML and network failures as backend offline, not 500 JSON', async () => {
    const listener = vi.fn();
    const unsubscribe = onBackendUnavailable(listener);
    const apacheHtml =
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Service unavailable!</title></head></html>';

    client.get.mockRejectedValueOnce({
      response: { status: 503, data: apacheHtml },
    });
    await expect(validateUser('alice')).rejects.toMatchObject({
      status: 503,
      message: BACKEND_OFFLINE_MESSAGE,
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(isBackendUnavailable({ response: { status: 503, data: apacheHtml } })).toBe(true);

    listener.mockClear();
    client.get.mockRejectedValueOnce({
      response: {
        status: 500,
        data: { message: 'Internal failure', code: 'INTERNAL', paths: [], users: [], deploymentId: null },
      },
    });
    await expect(validateUser('alice')).rejects.toMatchObject({ status: 500, message: 'Internal failure' });
    expect(listener).not.toHaveBeenCalled();
    expect(
      isBackendUnavailable({
        response: {
          status: 500,
          data: { message: 'Internal failure', code: 'INTERNAL' },
        },
      }),
    ).toBe(false);

    expect(isBackendUnavailable({ request: {} })).toBe(true);
    unsubscribe();
  });
});

describe('executeDatabaseQuery', () => {
  beforeEach(() => {
    sessionStorage.removeItem('qc-deployment-username');
    sessionStorage.setItem('qc-portal-tab-id', 'tab-test-1');
    client.request.mockReset();
    client.request.mockResolvedValue({ data: { success: true } });
    client.get.mockReset();
    client.post.mockReset();
    client.put.mockReset();
    client.delete.mockReset();
    client.get.mockResolvedValue({ data: [], headers: {} });
    client.post.mockResolvedValue({ data: { success: true } });
  });

  it('adds the stored TechDrive username to backend requests', () => {
    sessionStorage.setItem('qc-deployment-username', ' deploy-user ');

    expect(requestHandler()({ headers: {} })).toEqual({
      headers: { 'X-TechDrive-Username': 'deploy-user', 'X-Portal-Tab-Id': 'tab-test-1' },
    });
  });

  it('does not add the TechDrive username header when no user is stored', () => {
    sessionStorage.removeItem('qc-deployment-username');

    expect(requestHandler()({ headers: {} })).toEqual({ headers: { 'X-Portal-Tab-Id': 'tab-test-1' } });
  });

  it('validates with the candidate username header and no query parameter', async () => {
    client.get.mockResolvedValueOnce({
      data: {
        valid: true,
        normalizedUsername: 'candidate-user',
        isAdmin: false,
        admissionStatus: 'ADMITTED',
        maxOnlineUsers: 5,
        onlineCount: 1,
        queuePosition: null,
        onlineUsers: [],
        notices: ['unable to access techdrive'],
      },
      headers: {},
    });

    await expect(validateUser(' candidate-user ')).resolves.toEqual({
      valid: true,
      normalizedUsername: 'candidate-user',
      isAdmin: false,
      admissionStatus: 'ADMITTED',
      maxOnlineUsers: 5,
      onlineCount: 1,
      queuePosition: null,
      onlineUsers: [],
      notices: ['unable to access techdrive'],
    });

    expect(client.get).toHaveBeenCalledWith('/users/validate', {
      headers: { 'X-TechDrive-Username': 'candidate-user', 'X-Portal-Tab-Id': 'tab-test-1' },
    });
  });

  it('uses cookie-session endpoints and reports authenticated 401 responses', async () => {
    const unauthorized = vi.fn();
    const unsubscribe = onSessionUnauthorized(unauthorized);
    client.get
      .mockResolvedValueOnce({ data: { username: 'alice', admissionStatus: 'ADMITTED' } })
      .mockResolvedValueOnce({ data: { admissionStatus: 'QUEUED', queuePosition: 2, onlineUsers: [] } });
    client.post.mockResolvedValue({ data: undefined });

    await getCurrentPortalSession();
    await getPortalQueue();
    await logoutPortalSession();
    await forceLogoutPortalUser('bob/example');

    expect(client.get).toHaveBeenNthCalledWith(1, '/users/me');
    expect(client.get).toHaveBeenNthCalledWith(2, '/users/queue');
    expect(client.post).toHaveBeenCalledWith('/users/logout');
    expect(client.post).toHaveBeenCalledWith('/users/bob%2Fexample/force-logout');

    client.post.mockRejectedValueOnce({ response: { status: 401, data: { message: 'Ended', code: 'SESSION_ENDED' } } });
    await expect(reportUserActivity()).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('executes a DELETE descriptor using its metadata-provided parameters', async () => {
    const signal = new AbortController().signal;
    const query = databaseQuery({
      name: 'truncate',
      method: 'DELETE',
      path: '/api/database/tables/deployment-records/truncate',
      parameters: [databaseParameter('X-TechDrive-Username', 'HEADER', true)],
    });

    await expect(executeDatabaseQuery(query, { 'X-TechDrive-Username': 'spoofed-user' }, signal)).resolves.toEqual({
      success: true,
    });

    expect(client.request).toHaveBeenCalledWith({
      url: '/database/tables/deployment-records/truncate',
      method: 'DELETE',
      params: {},
      headers: {},
      signal,
    });
  });

  it('resolves path parameters for an existing single-record deletion descriptor', async () => {
    await executeDatabaseQuery(
      databaseQuery({
        name: 'delete',
        method: 'DELETE',
        path: '/api/database/tables/deployment-records/{deploymentId}',
        parameters: [databaseParameter('username', 'QUERY', true), databaseParameter('deploymentId', 'PATH', true)],
      }),
      { deploymentId: 'deployment/42', username: 'admin-user' },
    );

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/database/tables/deployment-records/deployment%2F42',
        method: 'DELETE',
        params: {},
      }),
    );
  });

  it('uses the full runtime resource, stop, and snapshot contracts', async () => {
    await getRuntimeResource('WILDFLY_PROFILE:profile/42');
    await startProfile('profile/42');
    await stopProfile('profile/42');
    await getWarSnapshots('profile/42');

    expect(client.get).toHaveBeenNthCalledWith(1, '/resources/WILDFLY_PROFILE%3Aprofile%2F42');
    expect(client.post).toHaveBeenNthCalledWith(1, '/profiles/profile%2F42/start');
    expect(client.post).toHaveBeenNthCalledWith(2, '/profiles/profile%2F42/stop');
    expect(client.get).toHaveBeenNthCalledWith(2, '/deployments/qc/war/snapshots', { params: { profileId: 'profile/42' } });
  });

  it('uses the system port inspection and managed JAR stop contracts', async () => {
    const signal = new AbortController().signal;
    await getPortStatus(8181, 'orders api', signal);
    await stopJar('orders/api');

    expect(client.get).toHaveBeenCalledWith('/system/ports/8181', {
      params: { applicationName: 'orders api' },
      signal,
    });
    expect(client.post).toHaveBeenCalledWith('/dashboard/jars/orders%2Fapi/stop', null);
  });

  it('uses dashboard profiles and canonical deployment-record table endpoints', async () => {
    const signal = new AbortController().signal;

    await getProfiles();
    await getDatabaseTables(signal);
    await getDatabaseTableRows('deployment-records', 2, 25, signal);

    expect(client.get).toHaveBeenNthCalledWith(1, '/dashboard/profiles');
    expect(client.get).toHaveBeenNthCalledWith(2, '/database/tables', {
      signal,
    });
    expect(client.get).toHaveBeenNthCalledWith(3, '/database/tables/deployment-records', {
      params: { page: 2, size: 25 },
      signal,
    });
  });

  it('downloads terminal logs without sending a username', async () => {
    client.get.mockResolvedValueOnce({
      data: new Blob(['failed output']),
      headers: { 'content-disposition': 'attachment; filename="operation.log"' },
    });

    await expect(downloadTerminal('operation/42')).resolves.toEqual({
      blob: expect.any(Blob),
      filename: 'operation.log',
    });

    expect(client.get).toHaveBeenCalledWith('/terminals/operation%2F42/download', { responseType: 'blob' });
  });

  it('downloads the additionalConfig sample as a blob and reads the save name from Content-Disposition', async () => {
    client.get.mockResolvedValueOnce({
      data: new Blob(['key = "value"']),
      headers: { 'content-disposition': 'attachment; filename="additionalConfig-sample.toml"' },
    });

    await expect(downloadAdditionalConfigSample()).resolves.toEqual({
      blob: expect.any(Blob),
      filename: 'additionalConfig-sample.toml',
    });

    expect(client.get).toHaveBeenCalledWith('/files/sample/additionalConfig', { responseType: 'blob' });
  });

  it('sends the root and selected paths in the bulk file deletion body', async () => {
    client.delete.mockResolvedValue({ data: { success: true } });

    await expect(deleteFiles('techDrive', ['release/a.txt', 'release/b.txt'])).resolves.toEqual({ success: true });

    expect(client.delete).toHaveBeenCalledWith('/files', {
      data: { rootKey: 'techDrive', paths: ['release/a.txt', 'release/b.txt'] },
    });
  });

  it('sends the relative file path and replacement name when renaming an entry', async () => {
    await renameFile({ rootKey: 'qc', path: 'release/old-name.war', newName: 'new-name.war' });

    expect(client.post).toHaveBeenCalledWith('/files/rename', {
      rootKey: 'qc',
      path: 'release/old-name.war',
      newName: 'new-name.war',
    });
  });

  it('preserves structured JAR deployment API errors', async () => {
    client.post.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          code: 'JAR_NOT_EXECUTABLE',
          message: 'The selected JAR has no executable launcher.',
        },
      },
    });

    const request: JarDeploymentRequest = {
      applicationName: 'orders',
      sourcePath: 'orders.jar',
      launcher: { mode: 'GENERATE_AND_SAVE', port: 8080 },
    };
    await expect(deployJar(request)).rejects.toMatchObject({
      status: 400,
      code: 'JAR_NOT_EXECUTABLE',
      message: 'The selected JAR has no executable launcher.',
    });
  });

  it('submits rollback with only the selected snapshot because the deployer is server-derived', async () => {
    await rollbackWar(1);

    expect(client.post).toHaveBeenCalledWith('/deployments/qc/war/rollback', {
      snapshotId: 1,
    });
  });

  it('uses applicationName for JAR snapshots and submits only the snapshot ID for rollback', async () => {
    await getJarSnapshots('orders/api');
    await rollbackJar(123);

    expect(client.get).toHaveBeenCalledWith('/deployments/qc/jar/snapshots', { params: { applicationName: 'orders/api' } });
    expect(client.post).toHaveBeenCalledWith('/deployments/qc/jar/rollback', { snapshotId: 123 });
  });

  it('uses the canonical terminal event endpoint without identity query parameters', () => {
    const url = new URL(terminalEventUrl('deployment-1'), 'http://localhost');
    expect(url.pathname).toBe('/deploymentOrchestrator/api/terminals/deployment-1/events');
    expect(url.search).toBe('');
  });

  it('normalizes an API-relative terminal URL and rejects unrelated supplied paths', () => {
    expect(
      new URL(resolvedTerminalEventUrl('/api/terminals/deployment-1/events', 'deployment-1'), 'http://localhost').pathname,
    ).toBe('/deploymentOrchestrator/api/terminals/deployment-1/events');
    expect(
      new URL(resolvedTerminalEventUrl('https://untrusted.example/events', 'deployment-1'), 'http://localhost').pathname,
    ).toBe('/deploymentOrchestrator/api/terminals/deployment-1/events');
  });

  it('uses canonical profile log subscription endpoints', async () => {
    client.put.mockResolvedValue({ data: {} });
    client.delete.mockResolvedValue({ data: {} });

    await subscribeProfileLogs('profile/1');
    await unsubscribeProfileLogs('profile/1');

    expect(client.put).toHaveBeenCalledWith('/profiles/profile%2F1/log-subscriptions');
    expect(client.delete).toHaveBeenCalledWith('/profiles/profile%2F1/log-subscriptions');
  });

  it('uses lockId across the UAT build workflow contracts', async () => {
    const signal = new AbortController().signal;
    const payload: UatPreflightRequest = {
      application: 'orders',
      sourceRootKey: 'techDrive',
      sourceWarPath: 'uat.war',
      jenkinsRootKey: 'jenkinsBuild',
      jenkinsExplodedWarPath: 'orders/uat',
      additionalConfigRequired: false,
    };
    const conversion = { lockId: 'lock/1', duplicateSelections: { 'web.xml': 'WEB-INF/web.xml' } };
    client.delete.mockResolvedValue({ data: {} });

    await preflightUatBuild(payload, signal);
    await releaseUatBuildLock('lock/1');
    await convertUatBuild(conversion);

    expect(client.post).toHaveBeenNthCalledWith(1, '/uat-builds/preflight', payload, { signal });
    expect(client.delete).toHaveBeenCalledWith('/uat-builds/locks/lock%2F1');
    expect(client.post).toHaveBeenNthCalledWith(2, '/uat-builds/convert', conversion);
    expect(uatBuildOperationEventUrl('operation/1')).toBe(
      'http://localhost:8080/deploymentOrchestrator/api/uat-builds/operations/operation%2F1',
    );
  });

  it('uses the upload operation ID across execute, refresh, and item rollback', async () => {
    const payload: UploadRequest = {
      mode: 'REGULAR',
      sourcePaths: ['release/assets'],
      target: { kind: 'QC_PATH', reference: 'qc1/import' },
    };

    await createUpload(payload);
    await getUpload('operation/1');
    await executeUpload('operation/1', { 'a/config.xml': 'WEB-INF/classes/config.xml' });
    await rollbackUploadItem('operation/1', 'a/config.xml');

    expect(client.post).toHaveBeenNthCalledWith(1, '/uploads', payload);
    expect(client.get).toHaveBeenCalledWith('/uploads/operation%2F1');
    expect(client.post).toHaveBeenNthCalledWith(2, '/uploads/operation%2F1/execute', {
      selectedTargets: { 'a/config.xml': 'WEB-INF/classes/config.xml' },
    });
    expect(client.post).toHaveBeenNthCalledWith(3, '/uploads/operation%2F1/rollback', {
      sourcePath: 'a/config.xml',
    });
  });
});

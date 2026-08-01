import { beforeEach, describe, expect, it, vi } from 'vitest'

const { client, interceptorState } = vi.hoisted(() => {
  const interceptorState = {}
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
          use: vi.fn((handler) => { interceptorState.handler = handler }),
        },
      },
    },
  }
})

vi.mock('axios', () => ({
  default: {
    create: () => client,
    isCancel: () => false,
  },
}))

import {
  downloadTerminal,
  executeDatabaseQuery,
  getDatabaseTableRows,
  getDatabaseTables,
  getProfiles,
  getRuntimeResource,
  getWarSnapshots,
  rollbackWar,
  startProfile,
  stopProfile,
  subscribeProfileLogs,
  terminalEventUrl,
  unsubscribeProfileLogs,
  validateUser,
} from './contractApi'

describe('executeDatabaseQuery', () => {
  beforeEach(() => {
    sessionStorage.removeItem('qc-deployment-username')
    client.request.mockReset()
    client.request.mockResolvedValue({ data: { success: true } })
    client.get.mockReset()
    client.post.mockReset()
    client.put.mockReset()
    client.delete.mockReset()
    client.get.mockResolvedValue({ data: [] , headers: {} })
    client.post.mockResolvedValue({ data: { success: true } })
  })

  it('adds the stored TechDrive username to backend requests', () => {
    sessionStorage.setItem('qc-deployment-username', ' deploy-user ')

    expect(interceptorState.handler({ headers: {} })).toEqual({
      headers: { 'X-TechDrive-Username': 'deploy-user' },
    })
  })

  it('does not add the TechDrive username header when no user is stored', () => {
    sessionStorage.removeItem('qc-deployment-username')

    expect(interceptorState.handler({ headers: {} })).toEqual({ headers: {} })
  })

  it('validates with the candidate username header and no query parameter', async () => {
    await validateUser(' candidate-user ')

    expect(client.get).toHaveBeenCalledWith('/users/validate', {
      headers: { 'X-TechDrive-Username': 'candidate-user' },
    })
  })

  it('executes a DELETE descriptor using its metadata-provided parameters', async () => {
    const signal = new AbortController().signal
    const query = {
      name: 'truncate',
      method: 'DELETE',
      path: '/api/database/tables/deployment-records/truncate',
      parameters: [{ name: 'X-TechDrive-Username', location: 'HEADER', required: true }],
    }

    await expect(executeDatabaseQuery(query, { 'X-TechDrive-Username': 'spoofed-user' }, signal))
      .resolves.toEqual({ success: true })

    expect(client.request).toHaveBeenCalledWith({
      url: '/database/tables/deployment-records/truncate',
      method: 'DELETE',
      params: {},
      headers: {},
      signal,
    })
  })

  it('resolves path parameters for an existing single-record deletion descriptor', async () => {
    await executeDatabaseQuery({
      name: 'delete',
      method: 'DELETE',
      path: '/api/database/tables/deployment-records/{deploymentId}',
      parameters: [
        { name: 'username', location: 'QUERY', required: true },
        { name: 'deploymentId', location: 'PATH', required: true },
      ],
    }, { deploymentId: 'deployment/42', username: 'admin-user' })

    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      url: '/database/tables/deployment-records/deployment%2F42',
      method: 'DELETE',
      params: {},
    }))
  })

  it('uses the full runtime resource, stop, and snapshot contracts', async () => {
    await getRuntimeResource('WILDFLY_PROFILE:profile/42')
    await startProfile('profile/42')
    await stopProfile('profile/42')
    await getWarSnapshots('profile/42')

    expect(client.get).toHaveBeenNthCalledWith(
      1,
      '/resources/WILDFLY_PROFILE%3Aprofile%2F42',
    )
    expect(client.post).toHaveBeenNthCalledWith(1, '/profiles/profile%2F42/start')
    expect(client.post).toHaveBeenNthCalledWith(2, '/profiles/profile%2F42/stop')
    expect(client.get).toHaveBeenNthCalledWith(
      2,
      '/deployments/qc/war/snapshots',
      { params: { profileId: 'profile/42' } },
    )
  })

  it('uses dashboard profiles and canonical deployment-record table endpoints', async () => {
    const signal = new AbortController().signal

    await getProfiles()
    await getDatabaseTables(signal)
    await getDatabaseTableRows('deployment-records', 2, 25, signal)

    expect(client.get).toHaveBeenNthCalledWith(1, '/dashboard/profiles')
    expect(client.get).toHaveBeenNthCalledWith(2, '/database/tables', {
      signal,
    })
    expect(client.get).toHaveBeenNthCalledWith(
      3,
      '/database/tables/deployment-records',
      { params: { page: 2, size: 25 }, signal },
    )
  })

  it('downloads terminal logs without sending a username', async () => {
    client.get.mockResolvedValueOnce({
      data: new Blob(['failed output']),
      headers: { 'content-disposition': 'attachment; filename="operation.log"' },
    })

    await expect(downloadTerminal('operation/42')).resolves.toEqual({
      blob: expect.any(Blob),
      filename: 'operation.log',
    })

    expect(client.get).toHaveBeenCalledWith(
      '/terminals/operation%2F42/download',
      { responseType: 'blob' },
    )
  })

  it('submits rollback with the selected snapshot and current deployer', async () => {
    await rollbackWar('snapshot-1', 'deploy-user')

    expect(client.post).toHaveBeenCalledWith(
      '/deployments/qc/war/rollback',
      { snapshotId: 'snapshot-1', deployerName: 'deploy-user' },
    )
  })

  it('uses the canonical terminal event endpoint without identity query parameters', () => {
    const url = new URL(terminalEventUrl('deployment-1'), 'http://localhost')
    expect(url.pathname).toBe('/deploymentOrchestrator/api/terminals/deployment-1/events')
    expect(url.search).toBe('')
  })

  it('uses canonical profile log subscription endpoints', async () => {
    client.put.mockResolvedValue({ data: {} })
    client.delete.mockResolvedValue({ data: {} })

    await subscribeProfileLogs('profile/1')
    await unsubscribeProfileLogs('profile/1')

    expect(client.put).toHaveBeenCalledWith('/profiles/profile%2F1/log-subscriptions')
    expect(client.delete).toHaveBeenCalledWith('/profiles/profile%2F1/log-subscriptions')
  })
})

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stream = vi.hoisted(() => ({ options: null }))
const api = vi.hoisted(() => ({
  deleteTerminal: vi.fn(),
  downloadTerminal: vi.fn(),
  getOperation: vi.fn(),
  saveBlob: vi.fn(),
  stopProfile: vi.fn(),
  subscribeProfileLogs: vi.fn(),
  techDriveHeaders: vi.fn((username) => ({ 'X-TechDrive-Username': username })),
  terminalEventUrl: vi.fn((deploymentId) => `/api/terminals/${deploymentId}/events`),
  unsubscribeProfileLogs: vi.fn(),
}))
const portal = vi.hoisted(() => ({
  clearProfileLogs: vi.fn(),
  jarProfileActivityMap: {},
  operations: {},
  profileLogLines: {},
  reconcileResourceActivity: vi.fn(),
  setViewingOperation: vi.fn(),
  username: 'deploy-user',
  viewingOperation: null,
}))

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn((_url, options) => {
    stream.options = options
    return new Promise(() => {})
  }),
}))
vi.mock('@/lib/contractApi', () => api)
vi.mock('@/context/PortalContext', () => ({ usePortal: () => portal }))
vi.mock('@/components/RollbackButton', () => ({
  default: () => <button type="button">Rollback to previous version</button>,
}))

import OperationProgressPanel from './OperationProgressPanel'

describe('OperationProgressPanel revised output contracts', () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockClear?.())
    api.getOperation.mockResolvedValue({})
    api.subscribeProfileLogs.mockResolvedValue({})
    api.unsubscribeProfileLogs.mockResolvedValue({})
    api.deleteTerminal.mockResolvedValue({})
    api.downloadTerminal.mockResolvedValue({ blob: new Blob(['log']), filename: 'deployment.log' })
    portal.clearProfileLogs.mockReset()
    portal.jarProfileActivityMap = {}
    portal.operations = {}
    portal.profileLogLines = {}
    portal.setViewingOperation.mockReset()
    portal.viewingOperation = null
    stream.options = null
  })

  afterEach(cleanup)

  it('subscribes to WildFly profile logs and renders only the selected profile buffer', async () => {
    portal.viewingOperation = {
      resourceType: 'WILDFLY_PROFILE',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
      profileId: 'profile-1',
      outputRequested: true,
      status: 'ACTIVE',
      label: 'Profile output',
    }
    portal.profileLogLines = {
      'profile-1': [{ timestamp: '1', line: 'matching profile output' }],
      'profile-2': [{ timestamp: '2', line: 'other profile output' }],
    }

    render(<OperationProgressPanel />)

    await waitFor(() => expect(api.subscribeProfileLogs).toHaveBeenCalledWith('profile-1'))
    expect(portal.clearProfileLogs).toHaveBeenCalledWith('profile-1')
    expect(screen.getByText('matching profile output')).toBeInTheDocument()
    expect(screen.queryByText('other profile output')).not.toBeInTheDocument()
  })

  it('does not unsubscribe when collapsed and unsubscribes on close', async () => {
    portal.viewingOperation = {
      resourceType: 'WILDFLY_PROFILE',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
      profileId: 'profile-1',
      outputRequested: true,
      status: 'ACTIVE',
    }
    const user = userEvent.setup()
    const view = render(<OperationProgressPanel />)

    await user.click(screen.getByRole('button', { name: 'Collapse operation progress' }))
    expect(api.unsubscribeProfileLogs).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Hide operation progress' }))
    await waitFor(() => expect(api.unsubscribeProfileLogs).toHaveBeenCalledTimes(1))
    expect(api.unsubscribeProfileLogs).toHaveBeenCalledWith('profile-1')

    portal.viewingOperation = null
    view.rerender(<OperationProgressPanel />)
    expect(api.unsubscribeProfileLogs).toHaveBeenCalledTimes(1)
  })

  it('attaches JAR terminal output with the canonical header-authenticated stream', async () => {
    portal.viewingOperation = {
      deploymentId: 'deployment-1',
      resourceType: 'JAR',
      resourceKey: 'JAR:orders',
    }
    portal.jarProfileActivityMap = {
      orders: { id: 'orders', currentDeploymentId: 'deployment-1' },
    }
    const user = userEvent.setup()
    render(<OperationProgressPanel />)

    expect(api.terminalEventUrl).toHaveBeenCalledWith('deployment-1')
    expect(api.techDriveHeaders).toHaveBeenCalledWith('deploy-user')
    expect(stream.options.headers).toEqual({ 'X-TechDrive-Username': 'deploy-user' })

    act(() => stream.options.onmessage({
      event: 'TERMINAL_OUTPUT',
      data: JSON.stringify({ deploymentId: 'deployment-1', line: 'JAR output' }),
    }))
    expect(await screen.findByText('JAR output')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Download full log' }))
    expect(api.downloadTerminal).toHaveBeenCalledWith('deployment-1')

    await user.click(screen.getByRole('button', { name: 'Close terminal' }))
    expect(api.deleteTerminal).toHaveBeenCalledWith('deployment-1')
  })

  it('continues rendering operation progress steps without opening a WildFly terminal stream', () => {
    portal.viewingOperation = {
      deploymentId: 'deployment-2',
      resourceType: 'WILDFLY_PROFILE',
      resourceKey: 'WILDFLY_PROFILE:profile-1',
    }
    portal.operations = {
      'deployment-2': {
        deploymentId: 'deployment-2',
        progress: {
          status: 'RUNNING',
          phaseCode: 'DEPLOY_ARTIFACT',
          steps: [{ timestamp: '1', phaseCode: 'PREPARE', message: 'Prepared deployment' }],
        },
      },
    }

    render(<OperationProgressPanel />)

    expect(screen.getByText('Prepared deployment')).toBeInTheDocument()
    expect(screen.queryByText('Command output')).not.toBeInTheDocument()
    expect(stream.options).toBeNull()
  })
})

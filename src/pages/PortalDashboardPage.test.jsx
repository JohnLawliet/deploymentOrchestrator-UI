import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getJars: vi.fn(),
  getProfiles: vi.fn(),
  isLockConflict: vi.fn(() => false),
  restartJar: vi.fn(),
  startProfile: vi.fn(),
  stopProfile: vi.fn(),
}))

const context = vi.hoisted(() => ({
  value: null,
}))
const rollback = vi.hoisted(() => ({ props: null }))

vi.mock('@/lib/contractApi', () => api)
vi.mock('@/context/PortalContext', () => ({
  usePortal: () => context.value,
}))
vi.mock('@/components/RollbackButton', () => ({
  default: (props) => {
    rollback.props = props
    return <button type="button">Rollback to previous version</button>
  },
}))

import PortalDashboardPage from './PortalDashboardPage'

const profile = {
  id: 'opaque/profile:42',
  name: 'payments-qc',
  application: 'payments',
  version: 'wildfly-26',
  status: 'ACTIVE',
  health: 'FUNCTIONAL',
  pid: 4210,
  currentDeploymentId: 'operation-2',
  serverLogAvailable: true,
  offset: 5020,
  applicationPort: 13100,
  managementPort: 15010,
  deployCount: 4,
  failedDeployCount: 2,
  consecutiveFailures: 0,
  lastDeploymentOn: '2026-07-26T13:20:00Z',
  lastSuccessfulDeploymentOn: '2026-07-25T11:00:00Z',
  lastUpdatedOn: '2026-07-26T13:24:11Z',
  lastResult: 'SUCCESS',
  hasBackup: true,
  backupSnapshotId: 'snapshot-1',
}

describe('PortalDashboardPage profile contract', () => {
  beforeEach(() => {
    api.getJars.mockResolvedValue([])
    api.getProfiles.mockResolvedValue([profile])
    api.startProfile.mockResolvedValue({})
    api.stopProfile.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    context.value = {
      username: 'admin-user',
      wildflyProfileActivityMap: {},
      jarProfileActivityMap: {},
      replaceProfileActivities: vi.fn(),
      reconcileResourceActivity: vi.fn(() => new Promise(() => {})),
      registerOperation: vi.fn(),
      setViewingOperation: vi.fn(),
      operations: {},
    }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the expanded profile payload without waiting for runtime reconciliation', async () => {
    const user = userEvent.setup()
    render(<PortalDashboardPage />)

    expect(await screen.findByText('payments-qc')).toBeVisible()
    expect(screen.getByText('4210')).toBeVisible()
    expect(screen.getByText('payments')).toBeVisible()
    expect(screen.getByText('5020')).toBeVisible()
    expect(screen.getByText('13100')).toBeVisible()
    expect(screen.getByText('15010')).toBeVisible()
    expect(screen.getByText('4')).toBeVisible()
    expect(screen.getByText('2')).toBeVisible()
    expect(screen.getByText('operation-2')).toBeVisible()
    expect(screen.getByRole('button', { name: 'View output' })).toBeEnabled()
    expect(context.value.reconcileResourceActivity).not.toHaveBeenCalled()
    expect(rollback.props.profileId).toBe('opaque/profile:42')
    expect(rollback.props.profileName).toBe('payments-qc')
    expect(screen.getByTestId('profile-actions-primary-opaque/profile:42')).toContainElement(
      screen.getByRole('button', { name: 'View output' }),
    )
    expect(screen.getByTestId('profile-actions-secondary-opaque/profile:42')).toContainElement(
      screen.getByRole('button', { name: 'Rollback to previous version' }),
    )

    await user.click(screen.getByRole('button', { name: 'View output' }))

    expect(context.value.setViewingOperation).toHaveBeenCalledWith({
      deploymentId: 'operation-2',
      resourceKey: 'WILDFLY_PROFILE:opaque/profile:42',
      resourceType: 'WILDFLY_PROFILE',
      profileId: 'opaque/profile:42',
      outputRequested: true,
      status: 'ACTIVE',
      label: 'Profile · payments-qc',
    })

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(api.stopProfile).toHaveBeenCalledWith('opaque/profile:42')
  })

  it('renders null PID as unavailable and lets later live activity take precedence', async () => {
    api.getProfiles.mockResolvedValue([{
      ...profile,
      pid: null,
      currentDeploymentId: null,
      serverLogAvailable: false,
    }])
    const view = render(<PortalDashboardPage />)

    expect(await screen.findByText('ACTIVE')).toBeVisible()
    expect(screen.getByText('FUNCTIONAL')).toBeVisible()
    expect(screen.getByRole('button', { name: 'View output' })).toBeDisabled()

    expect(screen.getByText('Unavailable')).toBeVisible()

    context.value = {
      ...context.value,
      wildflyProfileActivityMap: {
        [profile.id]: {
          id: profile.id,
          status: 'ACTIVE',
          health: 'FUNCTIONAL',
          pid: 9001,
          currentDeploymentId: 'live-operation',
          serverLogAvailable: true,
        },
      },
    }
    view.rerender(<PortalDashboardPage />)

    expect(screen.getByText('9001')).toBeVisible()
    expect(screen.getByRole('button', { name: 'View output' })).toBeEnabled()
  })

  it.each([
    ['INACTIVE', 'Start', false],
    ['STARTING', /Starting/, true],
    ['STOPPING', /Stopping/, true],
    ['DEPLOYING', 'Start', true],
  ])('renders %s with its state-aware profile action', async (status, label, disabled) => {
    api.getProfiles.mockResolvedValue([{ ...profile, status, currentDeploymentId: null }])
    const user = userEvent.setup()
    render(<PortalDashboardPage />)

    const action = await screen.findByRole('button', { name: label })
    if (disabled) {
      expect(action).toBeDisabled()
    } else {
      expect(action).toBeEnabled()
      await user.click(action)
      expect(api.startProfile).toHaveBeenCalledWith('opaque/profile:42')
    }
  })
})

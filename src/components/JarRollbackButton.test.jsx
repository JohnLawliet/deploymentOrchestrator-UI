import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getJarSnapshots: vi.fn(),
  isLockConflict: vi.fn(() => false),
  rollbackJar: vi.fn(),
}))
const portal = vi.hoisted(() => ({
  operations: {},
  registerOperation: vi.fn(),
}))

vi.mock('@/lib/contractApi', () => api)
vi.mock('@/context/PortalContext', () => ({ usePortal: () => portal }))

import JarRollbackButton from './JarRollbackButton'

describe('JarRollbackButton', () => {
  beforeEach(() => {
    api.getJarSnapshots.mockResolvedValue([{
      snapshotId: 123,
      applicationName: 'orders',
      createdAt: '2026-08-03T10:00:00Z',
      includesLauncher: true,
      preDeploymentActive: false,
    }])
    api.rollbackJar.mockResolvedValue({ deploymentId: 'rollback-1', status: 'QUEUED' })
    portal.operations = {}
    portal.registerOperation.mockReset()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('lists complete snapshot metadata and registers an asynchronous JAR rollback', async () => {
    const user = userEvent.setup()
    render(<JarRollbackButton resourceId="opaque-uuid" applicationName="orders" />)

    await user.click(screen.getByRole('button', { name: 'Rollback JAR' }))
    expect(api.getJarSnapshots).toHaveBeenCalledWith('orders')
    expect(await screen.findByText('123')).toBeVisible()
    expect(screen.getByText('orders')).toBeVisible()
    expect(screen.getByText('Launcher')).toBeVisible()
    expect(screen.getByText('Was active')).toBeVisible()
    expect(screen.getByText('Yes')).toBeVisible()
    expect(screen.getByText('No')).toBeVisible()

    await user.click(screen.getByRole('button', { name: /123/ }))

    await waitFor(() => expect(api.rollbackJar).toHaveBeenCalledWith(123))
    expect(portal.registerOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 'rollback-1',
        operationType: 'JAR_ROLLBACK',
        resourceType: 'JAR',
        applicationName: 'orders',
      }),
      'JAR:opaque-uuid',
      'Rollback JAR · orders',
    )
  })
})

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  deployJar: vi.fn(),
  getJars: vi.fn(),
  isLockConflict: vi.fn(() => false),
}))
const portal = vi.hoisted(() => ({
  username: 'deploy-user',
  jarProfileActivityMap: {},
  reconcileProfileActivity: vi.fn(() => Promise.resolve()),
  registerOperation: vi.fn(),
}))

vi.mock('@/lib/contractApi', () => api)
vi.mock('@/context/PortalContext', () => ({ usePortal: () => portal }))
vi.mock('@/components/FileBrowser', () => ({
  default: ({ onSelectionChange }) => (
    <button type="button" onClick={() => onSelectionChange(['tech/orders-source.jar'])}>
      Select test JAR
    </button>
  ),
}))

import JarDeploymentPage, {
  generatedLauncherScript,
  launcherPortError,
} from './JarDeploymentPage'

describe('JAR launcher port helpers', () => {
  it('substitutes the target JAR and mandatory port in the generated script', () => {
    expect(generatedLauncherScript('orders.jar', '8087')).toBe(
      'java -jar orders.jar --spring.profiles.active=qc --server.port=8087',
    )
  })

  it('accepts both supported port forms and rejects missing or mismatched ports', () => {
    expect(launcherPortError('java -jar orders.jar --server.port=8087', 8087)).toBe('')
    expect(launcherPortError('java -Dserver.port=8087 -jar orders.jar', 8087)).toBe('')
    expect(launcherPortError('java -jar orders.jar', 8087)).toMatch(/must include/)
    expect(launcherPortError('java -jar orders.jar --server.port=8088', 8087)).toMatch(/must match/)
  })
})

describe('JarDeploymentPage port contract', () => {
  beforeEach(() => {
    api.getJars.mockResolvedValue([{
      id: 'orders',
      applicationName: 'Orders',
      jarName: 'orders-target.jar',
    }])
    api.deployJar.mockResolvedValue({ deploymentId: 'deployment-1' })
    portal.jarProfileActivityMap = {}
    portal.reconcileProfileActivity.mockClear()
    portal.registerOperation.mockClear()
  })

  afterEach(() => cleanup())

  it('requires a valid port and keeps the existing Delete backup option', async () => {
    const user = userEvent.setup()
    render(<JarDeploymentPage />)

    expect(await screen.findByText('Orders · orders-target.jar')).toBeVisible()
    const submit = screen.getByRole('button', { name: 'Deploy JAR' })
    expect(submit).toBeDisabled()
    expect(screen.getByText('Port is required.')).toBeVisible()
    expect(screen.getByText('Delete previous backup?')).toBeVisible()

    await user.type(screen.getByLabelText('Port number (required)'), '65536')
    expect(screen.getByText(/whole number from 1 to 65535/)).toBeVisible()
    expect(submit).toBeDisabled()
  })

  it('updates generated script placeholders but preserves customized text', async () => {
    const user = userEvent.setup()
    render(<JarDeploymentPage />)
    await screen.findByText('Orders · orders-target.jar')
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))
    await user.type(screen.getByLabelText('Port number (required)'), '8087')
    await user.click(screen.getByLabelText('Yes, provide script data'))

    const script = screen.getByLabelText('Script line (optional)')
    expect(script).toHaveValue(
      'java -jar orders-target.jar --spring.profiles.active=qc --server.port=8087',
    )

    await user.clear(script)
    await user.type(script, 'java -Dserver.port=8087 -jar custom.jar')
    await user.clear(screen.getByLabelText('Port number (required)'))
    await user.type(screen.getByLabelText('Port number (required)'), '8088')

    expect(script).toHaveValue('java -Dserver.port=8087 -jar custom.jar')
    expect(screen.getByText(/Every launcher port must match Port 8088/)).toBeVisible()
  })

  it('submits numeric port and preserves script fields and Delete backup', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<JarDeploymentPage />)
    await screen.findByText('Orders · orders-target.jar')
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))
    await user.type(screen.getByLabelText('Port number (required)'), '8087')
    await user.click(screen.getByLabelText('Yes, provide script data'))
    await user.type(screen.getByLabelText('Frontend port (optional)'), '3000')
    await user.type(screen.getByLabelText('Context name (optional)'), 'orders-ui')
    await user.click(screen.getByLabelText('Yes, delete it'))
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }))

    await waitFor(() => expect(api.deployJar).toHaveBeenCalledWith({
      projectName: 'Orders',
      deployerName: 'deploy-user',
      deleteBackup: true,
      requiresScript: true,
      profileId: 'orders',
      sourcePath: 'tech/orders-source.jar',
      port: 8087,
      script: {
        scriptLine: 'java -jar orders-target.jar --spring.profiles.active=qc --server.port=8087',
        frontendPort: 3000,
        contextName: 'orders-ui',
      },
    }))
  })
})

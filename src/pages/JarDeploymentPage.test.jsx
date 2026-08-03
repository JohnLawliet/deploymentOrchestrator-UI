import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  deployJar: vi.fn(),
  getJars: vi.fn(),
  getPortStatus: vi.fn(),
  isLockConflict: vi.fn(() => false),
}))
const portal = vi.hoisted(() => ({
  jarProfileActivityMap: {},
  operations: {},
  lastSystemEvent: null,
  reconcileResourceActivity: vi.fn(() => Promise.resolve()),
  registerOperation: vi.fn(),
}))

vi.mock('@/lib/contractApi', () => api)
vi.mock('@/context/PortalContext', () => ({ usePortal: () => portal }))
vi.mock('@/components/FileBrowser', () => ({
  default: ({ onSelectionChange }) => (
    <button type="button" onClick={() => onSelectionChange(['tech/orders.jar'])}>
      Select test JAR
    </button>
  ),
}))

import JarDeploymentPage from './JarDeploymentPage'
import {
  frontendContextPathError,
  frontendUrl,
  generatedJarCommand,
  normalizeFrontendContextPath,
} from '@/lib/jarContract'

describe('JAR contract helpers', () => {
  it('generates the exact application launcher command', () => {
    expect(generatedJarCommand('orders', '8087')).toBe(
      'java -jar orders.jar --spring.profiles.active=qc --server.port=8087',
    )
  })

  it('normalizes paths and rejects URL, host, query, fragment, backslash, and traversal input', () => {
    expect(normalizeFrontendContextPath(' abcd//child/ ')).toBe('/abcd/child')
    expect(normalizeFrontendContextPath('/')).toBe('/')
    for (const value of ['https://host/a', '//host/a', '/a?x=1', '/a#x', '/a\\b', '/a/../b', '/a/%2e%2e/b']) {
      expect(frontendContextPathError(value)).not.toBe('')
    }
  })

  it('builds a frontend URL from the backend domain, selected port, and optional context', () => {
    expect(frontendUrl('http://192.168.40.192/', '3000', 'orders//ui/'))
      .toBe('http://192.168.40.192:3000/orders/ui')
    expect(frontendUrl('https://qc.example', '3000', '')).toBe('https://qc.example:3000/')
  })
})

describe('JarDeploymentPage port contract', () => {
  beforeEach(() => {
    api.getJars.mockResolvedValue({
      domain: 'http://192.168.40.192',
      jars: [{
        id: 'orders',
        applicationName: 'Orders',
        jarName: 'orders-target.jar',
      }],
    })
    api.deployJar.mockResolvedValue({ deploymentId: 'deployment-1' })
    api.getPortStatus.mockReset()
    api.getPortStatus.mockResolvedValue({
      port: 8087,
      occupied: false,
      ownerType: 'NONE',
      sameApplication: false,
      deploymentAllowed: true,
      message: 'Port 8087 is available',
    })
    portal.jarProfileActivityMap = {}
    portal.operations = {}
    portal.lastSystemEvent = null
    portal.reconcileResourceActivity.mockClear()
    portal.registerOperation.mockClear()
  })

  afterEach(() => cleanup())

  const waitForAvailablePort = () => waitFor(
    () => expect(screen.getByText('Port 8087 is available.')).toBeVisible(),
    { timeout: 2500 },
  )

  it('checks a valid port only after the 800 ms debounce', async () => {
    const user = userEvent.setup()
    render(<JarDeploymentPage />)
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))
    await user.type(screen.getByLabelText('Port number (required)'), '8087')

    await new Promise((resolve) => window.setTimeout(resolve, 700))
    expect(api.getPortStatus).not.toHaveBeenCalled()
    await waitForAvailablePort()
    expect(api.getPortStatus).toHaveBeenCalledWith(8087, 'orders', expect.any(AbortSignal))
  })

  it('shows the occupied process and blocks a nonmatching JAR port', async () => {
    api.getPortStatus.mockResolvedValueOnce({
      port: 8087,
      occupied: true,
      pid: 4242,
      ownerType: 'JAVA_JAR',
      jarName: 'other.jar',
      sameApplication: false,
      deploymentAllowed: false,
      message: 'Port 8087 is used by an unmanaged Java JAR process',
    })
    const user = userEvent.setup()
    render(<JarDeploymentPage />)
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))
    await user.type(screen.getByLabelText('Port number (required)'), '8087')

    expect(await screen.findByText(/PID 4242.*JAR: other.jar/s, {}, { timeout: 2500 })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Deploy JAR' })).toBeDisabled()
  })

  it('supports first deployment with an empty catalogue and requires a valid port', async () => {
    api.getJars.mockResolvedValue([])
    const user = userEvent.setup()
    render(<JarDeploymentPage />)

    expect(await screen.findByText(/You can deploy a new application/)).toBeVisible()
    const submit = screen.getByRole('button', { name: 'Deploy JAR' })
    expect(submit).toBeDisabled()
    expect(screen.queryByText('Port is required.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))
    expect(screen.getByLabelText('Application name (required)')).toHaveValue('orders')

    await user.type(screen.getByLabelText('Port number (required)'), '65536')
    await user.tab()
    expect(screen.getByText(/whole number from 1 to 65535/)).toBeVisible()
    expect(submit).toBeDisabled()
  })

  it('shows required messages only after an empty field loses focus', async () => {
    const user = userEvent.setup()
    render(<JarDeploymentPage />)

    expect(screen.queryByText('Application name is required.')).not.toBeInTheDocument()
    expect(screen.queryByText('Port is required.')).not.toBeInTheDocument()

    const applicationInput = screen.getByLabelText('Application name (required)')
    await user.click(applicationInput)
    await user.tab()
    expect(screen.getByText('Application name is required.')).toBeVisible()
    expect(screen.queryByText('Port is required.')).not.toBeInTheDocument()

    const portInput = screen.getByLabelText('Port number (required)')
    await user.click(portInput)
    await user.tab()
    expect(screen.getByText('Port is required.')).toBeVisible()
  })

  it('generates a read-only launcher from the editable application name and port', async () => {
    const user = userEvent.setup()
    render(<JarDeploymentPage />)
    const applicationInput = screen.getByLabelText('Application name (required)')
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))
    await user.type(screen.getByLabelText('Port number (required)'), '8087')
    await waitForAvailablePort()
    await user.click(screen.getByLabelText('Yes, include launcher settings'))

    const script = screen.getByLabelText('Generated launcher command')
    expect(script).toHaveValue(
      'java -jar orders.jar --spring.profiles.active=qc --server.port=8087',
    )
    expect(script).toHaveAttribute('readonly')
    await user.clear(applicationInput)
    await user.type(applicationInput, 'payments-api')
    expect(script).toHaveValue(
      'java -jar payments-api.jar --spring.profiles.active=qc --server.port=8087',
    )
  })

  it('requires a frontend choice and keeps frontend setup independent from launcher settings', async () => {
    const user = userEvent.setup()
    render(<JarDeploymentPage />)
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))
    await user.type(screen.getByLabelText('Port number (required)'), '8087')
    await waitForAvailablePort()

    expect(screen.getByRole('button', { name: 'Deploy JAR' })).toBeDisabled()
    expect(screen.queryByLabelText('Generated launcher command')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Include frontend deployment'))
    await user.type(screen.getByLabelText('Frontend port (required)'), '3000')
    expect(screen.queryByLabelText('Generated launcher command')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deploy JAR' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }))
    await waitFor(() => expect(api.deployJar).toHaveBeenCalledWith({
      applicationName: 'orders',
      sourcePath: 'tech/orders.jar',
      port: 8087,
      script: { frontendPort: 3000 },
    }))
  })

  it('submits only the latest JAR contract with normalized script fields', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<JarDeploymentPage />)
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))
    await user.type(screen.getByLabelText('Port number (required)'), '8087')
    await waitForAvailablePort()
    await user.click(screen.getByLabelText('Yes, include launcher settings'))
    await user.click(screen.getByLabelText('Include frontend deployment'))
    await user.type(screen.getByLabelText('Frontend port (required)'), '3000')
    await user.type(screen.getByLabelText('Frontend context path (optional)'), 'orders//ui/')
    expect(screen.getByText('http://192.168.40.192:3000/orders/ui')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }))

    await waitFor(() => expect(api.deployJar).toHaveBeenCalledWith({
      applicationName: 'orders',
      sourcePath: 'tech/orders.jar',
      port: 8087,
      script: {
        scriptLine: 'java -jar orders.jar --spring.profiles.active=qc --server.port=8087',
        frontendPort: 3000,
        frontendContextPath: '/orders/ui',
      },
    }))
    expect(portal.registerOperation).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: 'deployment-1', resourceType: 'JAR', applicationName: 'orders' }),
      undefined,
      'Deploy JAR · orders',
    )
  })

  it('sends a trimmed health URL as an optional top-level property', async () => {
    const user = userEvent.setup()
    render(<JarDeploymentPage />)
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))
    await user.type(screen.getByLabelText('Port number (required)'), '8087')
    await waitForAvailablePort()
    await user.type(screen.getByLabelText('Health URL (optional)'), '  https://orders.example/actuator/health  ')
    await user.click(screen.getByLabelText("Use existing frontend / this JAR doesn't require frontend"))
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }))

    await waitFor(() => expect(api.deployJar).toHaveBeenCalledWith({
      applicationName: 'orders',
      sourcePath: 'tech/orders.jar',
      port: 8087,
      healthUrl: 'https://orders.example/actuator/health',
    }))
  })

  it('shows a non-executable JAR ApiError without opening an operation', async () => {
    api.deployJar.mockRejectedValueOnce(Object.assign(
      new Error('The selected JAR does not contain an executable launcher.'),
      { status: 400, code: 'JAR_NOT_EXECUTABLE' },
    ))
    const user = userEvent.setup()
    render(<JarDeploymentPage />)
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))
    await user.type(screen.getByLabelText('Port number (required)'), '8087')
    await waitForAvailablePort()
    await user.click(screen.getByLabelText("Use existing frontend / this JAR doesn't require frontend"))
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }))

    const message = await screen.findByText('The selected JAR does not contain an executable launcher.')
    expect(message.tagName).toBe('STRONG')
    expect(portal.registerOperation).not.toHaveBeenCalled()
  })

  it('shows an INVALID_HEALTH_URL ApiError without opening an operation', async () => {
    api.deployJar.mockRejectedValueOnce(Object.assign(
      new Error('Health URL must use HTTP or HTTPS and resolve to an allowed host.'),
      { status: 400, code: 'INVALID_HEALTH_URL' },
    ))
    const user = userEvent.setup()
    render(<JarDeploymentPage />)
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))
    await user.type(screen.getByLabelText('Port number (required)'), '8087')
    await waitForAvailablePort()
    await user.type(screen.getByLabelText('Health URL (optional)'), 'file:///etc/passwd')
    await user.click(screen.getByLabelText("Use existing frontend / this JAR doesn't require frontend"))
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }))

    const message = await screen.findByText('Health URL must use HTTP or HTTPS and resolve to an allowed host.')
    expect(message.tagName).toBe('STRONG')
    expect(portal.registerOperation).not.toHaveBeenCalled()
  })

  it('omits optional frontend script fields when they are not supplied', async () => {
    const user = userEvent.setup()
    render(<JarDeploymentPage />)
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))
    await user.type(screen.getByLabelText('Port number (required)'), '8087')
    await waitForAvailablePort()
    await user.click(screen.getByLabelText('Yes, include launcher settings'))
    await user.click(screen.getByLabelText("Use existing frontend / this JAR doesn't require frontend"))
    await user.click(screen.getByRole('button', { name: 'Deploy JAR' }))

    await waitFor(() => expect(api.deployJar).toHaveBeenCalled())
    const payload = api.deployJar.mock.calls[0][0]
    expect(payload).not.toHaveProperty('healthUrl')
    expect(payload).not.toHaveProperty('frontendProfile')
    expect(payload).not.toHaveProperty('frontendProfileName')
    expect(payload.script).toEqual({
      scriptLine: 'java -jar orders.jar --spring.profiles.active=qc --server.port=8087',
    })
    for (const obsolete of ['profileId', 'projectName', 'requiresScript', 'deleteBackup', 'deployerName']) {
      expect(payload).not.toHaveProperty(obsolete)
    }
  })

  it('renders associated frontend details for the selected JAR', async () => {
    portal.jarProfileActivityMap = {
      orders: {
        id: 'orders',
        applicationName: 'Orders',
        frontendUrl: 'https://fallback.example/orders',
        frontendContextPath: '/orders',
        frontendProfile: {
          profileName: 'orders-ui',
          frontendUrl: 'https://orders.example',
          documentRoot: '/srv/www/orders',
          directoryExists: false,
          running: false,
        },
      },
    }

    const user = userEvent.setup()
    render(<JarDeploymentPage />)
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))

    expect(await screen.findByText('orders-ui')).toBeVisible()
    expect(screen.getByRole('link', { name: 'https://fallback.example/orders' })).toBeVisible()
    expect(screen.getByText('/orders')).toBeVisible()
    expect(screen.getByText('/srv/www/orders')).toBeVisible()
    expect(screen.getByText('Missing')).toBeVisible()
    expect(screen.getByText('Inactive')).toBeVisible()
    expect(portal.reconcileResourceActivity).toHaveBeenCalledWith('JAR:orders')
  })

  it('retains JAR URL and context details when the frontend profile is unresolved', async () => {
    portal.jarProfileActivityMap = {
      orders: {
        id: 'orders',
        applicationName: 'Orders',
        frontendUrl: 'https://orders.example',
        frontendContextPath: '/orders',
        frontendProfile: null,
      },
    }

    const user = userEvent.setup()
    render(<JarDeploymentPage />)
    await user.click(screen.getByRole('button', { name: 'Select test JAR' }))

    expect(await screen.findByText('Frontend profile unresolved')).toBeVisible()
    expect(screen.getByRole('link', { name: 'https://orders.example' })).toBeVisible()
    expect(screen.getByText('/orders')).toBeVisible()
    expect(screen.getAllByText('Unknown')).toHaveLength(2)
  })
})

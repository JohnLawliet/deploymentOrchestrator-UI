import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  createUpload: vi.fn(),
  executeUpload: vi.fn(),
  getUpload: vi.fn(),
  rollbackUploadItem: vi.fn(),
}))
const state = vi.hoisted(() => ({
  techSelection: ['release/config.xml', 'release/assets'],
  portal: {
    username: 'jonty',
    frontendProfileActivityMap: {},
    wildflyProfileActivityMap: {},
    lastSystemEvent: null,
    systemStatus: 'connected',
  },
}))

vi.mock('@/lib/contractApi', () => api)
vi.mock('@/context/PortalContext', () => ({ usePortal: () => state.portal }))
vi.mock('@/components/FileBrowser', () => ({
  default: ({ rootKey, onSelectionChange, disabled }) => <button
    type="button"
    disabled={disabled}
    onClick={() => onSelectionChange?.(rootKey === 'qc' ? ['profiles/qc1/import'] : state.techSelection)}
  >Choose {rootKey}</button>,
}))
vi.mock('@/components/SearchableProfileSelect', () => ({
  default: ({ profiles, onSelect, getKey = (item) => item.id, getLabel = (item) => item.name || item.profileName || item.id, isDisabled = () => false }) => <div>{profiles.map((profile) => <button type="button" key={getKey(profile)} disabled={isDisabled(profile)} onClick={() => onSelect(profile)}>Select {getLabel(profile)}</button>)}</div>,
}))

import UploadPage from './UploadPage'

const operation = (overrides = {}) => ({
  operationId: 'upload/1',
  mode: 'REGULAR',
  status: 'QUEUED',
  restartRequired: false,
  restartStatus: 'NOT_REQUIRED',
  items: [],
  ...overrides,
})

describe('UploadPage', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.releasePointerCapture = vi.fn()
    sessionStorage.clear()
    state.techSelection = ['release/config.xml', 'release/assets']
    Object.assign(state.portal, {
      username: 'jonty',
      frontendProfileActivityMap: {
        vendorPortalUI: {
          profileName: 'vendorPortalUI', port: 8081, documentRoot: 'D:\\xampp\\htdocs\\vendorPortalUI',
          frontendUrl: 'http://vendor-portal.local', directoryExists: true, running: true,
        },
      },
      wildflyProfileActivityMap: {
        'profile-uuid': { id: 'profile-uuid', profileName: 'qc1', application: 'orders', version: 'wildfly-26', status: 'ACTIVE', health: 'FUNCTIONAL' },
      },
      lastSystemEvent: null,
      systemStatus: 'connected',
    })
    api.createUpload.mockReset()
    api.executeUpload.mockReset()
    api.getUpload.mockReset()
    api.rollbackUploadItem.mockReset()
    api.createUpload.mockResolvedValue(operation())
    api.getUpload.mockResolvedValue(operation())
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders mode-specific controls and constructs a regular relative-path request', async () => {
    const user = userEvent.setup()
    render(<UploadPage />)

    expect(screen.getByRole('heading', { name: 'Upload' })).toBeInTheDocument()
    expect(screen.getByTestId('upload-mode-row')).toHaveClass('grid-cols-2')
    expect(screen.queryByText('Files and directories from Tech Drive')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Regular file upload' }))
    await user.click(screen.getByRole('button', { name: 'Choose techDrive' }))
    await user.click(screen.getByRole('button', { name: 'Choose qc' }))
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    expect(api.createUpload).toHaveBeenCalledWith({
      mode: 'REGULAR',
      sourcePaths: ['release/config.xml', 'release/assets'],
      target: { kind: 'QC_PATH', reference: 'profiles/qc1/import' },
    })
    expect(JSON.parse(sessionStorage.getItem('upload-operation:jonty'))).toEqual({ operationId: 'upload/1', mode: 'REGULAR' })
    expect(screen.getByTestId('upload-results-layout')).toHaveClass('lg:grid-cols-2')
  })

  it('submits a frontend profile port and never its document root', async () => {
    const user = userEvent.setup()
    state.techSelection = ['frontend-build/index.html', 'frontend-build/assets']
    api.createUpload.mockResolvedValue(operation({ mode: 'FRONTEND_HOTFIX', status: 'COMPLETED' }))
    render(<UploadPage />)

    await user.click(screen.getByRole('radio', { name: 'This is a hotfix' }))
    await user.click(screen.getByRole('radio', { name: 'Frontend XAMPP' }))
    await user.click(screen.getByRole('button', { name: 'Select vendorPortalUI' }))
    expect(screen.getByText(/D:\\xampp\\htdocs\\vendorPortalUI/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Choose techDrive' }))
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    expect(api.createUpload).toHaveBeenCalledWith({
      mode: 'FRONTEND_HOTFIX',
      sourcePaths: ['frontend-build/index.html', 'frontend-build/assets'],
      target: { kind: 'FRONTEND_PROFILE', reference: '8081' },
    })
    expect(JSON.stringify(api.createUpload.mock.calls[0][0])).not.toContain('documentRoot')
    expect(JSON.stringify(api.createUpload.mock.calls[0][0])).not.toContain('xampp')
    expect(screen.getByText('Frontend document directory')).toBeInTheDocument()
    expect(screen.getByText('D:\\xampp\\htdocs\\vendorPortalUI')).toBeInTheDocument()
  })

  it('renders WAR preflight items and executes with sourcePath-keyed duplicate choices', async () => {
    const user = userEvent.setup()
    const preflight = operation({
      mode: 'WILDFLY_HOTFIX',
      status: 'AWAITING_SELECTION',
      items: [
        { sourcePath: 'hotfix/one/config.properties', name: 'config.properties', status: 'AMBIGUOUS', candidates: ['WEB-INF/classes/a/config.properties'] },
        { sourcePath: 'hotfix/two/config.properties', name: 'config.properties', status: 'AMBIGUOUS', candidates: ['WEB-INF/classes/b/config.properties'] },
        { sourcePath: 'hotfix/Example.class', name: 'Example.class', status: 'READY', targetPath: 'WEB-INF/classes/Example.class' },
        { sourcePath: 'hotfix/missing.xml', name: 'missing.xml', status: 'MISSING', message: 'No matching target was found.' },
      ],
    })
    api.createUpload.mockResolvedValue(preflight)
    api.executeUpload.mockResolvedValue(operation({ mode: 'WILDFLY_HOTFIX', status: 'RUNNING', items: preflight.items }))
    render(<UploadPage />)

    await user.click(screen.getByRole('radio', { name: 'This is a hotfix' }))
    await user.click(screen.getByRole('radio', { name: 'WAR profile' }))
    await user.click(screen.getByRole('button', { name: 'Select qc1' }))
    await user.click(screen.getByRole('button', { name: 'Choose techDrive' }))
    await user.click(screen.getByRole('button', { name: 'Inspect hotfix' }))

    expect(api.createUpload).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'WILDFLY_HOTFIX',
      target: { kind: 'WILDFLY_PROFILE', reference: 'profile-uuid' },
    }))
    expect(await screen.findByText('config.properties (hotfix/one/config.properties)')).toBeInTheDocument()
    expect(screen.getByText('config.properties (hotfix/two/config.properties)')).toBeInTheDocument()
    expect(screen.getByText('No matching target was found.')).toBeInTheDocument()

    const firstRow = screen.getByText('config.properties (hotfix/one/config.properties)').closest('[data-status]')
    await user.click(within(firstRow).getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'WEB-INF/classes/a/config.properties' }))
    const secondRow = screen.getByText('config.properties (hotfix/two/config.properties)').closest('[data-status]')
    await user.click(within(secondRow).getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'WEB-INF/classes/b/config.properties' }))
    await user.click(screen.getByRole('button', { name: 'Deploy hotfix' }))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('missing item'))
    expect(api.executeUpload).toHaveBeenCalledWith('upload/1', {
      'hotfix/one/config.properties': 'WEB-INF/classes/a/config.properties',
      'hotfix/two/config.properties': 'WEB-INF/classes/b/config.properties',
    })
  })

  it('debounces matching upload events into an authoritative refresh and ignores other operations', async () => {
    const user = userEvent.setup()
    api.createUpload.mockResolvedValue(operation({ status: 'RUNNING' }))
    api.getUpload.mockResolvedValue(operation({ status: 'RUNNING', items: [{ sourcePath: 'release/config.xml', name: 'config.xml', status: 'PROCESSING' }] }))
    const view = render(<UploadPage />)
    await user.click(screen.getByRole('radio', { name: 'Regular file upload' }))
    await user.click(screen.getByRole('button', { name: 'Choose techDrive' }))
    await user.click(screen.getByRole('button', { name: 'Choose qc' }))
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    state.portal.lastSystemEvent = { eventType: 'UPLOAD_ITEM_PROCESSING', deploymentId: 'other-operation' }
    view.rerender(<UploadPage />)
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(api.getUpload).not.toHaveBeenCalled()

    state.portal.lastSystemEvent = { eventType: 'UPLOAD_ITEM_PROCESSING', deploymentId: 'upload/1' }
    view.rerender(<UploadPage />)
    await waitFor(() => expect(api.getUpload).toHaveBeenCalledWith('upload/1'))
    const processingRow = (await screen.findByText('config.xml')).closest('[data-status]')
    expect(processingRow).toHaveAttribute('data-status', 'PROCESSING')
    expect(within(processingRow).getByTestId('upload-item-status-icon')).toHaveClass('bg-blue-100')
  })

  it('clears an expired restored operation and returns to selection', async () => {
    sessionStorage.setItem('upload-operation:jonty', JSON.stringify({ operationId: 'expired/1', mode: 'REGULAR' }))
    api.getUpload.mockRejectedValue(Object.assign(new Error('Unknown upload operation'), { status: 404 }))
    render(<UploadPage />)

    expect(await screen.findByText(/saved upload is no longer available/i)).toBeInTheDocument()
    expect(sessionStorage.getItem('upload-operation:jonty')).toBeNull()
    expect(screen.getByText('Files and directories from Tech Drive')).toBeInTheDocument()
  })

  it('renders restart completion and rolls back only an eligible WAR item', async () => {
    const user = userEvent.setup()
    const preflight = operation({ mode: 'WILDFLY_HOTFIX', status: 'READY', items: [{ sourcePath: 'hotfix/Example.class', name: 'Example.class', status: 'READY', targetPath: 'WEB-INF/classes/Example.class' }] })
    const completed = operation({
      mode: 'WILDFLY_HOTFIX', status: 'COMPLETED', message: 'Upload completed', restartRequired: true, restartStatus: 'COMPLETED',
      items: [{ sourcePath: 'hotfix/Example.class', name: 'Example.class', status: 'SUCCEEDED', targetPath: 'WEB-INF/classes/Example.class', message: 'Copied successfully', rollbackAvailable: true }],
    })
    api.createUpload.mockResolvedValue(preflight)
    api.executeUpload.mockResolvedValue(completed)
    api.rollbackUploadItem.mockResolvedValue(operation({ mode: 'WILDFLY_HOTFIX', status: 'ROLLING_BACK', restartRequired: true, restartStatus: 'PENDING', items: completed.items }))
    api.getUpload.mockResolvedValue(operation({ mode: 'WILDFLY_HOTFIX', status: 'COMPLETED', restartRequired: true, restartStatus: 'COMPLETED', items: [{ ...completed.items[0], status: 'ROLLED_BACK', rollbackAvailable: false }] }))
    render(<UploadPage />)

    await user.click(screen.getByRole('radio', { name: 'This is a hotfix' }))
    await user.click(screen.getByRole('radio', { name: 'WAR profile' }))
    await user.click(screen.getByRole('button', { name: 'Select qc1' }))
    await user.click(screen.getByRole('button', { name: 'Choose techDrive' }))
    await user.click(screen.getByRole('button', { name: 'Inspect hotfix' }))
    await user.click(screen.getByRole('button', { name: 'Deploy hotfix' }))

    expect(await screen.findByText('Profile restart completed.')).toBeInTheDocument()
    expect(screen.queryByText('Upload completed')).not.toBeInTheDocument()
    expect(screen.queryByText('Copied successfully')).not.toBeInTheDocument()
    const successRow = screen.getByText('Example.class').closest('[data-status]')
    expect(within(successRow).getByTestId('upload-item-status-icon')).toHaveClass('bg-green-600')
    expect(within(successRow).queryByText('WEB-INF/classes/Example.class')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rollback' }))
    expect(window.confirm).toHaveBeenLastCalledWith('Rollback Example.class at WEB-INF/classes/Example.class?')
    expect(api.rollbackUploadItem).toHaveBeenCalledWith('upload/1', 'hotfix/Example.class')
    expect(await screen.findByText('ROLLED_BACK')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rollback' })).not.toBeInTheDocument()
  })
})

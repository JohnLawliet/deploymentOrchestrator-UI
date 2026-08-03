import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const portal = vi.hoisted(() => ({
  changeUser: vi.fn(),
}))

vi.mock('@/context/PortalContext', () => ({
  usePortal: () => ({
    username: 'jonty',
    changeUser: portal.changeUser,
    systemStatus: 'connected',
    operations: {},
  }),
}))

import Sidebar from './Sidebar'

describe('Sidebar Upload navigation', () => {
  afterEach(cleanup)

  it('replaces the deferred hotfix item with an active Upload link', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>)

    expect(screen.getByRole('link', { name: 'Upload' })).toHaveAttribute('href', '/upload')
    expect(screen.queryByText('Upload hotfix')).not.toBeInTheDocument()
    expect(screen.queryByText('LATER')).not.toBeInTheDocument()
  })

  it('opens the user menu from the displayed name and changes user from the menu', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Sidebar /></MemoryRouter>)

    expect(screen.queryByRole('button', { name: 'Change user' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'jonty' }))
    await user.click(screen.getByRole('button', { name: 'Change user' }))

    expect(portal.changeUser).toHaveBeenCalledOnce()
  })
})

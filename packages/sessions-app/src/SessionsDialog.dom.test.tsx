import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionsDialog } from './SessionsDialog'
import { createSessionsStore } from './store/sessionsStore'
import { FIXTURE_NOW, makeSessions } from './fixtures'
import { expectNoViolations } from './test/a11y'

const storeOf = () => createSessionsStore({
  client: { list: async () => makeSessions(), revoke: async () => undefined, revokeOthers: async () => undefined },
  host: { now: () => FIXTURE_NOW }
})

describe('SessionsDialog', () => {
  it('окно с заголовком, списком и массовым действием в подвале', async () => {
    render(<SessionsDialog store={storeOf()} onClose={() => {}} now={FIXTURE_NOW} />)
    expect(await screen.findByRole('dialog', { name: 'Сессии и устройства' })).toBeInTheDocument()
    await screen.findByTestId('sessions-panel')
    expect(screen.getByRole('button', { name: 'Выйти на других устройствах (3)' })).toBeInTheDocument()
    await expectNoViolations()
  })

  it('закрывается крестиком и по Esc', async () => {
    const onClose = vi.fn()
    render(<SessionsDialog store={storeOf()} onClose={onClose} now={FIXTURE_NOW} />)
    await screen.findByTestId('sessions-panel')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { InviteRegister } from './InviteRegister'

describe('InviteRegister', () => {
  it('показывает роль, подсказывает политику пароля, регистрирует и зовёт onDone', async () => {
    const api = { inviteInfo: vi.fn(async () => ({ role: 'tester', expiresAt: 9_999_999_999_999, note: 'QA' })), register: vi.fn(async () => ({ ok: true as const })) }
    const onDone = vi.fn()
    render(<InviteRegister token="t1" api={api} onDone={onDone} />)
    expect(await screen.findByText(/как «тестировщик» · QA/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Логин'), 'newbie')
    await userEvent.type(screen.getByLabelText('Пароль'), 'short')
    expect(screen.getByRole('status')).toHaveTextContent('короче 10')
    expect(screen.getByRole('button', { name: 'Создать учётную запись' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Пароль'), '-but-now-long')
    await userEvent.click(screen.getByRole('button', { name: 'Создать учётную запись' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api.register).toHaveBeenCalledWith({ token: 't1', name: 'newbie', password: 'short-but-now-long' })
  })
  it('мёртвое приглашение — сообщение об ошибке', async () => {
    render(<InviteRegister token="x" api={{ inviteInfo: async () => null, register: async () => ({ ok: true as const }) }} onDone={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('недействительно')
  })
})

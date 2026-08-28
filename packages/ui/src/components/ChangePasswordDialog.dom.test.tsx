import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { ChangePasswordDialog } from './ChangePasswordDialog'

describe('ChangePasswordDialog', () => {
  it('подсказывает политику, отправляет current/next и зовёт onDone; ошибка сервера показывается', async () => {
    const change = vi.fn(async ({ current }: { current: string; next: string }) => (current === 'old-password-ok' ? { ok: true as const } : { error: 'Текущий пароль неверен' }))
    const onDone = vi.fn()
    render(<ChangePasswordDialog userName="anna" change={change} onDone={onDone} />)
    await userEvent.type(screen.getByLabelText('Текущий пароль'), 'wrong-password-1')
    await userEvent.type(screen.getByLabelText('Новый пароль'), 'anna-new-password')
    expect(screen.getByRole('status')).toHaveTextContent('логин')
    await userEvent.clear(screen.getByLabelText('Новый пароль'))
    await userEvent.type(screen.getByLabelText('Новый пароль'), 'fresh-new-password-1')
    await userEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Текущий пароль неверен')
    await userEvent.clear(screen.getByLabelText('Текущий пароль'))
    await userEvent.type(screen.getByLabelText('Текущий пароль'), 'old-password-ok')
    await userEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
  it('forced: кнопка «Выйти», текст про временный пароль', () => {
    render(<ChangePasswordDialog userName="anna" change={async () => ({ ok: true as const })} forced onDone={() => {}} onLogout={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Смените временный пароль' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument()
  })
})

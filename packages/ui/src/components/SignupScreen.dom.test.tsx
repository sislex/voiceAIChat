import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { SignupScreen, VerifyScreen } from './SignupScreen'

describe('SignupScreen', () => {
  it('валидирует пароль и email, отправляет заявку и показывает «Проверьте почту» с повторной отправкой', async () => {
    const api = { signup: vi.fn(async () => ({ ok: true as const, mailSent: false })), resend: vi.fn(async () => undefined) }
    render(<SignupScreen api={api} onBack={() => {}} />)
    await userEvent.type(screen.getByLabelText('Логин'), 'nina')
    await userEvent.type(screen.getByLabelText('Email'), 'nina@example.com')
    await userEvent.type(screen.getByLabelText('Пароль'), 'short')
    expect(screen.getByRole('button', { name: 'Зарегистрироваться' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Пароль'), '-long-enough-1')
    await userEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(api.signup).toHaveBeenCalledWith({ name: 'nina', email: 'nina@example.com', password: 'short-long-enough-1' })
    const sent = await screen.findByTestId('signup-sent')
    expect(sent).toHaveTextContent('nina@example.com')
    expect(sent).toHaveTextContent('почта не настроена')
    await userEvent.click(screen.getByRole('button', { name: /ещё раз/ }))
    expect(api.resend).toHaveBeenCalledWith('nina@example.com')
  })
  it('VerifyScreen подтверждает токен и зовёт onDone; ошибка — сообщение', async () => {
    const onDone = vi.fn()
    render(<VerifyScreen token="t1" verify={async () => ({ ok: true as const })} onDone={onDone} onBack={() => {}} />)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    render(<VerifyScreen token="t2" verify={async () => ({ error: 'Ссылка недействительна' })} onDone={() => {}} onBack={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('недействительна')
  })
})

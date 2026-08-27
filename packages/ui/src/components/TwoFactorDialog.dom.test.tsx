import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { TwoFactorDialog } from './TwoFactorDialog'

describe('TwoFactorDialog', () => {
  it('настройка: секрет и ссылка, «Включить» с кодом; затем статус включён и «Выключить»', async () => {
    let enabled = false
    const api = {
      status: vi.fn(async () => ({ enabled })),
      setup: vi.fn(async () => ({ secret: 'ABCDEFGHIJKLMNOP', otpauth: 'otpauth://totp/ChatAI:u?secret=ABCDEFGHIJKLMNOP' })),
      enable: vi.fn(async () => { enabled = true }),
      disable: vi.fn(async () => { enabled = false })
    }
    render(<TwoFactorDialog api={api} onClose={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Настроить' }))
    expect((await screen.findByTestId('two-factor-secret')).textContent).toBe('ABCD EFGH IJKL MNOP')
    expect(screen.getByRole('link', { name: /Открыть в приложении/ })).toHaveAttribute('href', expect.stringContaining('otpauth://'))
    await userEvent.type(screen.getByLabelText('Код из приложения'), '123 456')
    await userEvent.click(screen.getByRole('button', { name: 'Включить 2FA' }))
    expect(api.enable).toHaveBeenCalledWith('123456')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Выключить 2FA' })).toBeInTheDocument())
  })
})

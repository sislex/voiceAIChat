import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginScreen } from './LoginScreen'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'

describe('LoginScreen', () => {
  it('кнопка «Войти» отключена без имени и активна с именем', () => {
    render(<LoginScreen onLogin={vi.fn()} />)
    const btn = screen.getByRole('button', { name: 'Войти' })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Пользователь'), { target: { value: 'user' } })
    expect(btn).not.toBeDisabled()
  })

  it('submit зовёт onLogin с именем и (пустым) паролем', async () => {
    const onLogin = vi.fn()
    render(<LoginScreen onLogin={onLogin} />)
    await userEvent.type(screen.getByLabelText('Пользователь'), 'admin')
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(onLogin).toHaveBeenCalledWith('admin', '')
  })

  it('показывает ошибку', () => {
    render(<LoginScreen onLogin={vi.fn()} error="Неверный логин или пароль" />)
    expect(screen.getByRole('alert').textContent).toContain('Неверный логин')
  })
})

describe('LoginScreen — доступность', () => {
  it('без нарушений axe (в том числе с ошибкой входа)', async () => {
    const { container } = render(<LoginScreen onLogin={vi.fn()} error="Неверный логин или пароль" />)
    await expectNoViolations(container)
    expectLabelledIconButtons(container)
  })
})

describe('LoginScreen — сброс пароля кодом и второй фактор (auth-roadmap пп.6, 10)', () => {
  it('ссылка переключает на форму сброса, отправка зовёт onReset с логином, кодом и паролем', async () => {
    const onReset = vi.fn()
    render(<LoginScreen onLogin={() => {}} onReset={onReset} />)
    await userEvent.click(screen.getByRole('button', { name: /код сброса/ }))
    await userEvent.type(screen.getByLabelText('Пользователь'), 'bob')
    await userEvent.type(screen.getByLabelText('Код от администратора'), 'abcd1234')
    await userEvent.type(screen.getByLabelText('Новый пароль'), 'new-strong-password-1')
    await userEvent.click(screen.getByRole('button', { name: 'Сменить пароль и войти' }))
    expect(onReset).toHaveBeenCalledWith('bob', 'ABCD1234', 'new-strong-password-1')
  })
  it('режим второго фактора: поле кода, «Подтвердить» активна только для 6 цифр', async () => {
    const onCode = vi.fn()
    render(<LoginScreen onLogin={() => {}} twoFactor onCode={onCode} onCancelTwoFactor={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Подтвердить' })
    expect(btn).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Код подтверждения'), '123 456')
    await userEvent.click(btn)
    expect(onCode).toHaveBeenCalledWith('123456')
  })
})

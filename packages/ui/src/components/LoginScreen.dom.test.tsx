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

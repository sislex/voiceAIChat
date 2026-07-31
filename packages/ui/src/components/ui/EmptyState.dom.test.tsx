import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('показывает иконку, заголовок и пояснение', () => {
    render(<EmptyState icon="💬" title="Пока нет бесед — начните первую" description="Разговор появится в списке." />)
    const state = screen.getByTestId('empty-state')
    expect(state).toHaveTextContent('Пока нет бесед — начните первую')
    expect(state).toHaveTextContent('Разговор появится в списке.')
    expect(state.querySelector('.vc-state__ico')).toHaveAttribute('aria-hidden', 'true')
  })

  it('действие — обычная кнопка, клик уходит наружу', async () => {
    const onAction = vi.fn()
    render(<EmptyState title="Пусто" actionLabel="Новый разговор" onAction={onAction} />)
    await userEvent.click(screen.getByRole('button', { name: 'Новый разговор' }))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('без onAction кнопки нет', () => {
    render(<EmptyState title="Пусто" actionLabel="Новый разговор" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

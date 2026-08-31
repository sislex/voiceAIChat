import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SubTabs } from './SubTabs'

const items = [
  { id: 'overview' as const, label: 'Обзор' },
  { id: 'model' as const, label: 'Работа модели' },
  { id: 'checks' as const, label: 'Проверки', count: 3 }
]

describe('SubTabs', () => {
  it('это группа переключателей, а не вложенный tablist', () => {
    // Вложенный tablist требует своих tabpanel с aria-controls — их здесь нет,
    // и axe справедливо ругался.
    render(<SubTabs items={items} value="overview" onChange={() => {}} ariaLabel="Разделы хода выполнения" />)
    expect(screen.getByRole('group', { name: 'Разделы хода выполнения' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('выбранный раздел объявлен aria-pressed', () => {
    render(<SubTabs items={items} value="model" onChange={() => {}} ariaLabel="Разделы" />)
    expect(screen.getByRole('button', { name: 'Работа модели' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Обзор' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('клик сообщает выбранный id', async () => {
    const onChange = vi.fn()
    render(<SubTabs items={items} value="overview" onChange={onChange} ariaLabel="Разделы" />)
    await userEvent.click(screen.getByRole('button', { name: /Проверки/ }))
    expect(onChange).toHaveBeenCalledWith('checks')
  })

  it('нулевой счётчик не рисуется — «0 проверок» шумит', () => {
    const withZero = [{ id: 'a' as const, label: 'Пусто', count: 0 }]
    const { container } = render(<SubTabs items={withZero} value="a" onChange={() => {}} ariaLabel="Разделы" />)
    expect(container.querySelector('.vc-subtab__count')).toBeNull()
  })
})

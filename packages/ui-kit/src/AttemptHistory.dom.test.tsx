import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttemptHistory } from './AttemptHistory'

const attempts = [
  { id: 'a2', attempt: 2, status: 'Успешно', tone: 'success' as const, at: 'сегодня, 11:08' },
  { id: 'a1', attempt: 1, status: 'Ошибка', tone: 'danger' as const, at: 'сегодня, 10:41', note: 'codex · gpt-5' }
]

describe('AttemptHistory', () => {
  it('это упорядоченный список с именем: порядок попыток — часть смысла', () => {
    render(<AttemptHistory attempts={attempts} />)
    const list = screen.getByRole('list', { name: 'История попыток' })
    expect(list.tagName).toBe('OL')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('статус — словом, а число попыток стоит в заголовке', () => {
    render(<AttemptHistory attempts={attempts} />)
    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('История попыток 2')
    expect(screen.getByText('Успешно')).toBeInTheDocument()
    expect(screen.getByText('Ошибка')).toBeInTheDocument()
  })

  it('без onSelect строки не кнопки — переключать нечего', () => {
    render(<AttemptHistory attempts={attempts} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('с onSelect выбранная попытка помечена aria-current, а не aria-selected', () => {
    // `aria-selected` допустим только внутри listbox/grid; здесь обычный список.
    const onSelect = vi.fn()
    render(<AttemptHistory attempts={attempts} selectedId="a2" onSelect={onSelect} />)
    const rows = screen.getAllByRole('button')
    expect(rows[0]).toHaveAttribute('aria-current', 'true')
    expect(rows[1]).not.toHaveAttribute('aria-current')
    expect(rows[1]).not.toHaveAttribute('aria-selected')
  })

  it('клик по строке сообщает id попытки', async () => {
    const onSelect = vi.fn()
    render(<AttemptHistory attempts={attempts} selectedId="a2" onSelect={onSelect} />)
    await userEvent.click(screen.getAllByRole('button')[1]!)
    expect(onSelect).toHaveBeenCalledWith('a1')
  })

  it('заголовок переопределяется — он же имя списка', () => {
    render(<AttemptHistory attempts={attempts} title="Попытки merge" />)
    expect(screen.getByRole('list', { name: 'Попытки merge' })).toBeInTheDocument()
  })
})

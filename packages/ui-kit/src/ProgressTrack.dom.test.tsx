import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressRing, ProgressTrack } from './ProgressTrack'

describe('ProgressTrack', () => {
  it('объявляет себя прогрессом с именем — безымянный прогрессбар читалке бесполезен', () => {
    render(<ProgressTrack value={2} max={3} label="Подзадачи" />)
    const bar = screen.getByRole('progressbar', { name: 'Подзадачи' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuemax', '3')
  })

  it('заполнение уходит переменной, а не классом', () => {
    const { container } = render(<ProgressTrack value={2} max={3} label="Подзадачи" />)
    expect(container.querySelector<HTMLElement>('.vc-track__fill')?.style.getPropertyValue('--vc-progress')).toBe('66.7%')
  })

  it('значение вне диапазона подрезается, а не ломает полосу', () => {
    const { container } = render(<ProgressTrack value={9} max={3} label="Сценарии" />)
    expect(container.querySelector<HTMLElement>('.vc-track__fill')?.style.getPropertyValue('--vc-progress')).toBe('100.0%')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
  })

  it('нулевой максимум не даёт NaN', () => {
    const { container } = render(<ProgressTrack value={1} max={0} label="Пусто" />)
    expect(container.querySelector<HTMLElement>('.vc-track__fill')?.style.getPropertyValue('--vc-progress')).toBe('0.0%')
  })
})

describe('ProgressRing', () => {
  it('в центре — проценты, и они же в aria', () => {
    render(<ProgressRing value={68} label="Ход выполнения" />)
    const ring = screen.getByRole('progressbar', { name: 'Ход выполнения' })
    expect(ring).toHaveTextContent('68%')
    expect(ring).toHaveAttribute('aria-valuenow', '68')
    expect(ring.style.getPropertyValue('--vc-progress')).toBe('68.0%')
  })

  it('подпись в центре можно заменить — например, на счёт сценариев', () => {
    render(<ProgressRing value={12} max={12} label="Сценарии" caption="12/12" />)
    expect(screen.getByRole('progressbar')).toHaveTextContent('12/12')
    expect(screen.getByRole('progressbar')).toHaveClass('vc-ring--running')
  })
})

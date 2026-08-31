import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QaScore } from './QaScore'

describe('QaScore', () => {
  it('счёт виден цифрой и объявлен прогрессом', () => {
    render(<QaScore passed={12} total={12} />)
    expect(screen.getByTestId('qa-score')).toHaveTextContent('12/12')
    const bar = screen.getByRole('progressbar', { name: 'Пройдено сценариев' })
    expect(bar).toHaveAttribute('aria-valuenow', '12')
    expect(bar).toHaveAttribute('aria-valuemax', '12')
  })

  it('тон выводится из счёта: всё, часть, ничего', () => {
    const { rerender } = render(<QaScore passed={12} total={12} />)
    expect(screen.getByRole('progressbar')).toHaveClass('vc-track--success')
    rerender(<QaScore passed={7} total={12} />)
    expect(screen.getByRole('progressbar')).toHaveClass('vc-track--warning')
    rerender(<QaScore passed={0} total={12} />)
    expect(screen.getByRole('progressbar')).toHaveClass('vc-track--danger')
  })

  it('пустой этап нейтрален, а не «всё прошло»', () => {
    render(<QaScore passed={0} total={0} />)
    expect(screen.getByRole('progressbar')).toHaveClass('vc-track--neutral')
  })

  it('единицу измерения задаёт вызывающая сторона', () => {
    render(<QaScore passed={3} total={3} unit="проверок" />)
    expect(screen.getByTestId('qa-score')).toHaveTextContent('проверок прошли')
  })
})

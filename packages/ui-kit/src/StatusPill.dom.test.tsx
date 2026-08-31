import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusPill } from './StatusPill'

describe('StatusPill', () => {
  it('тон превращается в модификатор и в data-атрибут', () => {
    render(<StatusPill tone="warning">Требует внимания</StatusPill>)
    const pill = screen.getByTestId('status-pill')
    expect(pill).toHaveClass('vc-pill', 'vc-pill--warning')
    expect(pill).toHaveAttribute('data-tone', 'warning')
  })

  it('без тона — нейтральная', () => {
    render(<StatusPill>Нет данных</StatusPill>)
    expect(screen.getByTestId('status-pill')).toHaveClass('vc-pill--neutral')
  })

  it('подпись остаётся текстом — её читает скринридер', () => {
    render(<StatusPill tone="success">Успешно</StatusPill>)
    expect(screen.getByText('Успешно')).toBeInTheDocument()
  })
})

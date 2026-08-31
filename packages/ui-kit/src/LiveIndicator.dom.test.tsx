import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveIndicator } from './LiveIndicator'

describe('LiveIndicator', () => {
  it('объявляет себя живой областью — иначе читалка не узнает про активный ран', () => {
    render(<LiveIndicator />)
    const live = screen.getByRole('status')
    expect(live).toHaveTextContent('Live')
    expect(live).toHaveClass('vc-live')
  })

  it('погашенный вариант остаётся на месте, но помечен модификатором', () => {
    render(<LiveIndicator active={false} label="Ран завершён" />)
    expect(screen.getByRole('status')).toHaveClass('vc-live--idle')
    expect(screen.getByText('Ран завершён')).toBeInTheDocument()
  })
})

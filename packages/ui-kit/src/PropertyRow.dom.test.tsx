import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PropertyRow } from './PropertyRow'

describe('PropertyRow', () => {
  it('в режиме label подпись связана с контролом — dt/dd этого не умеют', () => {
    render(
      <PropertyRow as="label" label="Приоритет">
        <select><option>Высокий</option></select>
      </PropertyRow>
    )
    expect(screen.getByRole('combobox', { name: 'Приоритет' })).toBeInTheDocument()
  })

  it('в режиме div подпись остаётся текстом рядом со значением', () => {
    render(<PropertyRow label="Автор"><strong>Михаил</strong></PropertyRow>)
    const row = screen.getByText('Автор').closest('.vc-prop')
    expect(row?.tagName).toBe('DIV')
    expect(row).toHaveTextContent('Михаил')
  })

  it('широкая строка помечена модификатором — чипы берут всю ширину', () => {
    render(<PropertyRow label="Метки" wide testId="labels">чипы</PropertyRow>)
    expect(screen.getByTestId('labels')).toHaveClass('vc-prop--wide')
  })
})

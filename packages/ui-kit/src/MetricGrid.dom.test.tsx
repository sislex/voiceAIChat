import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricGrid } from './MetricGrid'

describe('MetricGrid', () => {
  it('подпись и значение связаны как термин и определение', () => {
    const { container } = render(
      <MetricGrid items={[{ label: 'Длительность', value: '4 мин 18 сек' }, { label: 'Машина', value: 'MacBook · online' }]} />
    )
    const terms = [...container.querySelectorAll('dt')].map((node) => node.textContent)
    const values = [...container.querySelectorAll('dd')].map((node) => node.textContent)
    expect(terms).toEqual(['Длительность', 'Машина'])
    expect(values).toEqual(['4 мин 18 сек', 'MacBook · online'])
  })

  it('число колонок уходит переменной — под каждое значение класса не напасёшься', () => {
    render(<MetricGrid items={[{ label: 'Модель', value: 'GPT-5' }]} columns={2} />)
    expect(screen.getByTestId('metric-grid').style.getPropertyValue('--vc-metrics-columns')).toBe('2')
  })

  it('колонок не меньше одной даже при нулевом значении', () => {
    render(<MetricGrid items={[{ label: 'Модель', value: 'GPT-5' }]} columns={0} />)
    expect(screen.getByTestId('metric-grid').style.getPropertyValue('--vc-metrics-columns')).toBe('1')
  })

  it('полное значение показывается под курсором, когда видимое обрезано', () => {
    render(<MetricGrid items={[{ label: 'Ветка', value: 'task/CHAT-2…', title: 'task/CHAT-248-search' }]} />)
    expect(screen.getByText('task/CHAT-2…')).toHaveAttribute('title', 'task/CHAT-248-search')
  })
})

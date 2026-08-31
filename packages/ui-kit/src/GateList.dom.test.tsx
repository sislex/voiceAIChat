import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GateList } from './GateList'

const checks = [
  { id: 'ts', name: 'TypeScript', detail: 'Ошибок нет', verdict: 'Пройдено', tone: 'success' as const },
  { id: 'cov', name: 'Coverage', detail: '76% при пороге 80%', verdict: 'Не пройдено', tone: 'danger' as const }
]

describe('GateList', () => {
  it('это неупорядоченный список: проверки гейта равноправны', () => {
    render(<GateList checks={checks} ariaLabel="Проверки Automated QA" />)
    const list = screen.getByRole('list', { name: 'Проверки Automated QA' })
    expect(list.tagName).toBe('UL')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('вердикт стоит словом, а значок скрыт от читалки', () => {
    render(<GateList checks={checks} ariaLabel="Проверки" />)
    const failed = screen.getByText('Не пройдено')
    expect(failed).toHaveClass('vc-gate__verdict--danger')
    expect(screen.getAllByRole('listitem')[1]!.querySelector('.vc-gate__mark')).toHaveAttribute('aria-hidden', 'true')
  })

  it('тон уходит и в модификатор, и в data-атрибут', () => {
    render(<GateList checks={checks} ariaLabel="Проверки" />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveClass('vc-gate--success')
    expect(items[1]).toHaveAttribute('data-tone', 'danger')
  })

  it('без тона проверка нейтральна', () => {
    render(<GateList checks={[{ name: 'Lint', verdict: 'Ожидает' }]} ariaLabel="Проверки" />)
    expect(screen.getByRole('listitem')).toHaveAttribute('data-tone', 'neutral')
  })
})

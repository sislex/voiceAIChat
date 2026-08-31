import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SectionHeader } from './SectionHeader'

describe('SectionHeader', () => {
  it('по умолчанию заголовок третьего уровня — окно уже заняло второй', () => {
    render(<SectionHeader title="Описание" />)
    expect(screen.getByRole('heading', { level: 3, name: 'Описание' })).toBeInTheDocument()
  })

  it('сводка и действие стоят рядом с названием', () => {
    render(<SectionHeader title="Подзадачи" meta="2 из 3" action={<button>Добавить</button>} />)
    expect(screen.getByText('2 из 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument()
  })

  it('без сводки и действия лишних узлов нет', () => {
    const { container } = render(<SectionHeader title="Активность" />)
    expect(container.querySelector('.vc-section-head__meta')).toBeNull()
    expect(container.querySelector('.vc-section-head__action')).toBeNull()
  })
})

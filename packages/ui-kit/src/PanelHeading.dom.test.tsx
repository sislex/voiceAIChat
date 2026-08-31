import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PanelHeading } from './PanelHeading'
import { StatusPill } from './StatusPill'

describe('PanelHeading', () => {
  it('по умолчанию заголовок третьего уровня — окно уже заняло второй', () => {
    render(<PanelHeading title="Подготовка к разработке" />)
    expect(screen.getByRole('heading', { level: 3, name: 'Подготовка к разработке' })).toBeInTheDocument()
  })

  it('уровень заголовка задаётся снаружи', () => {
    render(<PanelHeading title="Слияние" level={2} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Слияние' })).toBeInTheDocument()
  })

  it('надзаголовок, пояснение и действия рисуются рядом с заголовком', () => {
    render(
      <PanelHeading
        kicker="Попытка 2"
        title="Подготовка"
        description="Анализ требований."
        actions={<StatusPill tone="success">Успешно</StatusPill>}
      />
    )
    expect(screen.getByText('Попытка 2')).toBeInTheDocument()
    expect(screen.getByText('Анализ требований.')).toBeInTheDocument()
    expect(screen.getByTestId('status-pill')).toBeInTheDocument()
  })

  it('titleId позволяет панели сослаться на заголовок', () => {
    render(<PanelHeading title="Quality gate" titleId="gate-title" />)
    expect(screen.getByRole('heading', { name: 'Quality gate' })).toHaveAttribute('id', 'gate-title')
  })

  it('без пояснения и действий лишних узлов нет', () => {
    const { container } = render(<PanelHeading title="Merge" />)
    expect(container.querySelector('.vc-panel-head__desc')).toBeNull()
    expect(container.querySelector('.vc-panel-head__actions')).toBeNull()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ProjectDetail } from '@shared/projects'
import type { AutomatedQaScenario } from '@shared/qa'
import { AutomatedQaScenarioEditor } from './AutomatedQaScenarioEditor'

const detail = (scenario?: AutomatedQaScenario): ProjectDetail =>
  ({ id: 'p1', automatedQaScenario: scenario } as unknown as ProjectDetail)

describe('AutomatedQaScenarioEditor', () => {
  it('пустой сценарий предупреждает, что этап заблокируется', () => {
    render(<AutomatedQaScenarioEditor detail={detail()} isOwner onUpdate={vi.fn()} />)
    expect(screen.getByText('Шагов нет: этап заблокируется, пока сценарий пуст.')).toBeInTheDocument()
  })

  it('добавляет шаг и сохраняет стартовый адрес', () => {
    const onUpdate = vi.fn()
    render(<AutomatedQaScenarioEditor detail={detail()} isOwner onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText('Стартовый адрес'), { target: { value: 'http://localhost:5173' } })
    expect(onUpdate).toHaveBeenCalledWith('p1', { automatedQaScenario: { startUrl: 'http://localhost:5173', steps: [] } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить шаг' }))
    expect(onUpdate.mock.calls.at(-1)?.[1].automatedQaScenario.steps).toHaveLength(1)
  })

  it('смена вида действия переносит селектор, а не теряет его', () => {
    const onUpdate = vi.fn()
    const scenario: AutomatedQaScenario = { startUrl: 'http://x', steps: [{ id: 's1', title: 'Кнопка', action: { kind: 'click', selector: '#create' } }] }
    render(<AutomatedQaScenarioEditor detail={detail(scenario)} isOwner onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText('Действие'), { target: { value: 'wait' } })
    expect(onUpdate.mock.calls.at(-1)?.[1].automatedQaScenario.steps[0].action).toEqual({ kind: 'wait', selector: '#create' })
  })

  it('участнику проекта поля недоступны', () => {
    const scenario: AutomatedQaScenario = { startUrl: 'http://x', steps: [{ id: 's1', title: 'Кнопка', action: { kind: 'click', selector: '#create' } }] }
    render(<AutomatedQaScenarioEditor detail={detail(scenario)} isOwner={false} onUpdate={vi.fn()} />)
    expect(screen.getByLabelText('Стартовый адрес')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Добавить шаг' })).toBeDisabled()
  })
})

describe('проверка стартового адреса (круг 10)', () => {
  it('localhost объясняется сразу, а не через минуты прогона', () => {
    const scenario: AutomatedQaScenario = { startUrl: 'http://localhost:5173', steps: [] }
    render(<AutomatedQaScenarioEditor detail={detail(scenario)} isOwner onUpdate={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('не ходит в localhost')
  })
  it('внешний адрес не ругается', () => {
    render(<AutomatedQaScenarioEditor detail={detail({ startUrl: 'https://example.com', steps: [] })} isOwner onUpdate={vi.fn()} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

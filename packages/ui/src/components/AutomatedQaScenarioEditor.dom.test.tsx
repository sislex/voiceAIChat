import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ProjectDetail } from '@shared/projects'
import type { AutomatedQaScenario } from '@shared/qa'
import { AutomatedQaScenarioEditor } from './AutomatedQaScenarioEditor'

const detail = (scenario?: AutomatedQaScenario): ProjectDetail =>
  ({ id: 'p1', automatedQaScenarios: scenario ? [scenario] : [] } as unknown as ProjectDetail)

describe('AutomatedQaScenarioEditor', () => {
  it('пустой сценарий предупреждает, что этап заблокируется', () => {
    render(<AutomatedQaScenarioEditor detail={detail()} isOwner onUpdate={vi.fn()} />)
    expect(screen.getByText('Шагов нет: этап заблокируется, пока сценарий пуст.')).toBeInTheDocument()
  })

  it('добавляет шаг и сохраняет стартовый адрес', () => {
    const onUpdate = vi.fn()
    render(<AutomatedQaScenarioEditor detail={detail()} isOwner onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText('Стартовый адрес'), { target: { value: 'http://localhost:5173' } })
    // Сохранение всегда отдаёт весь набор — сценариев у проекта может быть много.
    expect(onUpdate).toHaveBeenCalledWith('p1', { automatedQaScenarios: [{ startUrl: 'http://localhost:5173', steps: [] }] })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить шаг' }))
    expect(onUpdate.mock.calls.at(-1)?.[1].automatedQaScenarios[0].steps).toHaveLength(1)
  })

  it('смена вида действия переносит селектор, а не теряет его', () => {
    const onUpdate = vi.fn()
    const scenario: AutomatedQaScenario = { startUrl: 'http://x', steps: [{ id: 's1', title: 'Кнопка', action: { kind: 'click', selector: '#create' } }] }
    render(<AutomatedQaScenarioEditor detail={detail(scenario)} isOwner onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText('Действие'), { target: { value: 'wait' } })
    expect(onUpdate.mock.calls.at(-1)?.[1].automatedQaScenarios[0].steps[0].action).toEqual({ kind: 'wait', selector: '#create' })
  })

  it('участнику проекта поля недоступны', () => {
    const scenario: AutomatedQaScenario = { startUrl: 'http://x', steps: [{ id: 's1', title: 'Кнопка', action: { kind: 'click', selector: '#create' } }] }
    render(<AutomatedQaScenarioEditor detail={detail(scenario)} isOwner={false} onUpdate={vi.fn()} />)
    expect(screen.getByLabelText('Стартовый адрес')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Добавить шаг' })).toBeDisabled()
  })
})

describe('проверка стартового адреса (круг 10)', () => {
  // На экране может быть несколько тревог (беды набора целиком), поэтому
  // проверяем именно ту, что относится к адресу.
  const urlProblem = (): HTMLElement | null => document.getElementById('qa-scenario-url-problem')

  it('localhost объясняется сразу, а не через минуты прогона', () => {
    const scenario: AutomatedQaScenario = { startUrl: 'http://localhost:5173', steps: [] }
    render(<AutomatedQaScenarioEditor detail={detail(scenario)} isOwner onUpdate={vi.fn()} />)
    expect(urlProblem()).toHaveTextContent('не ходит в localhost')
  })
  it('внешний адрес не ругается', () => {
    render(<AutomatedQaScenarioEditor detail={detail({ startUrl: 'https://example.com', steps: [] })} isOwner onUpdate={vi.fn()} />)
    expect(urlProblem()).toBeNull()
  })
})

describe('дисциплина набора (круг 21)', () => {
  const withScenarios = (...items: AutomatedQaScenario[]): ProjectDetail =>
    ({ id: 'p1', automatedQaScenarios: items } as unknown as ProjectDetail)

  it('повтор названия и пустой адрес названы прямо', () => {
    render(<AutomatedQaScenarioEditor
      detail={withScenarios(
        { name: 'Вход', startUrl: 'http://a/', steps: [{ id: 's', title: 'ш', action: { kind: 'click', selector: '#a' } }] },
        { name: 'Вход', startUrl: '', steps: [] }
      )}
      isOwner onUpdate={vi.fn()} />)
    expect(screen.getByText(/Название «Вход» повторяется/)).toBeInTheDocument()
    expect(screen.getByText(/заблокирует весь этап/)).toBeInTheDocument()
  })

  it('новый сценарий не уезжает в проект, пока у него нет адреса', () => {
    const onUpdate = vi.fn()
    render(<AutomatedQaScenarioEditor
      detail={withScenarios({ name: 'Вход', startUrl: 'http://a/', steps: [{ id: 's', title: 'ш', action: { kind: 'click', selector: '#a' } }] })}
      isOwner onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить сценарий' }))
    // Пустой сценарий в проекте заблокировал бы весь этап, поэтому он черновик.
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Стартовый адрес'), { target: { value: 'https://example.com' } })
    expect(onUpdate).toHaveBeenCalledWith('p1', { automatedQaScenarios: expect.arrayContaining([expect.objectContaining({ startUrl: 'https://example.com' })]) })
  })
})

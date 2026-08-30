import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('разовый прогон набора (круг 24)', () => {
  const detailWith = (...items: AutomatedQaScenario[]): ProjectDetail =>
    ({ id: 'p1', automatedQaScenarios: items } as unknown as ProjectDetail)
  const scenario = { name: 'Вход', startUrl: 'http://a/', steps: [{ id: 's', title: 'ш', action: { kind: 'click' as const, selector: '#a' } }] }

  it('показывает исход каждого сценария', async () => {
    const onCheck = vi.fn(async () => ([
      { name: 'Вход', passed: true, blocked: null, steps: [], durationMs: 1200 },
      { name: 'Доска', passed: false, blocked: null, durationMs: 800, steps: [{ id: 's', title: 'Создать', status: 'failed' as const, detail: 'не найден', durationMs: 5 }] }
    ]))
    render(<AutomatedQaScenarioEditor detail={detailWith(scenario)} isOwner onUpdate={vi.fn()} onCheck={onCheck} />)
    fireEvent.click(screen.getByRole('button', { name: 'Прогнать набор сейчас' }))
    expect(await screen.findByText(/Вход: пройден/)).toBeInTheDocument()
    // Провалившийся шаг назван: без этого «провален» не подсказывает, куда смотреть.
    expect(screen.getByText(/Доска: провален на шаге «Создать»/)).toBeInTheDocument()
  })

  it('заблокированный прогон объясняет причину', async () => {
    const onCheck = vi.fn(async () => ([{ name: 'Вход', passed: false, blocked: 'Стартовый адрес не открылся', steps: [], durationMs: 300 }]))
    render(<AutomatedQaScenarioEditor detail={detailWith(scenario)} isOwner onUpdate={vi.fn()} onCheck={onCheck} />)
    fireEvent.click(screen.getByRole('button', { name: 'Прогнать набор сейчас' }))
    const line = await screen.findByText(/заблокирован — Стартовый адрес не открылся/)
    // Заблокированный отличается от провального не только словом: красный
    // цвет провала заставляет искать дефект там, где проверка вообще не шла.
    expect(line.closest('li')).toHaveAttribute('data-state', 'blocked')
  })

  it('шаги переставляются: раньше поменять порядок можно было только удалив шаг', () => {
    const onUpdate = vi.fn()
    const two: AutomatedQaScenario = { name: 'Доска', startUrl: 'https://a.b/', steps: [
      { id: 's1', title: 'Первый', action: { kind: 'click', selector: '#a' } },
      { id: 's2', title: 'Второй', action: { kind: 'click', selector: '#b' } }
    ] }
    render(<AutomatedQaScenarioEditor detail={detailWith(two)} isOwner onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Поднять шаг «Второй»' }))
    expect(onUpdate.mock.calls[0][1].automatedQaScenarios[0].steps.map((step: { id: string }) => step.id)).toEqual(['s2', 's1'])
    // У крайних шагов направление, которого нет, недоступно.
    expect(screen.getByRole('button', { name: 'Поднять шаг «Первый»' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Опустить шаг «Второй»' })).toBeDisabled()
  })

  it('ошибки страницы видны рядом с итогом сценария', async () => {
    // Иначе человек, который только что записал сценарий, видит «провален» и
    // идёт перезапускать, вместо того чтобы прочитать причину.
    const onCheck = vi.fn(async () => ([{
      name: 'Доска', passed: false, blocked: null, durationMs: 4200,
      steps: [{ id: 's', title: 'Создать', status: 'failed' as const, detail: 'локатор не найден', durationMs: 4000 }],
      pageErrors: ['Uncaught TypeError: columns is undefined']
    }]))
    render(<AutomatedQaScenarioEditor detail={detailWith(scenario)} isOwner onUpdate={vi.fn()} onCheck={onCheck} />)
    fireEvent.click(screen.getByRole('button', { name: 'Прогнать набор сейчас' }))
    expect(await screen.findByText('Uncaught TypeError: columns is undefined')).toBeInTheDocument()
  })

  it('снимок разового прогона показывается содержимым: роут снимка без рана отвечает 404', async () => {
    const onCheck = vi.fn(async () => ([{
      name: 'Доска', passed: false, blocked: null, durationMs: 900, steps: [],
      screenshot: 'data:image/png;base64,QQ=='
    }]))
    render(<AutomatedQaScenarioEditor detail={detailWith(scenario)} isOwner onUpdate={vi.fn()} onCheck={onCheck} />)
    fireEvent.click(screen.getByRole('button', { name: 'Прогнать набор сейчас' }))
    expect((await screen.findByAltText('Экран в конце сценария «Доска»') as HTMLImageElement).src).toContain('base64,QQ==')
  })

  it('отдельный сценарий прогоняется без остального набора', async () => {
    const onCheck = vi.fn(async () => ([]))
    const detail = detailWith(
      { name: 'Вход', startUrl: 'https://a.b/', steps: [{ id: 's1', title: 'Шаг', action: { kind: 'click', selector: '#a' } }] },
      { name: 'Доска', startUrl: 'https://a.b/board', steps: [{ id: 's1', title: 'Шаг', action: { kind: 'click', selector: '#b' } }] }
    )
    render(<AutomatedQaScenarioEditor detail={detail} isOwner onUpdate={vi.fn()} onCheck={onCheck} />)
    fireEvent.click(screen.getByRole('button', { name: 'Только «Вход»' }))
    await waitFor(() => expect(onCheck).toHaveBeenCalledWith(detail.id, 0))
  })

  it('отказ сервера показывается, а не теряется', async () => {
    const onCheck = vi.fn(async () => { throw new Error('Изолированный Chromium не настроен') })
    render(<AutomatedQaScenarioEditor detail={detailWith(scenario)} isOwner onUpdate={vi.fn()} onCheck={onCheck} />)
    fireEvent.click(screen.getByRole('button', { name: 'Прогнать набор сейчас' }))
    expect(await screen.findByText('Изолированный Chromium не настроен')).toBeInTheDocument()
  })

  it('без обработчика кнопки нет — сервер может не уметь прогон', () => {
    render(<AutomatedQaScenarioEditor detail={detailWith(scenario)} isOwner onUpdate={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Прогнать набор сейчас' })).not.toBeInTheDocument()
  })
})

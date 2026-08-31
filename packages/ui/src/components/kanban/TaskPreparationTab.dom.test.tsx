// Задача A: список ранов подготовки грузится один раз (REST), а обновления
// приходят по WS точечно — на событие preparation.run.updated догружается только
// изменившийся ран (loadRun), без перезапроса всего тяжёлого списка (loadRuns).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TaskPreparationRun } from '@shared/qa'
import { TaskPreparationTab } from './TaskPreparationTab'

function run(over: Partial<TaskPreparationRun> = {}): TaskPreparationRun {
  return { id: 'run-1', projectId: 'p1', taskId: 't1', status: 'running', stage: 'brief_generation', attempt: 1, log: 'log', events: [], questions: [], readiness: null, gateResults: [], gateReasons: [], createdBy: 'admin', createdAt: 1, updatedAt: 1, ...over } as TaskPreparationRun
}

let updateCb: ((e: { projectId: string; taskId: string; runId: string }) => void) | null = null
function stubBoard(): void {
  ;(window as { board?: unknown }).board = {
    onPreparationRunUpdated: (cb: (e: { projectId: string; taskId: string; runId: string }) => void) => { updateCb = cb; return () => { updateCb = null } },
    onReconnect: () => () => {}
  }
  ;(window as { ci?: unknown }).ci = {
    getTaskMachines: async () => ({ machines: [], effectiveAgentId: null }),
    getTaskPreparationLlm: async () => ({ provider: 'claude' as const, model: 'opus', llmEngineId: null })
  }
}

afterEach(() => { cleanup(); vi.useRealTimers(); delete (window as { board?: unknown }).board; delete (window as { ci?: unknown }).ci; updateCb = null })

describe('TaskPreparationTab — REST один раз, обновления по WS', () => {
  it('грузит список один раз, а на WS-событие догружает только один ран', async () => {
    stubBoard()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const loadRuns = vi.fn(async () => [run({ status: 'running' })])
    const loadRun = vi.fn(async (id: string) => run({ id, status: 'completed' }))
    render(<TaskPreparationTab projectId="p1" taskId="t1" loadRuns={loadRuns} loadRun={loadRun} />)
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(1))

    // Несколько WS-событий по одному рану коалесятся в одну догрузку.
    updateCb?.({ projectId: 'p1', taskId: 't1', runId: 'run-1' })
    updateCb?.({ projectId: 'p1', taskId: 't1', runId: 'run-1' })
    await vi.advanceTimersByTimeAsync(600)
    await waitFor(() => expect(loadRun).toHaveBeenCalledWith('run-1'))
    // Список НЕ перезапрашивается на обновлениях.
    expect(loadRuns).toHaveBeenCalledTimes(1)
  })

  it('чужой taskId в событии игнорируется', async () => {
    stubBoard()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const loadRuns = vi.fn(async () => [run()])
    const loadRun = vi.fn(async (id: string) => run({ id }))
    render(<TaskPreparationTab projectId="p1" taskId="t1" loadRuns={loadRuns} loadRun={loadRun} />)
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(1))
    updateCb?.({ projectId: 'p1', taskId: 'OTHER', runId: 'run-9' })
    await vi.advanceTimersByTimeAsync(600)
    expect(loadRun).not.toHaveBeenCalled()
  })
})

describe('TaskPreparationTab — форма запуска', () => {
  // Селекты стояли голыми в строке текста и были втрое мельче соседних полей
  // карточки, а пустоту и ошибки вкладка показывала своим текстом.
  it('одевает селекты в общий класс и показывает пустоту общим экраном', async () => {
    stubBoard()
    render(<TaskPreparationTab projectId="p1" taskId="t1" loadRuns={async () => []} llmAccess={[{ provider: 'claude', models: ['opus'] }] as never} />)

    const provider = await screen.findByRole('combobox', { name: 'Провайдер модели' })
    expect(provider).toHaveClass('sel')
    expect(provider.closest('label')).toHaveClass('task-preparation-field')
    expect(screen.getByTestId('task-preparation-no-machines')).toHaveClass('vc-state--empty')
    expect(screen.getByTestId('task-preparation-empty-state')).toHaveTextContent('Подготовка к разработке ещё не запускалась')
    expect(screen.queryByText('В проекте нет доступных машин.')).not.toBeInTheDocument()
  })

  it('ошибка чтения истории предлагает повторить', async () => {
    stubBoard()
    const loadRuns = vi.fn()
      .mockRejectedValueOnce(new Error('сеть недоступна'))
      .mockResolvedValueOnce([])
    render(<TaskPreparationTab projectId="p1" taskId="t1" loadRuns={loadRuns} />)

    const error = await screen.findByTestId('error-state')
    expect(error).toHaveTextContent('Не удалось загрузить историю подготовки')
    await userEvent.click(within(error).getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2))
    expect(await screen.findByTestId('task-preparation-empty-state')).toBeInTheDocument()
  })
})

describe('TaskPreparationTab — устойчивость к ререндерам родителя', () => {
  it('ререндер родителя с новыми функциями-пропсами не перезапрашивает список', async () => {
    stubBoard()
    const calls = { runs: 0 }
    // Как в App.tsx: колбэки — inline-стрелки, то есть новые на каждый рендер.
    const view = (): JSX.Element => (
      <TaskPreparationTab
        projectId="p1"
        taskId="t1"
        loadRuns={async () => { calls.runs += 1; return [run()] }}
        loadRun={async (id: string) => run({ id })}
      />
    )
    const { rerender } = render(view())
    await waitFor(() => expect(calls.runs).toBe(1))

    rerender(view())
    rerender(view())
    // Даём эффектам и их промисам отработать: баг проявляется именно здесь.
    await act(async () => { await Promise.resolve() })

    expect(calls.runs).toBe(1)
  })

  it('смена задачи по-прежнему перезагружает список', async () => {
    stubBoard()
    const loadRuns = vi.fn(async () => [run()])
    const { rerender } = render(<TaskPreparationTab projectId="p1" taskId="t1" loadRuns={loadRuns} loadRun={async (id) => run({ id })} />)
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(1))

    rerender(<TaskPreparationTab projectId="p1" taskId="t2" loadRuns={loadRuns} loadRun={async (id) => run({ id })} />)
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2))
  })
})

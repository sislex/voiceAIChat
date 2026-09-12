import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskPreparationRun } from '@shared/qa'
import { NewTaskPreparationPanel } from './NewTaskPreparationPanel'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'

function run(over: Partial<TaskPreparationRun> = {}): TaskPreparationRun {
  return {
    id: 'r1', projectId: 'p1', taskId: 't1', status: 'success', attempt: 1, maxAttempts: 3, log: 'готово',
    provider: 'claude', model: 'opus', error: null, readiness: null, gateReasons: [], createdAt: 100, finishedAt: 200,
    durationMs: 100, canRetry: false, canCancel: false, steps: [], ...over
  }
}
const cycle: TaskReworkCycleViewModel = {
  id: 'c1', sequence: 1, description: 'Восстановление записи', criteria: [], makeSources: [], attachments: [],
  createdBy: 'alex', createdAt: 1_000, preparationRunId: null, status: 'submitted'
}
const bridge = (): void => {
  window.ci = { getTaskMachines: vi.fn(async () => ({ machines: [], selectedAgentId: null, unavailableSelection: null, effectiveAgentId: null })), getTaskPreparationLlm: vi.fn(async () => ({ provider: 'claude', model: 'opus', llmEngineId: null })) } as unknown as typeof window.ci
}
afterEach(() => { delete (window as { ci?: unknown }).ci })

describe('NewTaskPreparationPanel', () => {
  it('раскладывает попытки по этапам: исходная постановка и каждый цикл доработки', async () => {
    bridge()
    const loadRuns = vi.fn(async () => [run(), run({ id: 'r2', attempt: 2, status: 'running', createdAt: 2_000, finishedAt: null, canCancel: true })])
    render(<NewTaskPreparationPanel cycles={[cycle]} workflow={['Подготовка', 'Разработка']} preparation={{ projectId: 'p1', taskId: 't1', loadRuns }} />)
    expect(await screen.findByText('2 этапа')).toBeTruthy()
    const first = screen.getByTestId('new-task-preparation-stage-1')
    const second = screen.getByTestId('new-task-preparation-stage-2')
    // Первый этап подготовлен, второй (цикл доработки) выполняется и выбран.
    await waitFor(() => expect(first).toHaveTextContent('Подготовлено'))
    expect(second).toHaveTextContent('Подготовка к разработке доработки 1')
    expect(second).toHaveTextContent('Выполняется')
    expect(second).toHaveAttribute('aria-current', 'step')
    // Функциональная панель стоит в выбранном этапе и показывает его попытку.
    expect(second).toHaveTextContent('Попытка 2')
    expect(loadRuns).toHaveBeenCalledTimes(1)
    // Переход к первому этапу переносит панель туда; статусы рейки при этом
    // не сбрасываются — пока панель грузится, она молчит о списке попыток.
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
    await waitFor(() => expect(screen.getByTestId('new-task-preparation-stage-1')).toHaveAttribute('aria-current', 'step'))
    expect(screen.getByTestId('new-task-preparation-stage-2')).toHaveTextContent('Выполняется')
    await waitFor(() => expect(screen.getByTestId('new-task-preparation-stage-1')).toHaveTextContent('Development Brief и результат'))
  })

  it('цикл без попыток предлагает запуск подготовки прямо в своём этапе', async () => {
    bridge()
    const onStart = vi.fn()
    render(<NewTaskPreparationPanel cycles={[cycle]} workflow={[]} preparation={{ projectId: 'p1', taskId: 't1', loadRuns: async () => [run()], onStart }} />)
    const second = await screen.findByTestId('new-task-preparation-stage-2')
    await waitFor(() => expect(second).toHaveTextContent('Подготовка к разработке ещё не запускалась'))
    expect(second).toHaveTextContent('Ожидает')
  })
})

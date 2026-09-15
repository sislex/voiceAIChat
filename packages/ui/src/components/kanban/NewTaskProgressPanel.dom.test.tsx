import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '../../test/uiRender'
import { createFakeCi, type FakeCi } from '@voicechat/ui-foundation/test/fakeApi'
import type { CiRunReport, CiTaskReport } from '@shared/ci'
import { EMPTY_CI_USAGE_TOTALS } from '@shared/ci'
import { NewTaskProgressPanel } from './NewTaskProgressPanel'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'

function report(over: Partial<CiRunReport> = {}): CiRunReport {
  return {
    runId: 'run-1', projectId: 'p1', taskId: 't1', status: 'success', mode: 'development', provider: 'claude', model: 'opus',
    startedAt: 100, finishedAt: 200, durationMs: 125_000, createdAt: 100, fixAttempts: 1, totals: { ...EMPTY_CI_USAGE_TOTALS, requests: 4, tokens: 1200 }, stages: [],
    steps: [
      { id: 's1', parentStepId: null, title: 'npm test', slot: 'after_model', kind: 'command', initiatedBy: 'workflow', status: 'success', attempt: 1, fixedByModel: false, exitCode: 0, durationMs: 5_000, usage: null },
      { id: 's2', parentStepId: null, title: 'Работа модели', slot: null, kind: 'model_work', initiatedBy: 'workflow', status: 'success', attempt: 1, fixedByModel: false, exitCode: null, durationMs: 100_000, usage: null }
    ],
    kbHit: null, toolCalls: null, toolChars: null, toolResponses: [], ...over
  } as CiRunReport
}
const cycle: TaskReworkCycleViewModel = {
  id: 'c1', sequence: 1, description: 'Восстановление записи', criteria: [], makeSources: [], attachments: [],
  createdBy: 'alex', createdAt: 1_000, preparationRunId: null, status: 'submitted'
}
let ci: FakeCi
beforeEach(() => {
  ci = createFakeCi()
  const runs = [report(), report({ runId: 'run-2', status: 'running', createdAt: 2_000, startedAt: 2_000, finishedAt: null, durationMs: null, steps: [] })]
  ci.getTaskReport = vi.fn(async (): Promise<CiTaskReport> => ({ projectId: 'p1', taskId: 't1', runs: [...runs].reverse(), totals: { ...EMPTY_CI_USAGE_TOTALS, requests: 4, tokens: 1200 }, durationMs: 125_000, toolCalls: null, toolChars: null, toolResponses: [] }))
  ci.getTaskKbUsage = vi.fn(async () => ({ projectId: 'p1', taskId: 't1', runs: 1, totals: { queries: 0, delivered: 0, empty: 0, errors: 0, toolQueries: 0, sections: 0, documents: 0, chars: 0, estimatedTokens: 0 }, sections: [], recent: [] }) as never)
  window.ci = ci
})
afterEach(() => { delete (window as { ci?: unknown }).ci })

describe('NewTaskProgressPanel', () => {
  // @testCase TC-INT-02
  it('строит этапы по циклам с метриками и лентой выбранного рана', async () => {
    render(<NewTaskProgressPanel projectId="p1" taskId="t1" cycles={[cycle]} workflow={['Разработка']} />)
    expect(await screen.findByText('2 этапа')).toBeTruthy()
    const first = screen.getByTestId('new-task-progress-stage-1')
    const second = screen.getByTestId('new-task-progress-stage-2')
    expect(first).toHaveTextContent('Разработка первоначальной постановки')
    expect(first).toHaveTextContent('Завершено')
    // Метрики этапа — из отчёта рана: шаги, проверки, время.
    expect(first).toHaveTextContent('2/2')
    expect(first).toHaveTextContent('1/1')
    expect(first).toHaveTextContent('2м 05с')
    expect(second).toHaveTextContent('Разработка доработки 1')
    expect(second).toHaveTextContent('В разработке')
    // Лента раскрыта у выбранного (живого) этапа.
    expect(second.querySelector('details')).toHaveAttribute('open')
  })

  it('разделы: проверки собирают команды всех ранов, ресурсы — итог отчёта', async () => {
    render(<NewTaskProgressPanel projectId="p1" taskId="t1" cycles={[]} workflow={[]} />)
    await screen.findByText('1 этап')
    fireEvent.click(screen.getByRole('button', { name: 'Проверки' }))
    expect(await screen.findByText('npm test')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ресурсы' }))
    expect(await screen.findByText('Ходов модели')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Временная шкала' }))
    expect(await screen.findByText('Этапов пока нет')).toBeTruthy()
  })

  it('запуск разработки доступен, пока нет активного рана', async () => {
    const start = vi.fn()
    const { rerender } = render(<NewTaskProgressPanel projectId="p1" taskId="t1" cycles={[]} workflow={[]} onStartCi={start} />)
    fireEvent.click(await screen.findByRole('button', { name: 'В очередь на разработку' }))
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    rerender(<NewTaskProgressPanel projectId="p1" taskId="t1" cycles={[]} workflow={[]} onStartCi={start} ciSummary={{ id: 'run-2', taskId: 't1', status: 'running', error: null, slotProgress: { phase: 'model', done: 1, total: 3 }, durationMs: null, modelActive: true, awaitingInput: false }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'В очередь на разработку' })).toBeDisabled())
  })

  it('ошибка отчёта показывает экран с повтором', async () => {
    ci.getTaskReport = vi.fn().mockRejectedValueOnce(new Error('сеть')).mockResolvedValue({ projectId: 'p1', taskId: 't1', runs: [], totals: EMPTY_CI_USAGE_TOTALS, durationMs: 0, toolCalls: null, toolChars: null, toolResponses: [] })
    render(<NewTaskProgressPanel projectId="p1" taskId="t1" cycles={[]} workflow={[]} />)
    expect(await screen.findByText('Не удалось загрузить ход выполнения')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Этапы выполнения')).toBeTruthy()
  })
})

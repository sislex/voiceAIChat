import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QaSession, QaTaskState } from '@shared/qa'
import { NewTaskManualQaPanel } from './NewTaskManualQaPanel'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'

function session(over: Partial<QaSession>): QaSession {
  return {
    id: 's1', taskId: 't1', projectId: 'p1', branch: 'CHAT-445', commitSha: 'a'.repeat(40), testRunId: 'run-1', previewId: null, previewSha: null,
    appUrl: 'https://preview.test/CHAT-445', storybookUrl: null, testDataScenario: '', criteriaSnapshot: [], status: 'passed', testerId: null,
    initiatedBy: 'alex', startedAt: 100, finishedAt: 200, staleReason: null, summary: '', results: [], ...over
  }
}
const cycle: TaskReworkCycleViewModel = {
  id: 'c1', sequence: 1, description: 'Восстановление записи', criteria: [], makeSources: [], attachments: [],
  createdBy: 'alex', createdAt: 1_000, preparationRunId: null, status: 'submitted'
}
afterEach(() => { delete window.qa })

describe('NewTaskManualQaPanel', () => {
  it('показывает тестовое окружение активной сессии и проходы по циклам', async () => {
    const active = session({ id: 's2', status: 'active', startedAt: 2_000, finishedAt: null, appUrl: 'https://preview.test/CHAT-445-2' })
    const state: QaTaskState = { criteria: [], versions: [], sessions: [active, session({})], activeSession: active, preparation: null }
    window.qa = { get: vi.fn().mockResolvedValue(state), createCriterion: vi.fn(), reviseCriterion: vi.fn(), completePreparation: vi.fn(), startSession: vi.fn(), saveResult: vi.fn(), addAttachment: vi.fn(), complete: vi.fn(), requestFix: vi.fn() }
    render(<NewTaskManualQaPanel projectId="p1" taskId="t1" cycles={[cycle]} workflow={[]} runActive={false} />)
    expect(await screen.findByRole('link', { name: 'https://preview.test/CHAT-445-2' })).toBeTruthy()
    expect(screen.getByText('2 прохода')).toBeTruthy()
    const first = screen.getByTestId('new-task-manual-qa-stage-1')
    const second = screen.getByTestId('new-task-manual-qa-stage-2')
    await waitFor(() => expect(first).toHaveTextContent('Принято'))
    expect(second).toHaveTextContent('Выполняется')
    // Панель ручного QA — в проходе активной сессии.
    expect(second.querySelector('[data-testid="new-manual-qa-session"]')).toBeTruthy()
    expect(first.querySelector('[data-testid="new-manual-qa-session"]')).toBeNull()
  })

  // @testCase TC-INT-02
  it('saves a manual result with its revision and keeps historical criteria immutable', async () => {
    const result = { id: 'result-2', sessionId: 's2', criterionId: 'criterion', criterionVersion: 2, revision: 4, status: 'not_tested', comment: '', draft: false, attachments: [] } as never
    const active = session({ id: 's2', status: 'active', startedAt: 2000, finishedAt: null, results: [result], criteriaSnapshot: [{ criterionId: 'criterion', version: 2, required: true }] })
    const older = session({ id: 's1', criteriaSnapshot: [{ criterionId: 'criterion', version: 1, required: true }] })
    const state = { criteria: [], versions: [
      { criterionId: 'criterion', version: 1, title: 'Original requirement', steps: 'Original steps', preconditions: '', testData: '', expectedResult: 'Original result' },
      { criterionId: 'criterion', version: 2, title: 'Current requirement', steps: 'New steps', preconditions: '', testData: '', expectedResult: 'New result' }
    ], sessions: [active, older], activeSession: active, preparation: null }
    const save = vi.fn(async () => { Object.assign(result, { status: 'passed', revision: 5 }); return result })
    window.qa = { get: vi.fn().mockResolvedValue(state), saveResult: save } as unknown as typeof window.qa
    render(<NewTaskManualQaPanel projectId="p1" taskId="t1" cycles={[cycle]} workflow={[]} runActive={false} />)
    fireEvent.change(await screen.findByLabelText('Результат проверки'), { target: { value: 'passed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить результат' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('p1', 't1', 'result-2', 4, { status: 'passed', draft: false, comment: '' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить результат' })).toBeDisabled())
    fireEvent.click(within(screen.getByTestId('new-task-manual-qa-stage-1')).getByRole('button', { name: 'Показать' }))
    await screen.findByText('Original requirement · v1')
    expect(screen.queryByText('Current requirement · v2')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Сохранить результат' })).toBeNull()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('без сессий объясняет, когда появится preview', async () => {
    window.qa = { get: vi.fn().mockResolvedValue({ criteria: [], versions: [], sessions: [], activeSession: null, preparation: null }), createCriterion: vi.fn(), reviseCriterion: vi.fn(), completePreparation: vi.fn(), startSession: vi.fn(), saveResult: vi.fn(), addAttachment: vi.fn(), complete: vi.fn(), requestFix: vi.fn() }
    render(<NewTaskManualQaPanel projectId="p1" taskId="t1" cycles={[]} workflow={[]} runActive={false} />)
    expect(await screen.findByText('Preview появится вместе с первой QA-сессией.')).toBeTruthy()
    expect(screen.getByText('1 проход')).toBeTruthy()
  })
})

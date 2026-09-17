import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnyQaStageRun, ComponentQaRun, ComponentQaTaskState, IntegrationTestRun } from '@shared/qa'
import { NewTaskQaStagesPanel } from './NewTaskQaStagesPanel'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'

function componentRun(over: Partial<ComponentQaRun>): ComponentQaRun {
  return {
    id: 'cq1', projectId: 'p1', taskId: 't1', developmentRunId: 'dev1', linkedFixRunId: null, branch: 'CHAT-445', commitSha: 'a'.repeat(40),
    attempt: 1, status: 'passed', uiImpact: 'existing_components', readinessRunId: 'prep1', readinessVersion: 'v1',
    scenarios: [], components: [], commands: [], artifacts: [], failureClassification: null, blockerReasons: [], summary: 'ok', log: '',
    storybookUrl: null, createdAt: 100, startedAt: 100, finishedAt: 200, staleReason: null, canCancel: false, canRetry: false, ...over
  } as ComponentQaRun
}
const cycle: TaskReworkCycleViewModel = {
  id: 'c1', sequence: 1, description: 'Восстановление записи', criteria: [], makeSources: [], attachments: [],
  createdBy: 'alex', createdAt: 1_000, preparationRunId: null, status: 'submitted'
}
afterEach(() => { delete window.qa })

describe('NewTaskQaStagesPanel', () => {
  // @testCase TC2
  // @testCase TC5
  it('integration stages share one load and retain the latest cycle error and retry action', async () => {
    const first: IntegrationTestRun = {
      ...componentRun({}), status: 'passed', snapshotVersion: 'v1', testCases: [], automationLinks: [], commands: [],
      failureClassification: null, failureReason: null, staleReason: null
    }
    const second: IntegrationTestRun = { ...first, id: 'integration-2', attempt: 2, createdAt: 2000, status: 'failed', failureReason: 'Integration failed\nDetails', summary: 'Integration failed\nDetails', canRetry: true }
    const getIntegration = vi.fn().mockResolvedValue({ runs: [second, first], latestRun: second, activeRun: null, testCases: [], launchReasons: [], canStart: true, canComplete: false, gateReasons: [] })
    const startIntegration = vi.fn().mockResolvedValue(second)
    window.qa = { get: vi.fn(), getIntegration, startIntegration, createCriterion: vi.fn(), reviseCriterion: vi.fn(), completePreparation: vi.fn(), startSession: vi.fn(), saveResult: vi.fn(), addAttachment: vi.fn(), complete: vi.fn(), requestFix: vi.fn() }
    render(<NewTaskQaStagesPanel projectId="p1" taskId="t1" stage="integration_tests" cycles={[cycle]} workflow={[]} runActive={false} />)
    await screen.findByText('2 прохода')
    await screen.findByText('Integration failed', { selector: '.new-task-stage-error p' })
    const panel = screen.getByRole('region', { name: 'Интеграционные автотесты' })
    for (let index = 0; index < 5; index++) fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
    expect(screen.getByTestId('new-task-qa-stage-integration_tests-1')).toContainElement(panel)
    expect(getIntegration).toHaveBeenCalledOnce()
    fireEvent.click(within(screen.getByTestId('new-task-qa-stage-integration_tests-2')).getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(startIntegration).toHaveBeenCalledWith('p1', 't1'))
  })

  // @testCase TC2
  // @testCase TC5
  it('Component QA: проходы по циклам, попытки выбранного прохода и действия панели', async () => {
    const runs = [componentRun({}), componentRun({ id: 'cq2', attempt: 2, status: 'failed', createdAt: 2_000, summary: 'упало\nтехническая подробность', canRetry: true })]
    const state: ComponentQaTaskState = { activeRun: null, latestRun: runs[1]!, runs, launchReasons: [], canStart: true, canComplete: false, gateReasons: [] }
    const startComponent = vi.fn().mockResolvedValue(runs[1])
    window.qa = { get: vi.fn(), getComponent: vi.fn().mockResolvedValue(state), startComponent, createCriterion: vi.fn(), reviseCriterion: vi.fn(), completePreparation: vi.fn(), startSession: vi.fn(), saveResult: vi.fn(), addAttachment: vi.fn(), complete: vi.fn(), requestFix: vi.fn() }
    render(<NewTaskQaStagesPanel projectId="p1" taskId="t1" stage="component_qa" cycles={[cycle]} workflow={['Component QA']} runActive={false} />)
    expect(await screen.findByText('2 прохода')).toBeTruthy()
    const first = screen.getByTestId('new-task-qa-stage-component_qa-1')
    const second = screen.getByTestId('new-task-qa-stage-component_qa-2')
    await waitFor(() => expect(first).toHaveTextContent('Завершено'))
    expect(second).toHaveTextContent('Component QA · доработка 1')
    expect(second).toHaveTextContent('Ошибка')
    const panel = second.querySelector('.component-qa-panel')
    for (let index = 0; index < 4; index++) fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
    expect(second.querySelector('.component-qa-panel')).toBe(panel)
    expect(window.qa!.getComponent).toHaveBeenCalledTimes(1)
    fireEvent.click(within(first).getByRole('button', { name: 'Показать' }))
    expect(second.querySelector('.new-task-stage-error p')).toHaveTextContent(/^упало$/)
    fireEvent.click(within(second).getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(startComponent).toHaveBeenCalledWith('p1', 't1'))
    await waitFor(() => expect(window.qa!.getComponent).toHaveBeenCalledTimes(2))
    startComponent.mockClear()
    // The existing launch action remains available in the same panel.
    fireEvent.click(screen.getByRole('button', { name: 'Запустить' }))
    await waitFor(() => expect(startComponent).toHaveBeenCalledWith('p1', 't1'))
    // Состояние загружено один раз и на рейку, и в панель.
    expect(window.qa!.getComponent).toHaveBeenCalledTimes(3)
  })

  it('Automated QA: проходы из stage-ранов, прежняя попытка открывается по клику', async () => {
    const stageRun = (over: Partial<AnyQaStageRun>): AnyQaStageRun => ({
      id: 'a1', projectId: 'p1', taskId: 't1', kind: 'automatedQaRun', stage: 'automated_qa', status: 'success', attempt: 1, triggeredBy: 'alex',
      branch: 'CHAT-445', commitSha: 'b'.repeat(40), llmEngineId: null, llmProvider: 'claude', llmModel: 'opus', currentStep: 'done',
      progress: { current: 3, total: 3, label: 'шаги' }, log: [], result: null, scenarios: null, gateReasons: [], error: null,
      createdAt: 100, startedAt: 100, finishedAt: 200, canCancel: false, canRetry: false, ...over
    } as AnyQaStageRun)
    const runs = [stageRun({ id: 'a2', attempt: 2, status: 'failed', createdAt: 200, error: 'сломалось' }), stageRun({})]
    window.qa = { get: vi.fn(), listStageRuns: vi.fn().mockResolvedValue(runs), createCriterion: vi.fn(), reviseCriterion: vi.fn(), completePreparation: vi.fn(), startSession: vi.fn(), saveResult: vi.fn(), addAttachment: vi.fn(), complete: vi.fn(), requestFix: vi.fn() }
    render(<NewTaskQaStagesPanel projectId="p1" taskId="t1" stage="automated_qa" cycles={[]} workflow={[]} runActive={false} />)
    expect(await screen.findByText('1 проход')).toBeTruthy()
    const stage = screen.getByTestId('new-task-qa-stage-automated_qa-1')
    await waitFor(() => expect(stage).toHaveTextContent('Ошибка'))
    expect(await screen.findAllByText('сломалось')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /Попытка 1/ }))
    await waitFor(() => expect(screen.getAllByText('сломалось')).toHaveLength(1))
    expect(window.qa!.listStageRuns).toHaveBeenCalledOnce()
  })
})

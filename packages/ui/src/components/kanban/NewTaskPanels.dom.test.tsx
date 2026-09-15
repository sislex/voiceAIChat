import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '../../test/uiRender'
import { Panel, type PanelName } from './NewTaskPanels.stories'
import { componentFixture, fixtureTaskProps, installNewTaskPanelFixtures, preparationFixture } from './newTaskPanelFixtures'
import { NewTaskQaStagesPanel } from './NewTaskQaStagesPanel'
import { NewTaskPreparationPanel } from './NewTaskPreparationPanel'
import { NewTaskSettingsPanel } from './NewTaskSettingsPanel'
import { NewDevelopmentRunFeed } from './NewDevelopmentRunFeed'

beforeEach(installNewTaskPanelFixtures)
afterEach(() => { delete window.qa; delete (window as { ci?: unknown }).ci; document.documentElement.removeAttribute('data-theme') })
const panels: PanelName[] = ['overview', 'reworks', 'preparation', 'settings', 'progress', 'component_qa', 'integration_tests', 'automated_qa', 'manual_qa', 'merge', 'feed']
describe('new task panel contracts', () => {
  // @testCase TC-INT-02
  it('saves engine/model configuration and the chosen command order', async () => {
    const saveModel = vi.fn().mockResolvedValue(undefined)
    const saveCommands = vi.fn().mockResolvedValue(undefined)
    window.ci!.putTaskCiLlm = saveModel
    window.ci!.putTaskCi = saveCommands
    window.ci!.listCommands = vi.fn().mockResolvedValue([{ id: 'check', name: 'Check contracts' }])
    render(<NewTaskSettingsPanel projectId="p1" taskId="t1" />)
    fireEvent.change(await screen.findByLabelText('Движок модели'), { target: { value: 'codex' } })
    const model = (screen.getByLabelText('Модель') as HTMLSelectElement).value
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить движок и модель' }))
    await waitFor(() => expect(saveModel).toHaveBeenCalledWith('p1', 't1', expect.objectContaining({ provider: 'codex', model, llmEngineId: null })))
    fireEvent.change(await screen.findByLabelText('Добавить команду: После работы модели'), { target: { value: 'check' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить команды' }))
    await waitFor(() => expect(saveCommands).toHaveBeenCalledWith('p1', 't1', { beforeModel: [], afterModel: ['check'] }))
  })

  // @testCase TC-INT-02
  it('persists the selected machine through the task contract', async () => {
    const previousApi = window.api
    const update = vi.fn().mockResolvedValue({})
    window.api = { ...previousApi, 'tasks:update': update }
    render(<NewTaskSettingsPanel projectId="p1" taskId="t1" />)
    fireEvent.change(await screen.findByLabelText('Машина выполнения'), { target: { value: '' } })
    await waitFor(() => expect(update).toHaveBeenCalledWith({ projectId: 'p1', taskId: 't1', agentId: null }))
    expect(update).toHaveBeenCalledTimes(1)
    window.api = previousApi
  })

  // @testCase TC-INT-02
  it('unsubscribes the previous development run and ignores its late response', async () => {
    const detail = await window.ci!.getRun('dev-2')
    let resolveOld!: (value: typeof detail) => void
    window.ci!.getRun = vi.fn().mockImplementation((id: string) => id === 'old'
      ? new Promise<typeof detail>(resolve => { resolveOld = resolve })
      : Promise.resolve({ ...detail, run: { ...detail.run, id, error: 'CURRENT RUN' } }))
    const subscribe = vi.spyOn(window.ci!, 'subscribe')
    const unsubscribe = vi.spyOn(window.ci!, 'unsubscribe')
    const stop = vi.fn()
    window.ci!.onLog = vi.fn().mockReturnValue(stop)
    const view = render(<NewDevelopmentRunFeed runId="old" />)
    await waitFor(() => expect(subscribe).toHaveBeenCalledWith('old'))
    view.rerender(<NewDevelopmentRunFeed runId="new" />)
    await screen.findByText('CURRENT RUN')
    resolveOld({ ...detail, run: { ...detail.run, id: 'old', error: 'STALE RUN' } })
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledWith('old'))
    expect(screen.queryByText('STALE RUN')).toBeNull()
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledWith('new')
    expect(stop).toHaveBeenCalledTimes(2)
  })

  // @testCase TC-UI-01
  it.each(panels.flatMap(panel => ['light', 'dark'].flatMap(theme => [390, 1280].map(width => ({ panel, theme, width })))))('renders $panel in $theme at $width without a legacy panel', async ({ panel, theme, width }) => {
    document.documentElement.dataset.theme = theme
    render(<div style={{ width }}><Panel panel={panel} /></div>)
    const container = document.body
    await waitFor(() => expect(container.querySelector('.new-task-process, .new-task-settings, .new-task-card')).toBeTruthy())
    await waitFor(() => expect(container.textContent).not.toContain('Загрузка хода выполнения'))
    expect(container.querySelector('.task-preparation-tab, .component-qa-panel, .qa-stage-panel, .manual-qa, .merge-panel, .ci-runfeed, .ci-task')).toBeNull()
    expect(container.querySelectorAll('button').length).toBeGreaterThan(0)
  })

  // @testCase TC-INT-02
  it('historical QA and empty cycles cannot cancel or display another cycle’s active run', async () => {
    const current = { ...componentFixture(), id: 'active', status: 'running' as const, canCancel: true, canRetry: false, log: 'ACTIVE ONLY' }
    const old = { ...componentFixture(), id: 'old', createdAt: 100, status: 'passed' as const, canRetry: false, log: 'HISTORICAL ONLY' }
    const cancel = vi.fn().mockResolvedValue(current)
    window.qa!.getComponent = vi.fn().mockResolvedValue({ runs: [current, old], latestRun: current, activeRun: current, canStart: false, canComplete: false, launchReasons: [], gateReasons: [] })
    window.qa!.cancelComponent = cancel
    render(<NewTaskQaStagesPanel {...fixtureTaskProps} stage="component_qa" runActive={false} />)
    await screen.findByText('ACTIVE ONLY')
    fireEvent.click(within(screen.getByTestId('new-task-qa-stage-component_qa-1')).getByRole('button', { name: 'Показать' }))
    await screen.findByText('HISTORICAL ONLY')
    expect(screen.queryByText('ACTIVE ONLY')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull()
    expect(cancel).not.toHaveBeenCalled()
  })

  // @testCase TC-NEG-01
  it('keeps the loaded QA history after a conflicting launch and suppresses duplicate requests', async () => {
    const snapshot = { runs: [componentFixture()], latestRun: componentFixture(), activeRun: null, canStart: true, canComplete: false, launchReasons: [], gateReasons: [] }
    window.qa!.getComponent = vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValue(new Error('Refresh unavailable'))
    let reject!: (cause: Error) => void
    const start = vi.fn(() => new Promise<never>((_, fail) => { reject = fail }))
    window.qa!.startComponent = start
    render(<NewTaskQaStagesPanel {...fixtureTaskProps} stage="component_qa" runActive={false} />)
    await screen.findByText('Обнаружен дефект')
    const button = screen.getByRole('button', { name: 'Запустить' })
    fireEvent.click(button); fireEvent.click(button)
    expect(start).toHaveBeenCalledTimes(1)
    reject(new Error('409: состояние изменилось'))
    await screen.findByText('Не удалось обновить этап')
    expect(screen.getByText('Обнаружен дефект')).toBeInTheDocument()
    await waitFor(() => expect(window.qa!.getComponent).toHaveBeenCalledTimes(2))
  })

  // @testCase TC-INT-02
  it('preparation answers use the selected question and historical selection survives refresh', async () => {
    const active = preparationFixture()
    const previous = { ...active, id: 'prep-1', attempt: 1, createdAt: 100, status: 'success' as const, canCancel: false, questions: [], log: 'OLD BRIEF LOG' }
    const answer = vi.fn().mockResolvedValue({ accepted: true })
    const loadRuns = vi.fn().mockResolvedValue([active, previous])
    render(<NewTaskPreparationPanel {...fixtureTaskProps} preparation={{ projectId: 'p1', taskId: 't1', loadRuns, onAnswer: answer }} />)
    fireEvent.change(await screen.findByLabelText('Ответ на вопрос подготовки'), { target: { value: 'Сохранить локально' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить ответ' }))
    await waitFor(() => expect(answer).toHaveBeenCalledWith('q2', 'Сохранить локально'))
    fireEvent.click(within(screen.getByTestId('new-task-preparation-stage-1')).getByRole('button', { name: 'Показать' }))
    await screen.findByText('OLD BRIEF LOG')
    expect(screen.queryByLabelText('Ответ на вопрос подготовки')).toBeNull()
    expect(answer).toHaveBeenCalledTimes(1)
  })

  // @testCase TC-INT-02
  it('integration completion carries the selected run ID', async () => {
    const complete = vi.fn().mockResolvedValue(undefined)
    window.qa!.completeIntegration = complete
    render(<NewTaskQaStagesPanel {...fixtureTaskProps} stage="integration_tests" runActive={false} />)
    const button = await screen.findByRole('button', { name: 'Перейти к Automated QA' })
    fireEvent.click(button)
    await waitFor(() => expect(complete).toHaveBeenCalledWith('p1', 't1', 'integration-2'))
  })
})

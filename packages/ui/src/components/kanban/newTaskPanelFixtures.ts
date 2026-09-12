import type { ComponentQaRun, IntegrationTestRun, QaSession, TaskPreparationRun } from '@shared/qa'
import type { CiRunDetail, CiTaskReport } from '@shared/ci'
import { DEFAULT_CI_LLM_CONFIG, EMPTY_CI_USAGE_TOTALS } from '@shared/ci'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'

/** Shared, deterministic domain fixtures for DOM coverage and the design stories. */
export const newTaskCycle: TaskReworkCycleViewModel = {
  id: 'cycle-2', sequence: 1, description: 'Восстановление после потери сети', criteria: ['Сохранить ввод'],
  makeSources: [], attachments: [], createdBy: 'alex', createdAt: 2000, preparationRunId: null, status: 'submitted'
}
export function preparationFixture(): TaskPreparationRun {
  return { id: 'prep-2', projectId: 'p1', taskId: 't1', attempt: 2, maxAttempts: 3, status: 'waiting_for_answer',
    provider: 'claude', model: 'default', createdAt: 3000, finishedAt: null, log: 'Изучены требования',
    error: null, readiness: null, gateReasons: [], canCancel: true, canRetry: false, steps: [],
    questions: [{ questionId: 'q2', attemptId: 'prep-2', text: 'Как восстанавливать ввод?', material: true, status: 'open', answer: null, askedAt: 3001, answeredAt: null, answeredBy: null }]
  }
}
export function componentFixture(): ComponentQaRun {
  return { id: 'component-2', projectId: 'p1', taskId: 't1', developmentRunId: 'dev-2', linkedFixRunId: null,
    attempt: 2, branch: 'CHAT-445', commitSha: 'abcdef12', status: 'failed', uiImpact: 'existing_components',
    readinessRunId: 'prep-2', readinessVersion: 'v2', scenarios: [], components: [], commands: [], artifacts: [],
    failureClassification: null, blockerReasons: [], summary: 'Проверка мобильной ширины', log: 'Обнаружен дефект',
    storybookUrl: null, createdAt: 3100, startedAt: 3100, finishedAt: 3200, staleReason: null, canCancel: false, canRetry: true
  } as ComponentQaRun
}
export function integrationFixture(): IntegrationTestRun {
  return { ...componentFixture(), id: 'integration-2', testCases: [], status: 'passed', summary: 'Проверен контракт', log: 'Контракт выполнен' } as unknown as IntegrationTestRun
}
export function manualFixture(): QaSession {
  return { id: 'session-2', projectId: 'p1', taskId: 't1', branch: 'CHAT-445', commitSha: 'abcdef12', testRunId: 'dev-2',
    previewId: null, previewSha: null, appUrl: 'https://preview.example.test/CHAT-445', storybookUrl: null, testDataScenario: '',
    criteriaSnapshot: [], status: 'active', testerId: 'alex', initiatedBy: 'alex', startedAt: 3300, finishedAt: null,
    staleReason: null, summary: 'Проверка восстановления ввода', results: []
  }
}
export const fixtureWorkflow = ['Подготовка', 'Development', 'Component QA', 'Integration', 'Automated QA', 'Manual QA', 'Merge']
export const fixtureTaskProps = { projectId: 'p1', taskId: 't1', cycles: [newTaskCycle], workflow: fixtureWorkflow }

/** The story's bridges implement the same read contracts; no production API calls. */
export function installNewTaskPanelFixtures(): void {
  const component = componentFixture()
  const integration = integrationFixture()
  const session = manualFixture()
  const noEvents = () => () => undefined
  const run = { id: 'dev-2', projectId: 'p1', taskId: 't1', agentId: 'mac', status: 'success', error: null, llmProvider: 'claude',
    llmModel: 'default', mode: 'development', clarifyLevel: 'few', clarifyMax: 3, slotProgress: { done: 1, total: 1, phase: 'development' },
    createdAt: 3000, startedAt: 3000, finishedAt: 4000, durationMs: 1000 }
  const detail = { run, steps: [], fixAttempts: [], interactions: [] } as unknown as CiRunDetail
  const report = { projectId: 'p1', taskId: 't1', runs: [{ runId: run.id, projectId: 'p1', taskId: 't1', status: 'success',
    provider: 'claude', model: 'default', createdAt: 3000, startedAt: 3000, finishedAt: 4000, durationMs: 1000,
    steps: [], stages: [], totals: EMPTY_CI_USAGE_TOTALS, fixAttempts: 0 }],
    totals: EMPTY_CI_USAGE_TOTALS, durationMs: 1000, toolCalls: null, toolChars: null, toolResponses: [] } as unknown as CiTaskReport
  window.ci = {
    getTaskMachines: async () => ({ machines: [{ agentId: 'mac', name: 'MacBook', online: true, canUse: true, personal: true, project: true, projectDefault: true }], selectedAgentId: 'mac', effectiveAgentId: 'mac', unavailableSelection: null }),
    getTaskPreparationLlm: async () => ({ provider: 'claude', model: 'default', llmEngineId: null }),
    getTaskCiLlm: async () => ({ config: DEFAULT_CI_LLM_CONFIG, overridden: false }),
    putTaskCiLlm: async () => undefined,
    listCommands: async () => [],
    getTaskCi: async () => ({ config: { beforeModel: [], afterModel: [] }, overridden: false }),
    getTaskReport: async () => report,
    getRun: async () => detail, getRunLog: async () => [],
    listMergeRuns: async () => [],
    getMergeMachines: async () => ({ machines: [{ agentId: 'mac', readiness: { ready: true, selectable: true, message: 'готова' } }], defaultAgentId: 'mac' }),
    subscribe: () => undefined, unsubscribe: () => undefined,
    onSnapshot: noEvents, onRun: noEvents, onStep: noEvents, onLog: noEvents, onDone: noEvents, onMerge: noEvents
  } as unknown as typeof window.ci
  window.qa = {
    get: async () => ({ criteria: [], versions: [], sessions: [session], activeSession: session, preparation: null }),
    getComponent: async () => ({ runs: [component], latestRun: component, activeRun: null, canStart: true, canComplete: false, launchReasons: [], gateReasons: [] }),
    getIntegration: async () => ({ runs: [integration], latestRun: integration, activeRun: null, canStart: true, canComplete: true, launchReasons: [], gateReasons: [] }),
    startComponent: async () => component, startIntegration: async () => integration,
    listStageRuns: async () => [{ id: 'auto-2', projectId: 'p1', taskId: 't1', stage: 'automated_qa', kind: 'automatedQaRun',
      status: 'running', attempt: 2, branch: 'CHAT-445', commitSha: 'abcdef12', currentStep: 'Проверка сценариев',
      progress: { current: 1, total: 3, label: 'Сценарии' }, log: [{ seq: 1, at: 3400, stream: 'out', text: 'Проверяем восстановление ввода' }],
      gateReasons: [], error: null, result: null, createdAt: 3400, startedAt: 3400, finishedAt: null, canCancel: true, canRetry: false }]
  } as unknown as typeof window.qa
}

// Сториз вкладки Merge задачи: состояния ленты (идёт, успех, ошибка с
// конфликтами), история попыток и таблица репозиториев. Данные — фикстуры
// через подменённый window.ci, сети нет.
import type { Meta, StoryObj } from '@storybook/react'
import type { MergeRun, TaskRepository } from '@shared/merge'
import { MergePanel } from './MergePanel'
import { createFakeCi } from '../../test/fakeApi'

const stagesDone = [
  { stage: 'checking', status: 'passed', startedAt: 1, finishedAt: 2, durationMs: 700, exitCode: null, timedOut: false, message: 'Серверные проверки пройдены', log: '' },
  { stage: 'fetching', status: 'passed', startedAt: 2, finishedAt: 3, durationMs: 1800, exitCode: null, timedOut: false, message: 'Source 1a2b3c4d, main 9f8e7d6c', log: '' },
  { stage: 'merging', status: 'passed', startedAt: 3, finishedAt: 4, durationMs: 400, exitCode: null, timedOut: false, message: 'Создан merge 5e6f7a8b', log: '' },
  { stage: 'testing', status: 'passed', startedAt: 4, finishedAt: 5, durationMs: 480000, exitCode: null, timedOut: false, message: 'Все обязательные проверки прошли', log: '' },
  { stage: 'pushing', status: 'passed', startedAt: 5, finishedAt: 6, durationMs: 2400, exitCode: null, timedOut: false, message: 'origin/main подтверждён', log: '' }
] as MergeRun['stages']

const baseRun: MergeRun = {
  id: 'run-1', projectId: 'p1', taskId: 't1', status: 'success', triggeredBy: 'admin',
  sourceBranch: 'CHAT-180', targetBranch: 'main', sourceSha: '1a2b3c4d'.repeat(5), targetSha: '9f8e7d6c'.repeat(5),
  mergeSha: '5e6f7a8b'.repeat(5), revertSha: null, agentId: 'm1', machineName: 'MacBook', llmEngineId: null,
  llmProvider: 'claude', llmModel: '', stage: 'success', stages: stagesDone, conflicts: [], conflictDetails: [],
  checks: [{ name: 'Проверки проекта', command: 'npm run typecheck', status: 'passed', startedAt: 4, finishedAt: 5, durationMs: 480000, exitCode: 0, timedOut: false, output: '> typecheck\n✓ ok' }],
  deployId: null, deployVersion: null, productionStatus: null, error: null, recommendedAction: null,
  log: '[12:00:00] merge requested by admin\n[12:00:01] Серверные проверки пройдены\n[12:08:02] origin/main подтверждён',
  canCancel: false, canRetry: false, pushStartedAt: 5, startedAt: 1, finishedAt: 6, createdAt: 1
}

const repos: TaskRepository[] = [
  { id: 'r1', projectId: 'p1', taskId: 't1', agentId: 'm1', machineName: 'MacBook', path: '/Users/dev/chatAI/dev/chatai/CHAT-180', kind: 'dev-workspace', state: 'active', createdAt: 1, deletedAt: null },
  { id: 'r2', projectId: 'p1', taskId: 't1', agentId: 'm2', machineName: 'Server', path: '/root/VoiceAIChatRepos/chatai/.merge', kind: 'merge-clone', state: 'deleted', createdAt: 2, deletedAt: 3 }
]

function withCi(run: MergeRun, history: MergeRun[] = [run]): (Story: () => JSX.Element) => JSX.Element {
  return function CiDecorator(Story: () => JSX.Element): JSX.Element {
    window.ci = { ...createFakeCi(), getMerge: async () => run, listMergeRuns: async () => history, getTaskRepositories: async () => repos, onMerge: () => () => {} }
    window.api = { 'projects:get': async () => ({ machines: [{ agentId: 'm1', name: 'MacBook', online: true, path: '/w', reposRoot: '/repos' }] }) } as unknown as typeof window.api
    return <div style={{ maxWidth: 860 }}><Story /></div>
  }
}

const meta: Meta<typeof MergePanel> = {
  title: 'CI/MergePanel',
  component: MergePanel,
  args: { projectId: 'p1', taskId: 't1', runId: 'run-1', canStart: false }
}
export default meta
type Story = StoryObj<typeof MergePanel>

/** Успешный ран: зелёный бейдж, все стадии пройдены, деплой ещё не запускался. */
export const Success: Story = { decorators: [withCi(baseRun)] }

/** Ран в работе: стадия testing выполняется, лог открыт, доступна отмена. */
export const Running: Story = {
  decorators: [withCi({ ...baseRun, id: 'run-2', status: 'testing', stage: 'testing', mergeSha: null, finishedAt: null, canCancel: true, stages: stagesDone.slice(0, 3).concat([{ ...stagesDone[3], status: 'running', finishedAt: null, durationMs: null, message: 'Запускаю обязательные проверки до push' }]) }, [{ ...baseRun, id: 'run-2', status: 'testing' }])],
  args: { runId: 'run-2' }
}

/** Конфликты: плашка ошибки с рекомендацией, список файлов, retry доступен. */
export const DecisionRequired: Story = {
  decorators: [withCi({ ...baseRun, id: 'run-3', status: 'decision_required', stage: 'decision_required', mergeSha: null, error: 'Конфликты требуют решения пользователя', recommendedAction: 'Разрешите файлы в ветке задачи и повторите merge.', conflicts: ['apps/server/src/index.ts'], canRetry: true, stages: stagesDone.slice(0, 2) }, [{ ...baseRun, id: 'run-3', status: 'decision_required' }, baseRun])],
  args: { runId: 'run-3', canStart: true }
}

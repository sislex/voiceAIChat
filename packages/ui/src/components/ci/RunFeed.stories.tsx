// Сториз ленты CI-рана: три состояния экрана (загрузка, пусто, ошибка) плюс
// обычная лента для сравнения геометрии — косточки скелетона совпадают по
// высоте со свёрнутыми шагами, поэтому при подстановке данных лента не прыгает.
import type { Meta, StoryObj } from '@storybook/react'
import type { CiLogLine, CiRun, CiRunStep } from '@shared/ci'
import { RunFeed, type RunFeedCache } from './RunFeed'

function run(over: Partial<CiRun> = {}): CiRun {
  return {
    id: 'run-1', projectId: 'p1', taskId: 't1', agentId: null, status: 'running', workspaceId: null,
    triggeredBy: 'admin', prevColumnId: null, llmProvider: 'claude', llmModel: 'sonnet',
    mode: 'development', clarifyLevel: 'few', clarifyMax: 3, conversationId: null,
    slotProgress: { done: 1, total: 3, phase: 'до модели' },
    startedAt: 1_000, finishedAt: null, durationMs: null, createdAt: 1_000, ...over
  }
}
function step(over: Partial<CiRunStep> = {}): CiRunStep {
  return {
    id: 's1', runId: 'run-1', slot: 'before_model', position: 1, kind: 'command', parentStepId: null,
    initiatedBy: 'system', commandId: 'cmd-1', commandSnapshot: 'npm ci', title: 'npm ci', workdir: null,
    status: 'success', exitCode: 0, attempt: 1, fixedByModel: false,
    startedAt: 1_000, finishedAt: 4_000, durationMs: 3_000, ...over
  }
}
function log(over: Partial<CiLogLine> = {}): CiLogLine {
  return { runId: 'run-1', stepId: 's1', seq: 1, stream: 'stdout', chunk: 'added 812 packages in 3s', at: 1_500, ...over }
}

const meta: Meta<typeof RunFeed> = {
  title: 'CI/RunFeed',
  component: RunFeed,
  args: {
    runId: 'run-1',
    onSubscribe: () => {},
    onUnsubscribe: () => {},
    onLoad: () => {},
    onRetry: () => {},
    onCancel: () => {},
    now: () => 5_000
  },
  decorators: [(Story) => <div style={{ maxWidth: 720 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof RunFeed>

/** Загрузка: ленты ещё нет — скелетон шагов вместо пустого списка. */
export const Loading: Story = {
  args: { cache: { detail: null, log: [], conclusion: null, loading: true } }
}

/** Пусто: ран в очереди, шагов ещё не появилось. */
export const Empty: Story = {
  args: {
    cache: {
      detail: { run: run({ status: 'queued' }), steps: [], fixAttempts: [], interactions: [] },
      log: [],
      conclusion: null
    } satisfies RunFeedCache
  }
}

/** Ошибка загрузки: сообщение, деталь под «Подробнее» и «Повторить». */
export const LoadError: Story = {
  args: { cache: { detail: null, log: [], conclusion: null, error: 'TypeError: Failed to fetch' } }
}

/** Обычная лента — для сравнения с геометрией скелетона. */
export const WithSteps: Story = {
  args: {
    cache: {
      detail: {
        run: run(),
        steps: [
          step(),
          step({ id: 's2', position: 2, title: 'npm run typecheck', status: 'running', exitCode: null, finishedAt: null, durationMs: null }),
          step({ id: 's3', position: 3, title: 'npm test', status: 'queued', exitCode: null, startedAt: null, finishedAt: null, durationMs: null })
        ],
        fixAttempts: [],
        interactions: []
      },
      log: [log(), log({ seq: 2, stepId: 's2', chunk: 'tsc --noEmit' })],
      conclusion: null
    } satisfies RunFeedCache
  }
}

/** Ошибка поверх уже показанной ленты: данные остаются, ошибка — баннером. */
export const StaleError: Story = {
  args: {
    cache: {
      detail: { run: run(), steps: [step()], fixAttempts: [], interactions: [] },
      log: [log()],
      conclusion: null,
      error: 'HTTP 503: сервер перезагружается'
    } satisfies RunFeedCache
  }
}

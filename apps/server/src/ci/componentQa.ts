import type { ComponentQaCommandResult, ComponentQaRun, ComponentQaScenarioSnapshot } from '@voicechat/shared'
import type { CommandExecutor } from './types.js'

export interface ComponentQaFinishInput {
  status: 'passed' | 'failed' | 'blocked'
  scenarios: ComponentQaScenarioSnapshot[]
  commands: ComponentQaCommandResult[]
  summary: string
  failureClassification?: ComponentQaRun['failureClassification']
  blockerReasons?: string[]
}

export interface ComponentQaRunnerDeps {
  db: {
    componentQaExecutionContext(runId: string): { agentId: string; workdir: string; commands: string[] } | null
    getComponentQaRun(userId: string, runId: string): ComponentQaRun | null
    markComponentQaRunning(runId: string): void
    appendComponentQaLog(runId: string, stream: 'stdout' | 'stderr', chunk: string): void
    finishComponentQaRun(userId: string, runId: string, input: ComponentQaFinishInput): ComponentQaRun
  }
  executor: CommandExecutor
  /** Общий бюджет рана на все стадии; каждая стадия получает остаток. */
  timeoutMs?: number
  now?: () => number
}

export interface ComponentQaRunner {
  launch(runId: string, userId: string): void
  cancel(runId: string): void
}

/** Исполнение Component QA-рана: стадии из testStages последовательно через
 *  ciExecutor с CI=1, отдельная запись commands на каждую стадию, единый
 *  потоковый лог. Первый ненулевой код прерывает оставшиеся стадии. */
export function createComponentQaRunner(deps: ComponentQaRunnerDeps): ComponentQaRunner {
  const controllers = new Map<string, AbortController>()
  const now = deps.now ?? Date.now
  const budgetMs = deps.timeoutMs ?? 30 * 60_000
  const launch = (runId: string, userId: string): void => {
    if (controllers.has(runId)) return
    const context = deps.db.componentQaExecutionContext(runId)
    const run = deps.db.getComponentQaRun(userId, runId)
    if (!context || !run) {
      if (run) {
        deps.db.markComponentQaRunning(runId)
        deps.db.finishComponentQaRun(userId, runId, { status: 'blocked', scenarios: run.scenarios.map((item) => ({ ...item, status: 'blocked', diagnostic: 'development workspace is unavailable' })), commands: [], summary: 'Development workspace недоступен', failureClassification: 'infrastructure', blockerReasons: ['workspace_unavailable'] })
      }
      return
    }
    const controller = new AbortController()
    controllers.set(runId, controller)
    deps.db.markComponentQaRunning(runId)
    void (async () => {
      const startedAt = now(), deadline = startedAt + budgetMs, total = context.commands.length
      const commands: ComponentQaCommandResult[] = []
      let failedStage: ComponentQaCommandResult | null = null
      let infrastructure = false
      for (let index = 0; index < total; index++) {
        const script = context.commands[index], stageStartedAt = now(), remainingMs = deadline - stageStartedAt
        let stdout = ''
        const result = remainingMs > 0
          ? await deps.executor.run({ agentId: context.agentId, script, workdir: context.workdir, env: { CI: '1' }, timeoutMs: remainingMs }, (chunk) => {
              stdout = (stdout + chunk).slice(-500000)
              deps.db.appendComponentQaLog(runId, 'stdout', chunk)
            }, controller.signal)
          : { exitCode: null, timedOut: true }
        if (controller.signal.aborted) return
        const stageInfrastructure = result.timedOut || result.exitCode == null
        const stagePassed = result.exitCode === 0 && !result.timedOut
        const record: ComponentQaCommandResult = { commandId: `stage-${index + 1}`, name: total > 1 ? `Стадия ${index + 1} из ${total}` : 'Component / Storybook tests', command: script, exitCode: result.exitCode, durationMs: now() - stageStartedAt, status: stagePassed ? 'passed' : stageInfrastructure ? 'blocked' : 'failed', stdout, stderr: '', diagnostic: result.timedOut ? 'command_timeout' : result.exitCode == null ? 'executor_disconnected' : stagePassed ? '' : 'non_zero_exit', artifacts: [] }
        commands.push(record)
        if (!stagePassed) { failedStage = record; infrastructure = stageInfrastructure; break }
      }
      const current = deps.db.getComponentQaRun(userId, runId)
      if (!current || current.status !== 'running') return
      const passed = !failedStage
      deps.db.finishComponentQaRun(userId, runId, {
        status: passed ? 'passed' : infrastructure ? 'blocked' : 'failed',
        scenarios: current.scenarios.map((item) => ({ ...item, status: passed ? 'passed' : infrastructure ? 'blocked' : 'failed', actualResult: passed ? 'Компонентные проверки прошли' : 'Команда компонентных проверок завершилась с ошибкой', diagnostic: failedStage?.diagnostic ?? '' })),
        commands,
        summary: passed ? 'Component QA пройден' : infrastructure ? 'Component QA заблокирован инфраструктурой' : 'Component QA выявил дефект реализации',
        failureClassification: passed ? null : infrastructure ? 'infrastructure' : 'implementation_defect',
        blockerReasons: infrastructure && failedStage ? [failedStage.diagnostic] : []
      })
    })().catch((error) => {
      const current = deps.db.getComponentQaRun(userId, runId)
      if (current?.status === 'running') deps.db.finishComponentQaRun(userId, runId, { status: 'blocked', scenarios: current.scenarios.map((item) => ({ ...item, status: 'blocked', diagnostic: String(error) })), commands: [], summary: String(error), failureClassification: 'infrastructure', blockerReasons: ['executor_error'] })
    }).finally(() => controllers.delete(runId))
  }
  return { launch, cancel: (runId) => controllers.get(runId)?.abort() }
}

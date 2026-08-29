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
  boardChanged?: (projectId: string) => void
  completed?: (runId: string, userId: string, passed: boolean, reason: string) => void
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
      if (run) deps.boardChanged?.(run.projectId)
      return
    }
    const controller = new AbortController()
    controllers.set(runId, controller)
    deps.db.markComponentQaRunning(runId)
    deps.boardChanged?.(run.projectId)
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
      deps.completed?.(runId, userId, passed, passed ? 'Component QA пройден' : failedStage?.diagnostic || 'Component QA failed')
    })().catch((error) => {
      const current = deps.db.getComponentQaRun(userId, runId)
      if (current?.status === 'running') deps.db.finishComponentQaRun(userId, runId, { status: 'blocked', scenarios: current.scenarios.map((item) => ({ ...item, status: 'blocked', diagnostic: String(error) })), commands: [], summary: String(error), failureClassification: 'infrastructure', blockerReasons: ['executor_error'] })
    }).finally(() => { controllers.delete(runId); deps.boardChanged?.(run.projectId) })
  }
  return { launch, cancel: (runId) => controllers.get(runId)?.abort() }
}

export interface AutomatedQaRunnerDeps {
  db: {
    automatedQaExecutionContext(runId: string): { agentId: string; workdir: string; command: string } | null
    getQaStageRun(userId: string, runId: string): { projectId: string; status: string } | null
    markAutomatedQaRunning(runId: string): void
    appendAutomatedQaLog(runId: string, stream: 'out' | 'err' | 'system', text: string): void
    completeQaStageRun(userId: string, runId: string, result: Record<string, unknown>): unknown
    updateQaStageRun(runId: string, patch: { status?: 'failed' | 'cancelled'; currentStep?: string; error?: string | null }): void
  }
  executor: CommandExecutor
  timeoutMs?: number
  boardChanged?: (projectId: string) => void
  completed?: (runId: string, userId: string, passed: boolean, reason: string) => void
}

/** Реальный Automated QA: одна настраиваемая команда, потоковый NDJSON-friendly
 * лог в qa_stage_runs и жёсткий общий timeout. */
export function createAutomatedQaRunner(deps: AutomatedQaRunnerDeps): ComponentQaRunner {
  const controllers = new Map<string, AbortController>()
  return {
    launch(runId, userId) {
      if (controllers.has(runId)) return
      const run = deps.db.getQaStageRun(userId, runId)
      const context = deps.db.automatedQaExecutionContext(runId)
      if (!run || !context) {
        if (run) deps.db.updateQaStageRun(runId, { status: 'failed', currentStep: 'workspace', error: 'Development workspace недоступен' })
        if (run) deps.boardChanged?.(run.projectId)
        deps.completed?.(runId, userId, false, 'Development workspace недоступен')
        return
      }
      const controller = new AbortController()
      controllers.set(runId, controller)
      deps.db.markAutomatedQaRunning(runId)
      deps.db.appendAutomatedQaLog(runId, 'system', `$ ${context.command}\n`)
      deps.boardChanged?.(run.projectId)
      void deps.executor.run({ agentId: context.agentId, script: context.command, workdir: context.workdir, env: { CI: '1' }, timeoutMs: deps.timeoutMs ?? 30 * 60_000 }, (chunk) => {
        deps.db.appendAutomatedQaLog(runId, 'out', chunk)
      }, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        const passed = result.exitCode === 0 && !result.timedOut
        const reason = result.timedOut ? 'Лимит времени Automated QA исчерпан' : result.exitCode == null ? 'Исполнитель Automated QA отключился' : passed ? 'Автотесты успешно пройдены' : `Команда автотестов завершилась с кодом ${result.exitCode}`
        if (passed) deps.db.completeQaStageRun(userId, runId, { gatePassed: true, command: context.command, exitCode: 0 })
        else deps.db.updateQaStageRun(runId, { status: 'failed', currentStep: 'tests', error: reason })
        deps.completed?.(runId, userId, passed, reason)
      }).catch((error) => {
        const reason = error instanceof Error ? error.message : String(error)
        deps.db.updateQaStageRun(runId, { status: 'failed', currentStep: 'executor', error: reason })
        deps.completed?.(runId, userId, false, reason)
      }).finally(() => { controllers.delete(runId); deps.boardChanged?.(run.projectId) })
    },
    cancel(runId) { controllers.get(runId)?.abort() }
  }
}

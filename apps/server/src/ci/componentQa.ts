import type { ComponentQaCommandResult, ComponentQaRun, ComponentQaScenarioSnapshot } from '@voicechat/shared'
import type { CommandExecutor } from './types.js'
import type { AutomatedQaStepResult, AutomatedQaVerdict } from '@voicechat/shared'
import { scenarioLabel } from '@voicechat/shared'
import type { AutomatedQaExecutionContext } from '../db/database.js'
import type { AutomatedQaScenarioRunner } from './automatedQaScenario.js'

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
    automatedQaExecutionContext(runId: string): AutomatedQaExecutionContext | null
    getQaStageRun(userId: string, runId: string): { projectId: string; status: string } | null
    markAutomatedQaRunning(runId: string): void
    appendAutomatedQaLog(runId: string, stream: 'out' | 'err' | 'system', text: string): void
    completeQaStageRun(userId: string, runId: string, result: Record<string, unknown>): unknown
    updateQaStageRun(runId: string, patch: { status?: 'failed' | 'cancelled'; currentStep?: string; error?: string | null; result?: Record<string, unknown> | null; progress?: { current: number; total: number; label: string } }): void
  }
  executor: CommandExecutor
  /** Прогон сценария в изолированном Chromium; без него режим `playwright` блокируется. */
  scenarioRunner?: AutomatedQaScenarioRunner
  timeoutMs?: number
  now?: () => number
  boardChanged?: (projectId: string) => void
  completed?: (runId: string, userId: string, passed: boolean, reason: string, verdict: AutomatedQaVerdict | null) => void
}

/** Хвост вывода, который уходит в вердикт и дальше в замечания на доработку. */
const LOG_TAIL_LIMIT = 8000
/** Порог сброса буфера лога: чанки копятся, а не пишутся в SQLite поштучно. */
const LOG_FLUSH_BYTES = 4000
const LOG_FLUSH_MS = 700

/**
 * Реальный Automated QA. Два режима: команда в воркспейсе задачи и сценарий в
 * изолированном Chromium. Оба заканчиваются одним вердиктом — этап обязан
 * объяснять, что сломалось и кто виноват, иначе автопроход заводит баг на
 * разработчика за инфраструктурный сбой, а на доработку уходит одна строка
 * «команда завершилась с кодом 1».
 */
export function createAutomatedQaRunner(deps: AutomatedQaRunnerDeps): ComponentQaRunner {
  const controllers = new Map<string, AbortController>()
  const now = deps.now ?? Date.now
  return {
    launch(runId, userId) {
      if (controllers.has(runId)) return
      const run = deps.db.getQaStageRun(userId, runId)
      const context = deps.db.automatedQaExecutionContext(runId)
      if (!run || !context) {
        if (run) {
          const verdict = blockedVerdict('command', '', 'Development workspace недоступен', now)
          deps.db.updateQaStageRun(runId, { status: 'failed', currentStep: 'workspace', error: verdict.summary, result: verdict as unknown as Record<string, unknown> })
          deps.boardChanged?.(run.projectId)
          deps.completed?.(runId, userId, false, verdict.summary, verdict)
        } else deps.completed?.(runId, userId, false, 'Development workspace недоступен', null)
        return
      }
      const controller = new AbortController()
      controllers.set(runId, controller)
      deps.db.markAutomatedQaRunning(runId)
      deps.boardChanged?.(run.projectId)
      const startedAt = now()
      const finish = (verdict: AutomatedQaVerdict): void => {
        if (controller.signal.aborted) return
        if (verdict.passed) deps.db.completeQaStageRun(userId, runId, verdict as unknown as Record<string, unknown>)
        else deps.db.updateQaStageRun(runId, { status: 'failed', currentStep: verdict.classification === 'infrastructure' ? 'blocked' : 'tests', error: verdict.summary, result: verdict as unknown as Record<string, unknown> })
        deps.completed?.(runId, userId, verdict.passed, verdict.summary, verdict)
      }
      const done = (): void => { controllers.delete(runId); deps.boardChanged?.(run.projectId) }
      if (context.mode === 'playwright') {
        void runScenario(deps, { runId, userId, context, controller, startedAt, now }).then(finish).catch((error) => {
          finish(blockedVerdict('playwright', context.scenarios[0]?.startUrl ?? '', error instanceof Error ? error.message : String(error), now, startedAt))
        }).finally(done)
        return
      }
      deps.db.appendAutomatedQaLog(runId, 'system', `$ ${context.command}\n`)
      deps.db.updateQaStageRun(runId, { currentStep: 'tests', progress: { current: 0, total: 1, label: context.command } })
      let tail = ''
      let buffer = ''
      let lastFlush = now()
      // Раньше каждый чанк перечитывал и переписывал весь журнал рана: у
      // болтливого `npm test` это тысячи парсингов растущего массива.
      const flush = (): void => {
        if (!buffer) return
        deps.db.appendAutomatedQaLog(runId, 'out', buffer)
        buffer = ''
        lastFlush = now()
      }
      void deps.executor.run(
        { agentId: context.agentId, script: context.command, workdir: context.workdir, env: { CI: '1' }, timeoutMs: deps.timeoutMs ?? 30 * 60_000 },
        (chunk) => {
          tail = (tail + chunk).slice(-LOG_TAIL_LIMIT)
          buffer += chunk
          if (buffer.length >= LOG_FLUSH_BYTES || now() - lastFlush >= LOG_FLUSH_MS) flush()
        },
        controller.signal
      ).then((result) => {
        flush()
        if (controller.signal.aborted) return
        const passed = result.exitCode === 0 && !result.timedOut
        const infrastructure = result.timedOut || result.exitCode == null
        const summary = result.timedOut ? 'Лимит времени Automated QA исчерпан' : result.exitCode == null ? 'Исполнитель Automated QA отключился' : passed ? 'Автотесты успешно пройдены' : `Команда автотестов завершилась с кодом ${result.exitCode}`
        deps.db.updateQaStageRun(runId, { progress: { current: 1, total: 1, label: context.command } })
        finish({
          mode: 'command', gatePassed: passed, passed, summary,
          classification: passed ? null : infrastructure ? 'infrastructure' : 'implementation_defect',
          command: context.command, exitCode: result.exitCode, durationMs: now() - startedAt,
          logTail: tail, steps: [], screenshotUrl: null
        })
      }).catch((error) => {
        flush()
        finish(blockedVerdict('command', context.command, error instanceof Error ? error.message : String(error), now, startedAt, tail))
      }).finally(done)
    },
    cancel(runId) { controllers.get(runId)?.abort() }
  }
}

/** Сбой, в котором не виноват разработчик: этап заблокирован, а не провален. */
function blockedVerdict(mode: AutomatedQaVerdict['mode'], command: string, summary: string, now: () => number, startedAt?: number, logTail = ''): AutomatedQaVerdict {
  return { mode, gatePassed: false, passed: false, summary, classification: 'infrastructure', command, exitCode: null, durationMs: startedAt ? now() - startedAt : 0, logTail, steps: [], screenshotUrl: null }
}

/**
 * Прогон набора сценариев. Один сценарий на проект был потолком задачи «много
 * автотестов»: этап теперь идёт по всем и объединяет результат. Первый
 * провалившийся сценарий останавливает набор — дальше идти незачем, а какой
 * именно упал, видно по названию шага.
 */
async function runScenario(
  deps: AutomatedQaRunnerDeps,
  args: { runId: string; userId: string; context: AutomatedQaExecutionContext; controller: AbortController; startedAt: number; now: () => number }
): Promise<AutomatedQaVerdict> {
  const { runId, userId, context, controller, startedAt, now } = args
  const scenarios = context.scenarios
  const first = scenarios[0]?.startUrl ?? ''
  if (!deps.scenarioRunner) return blockedVerdict('playwright', first, 'Изолированный Chromium не настроен: этап Playwright запустить негде', now, startedAt)
  if (!scenarios.length) return blockedVerdict('playwright', '', 'Сценарии Automated QA не настроены: проверять нечего', now, startedAt)

  const totalSteps = scenarios.reduce((sum, item) => sum + item.steps.length, 0)
  deps.db.appendAutomatedQaLog(runId, 'system', `Playwright: сценариев ${scenarios.length}, шагов ${totalSteps}\n`)
  deps.db.updateQaStageRun(runId, { currentStep: 'scenario', progress: { current: 0, total: totalSteps, label: scenarioLabel(scenarios[0]) } })

  const collected: AutomatedQaStepResult[] = []
  let done = 0
  let blocked: string | null = null
  let screenshotUrl: string | null = null
  let failedScenario: string | null = null
  const pageErrors: string[] = []

  for (const [index, scenario] of scenarios.entries()) {
    if (controller.signal.aborted) break
    const label = scenarioLabel(scenario, index)
    // Бюджет делится на оставшиеся сценарии: один длинный иначе съедал бы весь.
    const remaining = scenarios.length - index
    const budget = deps.timeoutMs ? Math.max(30_000, Math.floor(deps.timeoutMs / remaining)) : undefined
    const outcome = await deps.scenarioRunner.run({
      runId, userId, scenario, signal: controller.signal,
      ...(budget ? { budgetMs: budget } : {}),
      onStep: (step, stepIndex) => {
        deps.db.appendAutomatedQaLog(runId, step.status === 'failed' ? 'err' : 'out', `${label}: ${stepIndex + 1} ${step.title} — ${step.status}${step.detail ? `: ${step.detail}` : ''}\n`)
        deps.db.updateQaStageRun(runId, { progress: { current: done + stepIndex + 1, total: totalSteps, label: `${label}: ${step.title}` } })
      }
    })
    if (outcome.screenshotError) deps.db.appendAutomatedQaLog(runId, 'err', `${label}: снимок экрана не сделан: ${outcome.screenshotError}\n`)
    // Ошибки страницы помечаются сценарием: в наборе иначе непонятно, чьи они.
    for (const error of outcome.pageErrors ?? []) {
      pageErrors.push(`${label}: ${error}`)
      deps.db.appendAutomatedQaLog(runId, 'err', `${label}: ошибка страницы: ${error}\n`)
    }
    // Имя сценария в названии шага: иначе в общем списке непонятно, чей он.
    // Ошибки шага метятся так же, как ошибки прогона: иначе один и тот же текст
    // с меткой и без неё не совпадает, и панель показывает его дважды — под
    // шагом и в списке «вне шагов».
    collected.push(...outcome.steps.map((step) => ({
      ...step, id: `${label}/${step.id}`, title: `${label}: ${step.title}`,
      ...(step.pageErrors?.length ? { pageErrors: step.pageErrors.map((error) => `${label}: ${error}`) } : {})
    })))
    done += scenario.steps.length
    if (outcome.screenshotUrl) screenshotUrl = outcome.screenshotUrl
    if (outcome.blocked) { blocked = `${label}: ${outcome.blocked}`; break }
    if (outcome.steps.some((step) => step.status === 'failed')) { failedScenario = label; break }
  }

  if (blocked) return { ...blockedVerdict('playwright', first, blocked, now, startedAt), steps: collected, screenshotUrl, ...(pageErrors.length ? { pageErrors } : {}) }
  const failed = collected.filter((step) => step.status === 'failed')
  const passed = totalSteps > 0 && failed.length === 0
  return {
    mode: 'playwright', gatePassed: passed, passed,
    summary: totalSteps === 0
      ? 'Сценарии Automated QA пусты: проверять нечего'
      : passed
        ? `Пройдено сценариев: ${scenarios.length}, шагов ${totalSteps}`
        : `Сценарий «${failedScenario ?? '?'}» провален на шаге «${failed[0]?.title ?? '?'}»`,
    classification: passed ? null : totalSteps === 0 ? 'infrastructure' : 'implementation_defect',
    command: first, exitCode: null, durationMs: now() - startedAt,
    logTail: collected.filter((step) => step.status !== 'skipped').map((step) => `${step.title} — ${step.status}${step.detail ? `: ${step.detail}` : ''}`).join('\n').slice(-LOG_TAIL_LIMIT),
    steps: collected, screenshotUrl,
    ...(pageErrors.length ? { pageErrors } : {})
  }
}

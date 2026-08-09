// Контракты CI-раннера, инъектируемые в buildServer для изоляции внешнего исполнения в тестах.

/** Запрос выполнения одного скрипта на машине. */
export interface CommandExecRequest {
  /** Машина выполнения (agentId). */
  agentId: string
  /** Текст скрипта (bash). */
  script: string
  /** Рабочая директория (абсолютный путь на машине). */
  workdir: string
  /** Переменные окружения (имя → значение). Ключи-невалидные идентификаторы отбрасываются. */
  env: Record<string, string>
  /** Таймаут в мс. */
  timeoutMs: number
  /** Значения секретов для маскирования в логе. */
  secrets?: string[]
}

export interface CommandExecResult {
  exitCode: number | null
  timedOut: boolean
}

/** Исполнитель команд CI (по умолчанию — поверх AgentRegistry.execStream). */
export interface CommandExecutor {
  run(
    req: CommandExecRequest,
    onChunk: (data: string) => void,
    signal?: AbortSignal
  ): Promise<CommandExecResult>
}

// --- Контекст для инъектируемых шагов «работа модели» и «fix-loop» ---------

import type { CiRun, CiRunStep, CiStatus, CiSlot, CiInitiatedBy, CiStepKind, CiPlanDecision, QuestionSpec, CiFixAttempt, CiFixDiagnosticContext, CiTargetedTestRun, CiTestFailure } from '@voicechat/shared'
import type { Task, ProjectDetail } from '@voicechat/shared'

/** Примитивы, которые раннер даёт хукам модели/фикса. */
export interface CiRunPrimitives {
  runId: string
  agentId: string | null
  workspacePath: string
  env: Record<string, string>
  /**
   * Отмена рана. Хук ОБЯЗАН его слушать: без этого `cancel` не останавливает ход
   * CLI, ран висит в `running`, а очередь проекта (`projectChains`) стоит.
   */
  signal: AbortSignal
  /** Создать шаг ленты (напр. вложенный вызов команды моделью). */
  addStep(args: {
    slot: CiSlot | null
    kind: CiStepKind
    title: string
    parentStepId?: string | null
    initiatedBy?: CiInitiatedBy
    commandId?: string | null
    commandSnapshot?: string | null
    workdir?: string | null
  }): CiRunStep
  /** Пометить статус/итог шага (+ broadcast). */
  finishStep(stepId: string, status: CiStatus, exitCode?: number | null): void
  /** Дописать строку лога шага (+ broadcast, + персист). */
  log(stepId: string, stream: 'stdout' | 'stderr' | 'system', chunk: string): void
  /** Выполнить команду справочника на машине как инструмент модели. */
  runCommandById(commandId: string, parentStepId: string): Promise<{ exitCode: number | null; timedOut: boolean; output: string }>
  /**
   * Запомнить id CLI-сессии модели: fix-loop продолжает тот же диалог
   * (`--resume`), поэтому модель помнит, что она делала в шаге «работа модели»
   * и что уже пробовала на прошлой попытке.
   */
  setModelSessionId(sessionId: string | null): void
  /** Зафиксировать итерацию fix-loop (персист + broadcast ci.fix). */
  recordFix(args: { runStepId: string; attemptNo: number; diagnosis: string; action: string; result: 'fixed' | 'retrying' | 'gave_up'; diff?: string | null; changedFiles?: string[]; targetedTests?: CiTargetedTestRun[]; fullRerun?: CiFixAttempt['fullRerun']; failures?: CiTestFailure[]; durationMs?: number | null; tokensUsed?: number | null }): void
  /** Предложить правку скрипта команды (Исход A: рекомендация). */
  suggest(commandId: string, runStepId: string | null, reason: string, proposedScript: string): void
  /**
   * Задать уточняющие вопросы и дождаться ответа: ран встаёт в `awaiting_input`,
   * вопрос дублируется в связанный чат. `null` — ответа не дождались (таймаут или
   * отмена рана), модель должна продолжить без уточнений.
   */
  askUser(stepId: string, questions: QuestionSpec[]): Promise<string | null>
  /**
   * Показать план и дождаться решения. `null` — не дождались/отменено.
   * `rework` возвращается вместе с комментарием пользователя.
   */
  askPlanApproval(stepId: string, planText: string): Promise<{ decision: CiPlanDecision; comment: string } | null>
}

export interface CiModelContext extends CiRunPrimitives {
  run: CiRun
  task: Task
  project: ProjectDetail
  /** Шаг ленты, к которому относится текущая работа модели (для лога/вложенности). */
  parentStepId: string
}

export interface CiFixContext extends CiModelContext {
  /** Упавший шаг пайплайна. */
  failedStep: CiRunStep
  /** Хвост лога упавшего шага. */
  logTail: string
  /**
   * Сессия CLI, в которой модель делала работу (или чинила прошлый шаг); null —
   * работы в этом процессе не было (напр. повтор рана с шага слота «после»).
   */
  modelSessionId: string | null
  /** Упал шаг-проверка (тесты/typecheck/линт) — хвост лога нужен подлиннее. */
  isTestStep: boolean
  /** Сохранить свежую диагностику для повторов и восстановления после рестарта. */
  setFixContext?(context: CiFixDiagnosticContext | null): void
  /** Запустить одну ограниченную точечную проверку внутри fix-loop. */
  runTargetedTest?(command: string): Promise<CiTargetedTestRun>
  /** Получить список изменённых файлов для UI попытки. */
  listChangedFiles?(): Promise<string[]>
  /** Повторно выполнить упавший шаг; новые поля опциональны для совместимых хуков. */
  rerunFailedStep(): Promise<{ stepId?: string; exitCode: number | null; timedOut: boolean; output?: string }>
}

/**
 * Хук «работа модели»: разработка + возможные вызовы команд. `cancelled` — работа
 * прервана (план отклонён пользователем или ран отменён): слот «после» и резюме
 * не запускаются.
 */
export type CiModelWorkHook = (ctx: CiModelContext) => Promise<{ ok: boolean; cancelled?: boolean }>
/** Хук «резюме модели». */
export type CiModelSummaryHook = (ctx: CiModelContext) => Promise<string>
/**
 * Хук «Актуализировать базу знаний»: модель сверяет базу с изменениями рабочей
 * копии. Ран из-за него НЕ падает — `ok: false` означает предупреждение в ленте
 * (работа модели уже сделана, терять её из-за базы знаний нельзя).
 */
export type CiKbUpdateHook = (ctx: CiModelContext) => Promise<{ ok: boolean; message: string }>
/** Хук fix-loop: попытаться довести упавший шаг до успеха. */
export type CiFixHook = (ctx: CiFixContext) => Promise<{ fixed: boolean }>

// --- Группированный test pipeline -----------------------------------------

import type {
  TestArtifact, TestFailure, TestGroupConfig, TestGroupResult, TestGroupRun,
  TestNotApplicableDecision, TestProgressPatch, TestRun, TestRunStatus
} from '@voicechat/shared'
import {
  EMPTY_TEST_COUNTERS, assertSingleRunningGroup, blockedGroupsAfterFailure,
  mayMarkGroupNotApplicable
} from '@voicechat/shared'

export interface TestPipelineStore {
  save(run: TestRun): void | Promise<void>
  audit(event: { type: string; runId: string; groupId: string | null; userId: string | null; at: number; payload: Record<string, unknown> }): void | Promise<void>
}

export interface TestGroupExecutionContext {
  run: Readonly<TestRun>
  group: Readonly<TestGroupRun>
  signal: AbortSignal
  log(stream: 'stdout' | 'stderr' | 'system', chunk: string): void
  progress(patch: TestProgressPatch): void
}

export interface TestPipelineExecutor {
  execute(ctx: TestGroupExecutionContext): Promise<TestGroupResult>
  /** Точечный прогон — только диагностика; полный run не мутируется. */
  executeTargeted?(ctx: TestGroupExecutionContext, command: string): Promise<TestGroupResult>
}

export interface TestPreviewGuard {
  ensure(input: { projectId: string; taskId: string; commitSha: string; previewId: string; signal: AbortSignal }): Promise<{
    baseUrl: string
    previewCommitSha: string
    testData: string | null
    artifacts?: TestArtifact[]
  }>
}

export interface TestRunStart {
  id: string
  projectId: string
  taskId: string
  branch: string
  commitSha: string
  workspace: string
  agentId: string | null
  previewId: string | null
  analysisModel: string
  triggeredBy: string
  attempt: number
  previousRunId?: string | null
  groups: TestGroupConfig[]
}

export interface TestPipelineCoordinator {
  create(input: TestRunStart): TestRun
  start(runId: string): Promise<TestRun>
  cancel(runId: string, userId: string): boolean
  markNotApplicable(runId: string, configId: string, role: 'owner' | 'tester' | 'member' | 'model', decision: Omit<TestNotApplicableDecision, 'decidedAt' | 'commitSha' | 'automatic'>): Promise<TestRun>
  targeted(runId: string, configId: string, command: string): Promise<TestGroupResult>
  get(runId: string): TestRun | null
  subscribe(listener: (run: TestRun) => void): () => void
}

function cloneTestRun(run: TestRun): TestRun {
  return structuredClone(run)
}

function browserGroup(group: TestGroupRun): boolean {
  return group.kind === 'playwright_smoke' || group.kind === 'playwright_regression'
}

function failure(message: string, kind: TestFailure['kind']): TestFailure {
  return {
    kind, packageName: null, runner: null, file: null, suite: null, testName: null,
    message, stack: null, expected: null, actual: null, logExcerpt: null,
    tracePath: null, screenshotPath: null, retryCommand: null
  }
}

/** Последовательный fail-fast coordinator; хранение и WS реализуются адаптерами. */
export function createTestPipelineCoordinator(deps: {
  store: TestPipelineStore
  executor: TestPipelineExecutor
  preview?: TestPreviewGuard
  now?: () => number
  redact?: (text: string) => string
}): TestPipelineCoordinator {
  const now = deps.now ?? Date.now
  const redact = deps.redact ?? ((text: string) => text)
  const runs = new Map<string, TestRun>()
  const controllers = new Map<string, AbortController>()
  const listeners = new Set<(run: TestRun) => void>()

  const publish = async (run: TestRun, type: string, groupId: string | null = null, userId: string | null = null, payload: Record<string, unknown> = {}) => {
    assertSingleRunningGroup(run.groups)
    await deps.store.save(cloneTestRun(run))
    await deps.store.audit({ type, runId: run.id, groupId, userId, at: now(), payload })
    for (const listener of listeners) listener(cloneTestRun(run))
  }

  const finishRun = async (run: TestRun, status: TestRunStatus) => {
    run.status = status
    run.currentGroupId = null
    run.finishedAt = now()
    run.durationMs = run.startedAt == null ? null : run.finishedAt - run.startedAt
    await publish(run, `test_run.${status}`)
  }

  return {
    create(input) {
      if (!/^[0-9a-f]{7,64}$/i.test(input.commitSha)) throw new Error('Test run требует точный commit SHA')
      const configs = [...input.groups].sort((a, b) => a.position - b.position)
      if (new Set(configs.map((group) => group.id)).size !== configs.length) throw new Error('Идентификаторы test groups должны быть уникальны')
      const run: TestRun = {
        id: input.id, projectId: input.projectId, taskId: input.taskId, branch: input.branch,
        commitSha: input.commitSha, workspace: input.workspace, agentId: input.agentId,
        previewId: input.previewId, previewCommitSha: null, analysisModel: input.analysisModel,
        triggeredBy: input.triggeredBy, attempt: input.attempt, previousRunId: input.previousRunId ?? null,
        status: 'queued', startedAt: null, finishedAt: null, durationMs: null, currentGroupId: null,
        groups: configs.map((config) => ({
          id: `${input.id}:${config.id}`, testRunId: input.id, configId: config.id,
          name: config.name, kind: config.kind, command: config.command,
          commandVersion: config.commandVersion, position: config.position, required: config.required,
          status: 'queued', commitSha: input.commitSha, startedAt: null, finishedAt: null,
          durationMs: null, exitCode: null, counters: { ...EMPTY_TEST_COUNTERS },
          currentSuite: null, currentTest: null, progress: null, log: '', failures: [],
          artifacts: [], skipReason: null, notApplicable: null, browserProject: null,
          baseUrl: null, testData: null
        }))
      }
      runs.set(run.id, run)
      void publish(run, 'test_run.created', null, input.triggeredBy, { commitSha: input.commitSha })
      return cloneTestRun(run)
    },

    async start(runId) {
      const run = runs.get(runId)
      if (!run || run.status !== 'queued') throw new Error('Test run не найден или уже запущен')
      const controller = new AbortController()
      controllers.set(runId, controller)
      run.status = 'running'
      run.startedAt = now()
      await publish(run, 'test_run.started')

      for (const group of run.groups) {
        if (group.status !== 'queued') continue
        if (controller.signal.aborted) break
        run.currentGroupId = group.id
        group.status = 'running'
        group.startedAt = now()
        await publish(run, 'test_group.started', group.id)

        const log = (stream: 'stdout' | 'stderr' | 'system', chunk: string) => {
          const safe = redact(chunk)
          group.log += (group.log ? '\n' : '') + safe
          void publish(run, 'test_group.log', group.id, null, { stream, chunk: safe })
        }
        const progress = (patch: TestProgressPatch) => {
          if (patch.currentSuite !== undefined) group.currentSuite = patch.currentSuite
          if (patch.currentTest !== undefined) group.currentTest = patch.currentTest
          if (patch.progress !== undefined) group.progress = patch.progress == null ? null : Math.max(0, Math.min(100, patch.progress))
          if (patch.counters) group.counters = { ...group.counters, ...patch.counters }
          void publish(run, 'test_group.progress', group.id)
        }

        let result: TestGroupResult
        try {
          if (browserGroup(group)) {
            if (!run.previewId || !deps.preview) throw new Error('Feature-preview для Playwright не настроен')
            const preview = await deps.preview.ensure({
              projectId: run.projectId, taskId: run.taskId, commitSha: run.commitSha,
              previewId: run.previewId, signal: controller.signal
            })
            if (preview.previewCommitSha !== run.commitSha) throw new Error(`Preview SHA ${preview.previewCommitSha} не соответствует test run SHA ${run.commitSha}`)
            run.previewCommitSha = preview.previewCommitSha
            group.baseUrl = preview.baseUrl
            group.testData = preview.testData
            group.artifacts.push(...(preview.artifacts ?? []))
          }
          result = await deps.executor.execute({ run: cloneTestRun(run), group: structuredClone(group), signal: controller.signal, log, progress })
        } catch (error) {
          result = { exitCode: null, infrastructureFailure: failure(error instanceof Error ? error.message : String(error), 'infrastructure') }
        }

        group.finishedAt = now()
        group.durationMs = group.startedAt == null ? null : group.finishedAt - group.startedAt
        group.exitCode = result.exitCode
        group.counters = { ...group.counters, ...result.counters }
        group.failures = [...(result.failures ?? [])]
        group.artifacts.push(...(result.artifacts ?? []))
        if (result.parserError) {
          group.failures.push(failure(`Ошибка разбора результата: ${result.parserError}`, 'parser'))
          log('system', `Исходный лог сохранён; parser: ${result.parserError}`)
        }
        if (result.infrastructureFailure) group.failures.unshift(result.infrastructureFailure)

        if (controller.signal.aborted) {
          group.status = 'cancelled'
          for (const queued of run.groups) if (queued.status === 'queued') { queued.status = 'skipped'; queued.skipReason = 'cancelled' }
          await publish(run, 'test_group.cancelled', group.id)
          await finishRun(run, 'cancelled')
          controllers.delete(runId)
          return cloneTestRun(run)
        }

        const ok = result.exitCode === 0 && !result.infrastructureFailure
        group.status = ok ? 'passed' : 'failed'
        await publish(run, `test_group.${group.status}`, group.id, null, {
          failureKind: result.infrastructureFailure ? 'infrastructure' : 'product'
        })
        if (!ok && group.required) {
          run.groups = blockedGroupsAfterFailure(run.groups, group.id)
          await finishRun(run, 'failed')
          controllers.delete(runId)
          return cloneTestRun(run)
        }
      }

      await finishRun(run, run.groups.some((group) => group.status === 'failed') ? 'failed' : 'passed')
      controllers.delete(runId)
      return cloneTestRun(run)
    },

    cancel(runId, userId) {
      const run = runs.get(runId)
      if (!run || (run.status !== 'queued' && run.status !== 'running')) return false
      controllers.get(runId)?.abort()
      if (run.status === 'queued') {
        for (const group of run.groups) if (group.status === 'queued') { group.status = 'skipped'; group.skipReason = 'cancelled' }
        void finishRun(run, 'cancelled')
      } else {
        void publish(run, 'test_run.cancel_requested', run.currentGroupId, userId)
      }
      return true
    },

    async markNotApplicable(runId, configId, role, input) {
      const run = runs.get(runId)
      const group = run?.groups.find((item) => item.configId === configId)
      if (!run || !group || group.status !== 'queued') throw new Error('Группа не найдена или уже запущена')
      if (!mayMarkGroupNotApplicable(group, role, input)) throw new Error('Недостаточно прав или обязательного обоснования для not_applicable')
      group.status = 'not_applicable'
      group.skipReason = 'not_applicable'
      group.notApplicable = { ...input, decidedAt: now(), commitSha: run.commitSha, automatic: false }
      await publish(run, 'test_group.not_applicable', group.id, input.decidedBy, { reason: input.reason, alternativeVerification: input.alternativeVerification, commitSha: run.commitSha })
      return cloneTestRun(run)
    },

    async targeted(runId, configId, command) {
      const run = runs.get(runId)
      const group = run?.groups.find((item) => item.configId === configId)
      if (!run || !group || !deps.executor.executeTargeted) throw new Error('Точечный повтор недоступен')
      if (!command.trim()) throw new Error('Пустая команда точечного повтора')
      const controller = new AbortController()
      const result = await deps.executor.executeTargeted({
        run: cloneTestRun(run), group: structuredClone(group), signal: controller.signal,
        log: () => undefined, progress: () => undefined
      }, command)
      await deps.store.audit({ type: 'test_group.targeted', runId, groupId: group.id, userId: null, at: now(), payload: { command, exitCode: result.exitCode, commitSha: run.commitSha } })
      return result
    },

    get(runId) {
      const run = runs.get(runId)
      return run ? cloneTestRun(run) : null
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

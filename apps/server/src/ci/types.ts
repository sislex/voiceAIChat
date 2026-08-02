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

import type { CiRun, CiRunStep, CiStatus, CiSlot, CiInitiatedBy, CiStepKind, CiPlanDecision, QuestionSpec } from '@voicechat/shared'
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
  recordFix(args: { runStepId: string; attemptNo: number; diagnosis: string; action: string; result: 'fixed' | 'retrying' | 'gave_up'; diff?: string | null; durationMs?: number | null; tokensUsed?: number | null }): void
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
  /** Повторно выполнить упавший шаг; вернёт новый статус. */
  rerunFailedStep(): Promise<{ exitCode: number | null; timedOut: boolean }>
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

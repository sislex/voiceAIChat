// Процесс-глобальный менеджер CI-ранов (по образцу TurnManager): прогон
// слот-за-слотом, потоковый лог, FIFO-очередь на сервер по `maxConcurrentRuns`,
// отмена, откат задачи при Исходе B, снапшот для восстановления после reconnect.
// Раны разных задач идут параллельно (у каждой задачи своя рабочая директория и
// своя ветка), шаги с общими ресурсами сериализует мьютекс `sharedLock`.
// Работа модели и fix-loop подключаются хуками (реальная реализация — в Срезе 4).

import type {
  ServerMessage, CiRun, CiRunStep, CiStatus, CiSlot, CiSlotProgress, CiCommand,
  CiRunMode, CiInteraction, CiInteractionAnswer, CiPlanDecision, QuestionSpec, Message, Task
} from '@voicechat/shared'
import { formatKbUsageSummaryLine, formatQuestionsBlock, issueKey, isVerificationCommand } from '@voicechat/shared'
import { isTerminalCiStatus, clampModel, firstAllowedProvider, isProviderAllowed, pickCiRunAgent } from '@voicechat/shared'
import type { CiRunLaunch } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { PROD_REBUILD_TASK_TITLE } from '../db/database.js'
import type { CommandExecutor, CiModelContext, CiFixContext, CiModelWorkHook, CiModelSummaryHook, CiFixHook, CiKbUpdateHook, CiRunPrimitives } from './types.js'
import { isReadOnlyCommand } from './console.js'
import { CI_INFRA_LABEL, classifyCiInfraFailure, formatCiInfraFailure } from './infraErrors.js'
import type { CiConsoleExecResult, ProjectMachine } from '@voicechat/shared'

/**
 * Сколько ждём завершения `execute` после отмены, прежде чем закрыть ран
 * принудительно и отпустить его слот с мьютексом общих ресурсов. Без этого
 * сторожа зависший шаг модели держал слот вечно, и следующие раны висели в
 * `queued` до перезапуска сервера.
 */
const CANCEL_GRACE_MS = 15_000

export interface CiRunManagerDeps {
  db: VoiceChatDb
  executor: CommandExecutor
  /** Дёрнуть обновление доски (сводка рана на карточке). */
  boardChanged: (projectId: string) => void
  /**
   * Продублировать вопрос/план в связанный чат задачи и вернуть id сообщения.
   * Инъектируется, чтобы раннер не зависел от TurnManager; `undefined` — не дублируем.
   */
  postToChat?: (args: { userId: string; conversationId: string; text: string; runId: string; interactionId: string }) => string | null
  /** Дописать в чат ответ пользователя (чтобы лента и чат не расходились). */
  postAnswerToChat?: (args: { userId: string; conversationId: string; text: string }) => void
  /**
   * Дописать в связанный чат задачи резюме рана и вернуть сохранённое сообщение
   * (или `null`, если чат уже удалён). Инъектируется по той же причине, что и
   * `postToChat`: раннер не должен знать про хранилище сообщений.
   */
  postSummaryToChat?: (args: { userId: string; conversationId: string; text: string; runId: string }) => Message | null
  now?: () => number
  /** Сторожевой таймаут отмены (мс); по умолчанию `CANCEL_GRACE_MS`. */
  cancelGraceMs?: number
  modelWork?: CiModelWorkHook
  modelSummary?: CiModelSummaryHook
  attemptFix?: CiFixHook
  /** Встроенный шаг «Актуализировать базу знаний» (`CiCommand.builtin === 'kb_update'`). */
  kbUpdate?: CiKbUpdateHook
}

type ResumePoint = { kind: 'command'; slot: CiSlot; index: number } | { kind: 'model' }

interface ActiveRun {
  userId: string
  projectId: string
  taskId: string
  abort: AbortController
  /** Папка и ветка рана; известны с момента, когда `execute` начал работу. */
  workspacePath?: string
  branch?: string
}

export interface CiRunStartOptions {
  mode?: CiRunMode
  provider?: 'claude' | 'codex'
  model?: string
  /** `parallel` — сразу в работу, мимо FIFO-очереди и `maxConcurrentRuns`. */
  launch?: CiRunLaunch
  /** Явная машина запуска; без неё `parallel` подбирает машину сам. */
  agentId?: string
}

export interface CiRunManager {
  start(userId: string, projectId: string, taskId: string, options?: CiRunMode | CiRunStartOptions): { run: CiRun } | { error: string }
  /**
   * Немедленный запуск на явно указанной машине (из настроек задачи). Ран этой
   * задачи, ещё стоящий в очереди, не отменяется, а продвигается: получает
   * указанную машину и уходит в работу мимо очереди.
   */
  forceStartOnMachine(userId: string, projectId: string, taskId: string, agentId: string): { run: CiRun } | { error: string }
  retryFromFailed(userId: string, runId: string, model?: { provider: 'claude' | 'codex'; model: string; llmEngineId?: string | null }): { run: CiRun } | { error: string }
  discardChangesAndRetry(userId: string, runId: string): Promise<{ run: CiRun } | { error: string }>
  cancel(userId: string, runId: string): boolean
  /** Убрать именно ожидающий ран; не маскирует уже начавшееся выполнение. */
  dequeue(userId: string, runId: string): import('@voicechat/shared').CiQueueRemovalResult
  subscribe(listener: (m: ServerMessage, ownerUserId: string) => void): () => void
  snapshot(userId: string, runId: string): void | ServerMessage
  activeRunIds(): string[]
  consoleExec(userId: string, runId: string, command: string, editMode: boolean): Promise<CiConsoleExecResult>
  /** Ответить на паузу рана (из ленты или из связанного чата). */
  answerInteraction(userId: string, runId: string, interactionId: string, answer: CiInteractionAnswer): { interaction: CiInteraction } | { error: string }
}

/** Слаг из заголовка задачи для ветки/пути. */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task'
  )
}

export function createCiRunManager(deps: CiRunManagerDeps): CiRunManager {
  const now = deps.now ?? (() => Date.now())
  const cancelGraceMs = deps.cancelGraceMs ?? CANCEL_GRACE_MS
  const listeners = new Set<(m: ServerMessage, ownerUserId: string) => void>()
  const active = new Map<string, ActiveRun>()
  /** Ожидающие ответа паузы: runId → как разбудить `execute`. */
  const pendingInteractions = new Map<string, { interactionId: string; resolve: (v: CiInteraction | null) => void }>()
  /**
   * runId → id CLI-сессии модели. Живёт в памяти менеджера, а не в хуке: работа
   * модели и fix-loop — разные вызовы, а диалог у них должен быть один
   * (`--resume`), иначе модель чинит упавший шаг, не помня, что она написала.
   */
  const modelSessions = new Map<string, string | null>()

  // Серверный лимит одновременных ранов (значение читаем при каждом захвате).
  // Ожидающие раны выбираем по актуальному порядку карточек в development:
  // приоритет, затем ручной порядок. Между разными проектами относительного
  // порядка на доске нет, поэтому сохраняем порядок постановки. Раны разных
  // задач идут параллельно — изоляция держится на том, что рабочая директория и
  // ветка у каждой задачи свои (см. проверку инварианта в `execute`).
  let running = 0
  /**
   * Слот принадлежит рану, а не вызову: на паузе (`waitForUser`) ран слот
   * отпускает и берёт заново. `abandoned` поднимается, когда ран уже закрыт
   * (в том числе сторожевым таймаутом отмены) — зомби-`execute` после этого
   * слот не занимает, иначе лимит сервера утекает по одному слоту за ран.
   * `bypass` — ран идёт мимо очереди (параллельный или принудительный запуск):
   * слот сервера он не занимает и не освобождает.
   */
  interface RunSlot { runId: string; held: boolean; abandoned: boolean; bypass: boolean }
  /** Пробуждение из очереди: `slot` — освободился серверный слот, `promoted` — ран продвинули мимо очереди. */
  interface SlotWaiter { runId: string; slot: RunSlot; wake: (reason: 'slot' | 'promoted') => void }
  const waiters: SlotWaiter[] = []
  const runSlots = new Map<string, RunSlot>()

  /** Достаёт следующего ожидающего в порядке его текущей колонки development. */
  function takeNextWaiter(): SlotWaiter | undefined {
    if (waiters.length < 2) return waiters.shift()
    const boardOrder = new Map<string, Map<string, number>>()
    for (const waiter of waiters) {
      const activeRun = active.get(waiter.runId)
      if (!activeRun || boardOrder.has(activeRun.projectId)) continue
      const board = deps.db.getBoard(activeRun.userId, activeRun.projectId)
      const development = board?.columns.find((column) => column.semanticType === 'development')
      if (!board || !development) continue
      boardOrder.set(
        activeRun.projectId,
        new Map(board.tasks.filter((task) => task.columnId === development.id).map((task, index) => [task.id, index]))
      )
    }
    let bestIndex = 0
    for (let index = 1; index < waiters.length; index++) {
      const best = active.get(waiters[bestIndex].runId)
      const candidate = active.get(waiters[index].runId)
      if (!best || !candidate || best.projectId !== candidate.projectId) continue
      const order = boardOrder.get(best.projectId)
      const bestOrder = order?.get(best.taskId) ?? Number.MAX_SAFE_INTEGER
      const candidateOrder = order?.get(candidate.taskId) ?? Number.MAX_SAFE_INTEGER
      if (candidateOrder < bestOrder) bestIndex = index
    }
    return waiters.splice(bestIndex, 1)[0]
  }
  async function acquireSlot(slot: RunSlot): Promise<void> {
    if (slot.held || slot.abandoned || slot.bypass) return
    const limit = deps.db.getCiSettings().maxConcurrentRuns
    if (running < limit) {
      running++
      slot.held = true
      return
    }
    const reason = await new Promise<'slot' | 'promoted'>((res) => waiters.push({ runId: slot.runId, slot, wake: res }))
    // Продвинутый ран выдернут из очереди принудительным запуском: чужое
    // пробуждение он не получал, счётчик не трогаем — просто идём работать.
    if (reason === 'promoted') return
    // Пока стояли в очереди, ран могли закрыть — передаём пробуждение дальше,
    // не трогая счётчик (его уменьшил тот, кто нас разбудил).
    if (slot.abandoned) {
      const next = takeNextWaiter()
      if (next) next.wake('slot')
      return
    }
    running++
    slot.held = true
  }
  function releaseSlot(slot: RunSlot): void {
    if (!slot.held) return
    slot.held = false
    running--
    const next = takeNextWaiter()
    if (next) next.wake('slot')
  }

  /**
   * Глобальный мьютекс общих ресурсов. Раны изолированы папкой и веткой, но шаги
   * «Влить ветку задачи в прод-ветку» (пишет в прод-ветку) и «Обновить
   * прод-контейнер» трогают то, что на машине одно на всех: одновременно — это
   * отбитый `push` и наполовину пересобранный прод. Признак шага системный
   * (`isSharedResourceCommand`), а не подпись команды в конкретном проекте.
   */
  type LockRelease = () => void
  interface LockWaiter { runId: string; wake: (release: LockRelease) => void }
  let lockHolder: string | null = null
  const lockWaiters: LockWaiter[] = []
  /** runId → отпустить мьютекс: нужен, чтобы отмена не оставила его занятым. */
  const lockReleases = new Map<string, LockRelease>()

  function grantLock(runId: string): LockRelease {
    lockHolder = runId
    let done = false
    const release: LockRelease = () => {
      if (done) return
      done = true
      lockReleases.delete(runId)
      if (lockHolder !== runId) return
      lockHolder = null
      const next = lockWaiters.shift()
      if (next) next.wake(grantLock(next.runId))
    }
    lockReleases.set(runId, release)
    return release
  }

  /**
   * Захватить мьютекс общих ресурсов. `null` — ран отменили, пока он ждал в
   * очереди за мьютексом; `onWait` зовём только если пришлось ждать.
   */
  function acquireSharedLock(runId: string, signal: AbortSignal, onWait: () => void): Promise<LockRelease | null> {
    if (signal.aborted) return Promise.resolve(null)
    if (lockHolder === null) return Promise.resolve(grantLock(runId))
    onWait()
    return new Promise<LockRelease | null>((resolve) => {
      const onAbort = (): void => {
        const i = lockWaiters.indexOf(waiter)
        if (i >= 0) lockWaiters.splice(i, 1)
        resolve(null)
      }
      const waiter: LockWaiter = {
        runId,
        wake: (release) => {
          signal.removeEventListener('abort', onAbort)
          resolve(release)
        }
      }
      lockWaiters.push(waiter)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  function broadcast(m: ServerMessage, userId: string): void {
    for (const l of listeners) l(m, userId)
  }

  function emitRun(run: CiRun, userId: string): void {
    broadcast({ t: 'ci.run', runId: run.id, run }, userId)
    deps.boardChanged(run.projectId)
  }
  function emitStep(step: CiRunStep, userId: string): void {
    broadcast({ t: 'ci.step', runId: step.runId, step }, userId)
  }

  function start(userId: string, projectId: string, taskId: string, options?: CiRunMode | CiRunStartOptions): { run: CiRun } | { error: string } {
    const launchOptions = typeof options === 'string' ? { mode: options } : options
    const modeOverride = launchOptions?.mode
    const launch: CiRunLaunch = launchOptions?.launch === 'parallel' ? 'parallel' : 'queue'
    const project = deps.db.getProject(userId, projectId)
    if (!project) return { error: 'Проект недоступен' }
    const task = deps.db.getCiTask(userId, projectId, taskId)
    if (!task) return { error: 'Задача не найдена' }
    // Параллельность — между задачами: два рана одной задачи неизбежно делили бы
    // рабочую директорию и ветку, а это и есть то, чего мы не допускаем.
    if (hasActiveRunForTask(taskId)) return { error: 'Для этой задачи уже выполняется ран' }
    // Машина запуска: явный выбор (принудительный запуск) → закреплённая за
    // карточкой → при параллельном запуске автоподбор по загрузке машин проекта
    // → машина проекта по умолчанию (старые задачи с NULL идут на неё же).
    let agentId: string | null
    if (launchOptions?.agentId) {
      agentId = launchOptions.agentId
    } else if (launch === 'parallel' && !task.agentId) {
      agentId = pickCiRunAgent(
        project.machines.map((machine) => machine.agentId),
        project.defaultAgentId ?? null,
        deps.db.countActiveCiRunsByAgent()
      )
    } else {
      agentId = task.agentId ?? project.defaultAgentId
    }
    if (agentId && !project.machines.some((machine) => machine.agentId === agentId)) {
      return { error: 'Выбранная машина больше не привязана к проекту' }
    }
    if (!agentId) return { error: 'Для запуска не задана машина проекта' }
    const slots = deps.db.resolveTaskSlots(projectId, taskId)
    const taskCi = deps.db.resolveTaskLlmConfig(projectId, taskId, userId)
    const settings = deps.db.getSettings(userId)
    const userLlm = deps.db.ciLlmDefaultsForUser(userId)
    const role = deps.db.getUser(userId)?.role ?? 'user'
    // Обычный запуск наследует пару задачи → проекта → пользователя. Окно создания
    // задачи передаёт разовый выбор, который фиксируется только в этом ране.
    const requestedProvider = launchOptions?.provider ?? userLlm.provider
    const requestedModel = launchOptions?.model ?? userLlm.model
    const access = deps.db.getUserLlmAccess(userId)
    const provider = isProviderAllowed(access, requestedProvider) ? requestedProvider : firstAllowedProvider(access)
    if (!provider) return { error: 'Нет доступных движков и моделей' }
    const model = clampModel(access, provider, requestedModel)
    if (!model) return { error: 'Нет доступных моделей для движка' }
    const engineResolution = deps.db.resolveLlmEngine(settings.llmEngineId, provider, role)
    const total = slots.beforeModel.length + slots.afterModel.length + 2
    // Связанный чат нужен, чтобы дублировать туда вопросы модели. Идемпотентно:
    // если пользователь уже открывал карточку, вернётся существующий чат.
    let conversationId: string | null = null
    try {
      conversationId = deps.db.openOrCreateTaskChat(userId, projectId, taskId)?.id ?? null
    } catch {
      conversationId = null
    }
    const run = deps.db.createCiRun({
      projectId,
      taskId,
      agentId,
      triggeredBy: userId,
      prevColumnId: task.columnId,
      llmEngineId: engineResolution.engine?.id ?? null,
      llmProvider: provider,
      llmModel: model,
      mode: modeOverride ?? taskCi.mode,
      clarifyLevel: taskCi.clarifyLevel,
      clarifyMax: taskCi.clarifyMax,
      conversationId,
      // Режим БЗ — снимок настройки проекта: смена настройки действует со
      // следующего рана, а этот до конца работает в зафиксированном режиме.
      kbContextMode: project.ciKbContextMode ?? 'auto',
      slotProgress: { done: 0, total, phase: 'В очереди' }
    })
    const developmentColumnId = deps.db.getColumnIdBySemantic(projectId, 'development')
    if (developmentColumnId && developmentColumnId !== task.columnId) {
      deps.db.moveTask(userId, projectId, taskId, { columnId: developmentColumnId })
    }
    if (engineResolution.substituted) deps.db.addCiEvent({ projectId, runId: run.id, type: 'run.llm_engine_substituted', actorType: 'system', payload: { requestedEngineId: settings.llmEngineId, resolvedEngineId: engineResolution.engine?.id ?? null, message: `Исполнитель ${settings.llmEngineId} недоступен; выбран ${engineResolution.engine?.name ?? 'default'}` } })
    deps.db.addCiEvent({ projectId, runId: run.id, type: 'run.started', actorType: 'user', actorId: userId, payload: { taskId, launch, agentId } })
    emitRun(run, userId)

    const ctl = new AbortController()
    active.set(run.id, { userId, projectId, taskId, abort: ctl })
    enqueue(run.id, userId, ctl, undefined, launch === 'parallel')
    return { run }
  }

  /**
   * Немедленный запуск на явно указанной машине — из настроек задачи. Если ран
   * задачи ещё стоит в общей очереди, он не отменяется, а продвигается: получает
   * машину и уходит в работу мимо лимита. Уже выполняющийся ран не трогаем —
   * перезапуск на другой машине означал бы потерю его работы.
   */
  function forceStartOnMachine(userId: string, projectId: string, taskId: string, agentId: string): { run: CiRun } | { error: string } {
    const project = deps.db.getProject(userId, projectId)
    if (!project) return { error: 'Проект недоступен' }
    if (!deps.db.getCiTask(userId, projectId, taskId)) return { error: 'Задача не найдена' }
    if (!project.machines.some((machine) => machine.agentId === agentId)) {
      return { error: 'Выбранная машина больше не привязана к проекту' }
    }
    for (const [id, a] of active) {
      if (a.taskId !== taskId || isClosingRun(id, a)) continue
      // Проверка статуса и продвижение — синхронно, в одном ходе event loop:
      // если execute уже стартовал (в том числе прямо сейчас на другой машине),
      // promoteQueuedRun не найдёт ран в очереди и запуск честно откажет.
      const row = deps.db.getCiRunRaw(id)
      if (row && row.status === 'queued' && promoteQueuedRun(id, agentId)) {
        deps.db.addCiEvent({ projectId, runId: id, type: 'run.forced_to_machine', actorType: 'user', actorId: userId, payload: { agentId } })
        const promoted = deps.db.getCiRunRaw(id)!
        emitRun(promoted, a.userId)
        return { run: promoted }
      }
      return { error: 'Для этой задачи уже выполняется ран' }
    }
    return start(userId, projectId, taskId, { launch: 'parallel', agentId })
  }

  /**
   * Выдернуть ожидающий ран из общей очереди и пустить в работу на указанной
   * машине. `false` — рана в очереди уже нет (успел стартовать или закрыться).
   */
  function promoteQueuedRun(runId: string, agentId: string): boolean {
    const slot = runSlots.get(runId)
    if (!slot || slot.held || slot.abandoned || slot.bypass) return false
    const index = waiters.findIndex((waiter) => waiter.slot === slot)
    if (index < 0) return false
    // Машина меняется до пробуждения: execute читает запись рана уже после него.
    deps.db.updateCiRun(runId, { agentId })
    slot.bypass = true
    const [waiter] = waiters.splice(index, 1)
    waiter.wake('promoted')
    return true
  }

  /**
   * Поставить ран в общую очередь сервера. `acquireSlot` встаёт в неё синхронно,
   * поэтому порядок вызовов `enqueue` — это и есть FIFO. Хвост обязан отработать
   * в любом случае — даже если после отмены `execute` завис на процессе модели:
   * иначе слот и мьютекс держатся до перезапуска сервера.
   */
  function enqueue(runId: string, userId: string, ctl: AbortController, resume?: ResumePoint, bypassQueue = false): void {
    const slot: RunSlot = { runId, held: false, abandoned: false, bypass: bypassQueue }
    runSlots.set(runId, slot)
    void acquireSlot(slot)
      .then(() => guardCancel(runId, userId, ctl, execute(runId, userId, ctl, resume)))
      .catch(() => {})
      .finally(() => {
        // Зависший execute может позже дойти до своей паузы или до своего
        // release — `abandoned` и идемпотентный release не дают ему занять
        // слот/мьютекс, которые мы уже отпустили за него.
        slot.abandoned = true
        releaseSlot(slot)
        lockReleases.get(runId)?.()
        runSlots.delete(runId)
        active.delete(runId)
        modelSessions.delete(runId)
      })
  }

  /**
   * Держит ли задачу ещё живой ран (в очереди, в работе или на паузе).
   * Закрывающийся ран задачу НЕ держит: после отмены его запись живёт в `active`,
   * пока исполнитель не отпустит слот (до `cancelGraceMs`), и всё это окно
   * «Выполнить» отвечало «Для этой задачи уже выполняется ран» — со стороны это
   * выглядело как залипший статус «отменён». Признаки закрытия — поднятый abort
   * и терминальный статус в БД.
   */
  function hasActiveRunForTask(taskId: string): boolean {
    for (const [id, a] of active) {
      if (a.taskId !== taskId) continue
      if (isClosingRun(id, a)) continue
      return true
    }
    return false
  }

  /**
   * Ран уже закрывается: задачу он не держит, а папку и ветку отпустит сам — не
   * позже сторожевого таймаута отмены. Признаки — поднятый abort (отмена дошла до
   * исполнителя не мгновенно) и терминальный статус в БД (запись живёт в `active`
   * до конца хвоста `enqueue`).
   */
  function isClosingRun(runId: string, a: ActiveRun): boolean {
    if (a.abort.signal.aborted) return true
    const status = deps.db.getCiRunRaw(runId)?.status
    return status != null && isTerminalCiStatus(status)
  }

  /**
   * Дождаться `execute`, но после отмены — не дольше `cancelGraceMs`. По истечении
   * грейса ран закрывается как `cancelled`, слот и звено очереди отпускаются, а
   * подвисший `execute` уже ничего не перезапишет (см. `finalize`).
   */
  function guardCancel(runId: string, userId: string, ctl: AbortController, execution: Promise<void>): Promise<void> {
    const settled = execution.catch(() => {})
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const stop = (): void => {
        if (timer) clearTimeout(timer)
        ctl.signal.removeEventListener('abort', arm)
        resolve()
      }
      const arm = (): void => {
        if (timer) return
        timer = setTimeout(() => {
          hardCancel(runId, userId)
          stop()
        }, cancelGraceMs)
        timer.unref?.()
      }
      void settled.then(stop)
      if (ctl.signal.aborted) arm()
      else ctl.signal.addEventListener('abort', arm)
    })
  }

  /**
   * Принудительное закрытие рана, который не отреагировал на отмену за грейс:
   * незавершённые шаги → `cancelled`, задача возвращается в исходную колонку.
   */
  function hardCancel(runId: string, userId: string): void {
    const row = deps.db.getCiRunRaw(runId)
    if (!row || isTerminalCiStatus(row.status)) return
    const steps = deps.db.getCiRun(userId, runId)?.steps ?? []
    const live = steps.filter((st) => st.status === 'running' || st.status === 'queued')
    const lastLive = live[live.length - 1]
    if (lastLive) {
      const line = deps.db.appendCiLog(runId, lastLive.id, 'system', `Исполнитель не завершился за ${Math.round(cancelGraceMs / 1000)} с после отмены — ран закрыт принудительно.\n`)
      broadcast({ t: 'ci.log', runId, line }, userId)
    }
    for (const st of live) {
      const upd = deps.db.updateCiRunStep(st.id, { status: 'cancelled', finishedAt: now() })
      if (upd) emitStep(upd, userId)
    }
    const sp = row.slotProgress
    const withPhase = deps.db.updateCiRun(runId, { slotProgress: { ...sp, phase: 'Ран отменён', fixing: false } })
    if (withPhase) emitRun(withPhase, userId)
    deps.db.addCiEvent({ projectId: row.projectId, runId, type: 'run.cancel_forced', actorType: 'system', payload: { graceMs: cancelGraceMs } })
    rollbackTask(runId, userId, row.prevColumnId)
    finalize(runId, userId, 'cancelled')
  }

  async function discardChangesAndRetry(userId: string, runId: string): Promise<{ run: CiRun } | { error: string }> {
    const detail = deps.db.getCiRun(userId, runId)
    if (!detail || detail.run.status !== 'failed') return { error: 'Действие доступно только для упавшего рана' }
    const dirtyStep = [...detail.steps].reverse().find((step) => step.kind === 'command' && step.status === 'failed' && step.exitCode === 66)
    if (!dirtyStep) return { error: 'Ран не остановлен из-за локальных изменений' }
    if (hasActiveRunForTask(detail.run.taskId)) return { error: 'Для этой задачи уже выполняется ран' }
    const project = deps.db.getProject(userId, detail.run.projectId)
    const task = deps.db.getCiTask(userId, detail.run.projectId, detail.run.taskId)
    const workspace = detail.run.workspaceId ? deps.db.getCiWorkspaceById(detail.run.workspaceId) : null
    if (!project || !task || !workspace || !detail.run.agentId) return { error: 'Рабочая директория рана недоступна' }
    const repoPath = `${workspace.path}/${slugify(task.title)}`
    const script = `test -d ${shq(`${repoPath}/.git`)} || { echo "Git-репозиторий не найден" >&2; exit 67; }; git -C ${shq(repoPath)} reset --hard HEAD; git -C ${shq(repoPath)} clean -fdx`
    const ctl = new AbortController()
    let result: Awaited<ReturnType<CommandExecutor['run']>>
    try {
      result = await deps.executor.run({ agentId: detail.run.agentId, script, workdir: workspace.path, env: {}, timeoutMs: 120_000, secrets: [] }, (data) => {
        const line = deps.db.appendCiLog(runId, dirtyStep.id, 'system', data)
        broadcast({ t: 'ci.log', runId, line }, userId)
      }, ctl.signal)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
    if (result.exitCode !== 0) return { error: `Не удалось откатить изменения (exit ${result.exitCode ?? 'unknown'})` }
    deps.db.addCiEvent({ projectId: detail.run.projectId, runId, type: 'workspace.discarded', actorType: 'user', actorId: userId, payload: { path: repoPath } })
    return start(userId, detail.run.projectId, detail.run.taskId)
  }

  /**
   * Ручное исключение из очереди. Здесь нет await, поэтому проверка queued и
   * перевод в cancelled происходят в одном ходе event loop: если execute уже
   * сменил статус на running, клиент получает именно running, а не ложный успех.
   */
  function dequeue(userId: string, runId: string): import('@voicechat/shared').CiQueueRemovalResult {
    const detail = deps.db.getCiRun(userId, runId)
    if (!detail) return { status: 'not_found' }
    const row = detail.run
    if (row.status === 'cancelled') return { status: 'removed', run: row }
    if (row.status !== 'queued') return {
      status: row.status === 'running' || row.status === 'awaiting_input' ? 'running' : 'not_queued',
      run: row
    }
    const a = active.get(runId)
    // После рестарта активного исполнителя нет; queued ран всё равно нельзя
    // безопасно «отменить» этим действием, так как он уже не принадлежит очереди.
    if (!a || a.userId !== userId) return { status: 'not_queued', run: row }
    a.abort.abort()
    const backlogColumnId = deps.db.getColumnIdBySemantic(row.projectId, 'backlog')
    if (backlogColumnId) {
      try { deps.db.moveTask(userId, row.projectId, row.taskId, { columnId: backlogColumnId }) } catch { /* колонка могла исчезнуть */ }
    }
    deps.db.addCiEvent({ projectId: row.projectId, runId, type: 'run.dequeued', actorType: 'user', actorId: userId, payload: { backlogColumnId } })
    finalize(runId, userId, 'cancelled')
    return { status: 'removed', run: deps.db.getCiRunRaw(runId)! }
  }

  function cancel(userId: string, runId: string): boolean {
    const a = active.get(runId)
    if (!a || a.userId !== userId) return false
    // Отметка в ленте: отмена в фазе модели не мгновенна (сначала гасится процесс
    // CLI на машине), и без строки лога UI выглядит как «кнопка не сработала».
    const liveSteps = (deps.db.getCiRun(userId, runId)?.steps ?? []).filter((st) => st.status === 'running')
    const last = liveSteps[liveSteps.length - 1]
    if (last) {
      const line = deps.db.appendCiLog(runId, last.id, 'system', 'Отмена рана: останавливаю шаг…\n')
      broadcast({ t: 'ci.log', runId, line }, userId)
    }
    deps.db.addCiEvent({ projectId: a.projectId, runId, type: 'run.cancel_requested', actorType: 'user', actorId: userId, payload: {} })
    a.abort.abort()
    // Ран мог стоять на паузе: без этого промис ожидания никогда не разрешится.
    resolvePending(runId, null)
    // Ран, который ещё не начинал работу, закрываем прямо здесь: иначе он висит
    // `queued` до освобождения слота сервера, и карточка после «Отменить»
    // показывает «в очереди». Догнавший позже `execute` статус не перепишет.
    const row = deps.db.getCiRunRaw(runId)
    if (row && row.status === 'queued') {
      rollbackTask(runId, userId, row.prevColumnId)
      finalize(runId, userId, 'cancelled')
    }
    return true
  }

  /** Снять ожидание паузы (ответ, таймаут или отмена рана). */
  function resolvePending(runId: string, interaction: CiInteraction | null): void {
    const waiter = pendingInteractions.get(runId)
    if (!waiter) return
    pendingInteractions.delete(runId)
    if (!interaction) deps.db.cancelCiInteraction(waiter.interactionId)
    waiter.resolve(interaction)
  }

  /**
   * Ответ на паузу из ленты рана или из связанного чата. Первый ответ побеждает:
   * `answerCiInteraction` обновляет строку только пока она `pending`.
   */
  function answerInteraction(userId: string, runId: string, interactionId: string, answer: CiInteractionAnswer): { interaction: CiInteraction } | { error: string } {
    const detail = deps.db.getCiRun(userId, runId)
    if (!detail) return { error: 'Ран недоступен' }
    const existing = deps.db.getCiInteraction(interactionId)
    if (!existing || existing.runId !== runId) return { error: 'Вопрос не найден' }
    if (existing.status !== 'pending') return { error: 'На этот вопрос уже ответили' }
    const decision = answer.decision === 'approved' || answer.decision === 'rework' ? answer.decision : null
    if (existing.kind === 'plan_approval' && !decision) return { error: 'Нужно решение по плану' }
    const text = (answer.text ?? '').trim()
    const updated = deps.db.answerCiInteraction(interactionId, { userId, text: text || null, decision })
    if (!updated) return { error: 'На этот вопрос уже ответили' }
    broadcast({ t: 'ci.interaction', runId, interaction: updated }, detail.run.triggeredBy)
    deps.db.addCiEvent({ projectId: detail.run.projectId, runId, type: 'run.interaction_answered', actorType: 'user', actorId: userId, payload: { interactionId, kind: existing.kind, decision } })
    // Ответ виден и в чате: иначе лента и чат разойдутся.
    const answerLine = existing.kind === 'plan_approval'
      ? `${decision === 'approved' ? 'План одобрен.' : 'План на доработку.'}${text ? `\n${text}` : ''}`
      : text
    if (updated.conversationId && answerLine && deps.postAnswerToChat) {
      deps.postAnswerToChat({ userId, conversationId: updated.conversationId, text: answerLine })
    }
    resolvePending(runId, updated)
    return { interaction: updated }
  }

  /** Повтор с упавшего шага: тот же ран, переиспользуем рабочую директорию,
   *  перезапускаем стоп-шаг и всё после него; успешные ранее шаги сохраняются. */
  function retryFromFailed(userId: string, runId: string, model?: { provider: 'claude' | 'codex'; model: string; llmEngineId?: string | null }): { run: CiRun } | { error: string } {
    const detail = deps.db.getCiRun(userId, runId)
    if (!detail) return { error: 'Ран недоступен' }
    const run = detail.run
    if (!isTerminalCiStatus(run.status) || run.status === 'success' || run.status === 'cancelled') {
      return { error: 'Повтор с шага доступен только для упавшего рана' }
    }
    if (hasActiveRunForTask(run.taskId)) return { error: 'Для этой задачи уже выполняется ран' }
    const failedModel = detail.steps
      .filter((st) => st.kind === 'model_work' && (st.status === 'failed' || st.status === 'timeout'))
      .sort((a2, b2) => b2.position - a2.position)[0]
    const failedCommand = detail.steps
      .filter((st) => st.kind === 'command' && st.commandId != null && (st.status === 'failed' || st.status === 'timeout'))
      .sort((a2, b2) => b2.position - a2.position)
      .find((st) => {
        const c = deps.db.getCiCommand(userId, st.commandId as string)
        return c ? !c.allowFailure : true
      })
    let resume: ResumePoint
    let eventPayload: Record<string, unknown>
    if (failedModel && (!failedCommand || failedModel.position > failedCommand.position)) {
      const provider = model?.provider ?? run.llmProvider
      const selectedModel = model ? model.model.trim() : run.llmModel
      if (provider !== 'claude' && provider !== 'codex') return { error: 'Неизвестный провайдер модели' }
      if (provider === 'claude' && !selectedModel) return { error: 'Модель Claude не выбрана' }
      const role = deps.db.getUser(userId)?.role ?? 'user'
      const resolvedEngine = deps.db.resolveLlmEngine(model?.llmEngineId ?? run.llmEngineId, provider, role)
      if (model?.llmEngineId && !resolvedEngine.engine) return { error: 'Исполнитель недоступен для роли' }
      deps.db.updateCiRun(run.id, { llmEngineId: resolvedEngine.engine?.id ?? null, llmProvider: provider, llmModel: selectedModel })
      resume = { kind: 'model' }
      eventPayload = { step: 'model_work', provider, model: selectedModel }
    } else {
      if (!failedCommand || !failedCommand.slot) return { error: 'Не найден упавший шаг для повтора' }
      const failed = failedCommand
      const slot = failed.slot as CiSlot
      const slotIds = deps.db.resolveTaskSlots(run.projectId, run.taskId)[slot === 'before_model' ? 'beforeModel' : 'afterModel']
      const index = Math.max(0, slotIds.indexOf(failed.commandId as string))
      resume = { kind: 'command', slot, index }
      eventPayload = { slot, index }
    }

    // Повтор — продолжение той же работы, поэтому карточка возвращается в
    // разработку так же, как при новом ране: иначе задача остаётся в колонке,
    // куда её вернул откат после падения, и на доске ран не виден.
    const developmentColumnId = deps.db.getColumnIdBySemantic(run.projectId, 'development')
    const retryTask = deps.db.getCiTask(userId, run.projectId, run.taskId)
    if (developmentColumnId && retryTask && retryTask.columnId !== developmentColumnId) {
      try {
        deps.db.moveTask(userId, run.projectId, run.taskId, { columnId: developmentColumnId })
      } catch {
        /* колонка могла исчезнуть — не критично */
      }
    }

    const ctl = new AbortController()
    active.set(run.id, { userId, projectId: run.projectId, taskId: run.taskId, abort: ctl })
    deps.db.addCiEvent({ projectId: run.projectId, runId: run.id, type: 'run.retry_from_step', actorType: 'user', actorId: userId, payload: eventPayload })
    const queued = deps.db.updateCiRun(run.id, { status: 'queued' })!
    emitRun(queued, userId)

    enqueue(run.id, userId, ctl, resume)
    return { run: queued }
  }

  function progress(runId: string, done: number, total: number, phase: string, userId: string): void {
    const run = deps.db.updateCiRun(runId, { slotProgress: { done, total, phase } })
    if (run) emitRun(run, userId)
  }

  // --- Выполнение одного командного шага ---
  async function runCommandStep(
    runId: string,
    userId: string,
    agentId: string | null,
    machines: ProjectMachine[],
    workspacePath: string,
    baseEnv: Record<string, string>,
    slot: CiSlot | null,
    position: number,
    command: CiCommand,
    initiatedBy: 'user' | 'system' | 'model',
    parentStepId: string | null,
    signal: AbortSignal
  ): Promise<{ status: CiStatus; exitCode: number | null; output: string; stepId: string }> {
    const step = deps.db.addCiRunStep({
      runId,
      slot,
      position,
      kind: parentStepId ? 'model_command' : 'command',
      parentStepId,
      initiatedBy,
      commandId: command.id,
      commandSnapshot: command.script,
      title: command.name,
      workdir: command.workdir || null,
      status: 'running'
    })
    const started = now()
    deps.db.updateCiRunStep(step.id, { startedAt: started })
    emitStep({ ...step, status: 'running', startedAt: started }, userId)

    // Шаг с общим на всю машину ресурсом (прод-ветка, прод-контейнер) ждёт, пока
    // его освободит другой ран: параллельно такие шаги идти не должны.
    let releaseShared: LockRelease | null = null
    if (isSharedResourceCommand(command)) {
      releaseShared = await acquireSharedLock(runId, signal, () => {
        const line = deps.db.appendCiLog(runId, step.id, 'system', 'Шаг работает с общим ресурсом — жду, пока его освободит другой ран…\n')
        broadcast({ t: 'ci.log', runId, line }, userId)
      })
      if (!releaseShared) {
        const upd = deps.db.updateCiRunStep(step.id, { status: 'cancelled', finishedAt: now() })
        if (upd) emitStep(upd, userId)
        return { status: 'cancelled', exitCode: null, output: '', stepId: step.id }
      }
    }

    // `PROD_DIR` называет production checkout на конкретной машине проекта.
    // Такой шаг не может исполняться в рабочей копии машины, где идёт ран.
    const prodDir = command.env.PROD_DIR
    let commandAgentId = agentId
    let commandRoot = workspacePath
    let targetError: string | null = null
    if (prodDir !== undefined) {
      const normalizedProdDir = prodDir.trim().replace(/\/$/, '')
      if (!normalizedProdDir) targetError = `Неверная конфигурация команды «${command.name}»: PROD_DIR пуст`
      const owners = normalizedProdDir ? machines.filter((machine) => machine.path.trim().replace(/\/$/, '') === normalizedProdDir) : []
      if (!targetError && owners.length === 0) {
        targetError = `Неверная конфигурация команды «${command.name}»: PROD_DIR=${prodDir} не совпадает с папкой ни одной машины проекта`
      }
      if (!targetError && owners.length > 1) {
        targetError = `Неверная конфигурация команды «${command.name}»: PROD_DIR=${prodDir} задан у нескольких машин проекта`
      }
      if (!targetError) {
        commandAgentId = owners[0].agentId
        commandRoot = normalizedProdDir
      }
    }
    const cwd = command.workdir ? `${commandRoot}/${command.workdir}` : commandRoot
    const settings = deps.db.getCiSettings()
    const timeoutMs = (command.timeoutSec ?? settings.defaultStepTimeoutSec) * 1000
    const collected: string[] = []
    const onChunk = (data: string): void => {
      collected.push(data)
      const line = deps.db.appendCiLog(runId, step.id, 'stdout', data)
      broadcast({ t: 'ci.log', runId, line }, userId)
    }
    let exitCode: number | null = null
    let timedOut = false
    try {
      if (targetError) throw new Error(targetError)
      if (!commandAgentId) throw new Error('У проекта не задана машина по умолчанию для выполнения')
      const res = await deps.executor.run({ agentId: commandAgentId, script: command.script, workdir: cwd, env: { ...baseEnv, ...command.env }, timeoutMs, secrets: [] }, onChunk, signal)
      exitCode = res.exitCode
      timedOut = res.timedOut
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Сбой исполнителя (машина отключилась, нет агента) приходит исключением, а
      // не строкой stdout: без этого он не попадёт ни в output шага, ни в
      // классификатор инфраструктурных ошибок, ни в контекст fix-loop.
      collected.push(msg + '\n')
      const line = deps.db.appendCiLog(runId, step.id, 'system', msg + '\n')
      broadcast({ t: 'ci.log', runId, line }, userId)
      exitCode = null
    } finally {
      releaseShared?.()
    }
    const finished = now()
    const status: CiStatus = timedOut ? 'timeout' : exitCode === 0 ? 'success' : 'failed'
    const updated = deps.db.updateCiRunStep(step.id, { status, exitCode, finishedAt: finished, durationMs: finished - started })
    if (updated) emitStep(updated, userId)
    if (status === 'success' && command.isCleanup) {
      const run = deps.db.getCiRunRaw(runId)
      if (run?.workspaceId) deps.db.releaseCiWorkspace(run.workspaceId, step.id)
      // Клон удалён успешно: чат задачи возвращаем к безопасной папке проекта,
      // иначе следующая команда чата уйдёт в уже несуществующий каталог.
      if (run?.conversationId) deps.db.restoreTaskChatWorkdir(userId, run.conversationId, run.projectId)
    }
    return { status, exitCode, output: collected.join(''), stepId: step.id }
  }

  /**
   * Cleanup-команда удаляет рабочую директорию вместе с коммитами модели, поэтому
   * перед ней ветку задачи обязательно отправляем в origin. Скрипт идемпотентен:
   * без новых коммитов ничего не делает, при незакоммиченных изменениях падает —
   * тогда рабочая директория остаётся на машине и работу можно забрать руками.
   */
  const PUSH_BRANCH_SCRIPT = `set -eu
test -n "$SLUG"
test -n "$BRANCH"
cd -- "$SLUG"
if [ ! -d .git ]; then echo "Git-репозиторий не найден — сохранять нечего"; exit 0; fi
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "В рабочей директории есть незакоммиченные изменения — не отдаю её на удаление" >&2
  git status --short >&2
  exit 69
fi
head=$(git rev-parse HEAD)
base=$(git rev-parse "refs/remotes/origin/$BASE_BRANCH" 2>/dev/null || echo "")
if [ "$head" = "$base" ]; then echo "Новых коммитов нет — отправлять нечего"; exit 0; fi
git push origin "HEAD:refs/heads/$BRANCH" || git push --force-with-lease origin "HEAD:refs/heads/$BRANCH"
echo "Ветка $BRANCH отправлена в origin ($head)"`

  /** Системный шаг «сохранить работу модели»: пуш ветки перед cleanup. */
  async function pushTaskBranch(
    runId: string,
    userId: string,
    agentId: string | null,
    workspacePath: string,
    env: Record<string, string>,
    slot: CiSlot | null,
    position: number,
    signal: AbortSignal
  ): Promise<boolean> {
    // Без машины команды не выполнялись вовсе — сохранять нечего.
    if (!agentId) return true
    const step = deps.db.addCiRunStep({
      runId, slot, position, kind: 'command', initiatedBy: 'system',
      title: 'Отправить ветку задачи в origin', status: 'running'
    })
    emitStep(step, userId)
    const started = now()
    const logLine = (stream: 'stdout' | 'system', chunk: string): void => {
      const line = deps.db.appendCiLog(runId, step.id, stream, chunk)
      broadcast({ t: 'ci.log', runId, line }, userId)
    }
    let exitCode: number | null = null
    try {
      const r = await deps.executor.run(
        { agentId, script: PUSH_BRANCH_SCRIPT, workdir: workspacePath, env, timeoutMs: 300_000, secrets: [] },
        (d) => logLine('stdout', d),
        signal
      )
      exitCode = r.exitCode
    } catch (err) {
      logLine('system', (err instanceof Error ? err.message : String(err)) + '\n')
    }
    const ok = exitCode === 0
    if (!ok) logLine('system', 'Ветка не отправлена — рабочая директория сохранена, работа модели не потеряна\n')
    const upd = deps.db.updateCiRunStep(step.id, { status: ok ? 'success' : 'failed', exitCode, finishedAt: now(), durationMs: now() - started })
    if (upd) emitStep(upd, userId)
    return ok
  }

  /**
   * След работы модели в рабочей копии: коммиты сверх базовой ветки или
   * незакоммиченные изменения. Пусто — выходим с 70, этот код и есть вердикт
   * «модель ничего не сделала».
   */
  const MODEL_WORK_CHECK_SCRIPT = `set -eu
changes=$(git status --porcelain --untracked-files=all || true)
base=$(git rev-parse "refs/remotes/origin/$BASE_BRANCH" 2>/dev/null || echo "")
head=$(git rev-parse HEAD)
commits=""
if [ -n "$base" ] && [ "$base" != "$head" ]; then
  commits=$(git log --oneline "$base..HEAD" || true)
fi
if [ -n "$commits" ]; then
  echo "Коммиты сверх $BASE_BRANCH:"
  echo "$commits"
fi
if [ -n "$changes" ]; then
  echo "Незакоммиченные изменения:"
  git status --short
fi
if [ -z "$commits" ] && [ -z "$changes" ]; then
  echo "В рабочей копии нет ни коммитов сверх $BASE_BRANCH, ни изменений" >&2
  exit 70
fi`

  /**
   * Модель отработала — но оставила ли она хоть что-то в рабочей копии? Без этой
   * проверки пустой ход доезжал до успеха: шаг коммита при пустом индексе выходит
   * с нулём («коммит не нужен»), мерж и пересборка прода отрабатывают вхолостую,
   * cleanup сносит клон, карточка уезжает в «Готово». Так закрылся ран d2ba80bc
   * (CHAT-108): модель 604 с читала код, не смогла записать ни одного файла и
   * прямо написала об этом в ответе — а лента показала успех.
   *
   * «Модель работала» отличаем от «модель не запускалась» по счётчику вызовов
   * инструментов рана: нет вызовов — проверять нечего, ран идёт как раньше.
   * Возвращает `true`, если ран можно продолжать.
   */
  async function ensureModelProducedWork(
    runId: string,
    userId: string,
    agentId: string | null,
    repoPath: string,
    env: Record<string, string>,
    position: number,
    signal: AbortSignal
  ): Promise<boolean> {
    // Без машины модель ничего и не могла сделать — проверять нечего.
    if (!agentId) return true
    const step = deps.db.addCiRunStep({
      runId, slot: null, position, kind: 'command', initiatedBy: 'system',
      title: 'Проверка результата модели', workdir: repoPath, status: 'running'
    })
    emitStep(step, userId)
    const started = now()
    const logLine = (stream: 'stdout' | 'system', chunk: string): void => {
      const line = deps.db.appendCiLog(runId, step.id, stream, chunk)
      broadcast({ t: 'ci.log', runId, line }, userId)
    }
    let exitCode: number | null = null
    try {
      const r = await deps.executor.run(
        { agentId, script: MODEL_WORK_CHECK_SCRIPT, workdir: repoPath, env, timeoutMs: 60_000, secrets: [] },
        (d) => logLine('stdout', d),
        signal
      )
      exitCode = r.exitCode
    } catch (err) {
      logLine('system', (err instanceof Error ? err.message : String(err)) + '\n')
    }
    const finish = (status: CiStatus): void => {
      const upd = deps.db.updateCiRunStep(step.id, { status, exitCode, finishedAt: now(), durationMs: now() - started })
      if (upd) emitStep(upd, userId)
    }
    if (signal.aborted) {
      finish('cancelled')
      return false
    }
    if (exitCode === 70) {
      const calls = deps.db.ciRunToolCalls(runId)
      const total = calls ? Object.values(calls).reduce((sum, n) => sum + n, 0) : 0
      if (total > 0) {
        logLine(
          'system',
          `Модель сделала ${total} вызовов инструментов, но не изменила ни одного файла. ` +
            'Дальше пайплайн прошёл бы вхолостую: коммит с пустым индексом выходит с нулём, ' +
            'мерж и пересборка прода ничего не делают, cleanup удалил бы рабочую копию, а ран ' +
            `закрылся бы успехом. Ран остановлен, рабочая копия ${repoPath} сохранена — ` +
            'разберитесь с причиной: чаще всего модели нечем записать файл, и в логе хода ' +
            'видны отказы инструментов read/edit.\n'
        )
        finish('failed')
        return false
      }
      logLine('system', 'Модель не вносила изменений и не вызывала инструменты — проверять нечего.\n')
      finish('success')
      return true
    }
    // Сама проверка не отработала (git сломан, машина отвалилась) — это не повод
    // рубить ран: исход решат следующие шаги, а факт виден в ленте.
    if (exitCode !== 0) logLine('system', 'Проверку результата модели выполнить не удалось — ран продолжается.\n')
    finish('success')
    return true
  }

  /** Отметить, что модель разбирается с упавшим шагом (карточка мигает красным медленно). */
  function setFixing(runId: string, userId: string, fixing: boolean, phase?: string): void {
    const row = deps.db.getCiRunRaw(runId)
    if (!row) return
    const sp = row.slotProgress
    const run = deps.db.updateCiRun(runId, { slotProgress: { ...sp, phase: phase ?? sp.phase, fixing } })
    if (run) emitRun(run, userId)
  }

  function makePrimitives(runId: string, userId: string, agentId: string | null, machines: ProjectMachine[], workspacePath: string, commandWorkspacePath: string, env: Record<string, string>, signal: AbortSignal): CiRunPrimitives {
    return {
      runId,
      agentId,
      workspacePath,
      env,
      signal,
      addStep: (a) => {
        const steps = deps.db.getCiRun(userId, runId)?.steps ?? []
        const position = steps.length
        const step = deps.db.addCiRunStep({ runId, slot: a.slot, position, kind: a.kind, parentStepId: a.parentStepId ?? null, initiatedBy: a.initiatedBy ?? 'model', commandId: a.commandId ?? null, commandSnapshot: a.commandSnapshot ?? null, title: a.title, workdir: a.workdir ?? null, status: 'running' })
        emitStep(step, userId)
        return step
      },
      finishStep: (stepId, status, exitCode) => {
        const upd = deps.db.updateCiRunStep(stepId, { status, exitCode: exitCode ?? null, finishedAt: now() })
        if (upd) emitStep(upd, userId)
      },
      log: (stepId, stream, chunk) => {
        const line = deps.db.appendCiLog(runId, stepId, stream, chunk)
        broadcast({ t: 'ci.log', runId, line }, userId)
      },
      runCommandById: async (commandId, parentStepId) => {
        const command = deps.db.getCiCommand(userId, commandId)
        if (!command) return { exitCode: null, timedOut: false, output: 'Команда не найдена' }
        const steps = deps.db.getCiRun(userId, runId)?.steps ?? []
        const r = await runCommandStep(runId, userId, agentId, machines, commandWorkspacePath, env, null, steps.length, command, 'model', parentStepId, signal)
        return { exitCode: r.exitCode, timedOut: r.status === 'timeout', output: r.output }
      },
      setModelSessionId: (sessionId) => {
        modelSessions.set(runId, sessionId)
        deps.db.updateCiRun(runId, { modelSessionId: sessionId })
      },
      recordFix: (a) => {
        const attempt = deps.db.addCiFixAttempt(a)
        broadcast({ t: 'ci.fix', runId, attempt }, userId)
      },
      suggest: (commandId, runStepId, reason, proposedScript) => {
        deps.db.addCiSuggestion({ commandId, runStepId, reason, proposedScript })
      },
      askUser: async (stepId, questions) => {
        const it = await waitForUser(runId, userId, stepId, { kind: 'clarify', questions }, signal)
        return it && it.status === 'answered' ? (it.answerText ?? '') : null
      },
      askPlanApproval: async (stepId, planText) => {
        const it = await waitForUser(runId, userId, stepId, { kind: 'plan_approval', planText }, signal)
        if (!it || it.status !== 'answered' || !it.decision) return null
        return { decision: it.decision, comment: it.answerText ?? '' }
      }
    }
  }

  /**
   * Поставить ран на паузу и дождаться пользователя. Пока ждём, отпускаем
   * серверный слот: одобрение плана может занять часы, а `maxConcurrentRuns`
   * по умолчанию 2 — иначе одна пауза перекрывает раны других задач. Слот
   * забираем обратно уже после ответа (и не забираем вовсе, если ран за это
   * время закрыли).
   */
  async function waitForUser(
    runId: string,
    userId: string,
    stepId: string,
    payload: { kind: 'clarify'; questions: QuestionSpec[] } | { kind: 'plan_approval'; planText: string },
    signal: AbortSignal
  ): Promise<CiInteraction | null> {
    if (signal.aborted) return null
    const run = deps.db.getCiRunRaw(runId)
    const interaction = deps.db.addCiInteraction({
      runId,
      stepId,
      kind: payload.kind,
      questions: payload.kind === 'clarify' ? payload.questions : [],
      planText: payload.kind === 'plan_approval' ? payload.planText : null,
      conversationId: run?.conversationId ?? null
    })

    // Дублируем в связанный чат: UI разберёт блок ```questions тем же парсером.
    if (run?.conversationId && deps.postToChat) {
      const questions: QuestionSpec[] = payload.kind === 'clarify'
        ? payload.questions
        : [{ q: 'Одобрить план и перейти к разработке?', options: ['Одобрить', 'На доработку'] }]
      const head = payload.kind === 'clarify'
        ? 'Уточняющие вопросы по задаче (ответ уйдёт в CI-ран):'
        : `План работы по задаче:\n\n${payload.planText}`
      const messageId = deps.postToChat({
        userId,
        conversationId: run.conversationId,
        text: `${head}\n\n${formatQuestionsBlock(questions)}`,
        runId,
        interactionId: interaction.id
      })
      if (messageId) deps.db.setCiInteractionMessage(interaction.id, run.conversationId, messageId)
    }

    const phase = payload.kind === 'plan_approval' ? 'План готов — ждёт одобрения' : 'Модель ждёт ответа'
    const before = deps.db.getCiRunRaw(runId)
    const progressNow = before?.slotProgress ?? { done: 0, total: 0, phase }
    const paused = deps.db.updateCiRun(runId, { status: 'awaiting_input', slotProgress: { ...progressNow, phase } })
    if (paused) emitRun(paused, userId)
    broadcast({ t: 'ci.interaction', runId, interaction: deps.db.getCiInteraction(interaction.id) ?? interaction }, userId)
    deps.db.addCiEvent({
      projectId: before?.projectId ?? '',
      runId,
      type: 'run.interaction_asked',
      actorType: 'model',
      payload: { kind: payload.kind, interactionId: interaction.id }
    })

    const waitMs = deps.db.getCiSettings().interactionWaitMs
    const slot = runSlots.get(runId)
    if (slot) releaseSlot(slot)
    let answered: CiInteraction | null = null
    try {
      answered = await new Promise<CiInteraction | null>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null
        const onAbort = (): void => resolvePending(runId, null)
        pendingInteractions.set(runId, {
          interactionId: interaction.id,
          resolve: (v) => {
            if (timer) clearTimeout(timer)
            signal.removeEventListener('abort', onAbort)
            resolve(v)
          }
        })
        if (waitMs > 0) {
          timer = setTimeout(() => {
            const line = deps.db.appendCiLog(runId, stepId, 'system', 'Ответ пользователя не получен — продолжаю без уточнений\n')
            broadcast({ t: 'ci.log', runId, line }, userId)
            resolvePending(runId, null)
          }, waitMs)
        }
        // Ран могли отменить пока мы ставили паузу — тогда не зависаем.
        if (signal.aborted) resolvePending(runId, null)
        else signal.addEventListener('abort', onAbort, { once: true })
      })
    } finally {
      if (slot) await acquireSlot(slot)
    }

    if (answered) {
      const after = deps.db.getCiRunRaw(runId)
      const resumed = deps.db.updateCiRun(runId, {
        status: 'running',
        slotProgress: { ...(after?.slotProgress ?? progressNow), phase: 'Модель работает' }
      })
      if (resumed) emitRun(resumed, userId)
    } else {
      const dropped = deps.db.getCiInteraction(interaction.id)
      if (dropped) broadcast({ t: 'ci.interaction', runId, interaction: dropped }, userId)
    }
    return answered
  }

  async function execute(runId: string, userId: string, ctl: AbortController, resume?: ResumePoint): Promise<void> {
    const runRow = deps.db.getCiRunRaw(runId)
    if (!runRow) return
    // Ран отменили, пока он стоял в очереди проекта: не начинаем вовсе, иначе
    // подготовка упадёт на отменённой команде и статус будет failed вместо cancelled.
    if (ctl.signal.aborted) {
      // `cancel` мог закрыть ран прямо из очереди — тогда закрывать нечего.
      if (!isTerminalCiStatus(runRow.status)) {
        rollbackTask(runId, userId, runRow.prevColumnId)
        finalize(runId, userId, 'cancelled')
      }
      return
    }
    const project = deps.db.getProject(userId, runRow.projectId)
    const task = deps.db.getCiTask(userId, runRow.projectId, runRow.taskId)
    if (!project || !task) {
      finalize(runId, userId, 'failed')
      return
    }
    // Машина рана зафиксирована при запуске (выбор карточки, автоподбор или
    // принудительный запуск); NULL остался только у ранов до появления выбора.
    const agentId = runRow.agentId ?? project.defaultAgentId
    const machine = project.machines.find((m) => m.agentId === agentId)
    const repoRoot = machine?.reposRoot?.replace(/\/$/, '') || ''
    const projectSlug = slugify(project.name)
    const taskNumber = String(task.seq ?? 0)
    const slug = slugify(task.title)
    const branch = (project.ciBranchTemplate || 'feature/{task_number}-{slug}').replace('{task_number}', taskNumber).replace('{slug}', slug)
    const workspacePath = `${repoRoot}/${projectSlug}/${taskNumber}`
    const taskKey = `${projectSlug}-${taskNumber}`
    // Изолированный кэш npm на задачу. Общий `~/.npm` ломался, когда два `npm ci`
    // на машине шли одновременно: EEXIST/ENOENT в `_cacache`, шаг падал с 254 и
    // ретраи не помогали, пока кэш не чистили руками. Кэш лежит РЯДОМ с рабочими
    // копиями, а не внутри рабочей директории: cleanup сносит её в конце рана и
    // каждый повтор качал бы пакеты заново.
    const npmCacheRoot = `${repoRoot || workspacePath}/.npm-cache`
    const npmCacheDir = `${npmCacheRoot}/${taskKey}`
    const env: Record<string, string> = {
      TASK_NUMBER: taskNumber,
      TASK_KEY: taskKey,
      SLUG: slug,
      BRANCH: branch,
      BASE_BRANCH: project.ciBaseBranch || 'main',
      REPO_URL: project.gitUrl ?? '',
      REPO_ROOT: repoRoot,
      WORKSPACE: workspacePath,
      PROJECT: projectSlug,
      // Путь для скриптов шагов; `npm_config_cache` npm подхватывает сам.
      NPM_CACHE_DIR: npmCacheDir,
      npm_config_cache: npmCacheDir
    }
    const signal = ctl.signal

    // Инвариант параллельных ранов: своя рабочая директория и своя ветка.
    // Сломать его может только конфигурация (совпавший номер задачи, шаблон
    // ветки без `{task_number}`), и тогда два рана перемешали бы работу в одной
    // копии — поэтому проверяем до первой команды.
    const findClash = (): [string, ActiveRun] | undefined =>
      [...active.entries()].find(([id, a]) => id !== runId && (a.workspacePath === workspacePath || a.branch === branch))
    let clash = findClash()
    // Папку и ветку может ещё держать ОТМЕНЁННЫЙ ран, чей исполнитель не успел
    // остановиться. Он их отпустит сам (не позже сторожевого таймаута отмены) —
    // ждём его, вместо того чтобы валить конфликтом изоляции ран, запущенный
    // сразу после «Отменить».
    if (clash && isClosingRun(clash[0], clash[1])) {
      const waitRow = deps.db.getCiRunRaw(runId)
      if (waitRow) {
        const waiting = deps.db.updateCiRun(runId, { slotProgress: { ...waitRow.slotProgress, phase: 'Жду освобождения рабочей директории' } })
        if (waiting) emitRun(waiting, userId)
      }
      const attempts = Math.ceil((cancelGraceMs + 1_000) / 50)
      for (let i = 0; i < attempts && clash && isClosingRun(clash[0], clash[1]) && !signal.aborted; i++) {
        await new Promise((r) => setTimeout(r, 50))
        clash = findClash()
      }
      if (signal.aborted) {
        rollbackTask(runId, userId, runRow.prevColumnId)
        finalize(runId, userId, 'cancelled')
        return
      }
    }
    if (clash) {
      failIsolation(runId, userId, runRow, workspacePath, branch, clash[0])
      return
    }
    const self = active.get(runId)
    if (self) {
      self.workspacePath = workspacePath
      self.branch = branch
    }

    const started = now()
    let run = deps.db.updateCiRun(runId, { status: 'running', startedAt: started })!
    emitRun(run, userId)

    // Рабочая директория: подготовка по стратегии повтора + запись workspace.
    const strategy = project.ciReuseStrategy || 'fail'
    // Кэши старых задач копятся на диске — чистим те, к которым две недели не
    // ходили. `touch` отмечает «использован сейчас»: без него давно живущая
    // задача теряла бы кэш на своём же ране (mtime каталога не растёт сам).
    const cachePrep = `mkdir -p ${shq(npmCacheDir)}; touch ${shq(npmCacheDir)} 2>/dev/null || true; find ${shq(npmCacheRoot)} -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} + 2>/dev/null || true`
    // Рабочая копия, оставшаяся от упавшего или отменённого рана ЭТОЙ задачи:
    // новый полный ран всё равно начинает с чистой базовой ветки, поэтому
    // приводим копию в порядок сами. Без этого шаг клонирования падал с exit 66
    // («в репозитории есть локальные изменения»), и повторный запуск после
    // падения требовал ручного «Откатить изменения и повторить». Незакоммиченное
    // не пропадает: сначала `git stash`, и его всегда можно достать из копии.
    const repoPath = `${workspacePath}/${slug}`
    // Связанный чат задачи должен выполнять команды там же, где модель CI: внутри
    // клонированного репозитория, а не в каталоге-контейнере workspace.
    if (runRow.conversationId) {
      deps.db.setConversationExecTarget(userId, runRow.conversationId, agentId, repoPath, task.skills)
    }
    const reclaim = [
      `  echo "Рабочая копия прошлого рана найдена — привожу её в чистое состояние"`,
      `  git -C ${shq(repoPath)} stash push --include-untracked --message ${shq(`ci-run ${runId}`)} >/dev/null 2>&1 || true`,
      `  git -C ${shq(repoPath)} reset --hard >/dev/null 2>&1 || true`,
      `  git -C ${shq(repoPath)} clean -fd >/dev/null 2>&1 || true`
    ].join('\n')
    const guardExisting = strategy === 'fail'
      ? `if [ -d ${shq(workspacePath)} ] && [ -n "$(ls -A ${shq(workspacePath)} 2>/dev/null)" ]; then echo "Рабочая директория уже существует (стратегия fail)" >&2; exit 65; fi; mkdir -p ${shq(workspacePath)}`
      : `mkdir -p ${shq(workspacePath)}`
    // Стратегия `clean` сносит папку целиком — чистить там нечего; `fail`
    // защищает от ЧУЖОГО содержимого, но своя копия задачи под запрет не
    // попадает, иначе повтор после падения был бы невозможен в принципе.
    const workspacePrep = strategy === 'clean'
      ? `rm -rf ${shq(workspacePath)}; mkdir -p ${shq(workspacePath)}`
      : `if [ -d ${shq(`${repoPath}/.git`)} ]; then\n${reclaim}\nelse\n${guardExisting}\nfi`
    const prep = `${cachePrep}\n${workspacePrep}`
    if (!resume) {
      // Новый ран: создаём запись рабочей директории. При повторе — переиспользуем.
      const ws = deps.db.createCiWorkspace({ projectId: runRow.projectId, taskId: runRow.taskId, agentId: agentId ?? null, path: workspacePath })
      deps.db.updateCiRun(runId, { workspaceId: ws.id })
    }

    const slots = deps.db.resolveTaskSlots(runRow.projectId, runRow.taskId)
    const total = slots.beforeModel.length + slots.afterModel.length + 2
    const beforeLen = slots.beforeModel.length
    // Точка возобновления при «повторе с упавшего шага»: сколько шагов уже пройдено
    // и с какого номера нумеровать новые шаги (чтобы не пересекаться со старыми).
    let done = resume ? (resume.kind === 'model' ? beforeLen : resume.slot === 'before_model' ? resume.index : beforeLen + 1 + resume.index) : 0
    const posBase = resume ? (deps.db.getCiRun(userId, runId)?.steps.length ?? 0) : 0
    // Системные шаги, вставленные между командами слота, сдвигают позиции в ленте.
    let extraSteps = 0
    // Исход встроенного KB-шага приходит в итоговое сообщение даже если после
    // него упала команда слота: резюме выполняется до финализации рана.
    let kbUpdateSummary: string | null = null

    /** Закрыть ран отменой: фаза в прогрессе, откат карточки, финальный статус. */
    const finishCancelled = (): false => {
      progress(runId, done, total, 'Ран отменён', userId)
      rollbackTask(runId, userId, runRow.prevColumnId)
      finalize(runId, userId, 'cancelled')
      return false
    }

    // Системный шаг подготовки директории (пропускаем при повторе — директория есть).
    if (!resume && repoRoot && agentId) {
      const prepStep = deps.db.addCiRunStep({ runId, slot: 'before_model', position: 0, kind: 'command', initiatedBy: 'system', title: 'Подготовка рабочей директории', status: 'running' })
      emitStep(prepStep, userId)
      const ps = now()
      try {
        const r = await deps.executor.run({ agentId, script: prep, workdir: repoRoot, env, timeoutMs: 60_000, secrets: [] }, (d) => {
          const line = deps.db.appendCiLog(runId, prepStep.id, 'stdout', d)
          broadcast({ t: 'ci.log', runId, line }, userId)
        }, signal)
        const st: CiStatus = r.exitCode === 0 ? 'success' : 'failed'
        const upd = deps.db.updateCiRunStep(prepStep.id, { status: st, exitCode: r.exitCode, finishedAt: now(), durationMs: now() - ps })!
        emitStep(upd, userId)
        if (st !== 'success') {
          if (signal.aborted) {
            finishCancelled()
            return
          }
          rollbackAndFail(runId, userId, runRow.prevColumnId, 'script_error')
          return
        }
      } catch {
        deps.db.updateCiRunStep(prepStep.id, { status: signal.aborted ? 'cancelled' : 'failed', finishedAt: now() })
        if (signal.aborted) {
          finishCancelled()
          return
        }
        rollbackAndFail(runId, userId, runRow.prevColumnId, 'no_access')
        return
      }
    }

    /**
     * Встроенный шаг «Актуализировать базу знаний»: `script` не исполняется,
     * работу делает серверный хук (`kb/codeUpdate.ts`). Ошибка хука обязательна:
     * шаг и весь ран завершаются failed, последующие команды не запускаются.
     */
    const runKbUpdateStep = async (command: CiCommand, slot: CiSlot, position: number): Promise<boolean> => {
      const step = deps.db.addCiRunStep({
        runId, slot, position, kind: 'command', initiatedBy: 'system',
        commandId: command.id, title: command.name, status: 'running'
      })
      emitStep(step, userId)
      const started = now()
      let ok = false
      let message = 'Актуализация базы знаний не выполнена: хук не подключён'
      if (deps.kbUpdate) {
        const ctx: CiModelContext = {
          ...makePrimitives(runId, userId, agentId, project.machines, repoPath, workspacePath, env, signal),
          run: deps.db.getCiRunRaw(runId)!,
          task,
          project,
          parentStepId: step.id
        }
        try {
          const r = await deps.kbUpdate(ctx)
          ok = r.ok
          message = r.message
          kbUpdateSummary = message
        } catch (err) {
          ok = false
          message = `Шаг не выполнен: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      kbUpdateSummary = message
      const line = deps.db.appendCiLog(runId, step.id, 'system', `${ok ? '' : 'Ошибка: '}${message}\n`)
      broadcast({ t: 'ci.log', runId, line }, userId)
      const status: CiStatus = signal.aborted ? 'cancelled' : ok ? 'success' : 'failed'
      const upd = deps.db.updateCiRunStep(step.id, { status, finishedAt: now(), durationMs: now() - started })
      if (upd) emitStep(upd, userId)
      return status === 'success'
    }

    // Хелпер обработки одного слота команд.
    const runSlot = async (slot: CiSlot, commandIds: string[], phaseLabel: string, startIndex = 0): Promise<boolean> => {
      for (let i = startIndex; i < commandIds.length; i++) {
        if (signal.aborted) return finishCancelled()
        progress(runId, done, total, `${phaseLabel} (${i + 1}/${commandIds.length})`, userId)
        const command = deps.db.getCiCommand(userId, commandIds[i])
        if (!command) {
          done++
          continue
        }
        // Встроенный серверный шаг идёт мимо исполнителя команд машины.
        if (command.builtin === 'kb_update') {
          const updated = await runKbUpdateStep(command, slot, posBase + done + 1 + extraSteps)
          if (signal.aborted) return finishCancelled()
          if (!updated) {
            deps.db.updateCiRun(runId, { status: 'failed' })
            return false
          }
          done++
          continue
        }
        // Cleanup сносит рабочую директорию вместе с коммитами модели — сначала
        // отправляем ветку в origin; не получилось — не удаляем и падаем.
        if (command.isCleanup) {
          const pushed = await pushTaskBranch(runId, userId, agentId, workspacePath, env, slot, posBase + done + 1 + extraSteps, signal)
          extraSteps++
          if (!pushed) {
            if (slot === 'before_model') {
              rollbackAndFail(runId, userId, runRow.prevColumnId, 'script_error')
              return false
            }
            deps.db.updateCiRun(runId, { status: 'failed' })
            return false
          }
        }
        const res = await runCommandStep(runId, userId, agentId, project.machines, workspacePath, env, slot, posBase + done + 1 + extraSteps, command, 'user', null, signal)
        // Шаг мог упасть именно из-за отмены (исполнитель отклонил команду) —
        // тогда это `cancelled`, а не `failed`, и никакого fix-loop.
        if (signal.aborted) return finishCancelled()
        if (res.status !== 'success' && !command.allowFailure) {
          // Инфраструктурный сбой машины (повреждённый кэш npm, кончилось место)
          // в fix-loop не отдаём: модель ищет причину в проекте и жжёт ходы зря.
          const infra = classifyCiInfraFailure({ exitCode: res.exitCode, output: res.output })
          if (infra) {
            const line = deps.db.appendCiLog(runId, res.stepId, 'system', formatCiInfraFailure(infra))
            broadcast({ t: 'ci.log', runId, line }, userId)
            deps.db.addCiEvent({ projectId: runRow.projectId, runId, type: 'run.infra_error', actorType: 'system', payload: { kind: infra.kind, stepId: res.stepId, exitCode: res.exitCode } })
            progress(runId, done, total, `Инфраструктурная ошибка машины — ${CI_INFRA_LABEL[infra.kind]}`, userId)
            const infraStatus: CiStatus = res.status === 'timeout' ? 'timeout' : 'failed'
            if (slot === 'before_model') {
              rollbackAndFail(runId, userId, runRow.prevColumnId, 'infra_error', infraStatus)
              return false
            }
            deps.db.updateCiRun(runId, { status: infraStatus })
            return false
          }
          // fix-loop (если подключён) на упавший шаг.
          const fixed = await tryFix(runId, userId, agentId, repoPath, workspacePath, env, project, task, signal)
          if (!fixed) {
            const failStatus = res.status === 'timeout' ? 'timeout' : 'failed'
            if (slot === 'before_model') {
              // Слот «до» упал → модель не стартует. Откат задачи.
              rollbackAndFail(runId, userId, runRow.prevColumnId, 'script_error', failStatus)
              return false
            }
            // Слот «после» упал → ран failed, но резюме всё равно сформируется.
            deps.db.updateCiRun(runId, { status: failStatus })
            return false
          }
        }
        done++
      }
      return true
    }

    // 1) Слот «до».
    const beforeOk = await runSlot('before_model', slots.beforeModel, 'Подготовка', resume?.kind === 'command' && resume.slot === 'before_model' ? resume.index : resume ? slots.beforeModel.length : 0)
    if (!beforeOk) return
    // Команды подготовки исполняются из контейнера workspace и сами заходят в
    // $SLUG. Перед выдачей MCP модели проверяем именно корень клона: иначе CLI
    // честно стартовал в родительской папке, не находил репозиторий и пустой ран
    // всё равно доходил до merge/success.
    const repoStep = deps.db.addCiRunStep({ runId, slot: 'before_model', position: posBase + done + 1 + extraSteps++, kind: 'command', initiatedBy: 'system', title: 'Проверка рабочей директории модели', workdir: repoPath, status: 'running' })
    emitStep(repoStep, userId)
    const repoStarted = now()
    let repoReady = false
    try {
      if (!agentId) throw new Error('У проекта не задана машина по умолчанию для выполнения')
      const check = await deps.executor.run({ agentId, script: 'git rev-parse --show-toplevel >/dev/null', workdir: repoPath, env, timeoutMs: 30_000, secrets: [] }, (data) => {
        const line = deps.db.appendCiLog(runId, repoStep.id, 'stdout', data)
        broadcast({ t: 'ci.log', runId, line }, userId)
      }, signal)
      repoReady = check.exitCode === 0
      const upd = deps.db.updateCiRunStep(repoStep.id, { status: repoReady ? 'success' : 'failed', exitCode: check.exitCode, finishedAt: now(), durationMs: now() - repoStarted })
      if (upd) emitStep(upd, userId)
    } catch (err) {
      const line = deps.db.appendCiLog(runId, repoStep.id, 'system', `${err instanceof Error ? err.message : String(err)}\n`)
      broadcast({ t: 'ci.log', runId, line }, userId)
      const upd = deps.db.updateCiRunStep(repoStep.id, { status: signal.aborted ? 'cancelled' : 'failed', finishedAt: now(), durationMs: now() - repoStarted })
      if (upd) emitStep(upd, userId)
    }
    if (!repoReady) {
      if (signal.aborted) finishCancelled()
      else rollbackAndFail(runId, userId, runRow.prevColumnId, 'script_error')
      return
    }
    if (signal.aborted) {
      finishCancelled()
      return
    }

    // 2) Работа модели (при повторе из слота «после» — уже сделана, пропускаем).
    const prim = makePrimitives(runId, userId, agentId, project.machines, repoPath, workspacePath, env, signal)
    let modelOk = true
    let modelCancelled = false
    /** Модель работала, но рабочая копия пуста — слот «после» не запускаем. */
    let emptyWork = false
    if (!(resume?.kind === 'command' && resume.slot === 'after_model')) {
      progress(runId, done, total, 'Модель работает', userId)
      const mwStep = deps.db.addCiRunStep({ runId, slot: null, position: posBase + done + 1 + extraSteps, kind: 'model_work', initiatedBy: 'system', title: 'Работа модели', status: 'running' })
      emitStep(mwStep, userId)
      const mwStart = now()
      if (deps.modelWork) {
        const ctx: CiModelContext = { ...prim, run: deps.db.getCiRunRaw(runId)!, task, project, parentStepId: mwStep.id }
        try {
          const r = await deps.modelWork(ctx)
          modelOk = r.ok
          modelCancelled = r.cancelled === true
        } catch {
          modelOk = false
        }
      } else {
        const line = deps.db.appendCiLog(runId, mwStep.id, 'system', 'Работа модели пропущена (хук не подключён)\n')
        broadcast({ t: 'ci.log', runId, line }, userId)
      }
      const stepStatus: CiStatus = modelOk ? 'success' : modelCancelled || signal.aborted ? 'cancelled' : 'failed'
      const upd = deps.db.updateCiRunStep(mwStep.id, { status: stepStatus, finishedAt: now(), durationMs: now() - mwStart })!
      emitStep(upd, userId)
      // Отмена пользователем: слот «после» и резюме не запускаем, карточку возвращаем.
      if (signal.aborted) {
        finishCancelled()
        return
      }
      if (modelCancelled) {
        progress(runId, done, total, 'План не одобрен — ран остановлен', userId)
        rollbackTask(runId, userId, runRow.prevColumnId)
        finalize(runId, userId, 'cancelled')
        return
      }
      if (!modelOk) {
        progress(runId, done, total, 'Ошибка модели — выберите другую модель и повторите шаг', userId)
        finalize(runId, userId, 'failed')
        return
      }
      done++
      // Ход завершился успехом — но работа могла и не появиться. Пустую копию
      // дальше по пайплайну не пускаем: cleanup удалил бы её, а ран отчитался бы
      // успехом (см. `ensureModelProducedWork`).
      if (!(await ensureModelProducedWork(runId, userId, agentId, repoPath, env, posBase + done + 1 + extraSteps++, signal))) {
        if (signal.aborted) {
          finishCancelled()
          return
        }
        emptyWork = true
        progress(runId, done, total, 'Модель не внесла изменений — ран остановлен', userId)
      }
    }

    // 3) Слот «после» запускается только после успешной работы модели.
    let afterFailed = false
    if (signal.aborted) {
      finishCancelled()
      return
    }
    if (!emptyWork) {
      const afterOk = await runSlot('after_model', slots.afterModel, 'Финальные команды', resume?.kind === 'command' && resume.slot === 'after_model' ? resume.index : 0)
      if (!afterOk && !signal.aborted) afterFailed = true
    }

    // 4) Резюме модели.
    if (!signal.aborted) {
      progress(runId, done, total, 'Резюме', userId)
      const sumStep = deps.db.addCiRunStep({ runId, slot: null, position: posBase + done + 1 + extraSteps, kind: 'model_summary', initiatedBy: 'system', title: 'Резюме модели', status: 'running' })
      emitStep(sumStep, userId)
      let summaryText = 'Ран завершён.'
      if (deps.modelSummary) {
        const ctx: CiModelContext = { ...prim, run: deps.db.getCiRunRaw(runId)!, task, project, parentStepId: sumStep.id }
        try {
          summaryText = await deps.modelSummary(ctx)
        } catch {
          summaryText = 'Резюме недоступно.'
        }
      }
      // Пустой ход: причина обязана доехать до чата, а не остаться в ленте —
      // резюме модели о ней может и умолчать.
      if (emptyWork) {
        summaryText =
          `${summaryText}\n\nРабота не сдана: модель не изменила ни одного файла, поэтому коммита, ` +
          `мержа и пересборки прода не было. Рабочая копия ${repoPath} сохранена для разбора, ` +
          'карточка осталась в работе.'
      }
      const line = deps.db.appendCiLog(runId, sumStep.id, 'system', summaryText + '\n')
      broadcast({ t: 'ci.log', runId, line }, userId)
      const upd = deps.db.updateCiRunStep(sumStep.id, { status: 'success', finishedAt: now() })!
      emitStep(upd, userId)
      postSummaryMessage(runId, userId, project.name, task, summaryText, kbUpdateSummary)
      done++
    }

    if (signal.aborted) {
      finishCancelled()
      return
    }
    if (afterFailed || emptyWork) {
      // Пустой ход карточку не возвращает: она остаётся в рабочей колонке, чтобы
      // ран можно было повторить с упавшего шага — как при ошибке модели.
      if (afterFailed) rollbackTask(runId, userId, runRow.prevColumnId)
      finalize(runId, userId, 'failed')
    } else {
      if (modelOk) {
        // Строго после резюме: перенос в «Готово» убирает чат задачи из списка
        // бесед, и записанное позже резюме уехало бы в скрытый чат.
        settleTaskColumn(runId, userId)
        queueProdRebuild(runId, userId)
      }
      finalize(runId, userId, modelOk ? 'success' : 'failed')
    }
  }

  /** Fix-only команда должна адресовать конкретный тест и не быть shell-конвейером. */
  function targetedTestDenial(command: string): string | null {
    const value = command.trim()
    if (!value || value.length > 1000) return 'Команда пустая или слишком длинная.'
    if (/[\n\r;&|><`]/.test(value) || value.includes('$(')) return 'Shell-конвейеры и подстановки в точечной проверке запрещены.'
    if (!isVerificationCommand({ script: value })) return 'Разрешены только тестовые команды.'
    if (/affected-check|typecheck|\blint\b|\bbuild\b/i.test(value)) return 'Полный гейт, typecheck, lint и build запускает только workflow.'
    if (!/(?:\.(?:test|spec)\.[cm]?[jt]sx?\b|(?:^|\s)-t(?:\s|=)|--testNamePattern|--runTestsByPath)/i.test(value)) {
      return 'Укажите конкретный test-файл или test name.'
    }
    return null
  }

  async function tryFix(
    runId: string,
    userId: string,
    agentId: string | null,
    modelWorkspacePath: string,
    commandWorkspacePath: string,
    env: Record<string, string>,
    project: import('@voicechat/shared').ProjectDetail,
    task: import('@voicechat/shared').Task,
    signal: AbortSignal
  ): Promise<boolean> {
    if (!deps.attemptFix) return false
    const detail = deps.db.getCiRun(userId, runId)
    const failedStep = detail?.steps.slice().reverse().find((s) => s.status === 'failed' || s.status === 'timeout')
    if (!failedStep) return false
    const prim = makePrimitives(runId, userId, agentId, project.machines, modelWorkspacePath, commandWorkspacePath, env, signal)
    // Шаг гейта (тесты/typecheck/линт) отличаем от обычного: vitest печатает
    // много, и по сорока строкам хвоста упавших тестов не видно.
    const failedCommand = failedStep.commandId ? deps.db.getCiCommand(userId, failedStep.commandId) : null
    const isTestStep = isVerificationCommand(failedCommand ?? { name: failedStep.title, script: failedStep.commandSnapshot })
    const logTail = deps.db
      .getCiRunLog(userId, runId)
      .filter((l) => l.stepId === failedStep.id)
      .slice(isTestStep ? -400 : -40)
      .map((l) => l.chunk)
      .join('')
    const ctx: CiFixContext = {
      ...prim,
      run: deps.db.getCiRunRaw(runId)!,
      task,
      project,
      parentStepId: failedStep.id,
      failedStep,
      logTail,
      modelSessionId: modelSessions.get(runId) ?? detail?.run.modelSessionId ?? null,
      isTestStep,
      setFixContext: (context) => {
        deps.db.updateCiRun(runId, { fixContext: context })
      },
      runTargetedTest: async (command) => {
        const denial = targetedTestDenial(command)
        if (denial) return { command, exitCode: null, timedOut: false, output: denial }
        if (!agentId) return { command, exitCode: null, timedOut: false, output: 'У проекта не задана машина выполнения.' }
        const step = prim.addStep({
          slot: failedStep.slot,
          kind: 'model_command',
          title: `Точечная проверка: ${command.slice(0, 100)}`,
          parentStepId: failedStep.id,
          initiatedBy: 'model',
          commandSnapshot: command
        })
        const chunks: string[] = []
        let exitCode: number | null = null
        let timedOut = false
        try {
          const result = await deps.executor.run(
            { agentId, script: command, workdir: modelWorkspacePath, env, timeoutMs: 120_000, secrets: [] },
            (chunk) => { chunks.push(chunk); prim.log(step.id, 'stdout', chunk) },
            signal
          )
          exitCode = result.exitCode
          timedOut = result.timedOut
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          chunks.push(message)
          prim.log(step.id, 'system', message + '\n')
        }
        prim.finishStep(step.id, timedOut ? 'timeout' : exitCode === 0 ? 'success' : 'failed', exitCode)
        const output = chunks.join('')
        return { command, exitCode, timedOut, output: output.length > 20_000 ? output.slice(-20_000) : output }
      },
      listChangedFiles: async () => {
        if (!agentId) return []
        const chunks: string[] = []
        try {
          await deps.executor.run(
            { agentId, script: 'git status --short', workdir: modelWorkspacePath, env, timeoutMs: 30_000, secrets: [] },
            (chunk) => chunks.push(chunk),
            signal
          )
        } catch {
          return []
        }
        return chunks.join('').split(/\r?\n/).map((line) => line.slice(3).trim()).filter(Boolean).slice(0, 100)
      },
      rerunFailedStep: async () => {
        const command = failedStep.commandId ? deps.db.getCiCommand(userId, failedStep.commandId) : null
        if (!command) return { stepId: failedStep.id, exitCode: null, timedOut: false, output: 'Команда повторного шага не найдена.' }
        const r = await runCommandStep(runId, userId, agentId, project.machines, commandWorkspacePath, env, failedStep.slot, failedStep.position, command, 'model', null, signal)
        return { stepId: r.stepId, exitCode: r.exitCode, timedOut: r.status === 'timeout', output: r.output }
      }
    }
    setFixing(runId, userId, true, 'Модель исправляет ошибку')
    let fixed = false
    try {
      const r = await deps.attemptFix(ctx)
      fixed = r.fixed
      if (fixed) deps.db.updateCiRunStep(failedStep.id, { fixedByModel: true, status: 'success' })
    } catch {
      fixed = false
    }
    setFixing(runId, userId, false, fixed ? 'Ошибка исправлена — продолжаю' : 'Не удалось исправить ошибку')
    return fixed
  }

  /**
   * Куда уезжает карточка после УСПЕШНОГО рана — ровно один перенос (двойной
   * `moveTask` дёргал бы доску лишним `board.update`):
   *
   * - шаг «Влить ветку задачи в прод-ветку» прошёл → колонка `done` («Готово»):
   *   работа модели в прод-ветке, задача закрыта. Терминальный статус прошлого
   *   рана при этом не переживает успешный — карточка всегда доезжает до done;
   * - мержа не было (шага нет, упал, пропущен) → `awaiting_merge` («Ожидает
   *   мержа»): работа есть, ветка запушена, а в прод-ветке её нет — и это должно
   *   быть видно на доске, а не прятаться в «Готово».
   *
   * Колонку ищем по semantic type (подпись колонки — данные проекта); нужной нет
   * в проекте — карточку не двигаем. Упавший и отменённый ран сюда не заходят:
   * там карточка возвращается в `prev_column_id` (`rollbackTask`).
   *
   * Пуш ветки отдельно не проверяем: неудачный «Отправить ветку задачи в origin»
   * закрывает ран как `failed`, и до этого места мы не доходим.
   */
  function settleTaskColumn(runId: string, userId: string): void {
    const row = deps.db.getCiRunRaw(runId)
    if (!row) return
    const steps = deps.db.getCiRun(userId, runId)?.steps ?? []
    const merged = steps.some((st) => isMergeToBaseStep(st) && st.status === 'success')
    const columnId = deps.db.getColumnIdBySemantic(row.projectId, merged ? 'done' : 'awaiting_merge')
    if (!columnId) return
    const task = deps.db.getCiTask(userId, row.projectId, row.taskId)
    if (!task || task.columnId === columnId) return
    try {
      deps.db.moveTask(userId, row.projectId, row.taskId, { columnId })
    } catch {
      return /* колонка могла исчезнуть между запросом и переносом */
    }
    deps.db.addCiEvent({ projectId: row.projectId, runId, type: merged ? 'run.task_done' : 'run.awaiting_merge', actorType: 'system', payload: { columnId } })
    const last = steps[steps.length - 1]
    if (last) {
      const line = deps.db.appendCiLog(
        runId, last.id, 'system',
        merged
          ? 'Ветка задачи влита в прод-ветку — карточка переехала в «Готово»\n'
          : 'Ветка задачи в прод-ветку не влита — карточка ждёт мержа\n'
      )
      broadcast({ t: 'ci.log', runId, line }, userId)
    }
  }

  /**
   * Обратный к «Ожидает мержа» случай (`settleTaskColumn`): ветка влита в
   * прод-ветку, но прод в
   * этом ране не пересобирался (шага пересборки в слоте «после» нет, он упал или
   * был пропущен) — изменения лежат в прод-ветке и до прода не доехали. Заводим
   * (или дополняем) автозадачу учёта «Пересборка прода»: саму пересборку не
   * запускаем — это решение человека, наше дело не потерять её из виду.
   */
  function queueProdRebuild(runId: string, userId: string): void {
    const row = deps.db.getCiRunRaw(runId)
    if (!row) return
    const steps = deps.db.getCiRun(userId, runId)?.steps ?? []
    if (!steps.some((st) => isMergeToBaseStep(st) && st.status === 'success')) return
    if (steps.some((st) => isProdRebuildStep(st) && st.status === 'success')) return
    const project = deps.db.getProject(userId, row.projectId)
    const task = deps.db.getCiTask(userId, row.projectId, row.taskId)
    if (!project || !task) return
    // Ран самой автозадачи в её же список не пишем.
    if (task.title === PROD_REBUILD_TASK_TITLE) return
    let res: ReturnType<VoiceChatDb['ensureProdRebuildTask']>
    try {
      res = deps.db.ensureProdRebuildTask(userId, row.projectId, `- ${issueKey(project.name, task)}: ${task.title}`)
    } catch {
      return /* карточку могли удалить/перенести между запросом и записью */
    }
    if (!res) return
    deps.db.addCiEvent({
      projectId: row.projectId,
      runId,
      type: 'run.prod_rebuild_pending',
      actorType: 'system',
      payload: { taskId: res.task.id, created: res.created, appended: res.appended }
    })
    const last = steps[steps.length - 1]
    if (last && res.appended) {
      const line = deps.db.appendCiLog(runId, last.id, 'system', `Прод в этом ране не пересобирался — задача добавлена в «${PROD_REBUILD_TASK_TITLE}»\n`)
      broadcast({ t: 'ci.log', runId, line }, userId)
    }
    deps.boardChanged(row.projectId)
  }

  function rollbackTask(runId: string, userId: string, prevColumnId: string | null): void {
    const run = deps.db.getCiRunRaw(runId)
    if (!run || !prevColumnId) return
    try {
      deps.db.moveTask(userId, run.projectId, run.taskId, { columnId: prevColumnId })
    } catch {
      /* колонка могла исчезнуть — не критично */
    }
  }

  /**
   * Другой активный ран уже занял эту папку или эту ветку — не начинаем работу
   * вовсе: два рана в одной рабочей копии перемешали бы коммиты двух задач.
   * Причина видна в ленте отдельным шагом, а не только в логе сервера.
   */
  function failIsolation(runId: string, userId: string, runRow: CiRun, workspacePath: string, branch: string, otherRunId: string): void {
    const step = deps.db.addCiRunStep({
      runId, slot: 'before_model', position: 0, kind: 'command', initiatedBy: 'system',
      title: 'Проверка изоляции рабочей директории', status: 'running'
    })
    emitStep(step, userId)
    const line = deps.db.appendCiLog(
      runId, step.id, 'system',
      `Рабочая директория ${workspacePath} или ветка ${branch} уже заняты раном ${otherRunId}: параллельные раны обязаны работать в разных папках и разных ветках.\n`
    )
    broadcast({ t: 'ci.log', runId, line }, userId)
    const upd = deps.db.updateCiRunStep(step.id, { status: 'failed', finishedAt: now() })
    if (upd) emitStep(upd, userId)
    deps.db.addCiEvent({
      projectId: runRow.projectId, runId, type: 'run.isolation_conflict', actorType: 'system',
      payload: { workspacePath, branch, otherRunId }
    })
    rollbackAndFail(runId, userId, runRow.prevColumnId, 'isolation_conflict')
  }

  function rollbackAndFail(runId: string, userId: string, prevColumnId: string | null, _failureClass: string, status: CiStatus = 'failed'): void {
    rollbackTask(runId, userId, prevColumnId)
    finalize(runId, userId, status)
  }

  /**
   * Строка итогов по базе знаний для резюме рана. Обращений не было (режим
   * `off`, нечего искать, БЗ недоступна) — строки тоже нет: пустое «БЗ: 0» в
   * чате читается как поломка. Отчёт не имеет права уронить резюме, поэтому
   * любая ошибка выборки — просто пустая строка.
   */
  function kbSummaryLine(runId: string, userId: string): string {
    try {
      const report = deps.db.kbUsageRunReport(userId, runId)
      if (!report || !report.totals.queries) return ''
      // Попадание считаем здесь же: резюме уходит до finalize, а без доли строка
      // «выдано 5 разделов» не говорит, пригодился ли хоть один. Пересчёт в
      // finalize перепишет ту же строку метрик — она upsert по рану.
      let hit: { sectionsDelivered: number; sectionsHit: number; hitRatio: number } | null = null
      try {
        hit = deps.db.calculateAndSaveCiKbHit(runId)
      } catch {
        /* попадание — украшение строки, а не сама строка */
      }
      return `\n\n${formatKbUsageSummaryLine(report.totals, hit)}`
    } catch {
      return ''
    }
  }

  /**
   * Резюме рана уходит отдельным сообщением в связанный чат задачи: работу
   * обсуждают в чате, а лента рана — служебная и живёт до следующего запуска.
   * Промах (чат удалён, резюме не сложилось) ран не роняет.
   */
  function postSummaryMessage(runId: string, userId: string, projectName: string, task: Task, summaryText: string, kbUpdateSummary: string | null): void {
    if (!deps.postSummaryToChat) return
    const conversationId = deps.db.getCiRunRaw(runId)?.conversationId
    if (!conversationId) return
    const head = `Резюме по задаче ${issueKey(projectName, task)} · ${task.title}`
    const kbUpdateLine = kbUpdateSummary ? `\n\nБаза знаний: ${kbUpdateSummary}` : ''
    const message = deps.postSummaryToChat({ userId, conversationId, text: `${head}\n\n${summaryText}${kbUpdateLine}${kbSummaryLine(runId, userId)}`, runId })
    // Открытый чат показывает резюме сразу; закрытый увидит его при открытии.
    if (message) broadcast({ t: 'chat.message', conversationId, message }, userId)
  }

  function finalize(runId: string, userId: string, status: CiStatus): void {
    const run0 = deps.db.getCiRunRaw(runId)
    // Ран, закрытый отменой (в т.ч. сторожевым таймаутом), финальный: подвисший
    // execute, догребший до конца позже, не имеет права переписать его в failed.
    if (run0 && run0.status === 'cancelled' && status !== 'cancelled') return
    const finished = now()
    const durationMs = run0?.startedAt ? finished - run0.startedAt : null
    try { deps.db.calculateAndSaveCiKbHit(runId) } catch { /* метрика не роняет финализацию */ }
    const run = deps.db.updateCiRun(runId, { status, finishedAt: finished, durationMs: durationMs ?? undefined })
    if (run) {
      deps.db.addCiEvent({ projectId: run.projectId, runId, type: 'run.finished', actorType: 'system', payload: { status } })
      broadcast({ t: 'ci.done', runId, run }, userId)
      deps.boardChanged(run.projectId)
    }
  }

  function subscribe(listener: (m: ServerMessage, ownerUserId: string) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function snapshot(userId: string, runId: string): void | ServerMessage {
    const detail = deps.db.getCiRun(userId, runId)
    if (!detail) return
    const log = deps.db.getCiRunLog(userId, runId)
    return { t: 'ci.snapshot', runId, detail, log }
  }

  function activeRunIds(): string[] {
    return [...active.keys()]
  }

  async function consoleExec(userId: string, runId: string, command: string, editMode: boolean): Promise<CiConsoleExecResult> {
    const detail = deps.db.getCiRun(userId, runId)
    if (!detail) return { output: '', exitCode: null, rejected: true, message: 'Ран недоступен' }
    const run = detail.run
    if (editMode) {
      const owner = deps.db.getProject(userId, run.projectId)?.role === 'owner'
      if (!owner) return { output: '', exitCode: null, rejected: true, message: 'Режим редактирования — только для владельца проекта' }
      deps.db.addCiEvent({ projectId: run.projectId, runId, type: 'console.exec.edit', actorType: 'user', actorId: userId, payload: { command } })
    } else if (!isReadOnlyCommand(command)) {
      return { output: '', exitCode: null, rejected: true, message: 'В режиме только для чтения разрешён ограниченный набор команд (ls, cat, git status/log, …)' }
    }
    const ws = run.workspaceId ? deps.db.getCiWorkspaceById(run.workspaceId) : null
    const cwd = ws?.path ?? ''
    if (!run.agentId) return { output: '', exitCode: null, rejected: true, message: 'У рана нет машины выполнения' }
    const chunks: string[] = []
    try {
      const res = await deps.executor.run({ agentId: run.agentId, script: command, workdir: cwd, env: {}, timeoutMs: 30_000, secrets: [] }, (d) => chunks.push(d))
      return { output: chunks.join(''), exitCode: res.exitCode, rejected: false, message: '' }
    } catch (err) {
      return { output: chunks.join(''), exitCode: null, rejected: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  return { start, forceStartOnMachine, retryFromFailed, discardChangesAndRetry, cancel, dequeue, subscribe, snapshot, activeRunIds, consoleExec, answerInteraction }
}

/**
 * Шаг «Влить ветку задачи в прод-ветку». Набор команд пайплайна — это данные
 * проекта, поэтому шаг узнаём по назначению: название команды («влить»/«merge»)
 * или её скрипт (`git merge`). Ориентироваться на подпись колонки нельзя — она
 * произвольная, а semantic type колонки про мерж ничего не знает.
 */
export function isMergeToBaseStep(step: CiRunStep): boolean {
  if (step.kind !== 'command' && step.kind !== 'model_command') return false
  return isMergeToBase(step.title, step.commandSnapshot ?? '')
}

function isMergeToBase(title: string, script: string): boolean {
  return /вли(т|ва)|\bmerge\b/i.test(title) || /git\s+(?:-C\s+\S+\s+)?merge\b/.test(script)
}

/**
 * Шаг «Обновить прод-контейнер». Как и с мержем, набор команд — данные проекта,
 * поэтому узнаём шаг по назначению: название говорит про прод и про
 * обновление/пересборку, либо скрипт пересобирает контейнер (`docker compose up
 * --build`, `npm run docker`).
 */
export function isProdRebuildStep(step: CiRunStep): boolean {
  if (step.kind !== 'command' && step.kind !== 'model_command') return false
  return isProdRebuild(step.title, step.commandSnapshot ?? '')
}

function isProdRebuild(title: string, script: string): boolean {
  if (/прод|\bprod\b/i.test(title) && /пересбор|пересобра|обнов|деплой|deploy|rebuild|update/i.test(title)) return true
  return /docker[- ]compose[^\n]*\bup\b[^\n]*--build|npm\s+run\s+docker\b/.test(script)
}

/**
 * Команда трогает ресурс, общий для всех ранов машины: прод-ветку (в неё пишет
 * мерж ветки задачи) или сам прод-контейнер. Такие шаги разных ранов раннер
 * пропускает по одному — иначе гонка на `git push` и на пересборке прода.
 */
export function isSharedResourceCommand(command: { name: string; script: string }): boolean {
  return isMergeToBase(command.name, command.script) || isProdRebuild(command.name, command.script)
}

/** shell-quote для системных префиксов раннера. */
function shq(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`
}

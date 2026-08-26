// Процесс-глобальный реестр ходов LLM. Ход привязан к разговору, а не к
// WS-соединению: обновление страницы/обрыв сети его НЕ отменяет — модель
// доигрывает ответ, сервер сам сохраняет его в БД. События хода рассылаются
// всем подключённым клиентам; при (пере)подключении клиент получает снапшот
// активных ходов с накопленным частичным текстом (claude.active).

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import {
  appendChatInstructionHints,
  parseTaskLaunchRequest,
  buildConversationPrompt,
  buildPrompt,
  clampModel,
  firstAllowedProvider,
  isProviderAllowed,
  claudeModelAlias,
  normalizeClaudeModel,
  parseImages,
  type ActiveTurn,
  type AgentPolicy,
  type ClaudeInitInfo,
  type ClaudeLogEntry,
  type Message,
  type ServerMessage,
  type SttSegmentWire,
  type TurnMeta,
  type TurnRequestInfo,
  type TurnUsage,
  type LlmAttachment,
  type LlmProvider,
  type WidgetAssistantContext,
  toolNameForContextId
} from '@voicechat/shared'
import type { VoiceChatDb } from './db/database.js'
import { relocateImagesToMachine } from './imageRelocate.js'
import { resolveManagedChatStorage } from './uploads.js'
import type { LlmClient, LlmHandle } from './claude/types.js'
import type { KnowledgeBaseService } from './kb/types.js'
import { kbViewOf } from './kb/access.js'
import { buildKbAutoContext } from './kb/autoContext.js'
import type { KbUsageTracker } from './kb/usage.js'

export interface TurnManagerDeps {
  db: VoiceChatDb
  claude: LlmClient
  /** Альтернативный движок Codex (используется при settings.llmProvider='codex'). */
  codex?: LlmClient
  /** Клиент конкретного исполнителя из реестра. */
  engineClient?: (engine: { id: string; kind: 'claude' | 'codex'; baseUrl: string; token: string }) => LlmClient
  /** Поиск компактного контекста проекта перед ходом. */
  kb?: KnowledgeBaseService
  /** Телеметрия обращений к БЗ (авто-инъекция и вызовы модели); undefined — не считаем. */
  kbUsage?: KbUsageTracker
  /**
   * База URL MCP-эндпоинта базы знаний (с секретом k). Подключается и в ходе БЕЗ
   * машины: БЗ read-only и не зависит от агента.
   */
  kbMcpBaseUrl?: string
  /** Инструмент БЗ включён администратором (config.kbToolEnabled). */
  kbToolEnabled?: boolean
  /** Брокер токенов инструмента БЗ: токен живёт ровно один ход. */
  kbTool?: {
    register(token: string, entry: {
      userId: string
      conversationId: string
      projectId: string | null
      turnId: string
      runtimeContext?: {
        projectName?: string
        projectGitUrl?: string | null
        llm?: { provider: string; model: string; engineId: string | null; source: 'conversation' | 'project' | 'user' }
        userSettings?: Record<string, unknown>
      }
    }): void
    unregister(token: string): void
  }
  /**
   * База URL MCP-эндпоинта действий веб-превью (с секретом k). Только для хода
   * разговора: действия транслируются подключённым клиентам пользователя.
   */
  previewMcpBaseUrl?: string
  /** База URL MCP-эндпоинта консоли (с секретом k); ход адресуется query `conv`. */
  consoleMcpBaseUrl?: string
  /** Брокер токенов инструментов превью: токен живёт ровно один ход. */
  previewTool?: {
    register(token: string, entry: { userId: string; conversationId: string }): void
    unregister(token: string): void
  }
  /** Резолв id вложения → локальный путь либо уже прочитанные байты с машины. */
  resolveUpload?: (id: string) => string | LlmAttachment | null | undefined | Promise<string | LlmAttachment | null | undefined>
  /** Короткоживущий контекст вложений для бинарного remote:image. */
  remoteFileTool?: {
    register(token: string, attachments: Array<{ path: string; name: string; dataBase64: string }>): void
    unregister(token: string): void
  }
  /** Онлайн-статус и политика машин-агентов (для проброса Bash на клиента). */
  agents?: {
    isOnline(id: string): boolean
    nameOf(id: string): string | undefined
    policyOf(id: string): AgentPolicy | undefined
    /** Файловые операции машины — нужны, чтобы переложить туда картинки хода. */
    fsList?(id: string, path: string): Promise<{ root: string }>
    fsRead?(id: string, path: string): Promise<{ dataBase64?: string }>
    fsMkdir?(id: string, path: string): Promise<unknown>
    fsWrite?(id: string, path: string, dataBase64: string): Promise<unknown>
  }
  /** Чтение файла картинки с диска сервера или из профиля исполнителя. */
  readServerFile?: (userId: string, path: string) => Promise<{ name: string; dataBase64: string } | null>
  /** База URL MCP-эндпоинта remote-bash (с секретом k); undefined — проброс выключен. */
  mcpBaseUrl?: string
  /** Источник времени (для детерминированных тестов). */
  now?: () => number
  /** Только подтверждённая auth-ошибка хода меняет единое auth-состояние. */
  onAuthError?: (userId: string, provider: LlmProvider, message: string) => void
}

export interface ProjectMainIdentity {
  projectId: string
  machineId: string
  storageId: string
}
export interface ProjectMainSnapshot {
  baseSha: string
  path: string
  release(): void
}
export interface ProjectMainRefreshAdapter {
  refresh(identity: ProjectMainIdentity, signal?: AbortSignal): Promise<{ baseSha: string; path: string }>
}

/** Fair process-wide reader/writer coordination for the shared managed main checkout. */
export class ProjectMainSnapshotCoordinator {
  private entries = new Map<string, {
    readers: number
    writer: boolean
    pendingWriter: boolean
    refresh: Promise<{ baseSha: string; path: string }> | null
    changed: Promise<void>
    wake: () => void
  }>()
  constructor(private adapter: ProjectMainRefreshAdapter) {}
  private entry(identity: ProjectMainIdentity) {
    const key = [identity.projectId, identity.machineId, identity.storageId].join('\u0000')
    let state = this.entries.get(key)
    if (!state) {
      let wake = () => {}
      const changed = new Promise<void>((resolve) => { wake = resolve })
      state = { readers: 0, writer: false, pendingWriter: false, refresh: null, changed, wake }
      this.entries.set(key, state)
    }
    return state
  }
  private notify(state: ReturnType<ProjectMainSnapshotCoordinator['entry']>) {
    state.wake()
    let wake = () => {}
    state.changed = new Promise<void>((resolve) => { wake = resolve })
    state.wake = wake
  }
  private async wait(state: ReturnType<ProjectMainSnapshotCoordinator['entry']>, predicate: () => boolean, signal?: AbortSignal) {
    while (!predicate()) {
      if (signal?.aborted) throw signal.reason ?? new Error('Операция отменена')
      await state.changed
    }
  }
  private refresh(identity: ProjectMainIdentity, signal?: AbortSignal) {
    const state = this.entry(identity)
    if (state.refresh) return state.refresh
    state.pendingWriter = true
    const operation = (async () => {
      await this.wait(state, () => state.readers === 0 && !state.writer, signal)
      state.writer = true
      state.pendingWriter = false
      try { return await this.adapter.refresh(identity, signal) } finally {
        state.writer = false
        this.notify(state)
      }
    })()
    state.refresh = operation
    void operation.finally(() => {
      if (state.refresh === operation) state.refresh = null
      this.notify(state)
    }).catch(() => {})
    return operation
  }
  async acquireReadSnapshot(identity: ProjectMainIdentity, signal?: AbortSignal): Promise<ProjectMainSnapshot> {
    const state = this.entry(identity)
    const refreshed = await this.refresh(identity, signal)
    await this.wait(state, () => !state.writer && !state.pendingWriter, signal)
    state.readers++
    let released = false
    return { ...refreshed, release: () => {
      if (released) return
      released = true
      state.readers--
      this.notify(state)
    } }
  }
  invalidateProjectMain(identity: ProjectMainIdentity, signal?: AbortSignal) {
    return this.refresh(identity, signal)
  }
}

/** Запрос нового хода (соответствует клиентскому claude.send). */
async function loadAttachment(
  source: string | LlmAttachment | null | undefined | Promise<string | LlmAttachment | null | undefined>
): Promise<LlmAttachment | null> {
  const resolved = await source
  if (!resolved) return null
  if (typeof resolved !== 'string') return resolved
  try {
    return {
      serverPath: resolved,
      runnerName: basename(resolved),
      dataBase64: readFileSync(resolved).toString('base64')
    }
  } catch {
    return null
  }
}

export interface StartTurnRequest {
  /** Владелец разговора (логин пользователя) — для изоляции данных. */
  userId: string
  conversationId: string
  /** Сохранённое пользовательское сообщение — идемпотентность очереди. */
  messageId?: string
  segments: SttSegmentWire[]
  attachments?: string[]
  verbose?: boolean
  /** Цель конкретного сообщения: id, null — сервер, 'none' — запрет команд. */
  execTarget?: string | null
  /** Безопасный снимок виджета; принимается только служебным чатом ассистента. */
  assistantContext?: WidgetAssistantContext
}

export interface TurnManager {
  /** Запустить ход в разговоре (прежний ход этого разговора отменяется). */
  start(req: StartTurnRequest): Promise<void>
  /** Отменить ход разговора; без conversationId — все активные ходы. */
  cancel(conversationId?: string): void
  editQueued(userId: string, conversationId: string, id: string, text: string, segments: SttSegmentWire[]): void
  deleteQueued(userId: string, conversationId: string, id: string): void
  reorderQueued(userId: string, conversationId: string, ids: string[]): void
  sendQueuedNow(userId: string, conversationId: string, id: string): void
  queueSnapshot(userId: string, conversationId: string): void
  resumeQueues(userId: string): void
  /**
   * Подписка на события ходов (token/done/error/log). Слушатель получает id
   * владельца хода — сессия форвардит клиенту только события своего пользователя.
   */
  subscribe(listener: (m: ServerMessage, ownerUserId: string) => void): () => void
  /** Снапшот активных ходов пользователя (для claude.active при подключении). */
  active(userId: string): ActiveTurn[]
  /**
   * Остановка сервера (деплой/SIGTERM): отменить активные ходы и сохранить их
   * накопленный частичный текст в БД с пометкой interrupted — иначе рестарт
   * теряет уже набранную часть ответа.
   */
  flushInterrupted(): void
}

/**
 * Разбирает сохранённый resume-id с префиксом провайдера ("claude:abc"/"codex:xyz").
 * Возвращает id только если он принадлежит текущему провайдеру; иначе null
 * (смена движка → свежий ход без чужого resume). Терпит старые id без префикса
 * (считаем их claude).
 */
function resumeIdFor(stored: string | null, provider: 'claude' | 'codex'): string | null {
  if (!stored) return null
  const m = /^(claude|codex):(.*)$/s.exec(stored)
  if (!m) return provider === 'claude' ? stored : null
  return m[1] === provider ? m[2] : null
}

/** Краткое описание политики машины для системного промпта Claude. */
function policySummary(p: AgentPolicy, selectedSkills?: string[]): string {
  const parts: string[] = []
  if (p.allowedDirs.length) parts.push(`Работай только в каталогах: ${p.allowedDirs.join(', ')}.`)
  parts.push(
    p.allowNetwork
      ? 'Доступ в сеть разрешён.'
      : 'Доступ в сеть запрещён — не используй curl/wget/ssh и подобное.'
  )
  parts.push(
    p.allowWrite ? 'Изменение файлов разрешено.' : 'Изменение файлов запрещено — только чтение.'
  )
  if (p.denyPatterns.length) parts.push(`Запрещённые паттерны команд: ${p.denyPatterns.join(', ')}.`)
  if (p.allowPatterns.length) parts.push(`Разрешены только команды: ${p.allowPatterns.join(', ')}.`)
  const skills = selectedSkills === undefined
    ? p.skills
    : p.skills.filter((skill) => selectedSkills.includes(skill.name))
  if (skills.length) {
    parts.push(`Навыки этого разговора: ${skills.map((s) => `«${s.name}» → ${s.command}${s.description ? ` (${s.description})` : ''}`).join('; ')}.`)
  } else if (selectedSkills !== undefined) {
    parts.push('Для этого разговора навыки не выбраны.')
  }
  return `Политика машины: ${parts.join(' ')}`
}

/**
 * Суммарный вход хода: обычный ввод плюс токены кэша. Разложить его на «сколько
 * от БЗ» нельзя (CLI отдаёт итог по промпту) — число нужно как контекст рядом с
 * оценкой БЗ, а не как её замена.
 */
function turnInputTokens(meta: TurnMeta): number | null {
  const sum = (meta.inputTokens ?? 0) + (meta.cacheReadTokens ?? 0) + (meta.cacheCreationTokens ?? 0)
  return sum > 0 ? sum : null
}

interface TurnState {
  handle: LlmHandle
  partial: string
  verbose: boolean
  /** Владелец хода (для фильтрации broadcast/active по пользователю). */
  userId: string
  /** Активность хода (для подробного вида сообщения); собирается всегда. */
  activity: ClaudeLogEntry[]
  /** Накопленные счётчики токенов хода (живой счётчик под сообщением). */
  usage?: TurnUsage
  /** Ход завершён (done/error/flush) — поздние события CLI игнорируются. */
  done: boolean
  /** Контекст хода — чтобы flushInterrupted мог сохранить прерванный ответ. */
  provider: 'claude' | 'codex'
  model: string
  startedAt: number
  requestInfo: TurnRequestInfo
  execTarget: string | null
  /** id хода: связывает обращения к БЗ с сохранённым сообщением и usage. */
  turnId: string
  /** Токен MCP-инструмента БЗ этого хода (снимается при завершении/отмене). */
  kbToolToken: string | null
  /** Токен MCP-инструментов превью (mcp__browser__*) этого хода. */
  previewToolToken: string | null
  /** Токен бинарного файлового контекста remote:image. */
  remoteFileToken: string | null
  source: StartTurnRequest
}

/** Кэп на число записей активности, хранимых у одного хода. */
const ACTIVITY_CAP = 500

export function createTurnManager(deps: TurnManagerDeps): TurnManager {
  const listeners = new Set<(m: ServerMessage, ownerUserId: string) => void>()
  const turns = new Map<string, TurnState>()
  // Закрывает async-окно подготовки prompt/вложений до появления TurnState.
  const starting = new Set<string>()
  // Короткое окно атомарной замены хода через «Отправить сейчас»: повторная
  // команда не должна успеть продвинуть другой элемент очереди.
  const restarting = new Set<string>()
  // Завершённые ходы, чьё сохранение в БД ещё в полёте (перекладка картинок —
  // сетевой шаг). Держим их отдельно от активных `turns`, чтобы flushInterrupted
  // при остановке сервера успел сохранить готовый ответ, если async-запись не
  // завершилась (иначе последнее сообщение модели теряется без следа).
  const pendingSaves = new Set<() => void>()
  const now = deps.now ?? (() => Date.now())

  function broadcast(m: ServerMessage, ownerUserId: string): void {
    for (const l of listeners) l(m, ownerUserId)
  }

  function emitQueue(userId: string, conversationId: string, published?: Message, removedMessageIds?: string[]): void {
    broadcast({
      t: 'claude.queue',
      conversationId,
      items: deps.db.listQueuedTurns(userId, conversationId),
      paused: deps.db.isTurnQueuePaused(userId, conversationId),
      ...(published ? { published } : {}),
      ...(removedMessageIds?.length ? { removedMessageIds } : {})
    }, userId)
  }

  /** Время сообщения в формате ленты (HH:MM), как у клиента. */
  function timeHHMM(): string {
    const d = new Date(now())
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  async function start(req: StartTurnRequest): Promise<void> {
    const conversationId = req.conversationId
    const userId = req.userId
    // Заблокированный пользователь не может запускать ходы (страховка сверх WS-гейта).
    const account = deps.db.getUser(userId)
    if (!account || account.blocked) {
      broadcast({ t: 'claude.error', conversationId, message: 'Учётная запись недоступна.' }, userId)
      return
    }
    req.messageId ??= [...deps.db.listMessages(userId, conversationId)].reverse().find((m) => m.role !== 'ai')?.id
    // Второй параллельный ход запрещён. Сохраняем payload в SQLite; messageId —
    // ключ идемпотентности для повторной доставки и нескольких вкладок.
    if (turns.has(conversationId) || starting.has(conversationId)) {
      const messageId = req.messageId ?? [...deps.db.listMessages(userId, conversationId)].reverse().find((m) => m.role !== 'ai')?.id
      if (!messageId) {
        broadcast({ t: 'claude.error', conversationId, message: 'Не удалось поставить вопрос в очередь.' }, userId)
        return
      }
      deps.db.enqueueTurn(userId, conversationId, messageId, {
        segments: req.segments,
        attachments: req.attachments,
        verbose: req.verbose,
        execTarget: req.execTarget,
        assistantContext: req.assistantContext
      })
      emitQueue(userId, conversationId)
      return
    }
    starting.add(conversationId)
    // Явная новая отправка/повтор — реакция пользователя, снимающая паузу после ошибки.
    deps.db.setTurnQueuePaused(userId, conversationId, false)

    const conv = deps.db.getConversation(userId, conversationId)
    const settings = deps.db.getSettings(userId)
    // Связанный с проектом чат всегда работает на паре проекта (или на
    // пользовательском дефолте проекта). Для непривязанного чата остаётся
    // обычное переопределение разговора → пользователь.
    const projectLlm = conv?.projectId && conv.llmProvider === null
      ? deps.db.getCiLlmConfig('project', conv.projectId) ?? deps.db.ciLlmDefaultsForUser(userId)
      : null
    const wantProvider = conv?.llmProvider ?? projectLlm?.provider ?? settings.llmProvider
    const access = deps.db.getUserLlmAccess(userId)
    const fallbackProvider = firstAllowedProvider(access)
    if (!fallbackProvider) {
      starting.delete(conversationId)
      broadcast({ t: 'claude.error', conversationId, message: 'WARNING: Доступных движков и моделей для этого пользователя нет.' }, userId)
      return
    }
    const permittedProvider = isProviderAllowed(access, wantProvider) ? wantProvider : fallbackProvider
    const provider = permittedProvider === 'codex' && deps.codex ? 'codex' : 'claude'
    const role = account.role
    const wantedEngineId = conv?.llmEngineId ?? projectLlm?.llmEngineId ?? settings.llmEngineId
    const resolvedEngine = deps.db.resolveLlmEngine(wantedEngineId, provider, role)
    const client = resolvedEngine.engine && deps.engineClient
      ? deps.engineClient(resolvedEngine.engine)
      : provider === 'codex' ? deps.codex! : deps.claude
    const selectedModel = conv?.llmProvider === provider
      ? conv.llmModel
      : (projectLlm?.provider === provider ? projectLlm.model : null)
    const requestedModel = provider === 'codex'
      ? (selectedModel ?? settings.codexModel)
      : normalizeClaudeModel(selectedModel || settings.model)
    const permittedModel = clampModel(access, provider, requestedModel)
    if (!permittedModel) {
      starting.delete(conversationId)
      broadcast({ t: 'claude.error', conversationId, message: 'WARNING: Для выбранного движка нет доступных моделей.' }, userId)
      return
    }
    const model = provider === 'claude' ? claudeModelAlias(permittedModel) : permittedModel
    const notices = [
      resolvedEngine.substituted ? `⚠️ Исполнитель «${wantedEngineId}» недоступен; ход выполнен через «${resolvedEngine.engine?.name ?? `default ${provider}`}».` : '',
      permittedProvider !== wantProvider ? `⚠️ Движок «${wantProvider}» недоступен; выбран «${provider}».` : '',
      permittedModel !== requestedModel ? `⚠️ Модель «${requestedModel}» недоступна; выбрана «${permittedModel}».` : ''
    ].filter(Boolean)
    const engineNotice = notices.join('\n')
    // session-id хранится с префиксом провайдера ("claude:…"/"codex:…"); при
    // смене движка чужой resume-id игнорируем (свежий ход).
    const sessionId = resumeIdFor(conv?.claudeSessionId ?? null, provider)
    // Режим прав: переопределение разговора приоритетнее общих настроек.
    let permissionMode = conv?.permissionMode ?? settings.permissionMode
    // Рабочий каталог разговора (`conv.workdir`) выбирается через проводник
    // МАШИНЫ — это путь на её хосте, и в контейнере сервера его нет. Он уходит
    // только в MCP-мост (`&cwd=`), где `remote.bash` делает `cd` на агенте.
    // Локальный `cwd` для CLI теперь не валидируем на сервере: исполнитель сам
    // решает, существует ли каталог и можно ли в него перейти.
    const desiredCwd = settings.workdir ?? undefined
    const attachments = req.attachments?.length
      ? (await Promise.all(
          req.attachments.map((id) => loadAttachment(deps.resolveUpload?.(id)))
        )).filter((att): att is LlmAttachment => Boolean(att))
      : []
    const attachmentPaths = attachments.map((att) => att.serverPath)
    // Есть сессия → продолжаем одним ходом (--resume). Нет (новый разговор или
    // сессия сброшена после удаления/правки) → пересобираем промпт из текущей
    // истории БД, чтобы контекст модели совпадал с видимым (без удалённых реплик).
    // Хинт о формате уточняющих вопросов (```questions) — форма ответов в чате;
    // ```image — созданная картинка показывается прямо в сообщении.
    let kbContext: TurnRequestInfo['kbContext']
    let basePrompt = sessionId
      ? buildPrompt(req.segments, attachmentPaths)
      : buildConversationPrompt(deps.db.listMessages(userId, conversationId), attachmentPaths)
    // Режимы БЗ разговора (одно место на все три ветки):
    //   auto   — авто-инъекция контекста ДА + инструменты mcp__kb__* ДА;
    //   manual — авто-инъекции НЕТ, инструменты ДА (усиленный хинт «сначала БЗ»);
    //   off    — ничего.
    // Инспектор контекста: пункты, выключенные пользователем, не попадают ассистенту.
    const disabledContext = new Set(conv?.disabledContext ?? [])
    const kbMode = disabledContext.has('knowledge-mode') ? 'off' : (conv?.kbContextMode ?? 'auto')
    // Навыки: выключенные (skill-<encoded>) убираем из выбранных для этого хода.
    const effectiveSkills = (conv?.skillNames ?? []).filter((name) => !disabledContext.has(`skill-${encodeURIComponent(name)}`))
    // MCP-инструменты, выключенные пользователем (mcp-remote-*/mcp-kb-*) → --disallowedTools.
    const disallowedTools = [...disabledContext].map(toolNameForContextId).filter((tool): tool is string => tool !== null)
    const turnId = randomUUID()
    if (deps.kb && kbMode === 'auto') {
      const kbQuery = req.segments.map((segment) => segment.text).join(' ').trim()
      if (kbQuery) {
        const usage = deps.kbUsage?.begin(
          { userId, conversationId, projectId: conv?.projectId ?? null, turnId, source: 'auto' },
          kbQuery
        )
        try {
          // Вид пользователя: общий раздел + его персональные знания + знания
          // проекта чата. Права считает kbViewOf (kb/access.ts), а не ход.
          // Сборку блоков делает kb/autoContext.ts — та же, что у CI-рана.
          const auto = await buildKbAutoContext(deps.kb, kbQuery, {
            ...kbViewOf(deps.db, userId),
            ...(conv?.projectId ? { projectId: conv.projectId } : {})
          })
          if (auto.text) {
            kbContext = { confidence: auto.bundle.confidence, sections: auto.contextSections }
            basePrompt = `${basePrompt}${auto.text}`
            usage?.complete({
              deliveredChars: auto.text.length,
              injected: true,
              bundleTokens: auto.bundle.estimatedTokens,
              confidence: auto.bundle.confidence,
              sections: auto.sections
            })
          } else {
            usage?.empty(auto.emptyReason ?? 'no-match', auto.bundle.confidence)
          }
        } catch (err) {
          // KB не должна блокировать основной ход: exact/BM25/reranker могут быть временно недоступны.
          usage?.fail(err instanceof Error ? err.message : String(err))
        }
      }
    }
    // Контекст проекта — явная часть каждого хода связанного чата, даже если
    // у проекта ещё нет описания или репозитория: модель не должна угадывать,
    // к какому проекту относится разговор.
    const projectContext = conv?.projectId ? deps.db.getProject(userId, conv.projectId) : null
    if (conv?.projectId && !disabledContext.has('project-binding')) {
      const lines = projectContext
        ? [
            `ID проекта: ${projectContext.id}`,
            projectContext.gitUrl ? `Git-репозиторий: ${projectContext.gitUrl}` : '',
            projectContext.technologies.length ? `Технологии: ${projectContext.technologies.join(', ')}` : '',
            projectContext.skills.length ? `Навыки/области: ${projectContext.skills.join(', ')}` : '',
            projectContext.description ? projectContext.description : ''
          ].filter(Boolean)
        : [`ID проекта: ${conv.projectId}`, 'Проект больше недоступен этому пользователю.']
      basePrompt = `${basePrompt}\n\n## Контекст проекта «${projectContext?.name ?? 'неизвестный проект'}»\n${lines.join('\n')}`
    }
    // Контекст задачи, к которой привязан чат: иерархия, этап воркфлоу, папка и
    // ветка разработки. Без этого чат «знает» только проект, хотя task_id есть.
    if (conv?.taskId && !disabledContext.has('project-binding')) {
      const tc = deps.db.getTaskChatContext(userId, conversationId, deps.agents ? (agentId) => deps.agents!.isOnline(agentId) : undefined)
      if (tc) {
        const lines = [
          `Задача: ${tc.task.key} · ${tc.task.title}`,
          tc.epic ? `Эпик: ${tc.epic.key} · ${tc.epic.title}` : '',
          tc.story ? `История: ${tc.story.key} · ${tc.story.title}` : '',
          tc.columnName ? `Этап разработки: ${tc.columnName}${tc.columnSemantic ? ` (${tc.columnSemantic})` : ''}` : '',
          tc.agentName ? `Машина разработки: ${tc.agentName}` : '',
          tc.workdir ? `Рабочая директория: ${tc.workdir}` : '',
          tc.run ? `Последний CI-ран: ${tc.run.status}, режим ${tc.run.mode === 'plan' ? 'план' : 'разработка'}` : ''
        ].filter(Boolean)
        const task = conv.projectId ? deps.db.getCiTask(userId, conv.projectId, conv.taskId) : null
        if (task?.description) lines.push(`Описание задачи: ${task.description}`)
        if (task?.acceptanceCriteria) lines.push(`Критерии приёмки: ${task.acceptanceCriteria}`)
        basePrompt = `${basePrompt}\n\n## Контекст задачи\n${lines.join('\n')}`
      }
    }
    if (conv?.assistantKind === 'kanban' && req.assistantContext) {
      basePrompt = `${basePrompt}\n\n## Режим канбан-ассистента\nОтветь JSON-объектом {"text":"...","commands":[]}. Доступные команды: navigate.project-settings, navigate.task, propose.task-update, propose.rephrase, propose.acceptance-criteria, propose.settings-update. Для поиска карточек используй toolResults.query: шлюз предпочитает семантический UI-снимок, а без него делает API-fallback. Любые изменения только propose; они проходят общий action-шлюз после подтверждения — не утверждай, что они применены. Используй только безопасный снимок ниже.\n${JSON.stringify(req.assistantContext)}`
    }
    const personalization = settings.personalization
    const personalizationLines = [
      personalization.preferredName ? `Обращение к пользователю: ${personalization.preferredName}.` : '',
      personalization.responseLanguage ? `Обычный язык ответа: ${personalization.responseLanguage}; явная просьба в текущем сообщении имеет приоритет.` : '',
      personalization.responseStyle !== 'normal' ? `Стиль ответа: ${{ brief: 'кратко', detailed: 'подробно', 'step-by-step': 'пошагово', normal: 'обычно' }[personalization.responseStyle]}.` : '',
      personalization.tone !== 'neutral' ? `Тон общения: ${{ friendly: 'дружелюбный', business: 'деловой', plain: 'простой, без сложных терминов', neutral: 'нейтральный' }[personalization.tone]}.` : '',
      personalization.birthYear ? `Возраст пользователя: ${Math.max(0, new Date().getUTCFullYear() - personalization.birthYear - ((personalization.birthMonth ?? 1) > new Date().getUTCMonth() + 1 || ((personalization.birthMonth ?? 1) === new Date().getUTCMonth() + 1 && (personalization.birthDay ?? 1) > new Date().getUTCDate()) ? 1 : 0))} лет; адаптируй сложность только когда это уместно.` : ''
    ].filter(Boolean)
    if (personalizationLines.length && !disabledContext.has('personalization')) basePrompt = `${basePrompt}\n\n## Персонализация пользователя\n${personalizationLines.join('\n')}\nЭти предпочтения уступают явной инструкции текущего сообщения и настройкам разговора/проекта.`
    // Служебные подсказки (терминал/проводник, вопросы, картинки, task-launch) —
    // только те, что пользователь не выключил в настройках «Инструкции».
    const prompt = appendChatInstructionHints(basePrompt, settings.chatInstructions)
    // Единый resolver используется также REST-каталогом и task-chat context:
    // null хранит наследование, явный override не получает молчаливый fallback.
    const machine = deps.db.resolveConversationMachine(userId, conversationId, {
      ...(req.execTarget !== undefined ? { execTarget: req.execTarget } : {}),
      ...(deps.agents ? { isOnline: (agentId: string) => deps.agents!.isOnline(agentId) } : {})
    })
    const executionDisabled = machine?.source === 'disabled'
    if (machine?.error === 'unavailable') {
      starting.delete(conversationId)
      broadcast({ t: 'claude.error', conversationId, message: 'Выбранная машина больше недоступна для этого чата' }, userId)
      return
    }
    if (machine?.error === 'offline' && machine.agentId) {
      starting.delete(conversationId)
      broadcast({ t: 'claude.error', conversationId, message: `Выбранная машина «${deps.agents?.nameOf(machine.agentId) ?? machine.agentId}» offline` }, userId)
      return
    }
    const target = executionDisabled ? null : machine?.agentId ?? null
    // Пустой проект у admin сохраняет legacy server-side ход; если машины у
    // проекта есть, но ни одна не доступна online, это уже явная блокировка.
    if (!executionDisabled && !target && conv?.projectId && deps.db.listUsableAgents(userId, conv.projectId).length > 0) {
      starting.delete(conversationId)
      broadcast({ t: 'claude.error', conversationId, message: 'Нет доступной online-машины: запуск чата заблокирован' }, userId)
      return
    }
    if (!executionDisabled && !target && role !== 'admin') {
      broadcast({ t: 'claude.error', conversationId, message: 'Нет доступной online-машины: remote-команды заблокированы' }, userId)
    }
    const requestedTarget = target
    // Инструменты БЗ — ВНЕ ветки `remote`: база знаний read-only и нужна модели
    // и в ходе без машины (там она вообще единственный источник контекста).
    const kbToolAvailable = (): boolean => {
      if (!deps.kb || !deps.kbMcpBaseUrl || kbMode === 'off' || deps.kbToolEnabled === false) return false
      try {
        return deps.kb.status().available
      } catch {
        return false // сломанный индекс = инструмента нет, ход продолжается
      }
    }
    let kbToolToken: string | null = null
    let kbMcpUrl: string | undefined
    if (kbToolAvailable()) {
      kbToolToken = randomUUID()
      kbMcpUrl = `${deps.kbMcpBaseUrl}&turn=${encodeURIComponent(kbToolToken)}`
      deps.kbTool?.register(kbToolToken, {
        userId,
        conversationId,
        projectId: conv?.projectId ?? null,
        turnId,
        runtimeContext: {
          ...(projectContext ? { projectName: projectContext.name, projectGitUrl: projectContext.gitUrl } : {}),
          llm: {
            provider,
            model,
            engineId: resolvedEngine.engine?.id ?? null,
            source: projectLlm ? 'project' : (conv?.llmProvider ? 'conversation' : 'user')
          },
          // Снимок не содержит учётных данных: Settings хранит только безопасные
          // UI-предпочтения. Рядом даём фактические значения чата после наследования.
          userSettings: {
            ...settings,
            conversation: conv ? {
              id: conv.id, execTarget: conv.execTarget, workdir: conv.workdir,
              skillNames: conv.skillNames, llmEngineId: conv.llmEngineId ?? settings.llmEngineId,
              llmProvider: conv.llmProvider ?? settings.llmProvider,
              llmModel: conv.llmModel ?? (settings.llmProvider === 'claude' ? settings.model : settings.codexModel),
              permissionMode: conv.permissionMode ?? settings.permissionMode,
              kbContextMode: conv.kbContextMode ?? 'auto', projectId: conv.projectId ?? null
            } : null
          }
        }
      })
    }
    // Инструменты веб-превью (mcp__browser__*) — вне ветки `remote`: действия
    // выполняет браузер пользователя, машина-агент для них не нужна. Токен, как
    // и у БЗ, живёт ровно один ход.
    let previewToolToken: string | null = null
    let previewMcpUrl: string | undefined
    if (conv && deps.previewMcpBaseUrl && deps.previewTool) {
      previewToolToken = randomUUID()
      previewMcpUrl = `${deps.previewMcpBaseUrl}&turn=${encodeURIComponent(previewToolToken)}`
      deps.previewTool.register(previewToolToken, { userId, conversationId })
    }
    // Консоль с ассистентом: инструменты mcp__console__* пишут в живую PTY-сессию
    // разговора (ptyId `console:<conv>`). Только у чата этого вида.
    let consoleMcpUrl: string | undefined
    if (conv?.assistantKind === 'console-reader' && deps.consoleMcpBaseUrl) {
      consoleMcpUrl = `${deps.consoleMcpBaseUrl}&conv=${encodeURIComponent(conversationId)}`
    }
    let remote: { mcpUrl: string; agentName: string; policySummary?: string } | undefined
    let remoteFileToken: string | null = null
    if (target && deps.agents && deps.mcpBaseUrl) {
      if (!deps.agents.isOnline(target)) {
        starting.delete(conversationId)
        broadcast({ t: 'claude.error', conversationId, message: `Выбранная машина «${deps.agents.nameOf(target) ?? target}» offline` }, userId)
        return
      }
      const policy = deps.agents.policyOf(target)
      // Чат проекта видит и остальные машины проекта: query `project` включает в
      // мосте инструмент machines и параметр machine, а имена уходят в системный
      // хинт CLI. Без других машин (или вне проекта) ход остаётся прежним.
      const projectMachines = conv?.projectId ? deps.db.listProjectMachines(conv.projectId) : []
      const otherMachines = projectMachines.filter((m) => m.agentId !== target).map((m) => m.name)
      remoteFileToken = attachments.length && deps.remoteFileTool ? randomUUID() : null
      if (remoteFileToken) {
        deps.remoteFileTool!.register(remoteFileToken, attachments.map((item) => ({
          path: item.serverPath, name: item.runnerName, dataBase64: item.dataBase64
        })))
      }
      remote = {
        mcpUrl:
          `${deps.mcpBaseUrl}&agent=${encodeURIComponent(target)}` +
          `${remoteFileToken ? `&files=${encodeURIComponent(remoteFileToken)}` : ''}` +
          `${(conv?.workdir ?? (conv?.projectId ? projectMachines.find((m) => m.agentId === target)?.path : null)) ? `&cwd=${encodeURIComponent((conv?.workdir ?? projectMachines.find((m) => m.agentId === target)?.path)!)}` : ''}` +
          `${conv?.projectId && otherMachines.length ? `&project=${encodeURIComponent(conv.projectId)}` : ''}`,
        agentName: deps.agents.nameOf(target) ?? target,
        policySummary: policy ? policySummary(policy, effectiveSkills) : undefined,
        ...(otherMachines.length ? { projectMachines: otherMachines } : {})
      }
    }
    // `cwd` здесь только желаемый: локальный spawn или удалённый runner уже сами
    // решают, можно ли в него перейти, и при невозможности просто пропускают chdir.
    const cwd = desiredCwd
    // Роль user не имеет прав что-либо делать на сервере: без своей машины ход
    // идёт «на сервере» → форсим режим «план» (только текст/план, без изменений и
    // выполнения). На своей машине действия регулирует политика машины.
    if (executionDisabled || (role !== 'admin' && !remote)) permissionMode = 'plan'
    // Полный контекст хода: все сообщения разговора на момент отправки
    // (реплика пользователя уже сохранена клиентом перед claude.send).
    const contextMessages = deps.db
      .listMessages(userId, conversationId)
      .map((m) => ({ role: m.role, text: m.text }))
    // Детали запроса для панели «Подробнее» (всё, что мы отправили модели).
    const requestInfo: TurnRequestInfo = {
      provider,
      model,
      prompt,
      promptChars: prompt.length,
      resumed: Boolean(sessionId),
      ...(permissionMode ? { permissionMode } : {}),
      ...(cwd ? { cwd } : {}),
      ...(attachmentPaths.length ? { attachments: attachmentPaths } : {}),
      ...(executionDisabled ? { execTarget: 'Без машины (команды запрещены)' } : remote ? { execTarget: remote.agentName } : {}),
      ...(contextMessages.length ? { messages: contextMessages } : {}),
      ...(kbContext ? { kbContext } : {})
    }
    // Окружение хода из system/init (инструменты/навыки/mcp) — только claude.
    let initInfo: ClaudeInitInfo | undefined
    const startedAt = now()
    const turn: TurnState = {
      handle: { cancel: () => {} },
      partial: '',
      verbose: Boolean(req.verbose),
      userId,
      activity: [],
      done: false,
      provider,
      model,
      startedAt,
      requestInfo,
      execTarget: requestedTarget,
      turnId,
      kbToolToken,
      previewToolToken,
      remoteFileToken,
      source: req
    }
    starting.delete(conversationId)
    turns.set(conversationId, turn)
    const finish = (): void => {
      turn.done = true
      releaseTurnTools(turn)
      if (turns.get(conversationId) === turn) turns.delete(conversationId)
    }
    // Нативный CLI-режим plan глушит MCP-инструменты. Если есть машина,
    // запускаем CLI в default, но remote-мост получает ro=1 и отклоняет любые
    // изменения; так в план-фазе доступны только чтение файлов и БЗ.
    const readOnlyRemote = permissionMode === 'plan' && Boolean(remote)
    const executionPermissionMode = readOnlyRemote ? 'default' : permissionMode
    const executionRemote = readOnlyRemote && remote
      ? { ...remote, mcpUrl: `${remote.mcpUrl}&ro=1` }
      : remote
    turn.handle = client.send(
      {
        userId, prompt, sessionId, model, permissionMode: executionPermissionMode, cwd,
        remote: executionRemote, readOnlyRemote, executionDisabled,
        ...(attachments.length ? { attachments } : {}),
        ...(disallowedTools.length ? { disallowedTools } : {}),
        ...(kbMcpUrl ? { kbMcpUrl, kbMode: kbMode === 'manual' ? ('manual' as const) : ('auto' as const) } : {}),
        ...(previewMcpUrl ? { previewMcpUrl } : {}),
        // В режиме «План» консоль read-only: ввод в терминал блокируется (&ro=1).
        ...(consoleMcpUrl ? { consoleMcpUrl: permissionMode === 'plan' ? `${consoleMcpUrl}&ro=1` : consoleMcpUrl } : {})
      },
      {
        onSession: (sid) => deps.db.setClaudeSession(userId, conversationId, `${provider}:${sid}`),
        onInit: (info) => {
          initInfo = info
        },
        onDelta: (delta) => {
          if (turn.done) return
          turn.partial += delta
          broadcast({ t: 'claude.token', conversationId, delta }, userId)
        },
        // Живой счётчик токенов: рассылается всем клиентам всегда (в отличие от
        // claude.log, который зависит от verbose) и попадает в снапшот active().
        onUsage: (usage) => {
          if (turn.done) return
          turn.usage = usage
          broadcast({ t: 'claude.usage', conversationId, usage }, userId)
        },
        onDone: (text, meta) => {
          if (turn.done) return
          finish()
          // Итоговая модель: из потока CLI → из настроек → у Codex с пустой
          // настройкой модель берётся из его config.toml и наружу не видна.
          const resolvedModel =
            meta?.model || model || (provider === 'codex' ? 'по умолчанию (Codex)' : model)
          // Смещения `at` считались относительно turn.partial. Если CLI вернул
          // финальный текст, отличный от накопленного (край: часть Codex), —
          // чередование невалидно, снимаем `at` (fallback к «действия над текстом»).
          // Перекладка картинок меняет длину только в хвосте ответа (после всех
          // действий), поэтому более ранние смещения не съезжают.
          const canInterleave = !text.trim() || text === turn.partial
          const activity = canInterleave
            ? turn.activity
            : turn.activity.map(({ at: _at, ...e }) => e)
          const merged: TurnMeta = {
            // Codex отдаёт usage только в самом конце. Сохраняем и последний
            // live-снапшот: так счётчики не теряются при различиях форматов CLI.
            ...turn.usage,
            ...meta,
            // Длительность из CLI, а если её нет — измеряем по стенным часам.
            durationMs: meta?.durationMs ?? now() - startedAt,
            model: resolvedModel,
            request: {
              ...requestInfo,
              model: resolvedModel,
              ...(initInfo?.tools ? { tools: initInfo.tools } : {}),
              ...(initInfo?.slashCommands ? { slashCommands: initInfo.slashCommands } : {}),
              ...(initInfo?.mcpServers ? { mcpServers: initInfo.mcpServers } : {})
            },
            // Активность хода — для подробного вида сообщения (персистится в meta).
            ...(activity.length ? { activity } : {})
          }
          // Ответ сохраняет сервер: клиент мог обновить страницу или уйти.
          const answerText = text.trim() ? text : turn.partial
          const rawText = engineNotice ? `${engineNotice}\n\n${answerText}` : answerText
          // Модель явно запрашивает выбор через структурированный блок. Сам блок
          // служебный: в историю и видимый ответ он не попадает.
          const taskLaunch = parseTaskLaunchRequest(rawText)
          if (taskLaunch.request) merged.taskLaunch = taskLaunch.request
          if (taskLaunch.requests) merged.taskLaunches = taskLaunch.requests

          // Картинки, созданные CLI, лежат на сервере — перекладываем их на
          // машину разговора, откуда браузер возьмёт их напрямую. Шаг сетевой,
          // поэтому сохранение и claude.done ждут его; осечка не критична —
          // relocate вернёт исходный текст, и картинка покажется через сервер.
          //
          // Ход уже убран из `turns` (finish), а запись в БД идёт ПОСЛЕ этого
          // сетевого шага — есть окно, где ответа нет ни в реестре, ни в БД.
          // Если сервер остановится в этом окне (пересборка контейнера),
          // flushInterrupted не найдёт ход и последнее сообщение пропадёт.
          // Поэтому регистрируем отложенное сохранение: оно выполнится РОВНО
          // один раз (guard `saved`) — либо здесь после перекладки, либо из
          // flushInterrupted готовым текстом, если сервер останавливается раньше.
          let saved = false
          const persist = (finalText: string): Message | undefined => {
            if (saved) return undefined
            saved = true
            pendingSaves.delete(finalize)
            if (!finalText.trim()) return undefined
            const message = deps.db.addMessage(
              userId,
              conversationId,
              'ai',
              finalText,
              timeHHMM(),
              provider,
              merged,
              requestedTarget
            )
            // Итоги хода — в его обращения к БЗ: id сообщения (панель ведёт на
            // ход) и размеры промпта/входа (доля БЗ в промпте).
            deps.kbUsage?.attachTurn({
              turnId,
              messageId: message.id,
              promptChars: requestInfo.promptChars,
              turnInputTokens: turnInputTokens(merged)
            })
            return message
          }
          const emitDone = (finalText: string, message?: Message): void => {
            broadcast(
              {
                t: 'claude.done',
                conversationId,
                text: finalText,
                meta: merged,
                engine: provider,
                ...(message ? { message } : {})
              },
              userId
            )
          }
          // Аварийное сохранение из flushInterrupted: ответ уже полный (модель
          // завершила ход), поэтому пишем как есть — без пометки interrupted и
          // без перекладки (картинки останутся серверными, но покажутся).
          function finalize(): void {
            if (saved) return
            emitDone(taskLaunch.text, persist(taskLaunch.text))
          }
          pendingSaves.add(finalize)

          const prepared = (async (): Promise<string> => {
            const a = deps.agents
            const binding = deps.db.getChatStorageBinding(userId, conversationId)
            const destinationAgentId = binding?.machineId ?? target
            if (!destinationAgentId || !a?.fsList || !a.fsMkdir || !a.fsWrite || !deps.readServerFile) {
              if (binding) return `${parseImages(taskLaunch.text).body}\n\nНе удалось сохранить изображение: файловый доступ к MachineStorage недоступен.`
              return taskLaunch.text
            }
            try {
              const managed = await resolveManagedChatStorage(userId, conversationId, {
                getBinding: (uid, id) => deps.db.getChatStorageBinding(uid, id),
                listStorages: (uid, machineId) => deps.db.listMachineStorages(uid, machineId),
                ownsMachine: (uid, machineId) => deps.db.listAgents(uid).some((agent) => agent.id === machineId),
                isOnline: (machineId) => a.isOnline(machineId),
                verifyRoot: async (machineId, rootPath) => {
                  await a.fsList!(machineId, rootPath)
                  if (!a.fsRead) throw new Error('Проверка marker MachineStorage недоступна')
                  const separator = rootPath.includes('\\') && !rootPath.includes('/') ? '\\' : '/'
                  const marker = await a.fsRead(machineId, `${rootPath.replace(/[/\\]$/, '')}${separator}.voicechat${separator}storage.json`)
                  const parsed = JSON.parse(Buffer.from(marker.dataBase64 ?? '', 'base64').toString('utf8')) as { id?: string }
                  if (parsed.id !== binding?.storageId) throw new Error('Marker привязанного хранилища отсутствует или конфликтует')
                }
              })
              return await relocateImagesToMachine(taskLaunch.text, destinationAgentId, {
                readFile: (path) => deps.readServerFile!(userId, path),
                fsList: (id, path) => a.fsList!(id, path),
                ...(managed ? { destinationDir: managed.generated } : {}),
                fsMkdir: (id, path) => a.fsMkdir!(id, path),
                fsWrite: (id, path, data) => a.fsWrite!(id, path, data)
              })
            } catch (error) {
              if (!binding) return taskLaunch.text
              const detail = error instanceof Error ? error.message : String(error)
              return `${parseImages(taskLaunch.text).body}\n\nНе удалось сохранить изображение в MachineStorage: ${detail}`
            }
          })()

          void prepared.then((finalText) => {
            if (saved) return // flushInterrupted уже сохранил (сервер останавливается)
            emitDone(finalText, persist(finalText))
            dispatchNext(userId, conversationId)
          })
        },
        onError: (message) => {
          if (turn.done) return
          deps.onAuthError?.(userId, provider, message)
          finish()
          if (req.messageId) {
            deps.db.enqueueTurn(userId, conversationId, req.messageId, {
              segments: req.segments,
              attachments: req.attachments,
              verbose: req.verbose,
              execTarget: req.execTarget,
              assistantContext: req.assistantContext
            }, false)
            deps.db.markQueuedTurnFailed(userId, conversationId, req.messageId)
            deps.db.setTurnQueuePaused(userId, conversationId, true)
            emitQueue(userId, conversationId)
          }
          broadcast({ t: 'claude.error', conversationId, message }, userId)
        },
        // Активность собираем всегда (для подробного вида сообщения); в глобальную
        // консоль (событие claude.log) шлём только если ход запрошен с verbose.
        onActivity: (entry) => {
          if (turn.done) return
          // Смещение действия в тексте = длина уже накопленного ответа. Клиент
          // применяет токены и лог в том же порядке, поэтому по `at` UI чередует
          // действия с абзацами (и в живом потоке, и в сохранённом сообщении).
          const stamped: ClaudeLogEntry = { ...entry, at: turn.partial.length, ts: now() }
          turn.activity.push(stamped)
          if (turn.activity.length > ACTIVITY_CAP) turn.activity.shift()
          if (req.verbose) broadcast({ t: 'claude.log', conversationId, entry: stamped }, userId)
        }
      }
    )
    // Мгновенно завершившийся ход (мок/ошибка спавна) уже убран из реестра.
    if (turn.done) turn.handle = { cancel: () => {} }
  }

  /**
   * Снять токены инструментов хода (БЗ и превью). Обязателен во всех выходах
   * хода (готово, ошибка, отмена, остановка сервера) — иначе каждый отменённый
   * ход оставляет живые токены, по которым можно действовать от его имени.
   */
  function releaseTurnTools(turn: TurnState): void {
    if (turn.kbToolToken) {
      deps.kbTool?.unregister(turn.kbToolToken)
      turn.kbToolToken = null
    }
    // Токен превью живёт по тем же правилам: снимается вместе с ходом.
    if (turn.previewToolToken) {
      deps.previewTool?.unregister(turn.previewToolToken)
      turn.previewToolToken = null
    }
    if (turn.remoteFileToken) {
      deps.remoteFileTool?.unregister(turn.remoteFileToken)
      turn.remoteFileToken = null
    }
  }

  function dispatchNext(userId: string, conversationId: string): void {
    if (deps.db.isTurnQueuePaused(userId, conversationId) || turns.has(conversationId)) {
      emitQueue(userId, conversationId)
      return
    }
    const next = deps.db.takeQueuedTurn(userId, conversationId)
    emitQueue(userId, conversationId, next?.message)
    if (!next) return
    queueMicrotask(() => void start({ userId, conversationId, messageId: next.messageId, ...next.payload }))
  }

  /** Остановка сохраняет partial и затем автоматически продвигает очередь. */
  function cancelTurn(conversationId: string, notify: boolean): TurnState | undefined {
    const turn = turns.get(conversationId)
    if (!turn) return undefined
    turns.delete(conversationId)
    turn.done = true
    releaseTurnTools(turn)
    turn.handle.cancel()
    deps.db.setTurnQueuePaused(turn.userId, conversationId, false)
    const meta: TurnMeta = {
      ...turn.usage,
      durationMs: now() - turn.startedAt,
      model: turn.model,
      interrupted: true,
      request: turn.requestInfo,
      ...(turn.activity.length ? { activity: turn.activity } : {})
    }
    const message = turn.partial.trim()
      ? deps.db.addMessage(turn.userId, conversationId, 'ai', turn.partial, timeHHMM(), turn.provider, meta, turn.execTarget)
      : undefined
    if (notify) broadcast({ t: 'claude.done', conversationId, text: turn.partial, meta, engine: turn.provider, ...(message ? { message } : {}) }, turn.userId)
    dispatchNext(turn.userId, conversationId)
    return turn
  }

  function cancel(conversationId?: string): void {
    if (conversationId) cancelTurn(conversationId, true)
    else for (const id of [...turns.keys()]) cancelTurn(id, true)
  }

  function queueSnapshot(userId: string, conversationId: string): void {
    emitQueue(userId, conversationId)
  }

  function editQueued(userId: string, conversationId: string, id: string, text: string, segments: SttSegmentWire[]): void {
    const current = deps.db.queuedTurnPayload(userId, conversationId, id)
    if (!current) return
    deps.db.updateQueuedTurn(userId, conversationId, id, text, { ...current, segments })
    emitQueue(userId, conversationId)
  }

  function deleteQueued(userId: string, conversationId: string, id: string): void {
    deps.db.deleteQueuedTurn(userId, conversationId, id)
    emitQueue(userId, conversationId)
  }

  function reorderQueued(userId: string, conversationId: string, ids: string[]): void {
    deps.db.reorderQueuedTurns(userId, conversationId, ids)
    // И успех, и конфликт возвращают авторитетный снимок: клиент либо подтверждает
    // оптимистичный порядок, либо откатывается без потери элементов.
    emitQueue(userId, conversationId)
  }

  function sendQueuedNow(userId: string, conversationId: string, id: string): void {
    const turn = turns.get(conversationId)
    if (restarting.has(conversationId)) {
      emitQueue(userId, conversationId)
      return
    }
    if (!turn || turn.userId !== userId || !turn.source.messageId) {
      // Без активного хода выбранный элемент становится первым и запускается
      // сразу, если очередь не удерживает ошибка.
      deps.db.prioritizeQueuedTurn(userId, conversationId, id)
      deps.db.setTurnQueuePaused(userId, conversationId, false)
      dispatchNext(userId, conversationId)
      return
    }

    const merged = deps.db.mergeQueuedTurnIntoMessage(
      userId,
      conversationId,
      id,
      turn.source.messageId,
      {
        segments: turn.source.segments,
        attachments: turn.source.attachments,
        verbose: turn.source.verbose,
        execTarget: turn.source.execTarget,
        assistantContext: turn.source.assistantContext
      }
    )
    if (!merged) {
      emitQueue(userId, conversationId)
      return
    }

    // Замена текущего запроса: partial намеренно не сохраняем как ответ. Старые
    // callbacks обезвреживает done, а новый ход стартует с объединённым payload.
    turns.delete(conversationId)
    turn.done = true
    releaseTurnTools(turn)
    try {
      turn.handle.cancel()
    } catch {
      // Не запускаем второй процесс, если отмену даже не удалось инициировать.
      // Объединённая реплика уже атомарно сохранена и остаётся recoverable.
      deps.db.enqueueTurn(userId, conversationId, merged.message.id, merged.payload, false)
      deps.db.markQueuedTurnFailed(userId, conversationId, merged.message.id)
      deps.db.setTurnQueuePaused(userId, conversationId, true)
      emitQueue(userId, conversationId, merged.message, merged.replacedMessageIds)
      broadcast({ t: 'claude.error', conversationId, message: 'Не удалось остановить предыдущий запрос.' }, userId)
      return
    }
    deps.db.setTurnQueuePaused(userId, conversationId, false)
    restarting.add(conversationId)
    emitQueue(userId, conversationId, merged.message, merged.replacedMessageIds)
    queueMicrotask(() => {
      restarting.delete(conversationId)
      void start({
        userId,
        conversationId,
        messageId: merged.message.id,
        ...merged.payload
      }).catch((error: unknown) => {
        deps.db.enqueueTurn(userId, conversationId, merged.message.id, merged.payload, false)
        deps.db.markQueuedTurnFailed(userId, conversationId, merged.message.id)
        deps.db.setTurnQueuePaused(userId, conversationId, true)
        emitQueue(userId, conversationId)
        broadcast({ t: 'claude.error', conversationId, message: error instanceof Error ? error.message : String(error) }, userId)
      })
    })
  }

  function resumeQueues(userId: string): void {
    const conversations = deps.db.listConversations(userId)
    for (const conversation of conversations) {
      if (!deps.db.isTurnQueuePaused(userId, conversation.id)) dispatchNext(userId, conversation.id)
      else emitQueue(userId, conversation.id)
    }
  }

  /**
   * Плановая остановка сервера: каждый активный ход отменяется, а накопленный
   * частичный текст сохраняется в БД как ответ с пометкой interrupted (вместе с
   * активностью) — после рестарта пользователь видит уже набранную часть.
   */
  function flushInterrupted(): void {
    // Сперва — ходы, которые уже завершились, но не успели записаться в БД
    // (перекладка картинок в полёте): сохраняем готовый ответ целиком.
    for (const finalize of [...pendingSaves]) {
      pendingSaves.delete(finalize)
      finalize()
    }
    for (const [conversationId, turn] of [...turns]) {
      turns.delete(conversationId)
      turn.done = true
      releaseTurnTools(turn)
      turn.handle.cancel()
      // После restart очередь не должна неожиданно продолжиться вслед за
      // прерванным ответом: пользователь явно выберет дальнейшее действие.
      deps.db.setTurnQueuePaused(turn.userId, conversationId, true)
      if (!turn.partial.trim()) continue
      const meta: TurnMeta = {
        // Usage до обрыва — result-событие CLI с итогами уже не придёт.
        ...turn.usage,
        durationMs: now() - turn.startedAt,
        model: turn.model,
        interrupted: true,
        request: turn.requestInfo,
        ...(turn.activity.length ? { activity: turn.activity } : {})
      }
      const message = deps.db.addMessage(
        turn.userId,
        conversationId,
        'ai',
        turn.partial,
        timeHHMM(),
        turn.provider,
        meta,
        turn.execTarget
      )
      deps.kbUsage?.attachTurn({
        turnId: turn.turnId,
        messageId: message.id,
        promptChars: turn.requestInfo.promptChars,
        turnInputTokens: turnInputTokens(meta)
      })
      broadcast(
        { t: 'claude.done', conversationId, text: turn.partial, meta, engine: turn.provider, message },
        turn.userId
      )
    }
  }

  return {
    start,
    cancel,
    editQueued,
    deleteQueued,
    reorderQueued,
    sendQueuedNow,
    queueSnapshot,
    resumeQueues,
    flushInterrupted,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    active(userId) {
      return [...turns]
        .filter(([, t]) => t.userId === userId)
        .map(([conversationId, t]) => ({
          conversationId,
          partial: t.partial,
          ...(t.activity.length ? { activity: t.activity } : {}),
          ...(t.usage ? { usage: t.usage } : {})
        }))
    }
  }
}

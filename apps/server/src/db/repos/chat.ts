// Домен «chat»: таблицы conversations, messages, messages_fts, fts_state, speakers, conversation_context_events, conversation_draft_requests, conversation_turn_queue, conversation_turn_control, conversation_workspaces.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import { type Conversation, type ConversationScope, type ContextChangeEvent, type ConversationStatus, DEFAULT_CONVERSATION_STATUS, type DesktopMigrationBundle, type DesktopMigrationResult, type LlmProvider, type Message, type MessageAttachment, type MessageRole, type MessageSearchHit, type MessageSearchResult, type QueuedTurn, type QueueTurnPayload, type PermissionMode, type TurnMeta, type UsageBucket, type UsageByModel, type UsageByConversation, type UsageReport, type UsageTotals, type UsageUnit, type WorkspaceView, MAKE_KIND, isContextToggleable } from '@voicechat/shared'
import { MESSAGES_FTS_SQL } from '../schema.js'
import { toFtsMatchQuery } from '../fts.js'
import { BaseRepo } from './base.js'
import { parseJsonValue } from './support.js'

interface ConversationRow {
  id: string
  title: string
  created_at: number
  updated_at: number
  claude_session_id: string | null
  exec_target: string | null
  workdir: string | null
  skill_names: string | null
  llm_engine_id: string | null
  llm_provider: string | null
  llm_model: string | null
  permission_mode: string | null
  kb_context_mode: string | null
  disabled_context_json: string | null
  project_id: string | null
  preview_url: string | null
  task_id: string | null
  assistant_kind: string | null
  scope: string
  assistant_autonomy: string | null
  status: string | null
  /** Кэш стоимости: посчитан на прошлом показе списка, `cost_dirty` — признак протухания. */
  cost_usd?: number | null
  cost_status?: string | null
  cost_prices_stamp?: number | null
  cost_dirty?: number
  last_exec_target?: string | null
}

/** Разбор JSON meta сообщения; битый/пустой → undefined (не роняет чтение ленты). */
function parseMeta(raw: string): TurnMeta | undefined {
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as TurnMeta) : undefined
  } catch {
    return undefined
  }
}

/** Старые/битые метаданные не должны ломать восстановление ленты. */
function parseAttachments(raw: string | null): MessageAttachment[] | undefined {
  if (!raw) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return undefined
    const files = value.filter((item): item is MessageAttachment => Boolean(item) && typeof item === 'object' && typeof (item as MessageAttachment).path === 'string' && typeof (item as MessageAttachment).name === 'string' && typeof (item as MessageAttachment).mimeType === 'string' && typeof (item as MessageAttachment).size === 'number')
    return files.length ? files : undefined
  } catch {
    return undefined
  }
}

interface MessageRow {
  id: string
  conversation_id: string
  role: string
  text: string
  time: string
  created_at: number
  engine: string | null
  meta: string | null
  exec_target: string | null
  attachments: string | null
  state: string
  history_position: number | null
}

/**
 * Условие «беседа не является чатом завершённой задачи»: чат либо не привязан к
 * задаче, либо её колонка не имеет семантики `done`. Проверяем колонку, а не
 * `tasks.done_at`, чтобы возврат задачи в работу возвращал чат в список сразу.
 */
const NOT_DONE_TASK_CHAT = `(c.task_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM tasks t JOIN kanban_columns k ON k.id = t.column_id
    WHERE t.id = c.task_id AND k.semantic_type = 'done'))`

/** Отменённые задачи не входят ни в одну стандартную выборку разговоров. */
const NOT_CANCELLED_TASK_CHAT = `(c.task_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM tasks t JOIN kanban_columns k ON k.id = t.column_id
    WHERE t.id = c.task_id AND k.semantic_type = 'cancelled'))`

/** Нормализация статуса чата из колонки (мусор → дефолт). */
const CONVERSATION_STATUS_SET = new Set<ConversationStatus>([
  'planned',
  'developing',
  'planning_done',
  'development_done',
  'done'
])

function normStatus(raw: string | null): ConversationStatus {
  return raw && CONVERSATION_STATUS_SET.has(raw as ConversationStatus)
    ? (raw as ConversationStatus)
    : DEFAULT_CONVERSATION_STATUS
}

/** Имя индекса в `fts_state` (пока индексируются только сообщения). */
const FTS_MESSAGES = 'messages'

/** Сколько сообщений индексируем за одну порцию бэкфилла. */
const FTS_BACKFILL_CHUNK = 500

/** Пауза между порциями: старт и запросы не должны стоять в очереди за индексом. */
const FTS_BACKFILL_PAUSE_MS = 25

/** Предохранитель для `ensureMessagesIndexed` (500 × 20000 = 10 млн сообщений). */
const FTS_BACKFILL_MAX_CHUNKS = 20_000

/** Сколько раз готовы пересобрать индекс после проваленной integrity-check. */
const FTS_MAX_REPAIRS = 1

/** Длина сниппета в токенах (максимум, который допускает FTS5, — 64). */
const SNIPPET_TOKENS = 12

/** Границы размера страницы результатов. */
const SEARCH_LIMIT_DEFAULT = 20

const SEARCH_LIMIT_MAX = 50

/** Параметры поиска по сообщениям. */
export interface MessageSearchOptions {
  q: string
  /** undefined — по всем беседам, null — только беседы без проекта. */
  projectId?: string | null
  conversationId?: string
  limit?: number
  cursor?: string | null
}

interface MessageSearchRow {
  message_id: string
  conversation_id: string
  role: string
  created_at: number
  time: string
  rid: number
  conversation_title: string
  project_id: string | null
  score: number
  snippet: string
}

interface FtsStateRow {
  lastRowid: number
  maxRowid: number
  done: number
  repairs: number
}

function clampSearchLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return SEARCH_LIMIT_DEFAULT
  return Math.min(Math.max(Math.trunc(limit), 1), SEARCH_LIMIT_MAX)
}

/** Курсор — непрозрачная строка: пара (bm25, rowid) последней выданной строки. */
function encodeSearchCursor(score: number, rowid: number): string {
  return Buffer.from(`${score}|${rowid}`, 'utf8').toString('base64url')
}

function decodeSearchCursor(cursor: string | null | undefined): { score: number; rowid: number } | null {
  if (!cursor) return null
  // Подделанный/устаревший курсор — не ошибка запроса: просто первая страница.
  const [rawScore, rawRowid] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  const score = Number(rawScore)
  const rowid = Number(rawRowid)
  if (!Number.isFinite(score) || !Number.isInteger(rowid)) return null
  return { score, rowid }
}
export class ChatRepo extends BaseRepo {
  /** Доступен ли FTS5 в этой сборке SQLite (иначе поиск по сообщениям пустой). */
  private ftsReady = false

  /** Таймер следующей порции бэкфилла индекса; null — порция не запланирована. */
  ftsTimer: ReturnType<typeof setTimeout> | null = null

  /** Владелец разговора по id без пользовательского scope — для серверных сервисов (MCP Make). */
  conversationOwner(id: string): string | null {
    const row = this.db.prepare(`SELECT user_id FROM conversations WHERE id = ?`).get(id) as { user_id: string } | undefined
    return row?.user_id ?? null
  }

  createConversation(userId: string, title = 'Новый разговор', assistantKind: 'web-recorder' | 'playwright-reader' | 'console-reader' | 'make' | 'images' | null = null, projectId: string | null = null, requestedScope?: ConversationScope): Conversation {
    const scope = requestedScope ?? (assistantKind === 'make' ? 'make' : assistantKind === 'images' ? 'images' : assistantKind === 'console-reader' ? 'console' : assistantKind === 'playwright-reader' ? 'playwright-reader' : assistantKind === 'web-recorder' ? 'web-reader' : 'chat')
    if (scope === 'kanban' && !projectId) throw new Error('projectId is required for kanban')
    const project = projectId ? this.repos.projects.getProject(userId, projectId) : null
    if (projectId && !project) throw new Error('project not found')
    const skillNames = project?.skills ?? []
    const id = this.newId()
    const ts = this.now()
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, claude_session_id, user_id, exec_target, assistant_kind, project_id, skill_names, scope)
         VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?)`
      )
      .run(id, title, ts, ts, userId, assistantKind, projectId, JSON.stringify(skillNames), scope)
    // Дефолтный пресет контекста: применяется сразу при создании, иначе
    // «минимальный контекст» действует только после того, как человек вспомнит
    // про кнопку. Пункты безопасности пресет не трогает — их фильтрует запись.
    const settings = this.repos.settings.getSettings(userId)
    const preset = settings.defaultContextPresetId
      ? settings.contextPresets.find((entry) => entry.id === settings.defaultContextPresetId)
      : undefined
    const disabledContext = preset ? preset.disabled.filter(isContextToggleable) : []
    if (disabledContext.length) {
      this.db.prepare(`UPDATE conversations SET disabled_context_json = ? WHERE id = ? AND user_id = ?`)
        .run(JSON.stringify(disabledContext), id, userId)
    }
    return { id, title, createdAt: ts, updatedAt: ts, messageCount: 0, claudeSessionId: null, execTarget: null, workdir: null, skillNames, llmEngineId: null, llmProvider: null, llmModel: null, permissionMode: null, kbContextMode: 'auto', disabledContext, scope, projectId, assistantKind, status: DEFAULT_CONVERSATION_STATUS, costUsd: null, costStatus: 'unknown', lastExecTarget: null }
  }

  /**
   * Единственная точка персистенции нового обычного чата: разговор, проектные
   * настройки и первая реплика фиксируются одной SQLite-транзакцией.
   */
  createConversationDraft(
    userId: string,
    idempotencyKey: string,
    title: string,
    projectId: string | null,
    message: {
      role: MessageRole
      text: string
      time: string
      engine?: LlmProvider
      meta?: TurnMeta
      execTarget?: string | null
      attachments?: MessageAttachment[]
    }
  ): { conversation: Conversation; messages: Message[] } {
    const run = this.db.transaction(() => {
      const replay = this.db.prepare(
        `SELECT conversation_id FROM conversation_draft_requests WHERE user_id = ? AND idempotency_key = ?`
      ).get(userId, idempotencyKey) as { conversation_id: string } | undefined
      if (replay) {
        const conversation = this.getConversation(userId, replay.conversation_id)
        if (!conversation) throw new Error('idempotent conversation not found')
        return { conversation, messages: this.listMessages(userId, conversation.id) }
      }

      const created = this.createConversation(userId, title)
      const conversation = projectId ? this.setConversationProject(userId, created.id, projectId) : created
      if (!conversation) throw new Error('project not found')
      this.addMessage(
        userId,
        conversation.id,
        message.role,
        message.text,
        message.time,
        message.engine,
        message.meta,
        conversation.execTarget,
        message.attachments
      )
      this.db.prepare(
        `INSERT INTO conversation_draft_requests (user_id, idempotency_key, conversation_id) VALUES (?, ?, ?)`
      ).run(userId, idempotencyKey, conversation.id)
      return { conversation: this.getConversation(userId, conversation.id)!, messages: this.listMessages(userId, conversation.id) }
    })
    return run()
  }

  /** Один приватный сохраняемый чат канбан-ассистента на пользователя и проект. */
  ensureKanbanAssistantConversation(userId: string, projectId: string): Conversation | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const existing = this.db.prepare(
      `SELECT id FROM conversations WHERE user_id = ? AND project_id = ? AND assistant_kind = 'kanban' LIMIT 1`
    ).get(userId, projectId) as { id: string } | undefined
    if (existing) return this.getConversation(userId, existing.id)
    const project = this.repos.projects.getProject(userId, projectId)
    if (!project) return null
    const id = this.newId()
    const ts = this.now()
    this.db.prepare(
      `INSERT INTO conversations (id, title, created_at, updated_at, claude_session_id, user_id, exec_target, project_id, assistant_kind, scope)
       VALUES (?, ?, ?, ?, NULL, ?, 'none', ?, 'kanban', 'kanban')`
    ).run(id, `Ассистент · ${project.name}`, ts, ts, userId, projectId)
    return this.getConversation(userId, id)
  }

  /**
   * Список бесед пользователя. Чаты задач, лежащих в колонке с семантикой
   * `done`, из него убраны: завершённая задача забивала бы сайдбар навсегда.
   * Скрытие мгновенное (порог `doneRetentionDays` тут ни при чём) и обратимое —
   * задачу вернули в работу, чат снова в списке. Доступ к скрытому чату
   * остаётся: `getConversation` его отдаёт, карточка задачи открывает.
   */
  /**
   * Список бесед, свежие сверху. Окно задаётся `since` (беседы не старее метки —
   * так сайдбар берёт текущую неделю) или курсором `before` + `limit` — так
   * догружается секция «Более старые» порциями. Без окна отдаётся всё: этим
   * пользуются мосты и тесты.
   */
  listConversations(userId: string, opts?: {
    scope?: ConversationScope
    projectId?: string
    includeCompleted?: boolean
    since?: number
    before?: { updatedAt: number; id: string }
    limit?: number
  }): Conversation[] {
    const scope = opts?.scope ?? 'chat'
    if (scope === 'kanban' && !opts?.projectId) return []
    // Курсор — пара (updated_at, id): по одному времени страницы разъезжались бы
    // на беседах, обновлённых в одну миллисекунду.
    const rows = this.db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
                (SELECT m.exec_target FROM messages m WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_exec_target
         FROM conversations c
         WHERE c.user_id = @userId
           AND c.scope = @scope
           AND (@scope <> 'kanban' OR c.project_id = @projectId)
           AND ${NOT_CANCELLED_TASK_CHAT}
           AND (@includeCompleted = 1 OR ${NOT_DONE_TASK_CHAT})
           AND (@since IS NULL OR c.updated_at >= @since)
           AND (@beforeAt IS NULL OR c.updated_at < @beforeAt OR (c.updated_at = @beforeAt AND c.id < @beforeId))
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT @limit`
      )
      .all({
        userId,
        scope,
        projectId: opts?.projectId ?? null,
        includeCompleted: opts?.includeCompleted ? 1 : 0,
        since: opts?.since ?? null,
        beforeAt: opts?.before?.updatedAt ?? null,
        beforeId: opts?.before?.id ?? null,
        limit: opts?.limit && opts.limit > 0 ? opts.limit : -1
      }) as Array<ConversationRow & { message_count: number }>
    const costs = this.conversationCosts(rows)
    return rows.map((r) => this.mapConversation(r, r.message_count, costs.get(r.id)))
  }

  getConversation(userId: string, id: string, context?: { scope: ConversationScope; projectId?: string }): Conversation | null {
    const row = this.db
      .prepare(`SELECT c.*,
                       (SELECT m.exec_target FROM messages m WHERE m.conversation_id = c.id
                        ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_exec_target
                FROM conversations c WHERE c.id = ? AND c.user_id = ?`)
      .get(id, userId) as ConversationRow | undefined
    if (!row) return null
    if (context && (row.scope !== context.scope || (context.scope === 'kanban' && row.project_id !== context.projectId))) return null
    const count = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?`).get(id) as {
        n: number
      }
    ).n
    return this.mapConversation(row, count)
  }

  /** Владеет ли пользователь разговором (для проверок при работе с сообщениями). */
  ownsConversation(userId: string, conversationId: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM conversations WHERE id = ? AND user_id = ?`)
      .get(conversationId, userId)
    return row !== undefined
  }

  /**
   * Поиск по названию разговора и тексту его сообщений (регистронезависимо).
   * Состав тот же, что у `listConversations`: чаты завершённых задач приходят
   * только с `includeCompleted` — иначе выключенный фильтр возвращал бы их
   * через строку поиска.
   */
  searchConversations(userId: string, query: string, opts?: { scope?: ConversationScope; projectId?: string; includeCompleted?: boolean }): Conversation[] {
    const scope = opts?.scope ?? 'chat'
    if (scope === 'kanban' && !opts?.projectId) return []
    const q = query.trim()
    if (!q) return this.listConversations(userId, opts)
    const like = `%${q.toLowerCase().replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`
    const rows = this.db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
                (SELECT m.exec_target FROM messages m WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_exec_target
         FROM conversations c
         WHERE c.user_id = ?
           AND c.scope = ?
           AND (? <> 'kanban' OR c.project_id = ?)
           AND ${NOT_CANCELLED_TASK_CHAT}
           AND (? = 1 OR ${NOT_DONE_TASK_CHAT})
           AND (ulower(c.title) LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM messages m
                       WHERE m.conversation_id = c.id AND ulower(m.text) LIKE ? ESCAPE '\\'))
         ORDER BY c.updated_at DESC`
      )
      .all(userId, scope, scope, opts?.projectId ?? null, opts?.includeCompleted ? 1 : 0, like, like) as Array<ConversationRow & { message_count: number }>
    const costs = this.conversationCosts(rows)
    return rows.map((r) => this.mapConversation(r, r.message_count, costs.get(r.id)))
  }

  renameConversation(userId: string, id: string, title: string): void {
    this.db
      .prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(title, this.now(), id, userId)
  }

  setConversationExecTarget(
    userId: string,
    id: string,
    execTarget: string | null,
    workdir?: string | null,
    skillNames?: string[],
    llmProvider?: LlmProvider | null,
    llmModel?: string | null,
    permissionMode?: PermissionMode | null,
    llmEngineId?: string | null
  ): Conversation | null {
    // Make-чату машина не назначается: ход её всё равно игнорирует, а запись
    // в БД возвращала бы мусор, который чистит миграция. Явное «none» проходит.
    const makeChat = (this.db.prepare(`SELECT assistant_kind FROM conversations WHERE id = ? AND user_id = ?`).get(id, userId) as { assistant_kind: string | null } | undefined)?.assistant_kind === 'make'
    const target = makeChat && execTarget !== 'none' ? null : execTarget
    const fields = ['exec_target = ?']
    const values: unknown[] = [target]
    if (workdir !== undefined) {
      fields.push('workdir = ?')
      values.push(makeChat ? null : workdir)
    }
    if (skillNames !== undefined) {
      fields.push('skill_names = ?')
      values.push(JSON.stringify(skillNames))
    }
    if (llmEngineId !== undefined) {
      fields.push('llm_engine_id = ?')
      values.push(llmEngineId)
    }
    if (llmProvider !== undefined) {
      fields.push('llm_provider = ?')
      values.push(llmProvider)
    }
    if (llmModel !== undefined) {
      fields.push('llm_model = ?')
      values.push(llmModel)
    }
    if (permissionMode !== undefined) {
      fields.push('permission_mode = ?')
      values.push(permissionMode)
    }
    this.db
      .prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...values, id, userId)
    return this.getConversation(userId, id)
  }

  /**
   * Единое вычисление машины чата. Сохранённый `null` означает позднее
   * наследование персонального default пользователя; только наследование получает
   * безопасный online-fallback. Явный override не заменяется молча.
   */
  resolveConversationMachine(
    userId: string,
    conversationId: string,
    options: { execTarget?: string | null; projectId?: string | null; isOnline?: (agentId: string) => boolean } = {}
  ): {
    agentId: string | null
    source: 'explicit' | 'personal_default' | 'fallback' | 'disabled' | 'none'
    error: 'unavailable' | 'offline' | 'no_online_machine' | null
  } | null {
    const conversation = this.getConversation(userId, conversationId)
    if (!conversation) return null
    const explicitTarget = options.execTarget === undefined ? conversation.execTarget : options.execTarget
    const projectId = options.projectId === undefined ? conversation.projectId : options.projectId
    if (explicitTarget === 'none') return { agentId: null, source: 'disabled', error: null }
    const usable = this.repos.machines.listUsableAgents(userId, projectId)
    const isOnline = options.isOnline ?? (() => true)
    if (explicitTarget) {
      if (!this.repos.machines.canUseAgent(userId, explicitTarget, projectId)) {
        // Машины больше нет в реестре (удалена мимо UI, чистка) — ссылка
        // висячая, и чат залипал бы на «машина недоступна» до ручного
        // переключения. Забываем её и решаем заново, как для нового чата.
        const gone = !this.db.prepare(`SELECT 1 FROM agents WHERE id = ?`).get(explicitTarget)
        if (gone && options.execTarget === undefined) {
          this.db.prepare(`UPDATE conversations SET exec_target = NULL WHERE id = ? AND user_id = ?`).run(conversationId, userId)
          return this.resolveConversationMachine(userId, conversationId, { ...options, execTarget: null })
        }
        return { agentId: explicitTarget, source: 'explicit', error: 'unavailable' }
      }
      return {
        agentId: explicitTarget,
        source: 'explicit',
        error: isOnline(explicitTarget) ? null : 'offline'
      }
    }
    const personalDefault = projectId
      ? this.repos.machines.getUserProjectDefaultMachine(userId, projectId)
      : this.repos.settings.getSettings(userId).defaultAgentId
    if (personalDefault && usable.some((agent) => agent.id === personalDefault) && isOnline(personalDefault)) {
      return { agentId: personalDefault, source: 'personal_default', error: null }
    }
    const fallback = usable.find((agent) => isOnline(agent.id))
    if (fallback) return { agentId: fallback.id, source: 'fallback', error: null }
    return { agentId: null, source: 'none', error: 'no_online_machine' }
  }

  /** Вернуть чат задачи к наследованию после удаления изолированного клона. */
  restoreTaskChatWorkdir(userId: string, id: string, projectId: string): Conversation | null {
    if (!this.repos.projects.getProject(userId, projectId)) return null
    return this.setConversationExecTarget(userId, id, null, null)
  }

  setConversationKbContextMode(userId: string, id: string, mode: 'auto' | 'manual' | 'off'): Conversation | null {
    this.db.prepare(`UPDATE conversations SET kb_context_mode = ? WHERE id = ? AND user_id = ?`).run(mode, id, userId)
    return this.getConversation(userId, id)
  }

  /**
   * Включить/выключить пункт контекста инспектора. Правила безопасности выключить
   * нельзя (тихо игнорируем). Выключенные id хранятся в disabled_context_json и
   * применяются при сборке хода (turns.ts).
   */
  /**
   * Тумблер пункта контекста. `actor` пишется в журнал: обычно это владелец, но
   * админ правит и чужие чаты, и «почему этот чат ведёт себя иначе» без имени
   * не ответить. Повторное выставление того же значения событие не пишет —
   * журнал должен показывать изменения, а не нажатия.
   */
  setConversationContextEnabled(userId: string, id: string, itemId: string, enabled: boolean, actor = userId): Conversation | null {
    const conversation = this.getConversation(userId, id)
    if (!conversation) return null
    if (!isContextToggleable(itemId)) return conversation // безопасность/информация не выключается
    const disabled = new Set(conversation.disabledContext ?? [])
    const was = !disabled.has(itemId)
    if (enabled) disabled.delete(itemId); else disabled.add(itemId)
    this.db.prepare(`UPDATE conversations SET disabled_context_json = ? WHERE id = ? AND user_id = ?`).run(JSON.stringify([...disabled]), id, userId)
    if (was !== enabled) {
      this.db
        .prepare(`INSERT INTO conversation_context_events (at, conversation_id, user_id, actor, item_id, enabled) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(this.now(), id, userId, actor, itemId, enabled ? 1 : 0)
    }
    return this.getConversation(userId, id)
  }

  /**
   * Событие смены настройки разговора в журнале контекста. Тумблеры пишет
   * `setConversationContextEnabled`, а здесь — то, у чего есть значение:
   * режим доступа, режим базы знаний, движок и модель, машина. Пишем только
   * фактическое изменение: повторное сохранение той же формы журнал не растит.
   */
  recordConversationSettingEvent(userId: string, id: string, itemId: string, value: string, actor = userId): void {
    const conversation = this.getConversation(userId, id)
    if (!conversation) return
    const last = this.db
      .prepare(`SELECT value FROM conversation_context_events WHERE conversation_id = ? AND item_id = ? AND value IS NOT NULL ORDER BY id DESC LIMIT 1`)
      .get(id, itemId) as { value: string } | undefined
    if (last?.value === value) return
    this.db
      .prepare(`INSERT INTO conversation_context_events (at, conversation_id, user_id, actor, item_id, enabled, value) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(this.now(), id, userId, actor, itemId, 1, value)
  }

  /**
   * Журнал изменений контекста разговора, новые сверху. Читается через scope
   * владельца: чужой разговор просто не найдётся и журнал будет пуст.
   */
  listConversationContextEvents(userId: string, id: string, limit = 50): ContextChangeEvent[] {
    if (!this.getConversation(userId, id)) return []
    const rows = this.db
      .prepare(`SELECT at, actor, item_id, enabled, value FROM conversation_context_events WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`)
      .all(id, Math.max(1, Math.min(limit, 200))) as Array<{ at: number; actor: string; item_id: string; enabled: number; value: string | null }>
    return rows.map((row) => ({ at: row.at, actor: row.actor, itemId: row.item_id, enabled: row.enabled === 1, ...(row.value === null ? {} : { value: row.value }) }))
  }

  setConversationPreviewUrl(userId: string, id: string, previewUrl: string | null): Conversation | null {
    this.db.prepare(`UPDATE conversations SET preview_url = ?, updated_at = ? WHERE id = ? AND user_id = ?`).run(previewUrl, this.now(), id, userId)
    return this.getConversation(userId, id)
  }

  setConversationStatus(userId: string, id: string, status: ConversationStatus): Conversation | null {
    this.db.prepare(`UPDATE conversations SET status = ? WHERE id = ? AND user_id = ?`).run(status, id, userId)
    return this.getConversation(userId, id)
  }

  clearConversationExecTargetForAgent(userId: string, agentId: string): void {
    this.db
      .prepare(`UPDATE conversations SET exec_target = NULL WHERE user_id = ? AND exec_target = ?`)
      .run(userId, agentId)
  }

  deleteConversation(userId: string, id: string): void {
    // ON DELETE CASCADE удалит сообщения и спикеров. Никаких проверок «чат занят»:
    // Feature Run убран, а CI-раны с разговорами не связаны.
    this.db.prepare(`DELETE FROM conversations WHERE id = ? AND user_id = ?`).run(id, userId)
  }

  setClaudeSession(userId: string, id: string, sessionId: string | null): void {
    this.db
      .prepare(`UPDATE conversations SET claude_session_id = ? WHERE id = ? AND user_id = ?`)
      .run(sessionId, id, userId)
  }

  listQueuedTurns(userId: string, conversationId: string): QueuedTurn[] {
    if (!this.ownsConversation(userId, conversationId)) return []
    const rows = this.db.prepare(
      `SELECT q.id, q.conversation_id, q.message_id, q.payload, q.status, q.position,
              q.created_at, m.text, m.attachments AS message_attachments
       FROM conversation_turn_queue q
       JOIN messages m ON m.id = q.message_id
       WHERE q.user_id = ? AND q.conversation_id = ? AND q.status IN ('queued','failed')
       ORDER BY q.position, q.created_at`
    ).all(userId, conversationId) as Array<{ id: string; conversation_id: string; message_id: string; payload: string; status: string; position: number; created_at: number; text: string; message_attachments: string | null }>
    return rows.map((row, index) => {
      let payload: QueueTurnPayload = { segments: [] }
      try { payload = JSON.parse(row.payload) as QueueTurnPayload } catch { /* keep recoverable row visible */ }
      let attachmentDetails: MessageAttachment[] = []
      try { attachmentDetails = row.message_attachments ? JSON.parse(row.message_attachments) as MessageAttachment[] : [] } catch { /* attachment ids still remain usable */ }
      return {
        id: row.id,
        conversationId: row.conversation_id,
        messageId: row.message_id,
        text: row.text,
        attachments: payload.attachments ?? [],
        ...(attachmentDetails.length ? { attachmentDetails } : {}),
        position: index + 1,
        status: row.status === 'failed' ? 'failed' : 'queued',
        createdAt: row.created_at
      }
    })
  }

  isTurnQueuePaused(userId: string, conversationId: string): boolean {
    if (!this.ownsConversation(userId, conversationId)) return false
    const row = this.db.prepare(`SELECT paused FROM conversation_turn_control WHERE conversation_id = ?`).get(conversationId) as { paused: number } | undefined
    return Boolean(row?.paused)
  }

  setTurnQueuePaused(userId: string, conversationId: string, paused: boolean): void {
    if (!this.ownsConversation(userId, conversationId)) return
    this.db.prepare(
      `INSERT INTO conversation_turn_control (conversation_id, paused) VALUES (?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET paused = excluded.paused`
    ).run(conversationId, paused ? 1 : 0)
  }

  enqueueTurn(userId: string, conversationId: string, messageId: string, payload: QueueTurnPayload, hideMessage = true): QueuedTurn[] {
    if (!this.ownsConversation(userId, conversationId)) throw new Error('conversation not found')
    const now = this.now()
    this.db.transaction(() => {
      const position = (this.db.prepare(
        `SELECT COALESCE(MAX(position), 0) + 1 AS position FROM conversation_turn_queue WHERE conversation_id = ?`
      ).get(conversationId) as { position: number }).position
      const inserted = this.db.prepare(
        `INSERT OR IGNORE INTO conversation_turn_queue
          (id, conversation_id, user_id, message_id, payload, status, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
      ).run(this.newId(), conversationId, userId, messageId, JSON.stringify(payload), position, now, now)
      if (inserted.changes && hideMessage) {
        this.db.prepare(`UPDATE messages SET state = 'queued', history_position = NULL WHERE id = ? AND conversation_id = ?`).run(messageId, conversationId)
      }
    })()
    return this.listQueuedTurns(userId, conversationId)
  }

  queuedTurnPayload(userId: string, conversationId: string, id: string): QueueTurnPayload | null {
    const row = this.db.prepare(
      `SELECT payload FROM conversation_turn_queue WHERE id = ? AND conversation_id = ? AND user_id = ? AND status IN ('queued','failed')`
    ).get(id, conversationId, userId) as { payload: string } | undefined
    if (!row) return null
    try { return JSON.parse(row.payload) as QueueTurnPayload } catch { return null }
  }

  updateQueuedTurn(userId: string, conversationId: string, id: string, text: string, payload: QueueTurnPayload): QueuedTurn[] {
    this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT message_id FROM conversation_turn_queue WHERE id = ? AND conversation_id = ? AND user_id = ? AND status IN ('queued','failed')`
      ).get(id, conversationId, userId) as { message_id: string } | undefined
      if (!row) return
      this.db.prepare(`UPDATE messages SET text = ? WHERE id = ? AND conversation_id = ?`).run(text, row.message_id, conversationId)
      this.db.prepare(`UPDATE conversation_turn_queue SET payload = ?, status = 'queued', updated_at = ? WHERE id = ?`).run(JSON.stringify(payload), this.now(), id)
    })()
    return this.listQueuedTurns(userId, conversationId)
  }

  deleteQueuedTurn(userId: string, conversationId: string, id: string): QueuedTurn[] {
    this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT message_id FROM conversation_turn_queue WHERE id = ? AND conversation_id = ? AND user_id = ? AND status IN ('queued','failed')`
      ).get(id, conversationId, userId) as { message_id: string } | undefined
      if (!row) return
      this.db.prepare(`DELETE FROM conversation_turn_queue WHERE id = ?`).run(id)
      this.db.prepare(`DELETE FROM messages WHERE id = ? AND conversation_id = ?`).run(row.message_id, conversationId)
    })()
    return this.listQueuedTurns(userId, conversationId)
  }

  /** Идемпотентно повышает ожидающий элемент до первого места, не трогая активный ход. */
  prioritizeQueuedTurn(userId: string, conversationId: string, id: string): QueuedTurn[] {
    this.db.transaction(() => {
      const selected = this.db.prepare(
        `SELECT position FROM conversation_turn_queue
         WHERE id = ? AND conversation_id = ? AND user_id = ? AND status IN ('queued','failed')`
      ).get(id, conversationId, userId) as { position: number } | undefined
      if (!selected) return
      const first = this.db.prepare(
        `SELECT MIN(position) AS position FROM conversation_turn_queue
         WHERE conversation_id = ? AND user_id = ? AND status IN ('queued','failed')`
      ).get(conversationId, userId) as { position: number | null }
      if (first.position === null || selected.position === first.position) return
      // UNIQUE(conversation_id, position) проверяется SQLite после каждой строки,
      // поэтому переставляем через заведомо свободный отрицательный/временный диапазон.
      this.db.prepare(`UPDATE conversation_turn_queue SET position = -1, updated_at = ? WHERE id = ?`)
        .run(this.now(), id)
      this.db.prepare(
        `UPDATE conversation_turn_queue SET position = position + 1000000, updated_at = ?
         WHERE conversation_id = ? AND user_id = ? AND status IN ('queued','failed') AND position < ? AND position >= 0`
      ).run(this.now(), conversationId, userId, selected.position)
      this.db.prepare(
        `UPDATE conversation_turn_queue SET position = position - 999999
         WHERE conversation_id = ? AND user_id = ? AND position >= 1000000`
      ).run(conversationId, userId)
      this.db.prepare(
        `UPDATE conversation_turn_queue SET position = ?, status = 'queued', updated_at = ? WHERE id = ?`
      ).run(first.position, this.now(), id)
    })()
    return this.listQueuedTurns(userId, conversationId)
  }

  /** Атомарно применяет полный порядок, только если набор элементов не изменился. */
  reorderQueuedTurns(userId: string, conversationId: string, ids: string[]): QueuedTurn[] {
    this.db.transaction(() => {
      if (!this.ownsConversation(userId, conversationId) || new Set(ids).size !== ids.length) return
      const current = this.db.prepare(
        `SELECT id FROM conversation_turn_queue
         WHERE user_id = ? AND conversation_id = ? AND status IN ('queued','failed')
         ORDER BY position, created_at`
      ).all(userId, conversationId) as Array<{ id: string }>
      if (current.length !== ids.length || current.some((row) => !ids.includes(row.id))) return
      const now = this.now()
      // Уникальный индекс проверяется построчно, поэтому сначала переносим все
      // позиции во временный отрицательный диапазон, затем назначаем 1..N.
      this.db.prepare(
        `UPDATE conversation_turn_queue SET position = -(position + 1000000), updated_at = ?
         WHERE user_id = ? AND conversation_id = ? AND status IN ('queued','failed')`
      ).run(now, userId, conversationId)
      const update = this.db.prepare(
        `UPDATE conversation_turn_queue SET position = ?, status = 'queued', updated_at = ?
         WHERE id = ? AND user_id = ? AND conversation_id = ?`
      )
      ids.forEach((id, index) => update.run(index + 1, now, id, userId, conversationId))
    })()
    return this.listQueuedTurns(userId, conversationId)
  }

  /**
   * Атомарно присоединяет выбранную ожидающую реплику к активной пользовательской
   * реплике. Скрытое сообщение и строка очереди удаляются, активное сохраняет id
   * и позицию истории, а CLI-сессия сбрасывается для чистого перезапуска.
   */
  mergeQueuedTurnIntoMessage(
    userId: string,
    conversationId: string,
    id: string,
    activeMessageId: string,
    activePayload: QueueTurnPayload
  ): { message: Message; payload: QueueTurnPayload; replacedMessageIds: [string, string] } | null {
    return this.db.transaction(() => {
      if (!this.ownsConversation(userId, conversationId)) return null
      const queued = this.db.prepare(
        `SELECT q.message_id, q.payload, m.text, m.attachments
           FROM conversation_turn_queue q
           JOIN messages m ON m.id = q.message_id AND m.conversation_id = q.conversation_id
          WHERE q.id = ? AND q.conversation_id = ? AND q.user_id = ?
            AND q.status IN ('queued','failed')`
      ).get(id, conversationId, userId) as { message_id: string; payload: string; text: string; attachments: string | null } | undefined
      const active = this.db.prepare(
        `SELECT role, text, attachments, time, exec_target FROM messages
          WHERE id = ? AND conversation_id = ? AND state = 'published' AND role <> 'ai'`
      ).get(activeMessageId, conversationId) as { role: MessageRole; text: string; attachments: string | null; time: string; exec_target: string | null } | undefined
      if (!queued || !active || queued.message_id === activeMessageId) return null

      let queuedPayload: QueueTurnPayload
      try { queuedPayload = JSON.parse(queued.payload) as QueueTurnPayload } catch { return null }
      const parseDetails = (value: string | null): MessageAttachment[] => {
        try { return value ? JSON.parse(value) as MessageAttachment[] : [] } catch { return [] }
      }
      // Не дедуплицируем: одинаковая ссылка в двух сообщениях остаётся двумя
      // упорядоченными позициями, как и передал пользователь.
      const details = [...parseDetails(active.attachments), ...parseDetails(queued.attachments)]
      const payload: QueueTurnPayload = {
        ...activePayload,
        ...queuedPayload,
        segments: [...activePayload.segments, ...queuedPayload.segments],
        attachments: [...(activePayload.attachments ?? []), ...(queuedPayload.attachments ?? [])]
      }
      const text = [active.text.trim(), queued.text.trim()].filter(Boolean).join('\n\n')
      const messageId = this.newId()
      const createdAt = this.now()
      const historyPosition = (this.db.prepare(
        `SELECT COALESCE(MAX(history_position), 0) + 1 AS position FROM messages WHERE conversation_id = ? AND state = 'published'`
      ).get(conversationId) as { position: number }).position

      this.db.prepare(`DELETE FROM conversation_turn_queue WHERE id = ?`).run(id)
      this.db.prepare(`DELETE FROM messages WHERE id IN (?, ?) AND conversation_id = ?`)
        .run(activeMessageId, queued.message_id, conversationId)
      this.db.prepare(
        `INSERT INTO messages (id, conversation_id, role, text, time, created_at, exec_target, attachments, state, history_position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`
      ).run(messageId, conversationId, active.role, text, active.time, createdAt, active.exec_target,
        details.length ? JSON.stringify(details) : null, historyPosition)
      this.db.prepare(`UPDATE conversations SET claude_session_id = NULL, updated_at = ? WHERE id = ? AND user_id = ?`)
        .run(createdAt, conversationId, userId)

      const message = this.listMessages(userId, conversationId).find((item) => item.id === messageId)
      if (!message) throw new Error('merged message not found')
      return { message, payload, replacedMessageIds: [activeMessageId, queued.message_id] as [string, string] }
    })()
  }

  takeQueuedTurn(userId: string, conversationId: string, id?: string, publish = true): { id: string; messageId: string; payload: QueueTurnPayload; message: Message } | null {
    return this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT id, message_id, payload FROM conversation_turn_queue
         WHERE user_id = ? AND conversation_id = ? AND status = 'queued'
           AND (? IS NULL OR id = ?)
         ORDER BY position LIMIT 1`
      ).get(userId, conversationId, id ?? null, id ?? null) as { id: string; message_id: string; payload: string } | undefined
      if (!row) return null
      const position = (this.db.prepare(
        `SELECT COALESCE(MAX(history_position), 0) + 1 AS position FROM messages WHERE conversation_id = ? AND state = 'published'`
      ).get(conversationId) as { position: number }).position
      this.db.prepare(`UPDATE messages SET state = 'published', history_position = ? WHERE id = ? AND conversation_id = ? AND state = 'queued'`)
        .run(position, row.message_id, conversationId)
      this.db.prepare(`DELETE FROM conversation_turn_queue WHERE id = ?`).run(row.id)
      const message = this.listMessages(userId, conversationId).find((item) => item.id === row.message_id)
      if (!message) throw new Error('queued message not found')
      if (!publish) {
        this.db.prepare(`UPDATE messages SET state = 'queued', history_position = NULL WHERE id = ? AND conversation_id = ?`).run(row.message_id, conversationId)
      }
      return { id: row.id, messageId: row.message_id, payload: JSON.parse(row.payload) as QueueTurnPayload, message }
    })()
  }

  markQueuedTurnFailed(userId: string, conversationId: string, messageId: string): void {
    this.db.prepare(
      `UPDATE conversation_turn_queue SET status = 'failed', updated_at = ? WHERE user_id = ? AND conversation_id = ? AND message_id = ?`
    ).run(this.now(), userId, conversationId, messageId)
  }

  addMessage(
    userId: string,
    conversationId: string,
    role: MessageRole,
    text: string,
    time: string,
    engine?: LlmProvider,
    meta?: TurnMeta,
    execTarget?: string | null,
    attachments?: MessageAttachment[],
    requestedId?: string
  ): Message {
    if (!this.ownsConversation(userId, conversationId)) {
      throw new Error(`Разговор ${conversationId} не принадлежит пользователю`)
    }
    const id = requestedId ?? this.newId()
    const existing = requestedId
      ? this.db.prepare(`SELECT * FROM messages WHERE id = ? AND conversation_id = ?`).get(requestedId, conversationId) as MessageRow | undefined
      : undefined
    if (existing) {
      return {
        id: existing.id,
        conversationId: existing.conversation_id,
        role: existing.role as MessageRole,
        text: existing.text,
        time: existing.time,
        createdAt: existing.created_at,
        ...(existing.engine ? { engine: existing.engine as LlmProvider } : {}),
        ...(existing.meta ? { meta: parseMeta(existing.meta) } : {}),
        ...(existing.exec_target !== null ? { execTarget: existing.exec_target } : {}),
        ...(parseAttachments(existing.attachments) ? { attachments: parseAttachments(existing.attachments) } : {})
      }
    }
    const createdAt = this.now()
    const insert = this.db.prepare(
      `INSERT INTO messages (id, conversation_id, role, text, time, created_at, engine, meta, exec_target, attachments, state, history_position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`
    )
    const touch = this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
    const metaJson = meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : null
    this.db.transaction(() => {
      const position = (this.db.prepare(
        `SELECT COALESCE(MAX(history_position), 0) + 1 AS position FROM messages WHERE conversation_id = ? AND state = 'published'`
      ).get(conversationId) as { position: number }).position
      insert.run(id, conversationId, role, text, time, createdAt, engine ?? null, metaJson, execTarget ?? null, attachments?.length ? JSON.stringify(attachments) : null, position)
      touch.run(createdAt, conversationId)
    })()
    return {
      id,
      conversationId,
      role,
      text,
      time,
      createdAt,
      ...(engine ? { engine } : {}),
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
      ...(execTarget !== undefined ? { execTarget } : {}),
      ...(attachments?.length ? { attachments } : {})
    }
  }

  /** Заменяет метаданные сообщения и возвращает актуальную запись. */
  updateMessageMeta(userId: string, conversationId: string, messageId: string, meta: TurnMeta): Message {
    if (!this.ownsConversation(userId, conversationId)) throw new Error('message not found')
    const result = this.db
      .prepare(`UPDATE messages SET meta = ? WHERE id = ? AND conversation_id = ?`)
      .run(Object.keys(meta).length ? JSON.stringify(meta) : null, messageId, conversationId)
    if (!result.changes) throw new Error('message not found')
    const message = this.listMessages(userId, conversationId).find((item) => item.id === messageId)
    if (!message) throw new Error('message not found')
    return message
  }

  /** Удаляет одно сообщение по id (в рамках разговора пользователя). */
  deleteMessage(userId: string, conversationId: string, messageId: string): void {
    if (!this.ownsConversation(userId, conversationId)) return
    this.db
      .prepare(`DELETE FROM messages WHERE id = ? AND conversation_id = ?`)
      .run(messageId, conversationId)
  }

  listMessages(userId: string, conversationId: string): Message[] {
    if (!this.ownsConversation(userId, conversationId)) return []
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE conversation_id = ? AND state = 'published' ORDER BY history_position ASC, id ASC`
      )
      .all(conversationId) as MessageRow[]
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role as MessageRole,
      text: r.text,
      time: r.time,
      createdAt: r.created_at,
      ...(r.engine ? { engine: r.engine as LlmProvider } : {}),
      ...(r.meta ? { meta: parseMeta(r.meta) } : {}),
      ...(r.exec_target !== null ? { execTarget: r.exec_target } : {}),
      ...(parseAttachments(r.attachments) ? { attachments: parseAttachments(r.attachments) } : {})
    }))
  }

  /**
   * Ищет сообщения пользователя по индексу `messages_fts`.
   *
   * Владелец фильтруется джойном на `conversations.user_id` — чужие сообщения
   * недостижимы при любых параметрах (в том числе при явном `conversationId`).
   * Порядок — bm25 (меньше = релевантнее), при равенстве — по rowid, чтобы
   * страницы не «дышали»: курсор кодирует именно эту пару.
   *
   * `projectId`: undefined — по всем беседам, null — только беседы без проекта.
   * Сообщения чатов отменённых задач исключаются до LIMIT/курсора; прямой поиск
   * внутри такого разговора намеренно не превращает его в стандартную выборку.
   */
  searchMessages(userId: string, opts: MessageSearchOptions): MessageSearchResult {
    const match = toFtsMatchQuery(opts.q ?? '')
    const limit = clampSearchLimit(opts.limit)
    // Индекса нет (сборка SQLite без FTS5) или искать нечего — пустая страница.
    if (!match || !this.ftsReady) return { hits: [], nextCursor: null, match }

    const where = ['messages_fts MATCH ?', 'c.user_id = ?', "m.state = 'published'", NOT_CANCELLED_TASK_CHAT]
    const params: unknown[] = [match, userId]
    if (opts.projectId !== undefined) {
      if (opts.projectId === null) where.push('c.project_id IS NULL')
      else {
        where.push('c.project_id = ?')
        params.push(opts.projectId)
      }
    }
    if (opts.conversationId) {
      where.push('m.conversation_id = ?')
      params.push(opts.conversationId)
    }
    const cursor = decodeSearchCursor(opts.cursor)
    if (cursor) {
      where.push('(bm25(messages_fts) > ? OR (bm25(messages_fts) = ? AND m.rowid > ?))')
      params.push(cursor.score, cursor.score, cursor.rowid)
    }

    const rows = this.db
      .prepare(
        `SELECT m.id            AS message_id,
                m.conversation_id,
                m.role,
                m.created_at,
                m.time,
                m.rowid         AS rid,
                c.title         AS conversation_title,
                c.project_id,
                bm25(messages_fts) AS score,
                snippet(messages_fts, 0, '<mark>', '</mark>', '…', ${SNIPPET_TOKENS}) AS snippet
           FROM messages_fts
           JOIN messages m      ON m.rowid = messages_fts.rowid
           JOIN conversations c ON c.id = m.conversation_id
          WHERE ${where.join(' AND ')}
          ORDER BY score ASC, rid ASC
          LIMIT ?`
      )
      .all(...params, limit) as MessageSearchRow[]

    const hits: MessageSearchHit[] = rows.map((r) => ({
      messageId: r.message_id,
      conversationId: r.conversation_id,
      conversationTitle: r.conversation_title,
      projectId: r.project_id,
      role: r.role as MessageRole,
      createdAt: r.created_at,
      time: r.time,
      snippet: r.snippet,
      score: r.score
    }))
    // Полная страница — предполагаем продолжение: следующий запрос либо добьёт
    // остаток, либо вернёт пусто. Это дешевле, чем считать общее число совпадений.
    const last = rows[rows.length - 1]
    const nextCursor = last && rows.length === limit ? encodeSearchCursor(last.score, last.rid) : null
    return { hits, nextCursor, match }
  }

  /**
   * Подключает FTS5-индекс: DDL с триггерами + запуск бэкфилла истории.
   * Вызывается на каждом старте и обязана быть идемпотентной.
   */
  setupMessagesFts(): void {
    try {
      this.db.exec(MESSAGES_FTS_SQL)
      this.ftsReady = true
    } catch {
      // SQLite без FTS5: поиск по сообщениям недоступен, но сервер поднимается —
      // остальная БД работоспособна, а роут вернёт пустой результат.
      this.ftsReady = false
      return
    }
    const state = this.ftsState()
    if (!state) {
      // Первый старт с индексом (новая БД или миграция боевой): историю
      // проиндексируем порциями, чтобы не держать старт на 100k сообщений.
      this.db.prepare(`INSERT INTO fts_state (name, last_rowid, max_rowid, done) VALUES (?, 0, 0, 0)`).run(FTS_MESSAGES)
    }
    this.scheduleFtsBackfill()
  }

  private ftsState(): FtsStateRow | undefined {
    return this.db
      .prepare(`SELECT last_rowid AS lastRowid, max_rowid AS maxRowid, done, repairs FROM fts_state WHERE name = ?`)
      .get(FTS_MESSAGES) as FtsStateRow | undefined
  }

  /**
   * Ставит следующую порцию бэкфилла в очередь макротаска. Таймер `unref`-нут:
   * незаконченный бэкфилл не должен держать процесс живым (важно и в тестах).
   */
  private scheduleFtsBackfill(): void {
    if (this.closed || !this.ftsReady || this.ftsTimer) return
    const state = this.ftsState()
    if (!state || state.done) return
    const timer = setTimeout(() => {
      this.ftsTimer = null
      try {
        const res = this.backfillMessagesFts()
        if (!res.done) this.scheduleFtsBackfill()
      } catch {
        // Бэкфилл — не критичный путь: недоиндексированная история просто не
        // находится. Сервер и запись сообщений при этом целы.
      }
    }, FTS_BACKFILL_PAUSE_MS)
    timer.unref?.()
    this.ftsTimer = timer
  }

  /**
   * Одна порция бэкфилла (открыта для тестов и разогрева).
   *
   * Границу `max_rowid` фиксируем на старте: всё, что появилось позже, уже
   * проиндексировано триггерами, и повторная вставка тех же rowid раздула бы
   * индекс дублями. Старт с нуля начинается с `delete-all`, поэтому повторный
   * запуск (или потерянное состояние) пересобирает индекс, а не удваивает его.
   */
  backfillMessagesFts(chunk = FTS_BACKFILL_CHUNK): { indexed: number; done: boolean } {
    if (this.closed || !this.ftsReady) return { indexed: 0, done: true }
    const state = this.ftsState()
    if (!state || state.done) return { indexed: 0, done: true }

    let maxRowid = state.maxRowid
    if (state.lastRowid === 0) {
      this.db.exec(`INSERT INTO messages_fts (messages_fts) VALUES ('delete-all')`)
      maxRowid = (this.db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS m FROM messages`).get() as { m: number }).m
      this.db.prepare(`UPDATE fts_state SET max_rowid = ? WHERE name = ?`).run(maxRowid, FTS_MESSAGES)
    }
    const rows = this.db
      .prepare(`SELECT rowid AS rid, text FROM messages WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?`)
      .all(state.lastRowid, maxRowid, chunk) as Array<{ rid: number; text: string }>

    const insert = this.db.prepare(`INSERT INTO messages_fts (rowid, text) VALUES (?, ?)`)
    const done = rows.length < chunk
    const lastRowid = rows.length ? rows[rows.length - 1].rid : state.lastRowid
    this.db.transaction(() => {
      for (const r of rows) insert.run(r.rid, r.text)
      this.db
        .prepare(`UPDATE fts_state SET last_rowid = ?, done = ? WHERE name = ?`)
        .run(lastRowid, done ? 1 : 0, FTS_MESSAGES)
    })()
    if (done && rows.length > 0) this.verifyMessagesFts()
    return { indexed: rows.length, done }
  }

  /** Догоняет бэкфилл целиком (тесты и bench: им нужен готовый индекс). */
  ensureMessagesIndexed(): void {
    for (let i = 0; i < FTS_BACKFILL_MAX_CHUNKS; i++) {
      if (this.backfillMessagesFts().done) return
    }
  }

  /**
   * Проверяет индекс после бэкфилла. Удаление сообщения в момент бэкфилла может
   * оставить в индексе мусор (триггер удаляет то, чего там ещё нет), поэтому
   * один раз честно пересобираем — иначе поиск начнёт врать молча.
   */
  private verifyMessagesFts(): void {
    const state = this.ftsState()
    if (!state) return
    try {
      this.db.exec(`INSERT INTO messages_fts (messages_fts) VALUES ('integrity-check')`)
    } catch {
      if (state.repairs >= FTS_MAX_REPAIRS) return
      this.db
        .prepare(`UPDATE fts_state SET last_rowid = 0, max_rowid = 0, done = 0, repairs = repairs + 1 WHERE name = ?`)
        .run(FTS_MESSAGES)
      this.scheduleFtsBackfill()
    }
  }

  /** Идемпотентно переносит legacy-разговоры desktop, сохраняя id и даты. */
  importDesktopData(userId: string, bundle: DesktopMigrationBundle): DesktopMigrationResult {
    const insertConversation = this.db.prepare(`INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at, claude_session_id, user_id, exec_target, workdir, skill_names, llm_provider, llm_model) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', NULL, NULL)`)
    const insertMessage = this.db.prepare(`INSERT OR IGNORE INTO messages (id, conversation_id, role, text, time, created_at, engine, meta, exec_target) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    let conversationsImported = 0
    let messagesImported = 0
    this.db.transaction(() => {
      for (const item of bundle.conversations) {
        const c = item.conversation
        conversationsImported += Number(insertConversation.run(c.id, c.title, c.createdAt, c.updatedAt, c.claudeSessionId, userId, c.execTarget).changes)
        if (!this.ownsConversation(userId, c.id)) continue
        for (const m of item.messages) {
          if (m.conversationId !== c.id) continue
          messagesImported += Number(insertMessage.run(m.id, c.id, m.role, m.text, m.time, m.createdAt, m.engine ?? null, m.meta ? JSON.stringify(m.meta) : null, m.execTarget ?? null).changes)
        }
      }
    })()
    return { conversationsImported, messagesImported }
  }

  /**
   * Число разговоров у каждого пользователя одним запросом. Админу показываются
   * все беседы, включая чаты завершённых задач: их скрытие — фильтр сайдбара
   * владельца, а не свойство данных.
   */
  conversationCounts(): Map<string, number> {
    const rows = this.db.prepare(`SELECT c.user_id AS user, COUNT(*) AS total FROM conversations c
      WHERE (c.assistant_kind IS NULL OR c.assistant_kind IN ('web-recorder', 'playwright-reader', 'console-reader', 'make'))
        AND ${NOT_CANCELLED_TASK_CHAT}
      GROUP BY c.user_id`).all() as { user: string; total: number }[]
    return new Map(rows.map((row) => [row.user, row.total]))
  }

  /**
   * Отчёт по использованию токенов пользователя: суммы по временным бакетам и по
   * моделям + итог. Считается из meta ai-сообщений (JSON1 json_extract). Бакеты
   * времени — в UTC (created_at хранится в мс).
   */
  usageReport(userId: string, unit: UsageUnit, from?: number, to?: number, conversationId?: string): UsageReport {
    const fmt = unit === 'hour' ? '%Y-%m-%d %H:00' : unit === 'week' ? '%Y-W%W' : '%Y-%m-%d'
    // Два независимых числа: CLI сообщает фактическую цену не для всех движков,
    // а редактируемый прайс пересчитывает все ответы с известной строкой.
    const estimatedCost = `CASE WHEN mp.model IS NOT NULL THEN (
      MAX(COALESCE(json_extract(m.meta,'$.inputTokens'),0) - COALESCE(json_extract(m.meta,'$.cacheReadTokens'),0), 0) * mp.input_per_million +
      COALESCE(json_extract(m.meta,'$.cacheReadTokens'),0) * mp.cached_input_per_million +
      COALESCE(json_extract(m.meta,'$.cacheCreationTokens'),0) * mp.cache_write_per_million +
      COALESCE(json_extract(m.meta,'$.outputTokens'),0) * mp.output_per_million
    ) / 1000000.0 END`
    const sums = `
      COUNT(*) AS messages,
      COALESCE(SUM(json_extract(m.meta,'$.inputTokens')),0) AS inputTokens,
      COALESCE(SUM(json_extract(m.meta,'$.outputTokens')),0) AS outputTokens,
      COALESCE(SUM(json_extract(m.meta,'$.cacheReadTokens')),0) AS cacheReadTokens,
      COALESCE(SUM(json_extract(m.meta,'$.costUsd')),0) AS costUsd,
      COALESCE(SUM(${estimatedCost}),0) AS costFromPrices,
      COALESCE(SUM(CASE WHEN json_extract(m.meta,'$.interrupted') THEN 1 ELSE 0 END),0) AS interrupted,
      MAX(CASE WHEN json_extract(m.meta,'$.costUsd') IS NULL AND mp.model IS NULL THEN 1 ELSE 0 END) AS costIncomplete`
    const dateWhere = `${from !== undefined ? 'AND m.created_at >= @from' : ''}
      ${to !== undefined ? 'AND m.created_at <= @to' : ''}`
    const where = `c.user_id = @userId AND m.role = 'ai' AND m.meta IS NOT NULL ${dateWhere}
      ${conversationId ? 'AND c.id = @conversationId' : ''}`
    const bind = { userId, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), ...(conversationId ? { conversationId } : {}) }
    const joins = `FROM messages m JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN model_prices mp ON mp.provider = m.engine AND mp.model = COALESCE(json_extract(m.meta,'$.model'), c.llm_model)`

    type SqlUsage<T extends UsageTotals> = Omit<T, 'costIncomplete'> & { costIncomplete?: number }
    const complete = <T extends UsageTotals>(row: SqlUsage<T>): T => ({ ...row, costIncomplete: Boolean(row.costIncomplete) } as T)
    const totals = complete(this.db.prepare(`SELECT ${sums} ${joins} WHERE ${where}`).get(bind) as SqlUsage<UsageTotals>)
    const byBucket = (this.db.prepare(`SELECT strftime('${fmt}', m.created_at/1000, 'unixepoch') AS bucket, ${sums}
      ${joins} WHERE ${where} GROUP BY bucket ORDER BY bucket ASC`).all(bind) as SqlUsage<UsageBucket>[]).map((row) => complete<UsageBucket>(row))
    const byModel = (this.db.prepare(`SELECT COALESCE(json_extract(m.meta,'$.model'), c.llm_model, '?') AS model, ${sums}
      ${joins} WHERE ${where} GROUP BY COALESCE(json_extract(m.meta,'$.model'), c.llm_model, '?') ORDER BY outputTokens DESC`).all(bind) as SqlUsage<UsageByModel>[]).map((row) => complete<UsageByModel>(row))
    // Фильтр разговоров всегда строится для всего выбранного периода, чтобы после
    // выбора одного разговора остальные варианты не исчезали из селекта.
    const conversationWhere = `c.user_id = @userId AND m.role = 'ai' AND m.meta IS NOT NULL ${dateWhere}`
    const byConversation = (this.db.prepare(`SELECT c.id AS conversationId, c.title, ${sums}
      ${joins} WHERE ${conversationWhere} GROUP BY c.id, c.title ORDER BY costUsd DESC, c.updated_at DESC`).all(bind) as SqlUsage<UsageByConversation>[]).map((row) => complete<UsageByConversation>(row))
    return { unit, conversationId: conversationId ?? null, totals, byBucket, byModel, byConversation }
  }

  /**
   * Один SQL-проход для дашборда: итоги и использованные модели всех пользователей.
   * В отличие от вызова usageReport на каждого пользователя не создаёт N запросов.
   */
  usageSummary(from?: number, to?: number): import('@voicechat/shared').UserUsageSummary[] {
    const estimatedCost = `CASE WHEN mp.model IS NOT NULL THEN (
      MAX(COALESCE(json_extract(m.meta,'$.inputTokens'),0) - COALESCE(json_extract(m.meta,'$.cacheReadTokens'),0), 0) * mp.input_per_million +
      COALESCE(json_extract(m.meta,'$.cacheReadTokens'),0) * mp.cached_input_per_million +
      COALESCE(json_extract(m.meta,'$.cacheCreationTokens'),0) * mp.cache_write_per_million +
      COALESCE(json_extract(m.meta,'$.outputTokens'),0) * mp.output_per_million
    ) / 1000000.0 END`
    const sums = `COUNT(*) AS messages,
      COALESCE(SUM(json_extract(m.meta,'$.inputTokens')),0) AS inputTokens,
      COALESCE(SUM(json_extract(m.meta,'$.outputTokens')),0) AS outputTokens,
      COALESCE(SUM(json_extract(m.meta,'$.cacheReadTokens')),0) AS cacheReadTokens,
      COALESCE(SUM(json_extract(m.meta,'$.costUsd')),0) AS costUsd,
      COALESCE(SUM(${estimatedCost}),0) AS costFromPrices,
      COALESCE(SUM(CASE WHEN json_extract(m.meta,'$.interrupted') THEN 1 ELSE 0 END),0) AS interrupted,
      MAX(CASE WHEN json_extract(m.meta,'$.costUsd') IS NULL AND mp.model IS NULL THEN 1 ELSE 0 END) AS costIncomplete`
    const where = `m.role = 'ai' AND m.meta IS NOT NULL ${from !== undefined ? 'AND m.created_at >= @from' : ''} ${to !== undefined ? 'AND m.created_at <= @to' : ''}`
    const bind = { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) }
    const joins = `FROM messages m JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN model_prices mp ON mp.provider = m.engine AND mp.model = COALESCE(json_extract(m.meta,'$.model'), c.llm_model)`
    type Row = UsageTotals & { name: string; model?: string; costIncomplete?: number }
    const complete = (row: Row): UsageTotals => ({ inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheReadTokens, costUsd: row.costUsd, costFromPrices: row.costFromPrices, messages: row.messages, interrupted: row.interrupted ?? 0, costIncomplete: Boolean(row.costIncomplete) })
    const totals = this.db.prepare(`SELECT c.user_id AS name, ${sums} ${joins} WHERE ${where} GROUP BY c.user_id`).all(bind) as Row[]
    const models = this.db.prepare(`SELECT c.user_id AS name, COALESCE(json_extract(m.meta,'$.model'), c.llm_model, '?') AS model, ${sums} ${joins} WHERE ${where} GROUP BY c.user_id, model ORDER BY outputTokens DESC`).all(bind) as Row[]
    const byName = new Map<string, import('@voicechat/shared').UserUsageSummary>()
    for (const user of this.repos.identity.listUsers()) byName.set(user.name, { name: user.name, totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, costFromPrices: 0, messages: 0, interrupted: 0, costIncomplete: false }, byModel: [] })
    // Строка расхода без учётки в users — след удалённого пользователя; такую
    // сводку показывать некому, но и падать на ней сводке дашборда нельзя.
    for (const row of totals) { const summary = byName.get(row.name); if (summary) summary.totals = complete(row) }
    for (const row of models) byName.get(row.name)?.byModel.push({ model: row.model ?? '?', ...complete(row) })
    return [...byName.values()]
  }

  getConversationWorkspace(conversationId: string): WorkspaceView | null {
    const row = this.db.prepare(`SELECT mode, base_sha, branch, repository_path, state, diagnostic
      FROM conversation_workspaces WHERE conversation_id = ?`).get(conversationId) as {
        mode: WorkspaceView['mode']; base_sha: string; branch: string; repository_path: string
        state: WorkspaceView['state']; diagnostic: string | null
      } | undefined
    return row ? {
      mode: row.mode,
      baseSha: row.base_sha,
      branch: row.branch,
      path: row.repository_path,
      readOnly: row.mode === 'shared_main',
      state: row.state,
      diagnostic: row.diagnostic
    } : null
  }

  saveConversationWorkspace(binding: {
    conversationId: string; projectId: string; machineId: string; storageId: string
    mode: 'chat_workspace' | 'task_workspace'; baseSha: string; branch: string
    repositoryPath: string; state: WorkspaceView['state']; diagnostic?: string | null
  }): WorkspaceView {
    if (!/^[0-9a-f]{40}$/i.test(binding.baseSha)) throw new Error('Некорректный baseSha workspace')
    this.db.prepare(`INSERT INTO conversation_workspaces
      (conversation_id,project_id,machine_id,storage_id,mode,base_sha,branch,repository_path,state,diagnostic,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        project_id=excluded.project_id,machine_id=excluded.machine_id,storage_id=excluded.storage_id,
        mode=excluded.mode,base_sha=excluded.base_sha,branch=excluded.branch,
        repository_path=excluded.repository_path,state=excluded.state,
        diagnostic=excluded.diagnostic,updated_at=excluded.updated_at`).run(
          binding.conversationId,binding.projectId,binding.machineId,binding.storageId,binding.mode,
          binding.baseSha,binding.branch,binding.repositoryPath,binding.state,binding.diagnostic ?? null,this.now()
        )
    return this.getConversationWorkspace(binding.conversationId)!
  }

  clearConversationWorkspace(conversationId: string): boolean {
    return this.db.prepare('DELETE FROM conversation_workspaces WHERE conversation_id = ?').run(conversationId).changes > 0
  }

  private conversationCosts(rows: ConversationRow[]): Map<string, Pick<Conversation, 'costUsd' | 'costStatus'>> {
    const unknown = (): Pick<Conversation, 'costUsd' | 'costStatus'> => ({ costUsd: null, costStatus: 'unknown' })
    const costs = new Map(rows.map((row) => [row.id, unknown()]))
    if (rows.length === 0) return costs
    try {
      // Считаем только протухшие беседы: у остальных берём кэш, посчитанный на
      // прошлом показе. Полный агрегат сканирует все AI-сообщения беседы и
      // разбирает JSON каждого — на списке это 95% его времени.
      const stamp = this.repos.llm.modelPricesStamp()
      const stale: string[] = []
      for (const row of rows) {
        if (row.cost_dirty === 0 && row.cost_prices_stamp === stamp && row.cost_status) {
          costs.set(row.id, { costUsd: row.cost_status === 'known' ? row.cost_usd ?? 0 : null, costStatus: row.cost_status as Conversation['costStatus'] })
        } else stale.push(row.id)
      }
      if (stale.length === 0) return costs
      const ids = stale
      const placeholders = ids.map(() => '?').join(',')
      const results = this.db.prepare(`SELECT
        m.conversation_id AS conversation_id,
        COUNT(*) AS ai_count,
        SUM(CASE WHEN json_valid(m.meta)
          AND json_type(m.meta, '$.inputTokens') IN ('integer', 'real')
          AND json_type(m.meta, '$.outputTokens') IN ('integer', 'real')
          AND (json_type(m.meta, '$.cacheReadTokens') IS NULL OR json_type(m.meta, '$.cacheReadTokens') IN ('integer', 'real'))
          AND (json_type(m.meta, '$.cacheCreationTokens') IS NULL OR json_type(m.meta, '$.cacheCreationTokens') IN ('integer', 'real'))
          AND mp.model IS NOT NULL THEN 1 ELSE 0 END) AS known_count,
        SUM(CASE WHEN json_valid(m.meta)
          AND json_type(m.meta, '$.inputTokens') IN ('integer', 'real')
          AND json_type(m.meta, '$.outputTokens') IN ('integer', 'real')
          AND (json_type(m.meta, '$.cacheReadTokens') IS NULL OR json_type(m.meta, '$.cacheReadTokens') IN ('integer', 'real'))
          AND (json_type(m.meta, '$.cacheCreationTokens') IS NULL OR json_type(m.meta, '$.cacheCreationTokens') IN ('integer', 'real'))
          AND mp.model IS NOT NULL THEN (
            MAX(COALESCE(json_extract(m.meta,'$.inputTokens'),0) - COALESCE(json_extract(m.meta,'$.cacheReadTokens'),0), 0) * mp.input_per_million +
            COALESCE(json_extract(m.meta,'$.cacheReadTokens'),0) * mp.cached_input_per_million +
            COALESCE(json_extract(m.meta,'$.cacheCreationTokens'),0) * mp.cache_write_per_million +
            COALESCE(json_extract(m.meta,'$.outputTokens'),0) * mp.output_per_million
          ) / 1000000.0 END) AS cost_usd
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        LEFT JOIN model_prices mp
          ON mp.provider = m.engine
         AND mp.model = COALESCE(CASE WHEN json_valid(m.meta) THEN json_extract(m.meta,'$.model') END, c.llm_model)
        WHERE m.conversation_id IN (${placeholders}) AND m.role = 'ai'
        GROUP BY m.conversation_id`).all(...ids) as Array<{
          conversation_id: string; ai_count: number; known_count: number | null; cost_usd: number | null
        }>
      const remember = this.db.prepare(
        `UPDATE conversations SET cost_usd = ?, cost_status = ?, cost_prices_stamp = ?, cost_dirty = 0 WHERE id = ?`
      )
      const computed = new Map(results.map((result) => [result.conversation_id, result]))
      for (const id of ids) {
        const result = computed.get(id)
        const aiCount = result?.ai_count ?? 0
        const knownCount = result?.known_count ?? 0
        const costStatus = aiCount === 0 || knownCount === 0
          ? 'unknown'
          : knownCount === aiCount ? 'known' : 'partial'
        const costUsd = costStatus === 'known' ? (result?.cost_usd ?? 0) : null
        costs.set(id, { costUsd, costStatus })
        // Беседы без единого AI-хода тоже кэшируем: иначе пустые чаты гоняли бы
        // агрегат на каждом показе списка.
        remember.run(costUsd, costStatus, stamp, id)
      }
    } catch {
      // Историческое повреждение meta или ошибка расчёта не ломают список бесед.
    }
    return costs
  }

  private conversationCost(row: ConversationRow): Pick<Conversation, 'costUsd' | 'costStatus'> {
    return this.conversationCosts([row]).get(row.id)!
  }

  private mapConversation(row: ConversationRow, messageCount: number, prefetchedCost?: Pick<Conversation, 'costUsd' | 'costStatus'>): Conversation {
    const cost = prefetchedCost ?? this.conversationCost(row)
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount,
      claudeSessionId: row.claude_session_id,
      execTarget: row.exec_target,
      workdir: row.workdir,
      workspace: this.getConversationWorkspace(row.id),
      skillNames: (() => {
        try {
          const value = JSON.parse(row.skill_names ?? '[]') as unknown
          return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
        } catch {
          return []
        }
      })(),
      llmEngineId: row.llm_engine_id ?? null,
      llmProvider: row.llm_provider === 'claude' || row.llm_provider === 'codex' ? row.llm_provider : null,
      llmModel: row.llm_model,
      // Мусор в колонке (например, откат версии) читаем как «из общих настроек».
      permissionMode:
        row.permission_mode === 'plan' || row.permission_mode === 'acceptEdits' || row.permission_mode === 'bypassPermissions'
          ? row.permission_mode
          : null,
      kbContextMode: row.kb_context_mode === 'manual' || row.kb_context_mode === 'off' ? row.kb_context_mode : 'auto',
      disabledContext: parseJsonValue<string[]>(row.disabled_context_json, []).filter((item): item is string => typeof item === 'string'),
      scope: row.scope === 'kanban' || row.scope === 'make' || row.scope === 'images' || row.scope === 'console' || row.scope === 'playwright-reader' || row.scope === 'web-reader' ? row.scope : 'chat',
      projectId: row.project_id ?? null,
      assistantKind: row.assistant_kind === 'kanban' || row.assistant_kind === 'web-recorder' || row.assistant_kind === 'playwright-reader' || row.assistant_kind === 'console-reader' || row.assistant_kind === 'make' || row.assistant_kind === 'images' ? row.assistant_kind : null,
      // Дефолт — полная автономия: ассистент задуман действующим, а не советующим.
      assistantAutonomy: row.assistant_autonomy === 'confirm' ? 'confirm' : 'auto',
      previewUrl: row.preview_url ?? null,
      projectPreviewUrl: row.project_id ? ((this.db.prepare(`SELECT preview_url FROM projects WHERE id = ?`).get(row.project_id) as { preview_url: string | null } | undefined)?.preview_url ?? null) : null,
      taskId: row.task_id ?? null,
      status: normStatus(row.status),
      ...cost,
      lastExecTarget: row.last_exec_target ?? null
    }
  }

  /** Режим применения мутаций канбан-ассистентом; тумблер «Автопилот» в шапке. */
  setConversationAutonomy(userId: string, convId: string, autonomy: 'auto' | 'confirm'): Conversation | null {
    const conversation = this.getConversation(userId, convId)
    if (!conversation) return null
    this.db.prepare(`UPDATE conversations SET assistant_autonomy = ? WHERE id = ? AND user_id = ?`).run(autonomy, convId, userId)
    return this.getConversation(userId, convId)
  }

  setConversationProject(userId: string, convId: string, projectId: string | null): Conversation | null {
    const current = this.getConversation(userId, convId)
    if (!current) return null
    if (projectId === null) {
      this.db.prepare(`UPDATE conversations SET project_id = NULL WHERE id = ? AND user_id = ?`).run(convId, userId)
      return this.getConversation(userId, convId)
    }
    const project = this.repos.projects.getProject(userId, projectId)
    if (!project) return null // не участник / проект не найден
    this.db
      .prepare(
        `UPDATE conversations SET project_id = ?, exec_target = NULL, workdir = NULL, skill_names = ?, llm_engine_id = NULL, llm_provider = NULL, llm_model = NULL WHERE id = ? AND user_id = ?`
      )
      .run(projectId, JSON.stringify(project.skills), convId, userId)
    return this.getConversation(userId, convId)
  }

  /**
   * Открыть связанный с задачей чат текущего пользователя, создав его при
   * отсутствии. Новый чат привязывается к задаче (`task_id`) и её проекту:
   * машина/папка остаются null (персональное наследование), навыки — навыки самой карточки (`Task.skills`).
   * Идемпотентно по (userId, taskId): одна задача — не более одного чата на юзера.
   * Имя по умолчанию — «Задача <заголовок>»: в общем списке чатов такой чат сразу
   * отличим от обычного разговора. Дальше его можно переименовать вручную.
   */
  openOrCreateTaskChat(userId: string, projectId: string, taskId: string): Conversation | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const task = this.repos.tasks.getTask(projectId, taskId)
    if (!task) return null
    // Связанный чат хранит только собственное переопределение; null означает
    // динамическое наследование эффективной настройки проекта.
    const existing = this.db
      .prepare(`SELECT id FROM conversations WHERE task_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 1`)
      .get(taskId, userId) as { id: string } | undefined
    if (existing) {
      this.db
        .prepare(`UPDATE conversations SET updated_at = ?, scope = 'kanban', project_id = ? WHERE id = ? AND user_id = ?`)
        .run(this.now(), projectId, existing.id, userId)
      return this.getConversation(userId, existing.id)
    }
    const id = this.newId()
    const ts = this.now()
    const title = task.title.trim() ? `Задача ${task.title.trim()}` : 'Задача'
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, claude_session_id, user_id, exec_target, workdir, skill_names, llm_engine_id, llm_provider, llm_model, project_id, task_id, scope)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'kanban')`
      )
      .run(id, title, ts, ts, userId, null, null, JSON.stringify(task.skills), null, null, null, projectId, taskId)
    return this.getConversation(userId, id)
  }

  /**
   * Может ли пользователь читать Make-проект как участник проекта. Привязка
   * Make-чата к проекту (настройки чата) и есть акт, открывающий дизайн команде:
   * иначе связанный с карточкой макет открывался бы только у своего автора.
   */
  /** Проект, к которому привязан Make-чат (роуты Make знают только conversationId). */
  makeConversationProject(conversationId: string): string | null {
    const conv = this.db
      .prepare(`SELECT project_id FROM conversations WHERE id = ? AND assistant_kind = ?`)
      .get(conversationId, MAKE_KIND) as { project_id: string | null } | undefined
    return conv?.project_id ?? null
  }

  isMakeProjectViewer(userId: string, conversationId: string): boolean {
    const conv = this.db
      .prepare(`SELECT project_id FROM conversations WHERE id = ? AND assistant_kind = ?`)
      .get(conversationId, MAKE_KIND) as { project_id: string | null } | undefined
    return Boolean(conv?.project_id && this.repos.projects.isProjectMember(userId, conv.project_id))
  }

  /** Каскад удаления аккаунта: все разговоры пользователя; messages/speakers уйдут по ON DELETE CASCADE. */
  deleteConversationsOfUser(userId: string): void {
    this.db.prepare(`DELETE FROM conversations WHERE user_id = ?`).run(userId)
  }

  /** Машина удаляется — её рабочие каталоги у разговоров больше не существуют (зовётся из machines.deleteAgent). */
  clearConversationWorkspacesOfMachine(machineId: string): void {
    this.db.prepare(`DELETE FROM conversation_workspaces WHERE machine_id = ?`).run(machineId)
  }
}

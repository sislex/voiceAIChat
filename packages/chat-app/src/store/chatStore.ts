// chatStore — разговоры, сообщения и жизненный цикл хода LLM (CHAT-236).
//
// Ключевые инварианты домена:
//  - активный ход принадлежит разговору, а не realtime-соединению: закрытие
//    сокета не завершает ход, а `claude:active` после reconnect его возвращает;
//  - все realtime-кадры адресуются `conversationId` и применяются к экрану
//    только для активного разговора; фоновому обновляются статус и список;
//  - «Новый разговор» создаёт локальный черновик, а первая отправка —
//    идемпотентно создаёт запись (ключ живёт до подтверждённого успеха);
//  - поздний ответ прошлого выбора не перетирает новый чат (`selectToken`).

import type { SttSegmentWire, UploadInfo } from '@shared/ipc'
import type { TaskChatBadge, TaskChatContext } from '@shared/projects'
import type { ActiveTurn, QueuedTurn } from '@shared/protocol'
import type { AgentInfo } from '@shared/agentProtocol'
import type { KbStatus, KbUsageQuery } from '@shared/kb'
import type { PreviewElementPayload } from '@shared/previewInspector'
import { withPreviewElementContext } from '@shared/prompt'
import { conversationToJson, conversationToMarkdown, exportFileName } from '@shared/export'
import { detectOpenUtility, toolBlock, type ToolSpec } from '@shared/tools'
import type {
  ClaudeLogEntry,
  Conversation,
  ConversationStatus,
  KbContextMode,
  LlmProvider,
  Message,
  MessageAttachment,
  MessageRole,
  MessageSearchHit,
  PermissionMode,
  Settings,
  TurnMeta,
  TurnUsage
} from '@shared/types'
import {
  applyKbUsageFrame,
  buildKbUsageFromMessages,
  emptyKbUsageCache,
  kbUsageSnapshot,
  mergeKbUsage,
  type KbUsageCache
} from '../lib/kbUsage'
import type { LoadStatus } from '../lib/loadState'
import type { LiveSegment } from '../contracts'
import type { ChatClient, DownloadPort, PreferencesPort } from '../contracts'
import { createStoreCore, type Store } from './createStore'
import { DONE_TASK_CHATS_KEY, MESSAGE_META_UPDATE_KEY, SIDEBAR_PROJECT_KEY } from '../contracts'
import { DEFAULT_DELAYS, formatTime, mockReply, titleFromText, type PipelineDelays } from './mockPipeline'

/** Область поиска в сайдбаре: названия бесед или текст сообщений (FTS5). */
export type SearchScope = 'chats' | 'messages'

/** Состояние панели поиска по сообщениям (режим «Сообщения» в сайдбаре). */
export interface MessageSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  hits: MessageSearchHit[]
  nextCursor: string | null
  loadingMore: boolean
  error: string | null
}

/** Пауза перед запросом: пользователь печатает быстрее, чем ходит сервер. */
const MESSAGE_SEARCH_DEBOUNCE_MS = 250
/** Размер страницы результатов. */
const MESSAGE_SEARCH_PAGE = 20
/**
 * Окно склейки фоновых перезапросов списка бесед: на одно событие прилетает
 * сразу несколько кадров (`ci.done` + `ci.summary` + `board.update`).
 */
export const CONVERSATIONS_REFRESH_DEBOUNCE_MS = 300
/** Ограничение роста лога консоли и накопленной активности хода. */
const CONSOLE_LOG_CAP = 500


const EMPTY_MESSAGE_SEARCH: MessageSearchState = {
  query: '',
  status: 'idle',
  hits: [],
  nextCursor: null,
  loadingMore: false,
  error: null
}

/**
 * Reader-чат: типизированный web-recorder или старый разговор с сохранённым
 * previewUrl (создан до появления `assistantKind`, но совместим с Web Reader).
 */
export function isReaderConversation(conv: Conversation): boolean {
  return conv.assistantKind === 'web-recorder' || (conv.assistantKind == null && Boolean(conv.previewUrl))
}

export function isPlaywrightReaderConversation(conv: Conversation): boolean {
  return conv.assistantKind === 'playwright-reader'
}

/** Добавляет беседу в список, если её там нет, сохраняя порядок «свежее выше». */
function withConversation(list: Conversation[], conv: Conversation): Conversation[] {
  if (list.some((c) => c.id === conv.id)) return list
  const at = list.findIndex((c) => c.updatedAt < conv.updatedAt)
  const out = [...list]
  out.splice(at < 0 ? out.length : at, 0, conv)
  return out
}

/** Текст сообщения пользователя с пометкой о вложениях (для истории). */
function composeUserText(text: string, attachments: UploadInfo[]): string {
  if (attachments.length === 0) return text
  const note = `📎 ${attachments.map((a) => a.name).join(', ')}`
  return text ? `${text}\n\n${note}` : note
}

/** Кодирует File в base64 (без префикса data:) для загрузки на сервер. */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export interface ChatState {
  conversations: Conversation[]
  /** Все reader-чаты пользователя — без фильтра сайдбара по проекту. */
  readerConversations: Conversation[]
  /** Все и только разговоры самостоятельного Playwright Reader. */
  playwrightReaderConversations: Conversation[]
  conversationsStatus: LoadStatus
  conversationsError: string | null
  searchQuery: string
  searchScope: SearchScope
  messageSearch: MessageSearchState
  /** Сообщение, к которому надо прокрутить ленту и подсветить его. */
  highlightMessageId: string | null
  activeId: string | null
  messages: Message[]
  loadingMessages: boolean
  draft: string
  /** Помощник промптов: список переформулировок черновика и состояние панели. */
  promptHelper: { open: boolean; loading: boolean; variants: string[]; error: string | null }
  attachments: UploadInfo[]
  /** Лог активности агента (режим консоли). */
  consoleLog: ClaudeLogEntry[]
  /** Активность текущего (незавершённого) хода активного разговора. */
  liveActivity: ClaudeLogEntry[]
  streamingReply: string
  /** Незавершённые ходы модели по разговорам: id → накопленный частичный текст. */
  activeTurns: Record<string, string>
  queuedTurns: Record<string, QueuedTurn[]>
  queuePaused: Record<string, boolean>
  activeActivity: Record<string, ClaudeLogEntry[]>
  lastTurnMeta: TurnMeta | null
  liveUsage: TurnUsage | null
  activeUsage: Record<string, TurnUsage>
  /** Проект сайдбара (null — «Без проекта»); фильтрует список/поиск чатов. */
  sidebarProjectId: string | null
  showDoneTaskChats: boolean
  /** Открытый чат, скрытый из отфильтрованного списка (чат завершённой задачи). */
  pinnedConversation: Conversation | null
  taskChatContext: TaskChatContext | null
  taskChatBadges: Record<string, TaskChatBadge>
  /** Телеметрия БЗ по чатам (снапшот + инкременты kb.usage). */
  kbUsage: Record<string, KbUsageCache>
  /** Телеметрия БЗ по проектам (вкладка «По проекту»). */
  kbUsageByProject: Record<string, KbUsageCache>
  kbStatus: KbStatus | null
}

export interface ChatActions {
  /** Загрузка индекса разговоров (защищённый bootstrap). */
  loadConversationIndex(): Promise<Conversation[]>
  refreshConversations(options?: { keepActiveListed?: boolean }): Promise<void>
  scheduleConversationsRefresh(): void
  retryConversations(): Promise<void>
  newConversation(assistantKind?: 'web-recorder' | 'playwright-reader'): Promise<string | null>
  /** Создаёт сохранённый чат из явной формы создания и сразу открывает его. */
  createConversation(input: { title: string; projectId?: string | null }): Promise<string>
  selectConversation(id: string): Promise<boolean>
  deleteConversation(id: string): Promise<void>
  renameConversation(id: string, title: string): Promise<void>
  setConversationExecTarget(
    id: string,
    execTarget: string | null,
    workdir?: string | null,
    skillNames?: string[],
    llmProvider?: LlmProvider | null,
    llmModel?: string | null,
    permissionMode?: PermissionMode | null,
    kbContextMode?: KbContextMode,
    llmEngineId?: string | null
  ): Promise<void>
  setConversationProject(id: string, projectId: string | null): Promise<void>
  setConversationPreviewUrl(id: string, previewUrl: string | null): Promise<void>
  setConversationStatus(id: string, status: ConversationStatus): Promise<void>
  fetchConversationMachines(id: string, projectId?: string | null): Promise<AgentInfo[]>
  setSearchQuery(query: string): Promise<void>
  setSearchScope(scope: SearchScope): Promise<void>
  retryMessageSearch(): Promise<void>
  loadMoreMessageSearch(): Promise<void>
  focusMessage(messageId: string): void
  clearMessageHighlight(): void
  setSidebarProject(projectId: string | null): Promise<void>
  setShowDoneTaskChats(show: boolean): Promise<void>
  exportConversation(format: 'md' | 'json'): void
  setDraft(value: string): void
  submitText(previewElement?: PreviewElementPayload): Promise<boolean>
  /** Готовая транскрипция из голосового домена: реплики + ход модели. */
  submitVoiceSegments(segments: LiveSegment[]): Promise<void>
  suggestPrompts(modifiers: Settings['aiAssistPrompts']): Promise<void>
  applyPromptSuggestion(text: string): void
  closePromptSuggestions(): void
  answerQuestions(text: string): Promise<void>
  executePlan(answerId: string): Promise<void>
  cancelRequest(): void
  deleteMessage(id: string): Promise<void>
  editMessage(id: string, newText: string): Promise<void>
  updateTaskLaunchStatus(messageId: string, proposalId: string, status: 'opened' | 'created' | 'declined', result?: import('@voicechat/shared').TaskLaunchResult): Promise<void>
  addAttachment(file: File): Promise<void>
  removeAttachment(id: string): void
  applyClaudeToken(delta: string, conversationId?: string): void
  applyClaudeDone(text: string, meta?: TurnMeta, engine?: LlmProvider, message?: Message, conversationId?: string): Promise<void>
  applyClaudeError(message: string, conversationId?: string): void
  applyClaudeActive(turns: ActiveTurn[]): void
  applyClaudeQueue(conversationId: string, items: QueuedTurn[], paused: boolean, published?: Message): void
  applyClaudeUsage(usage: TurnUsage, conversationId?: string): void
  applyClaudeLog(entry: ClaudeLogEntry, conversationId?: string): void
  editQueued(id: string, text: string): void
  deleteQueued(id: string): void
  sendQueuedNow(id: string): void
  applyChatMessage(conversationId: string, message: Message): void
  /** Перечитать ленту активного разговора (после ответа на паузу CI-рана). */
  reloadActiveMessages(): Promise<void>
  loadTaskChatContext(id: string): Promise<void>
  /** Открыть разговор, уже полученный с сервера (resume сессии наблюдателя). */
  adoptConversation(conversation: Conversation, messages: Message[]): Promise<void>
  loadKbUsage(conversationId: string, markViewed?: boolean): Promise<void>
  loadProjectKbUsage(projectId: string): Promise<void>
  applyKbUsageQuery(conversationId: string, projectId: string | null, query: KbUsageQuery): void
  refreshKbStatus(): Promise<void>
  /** Панель «Использование БЗ» открыта (владелец флага — shellStore). */
  setKbUsagePanelOpen(open: boolean): void
  /** Машину удалили: снять её со всех разговоров в списке. */
  forgetAgent(id: string): void
  reset(): void
}

export type ChatStore = Store<ChatState, ChatActions>

/** То, что chatStore спрашивает у голосового домена (через AppRuntime). */
export interface ChatVoicePort {
  state(): string
  dispatch(event: 'submit_text' | 'reset' | 'error' | 'reply_ready' | 'speaking_done'): boolean
  restoreThinking(): boolean
  beginTurn(): void
  speakDelta(delta: string): void
  finishStreamedTurn(): boolean
  speakReply(text: string): void
  autoSpeakActive(): boolean
  cancelSpeech(): void
  cancelTimers(): void
  resetForChatSwitch(): void
}

export interface ChatDeps {
  chat: ChatClient
  prefs: PreferencesPort
  download: DownloadPort
  voice: ChatVoicePort
  /** Настройки принадлежат settingsStore — здесь только чтение снимка. */
  getSettings: () => Settings
  /** Машины принадлежат operationsStore — нужны для распознавания команд. */
  listAgents: () => AgentInfo[]
  /** Метки чатов задач приносят и сводки ранов — их владелец другой домен. */
  onTaskBadgeRuns?: (badges: TaskChatBadge[]) => void
  /** Баннер и тосты — владелец shellStore. */
  setError?: (message: string | null) => void
  fail?: (err: unknown, retry?: () => void) => void
  now?: () => number
  delays?: Partial<PipelineDelays>
}

function initialState(sidebarProjectId: string | null, showDoneTaskChats: boolean): ChatState {
  return {
    conversations: [],
    readerConversations: [],
    playwrightReaderConversations: [],
    conversationsStatus: 'loading',
    conversationsError: null,
    searchQuery: '',
    searchScope: 'chats',
    messageSearch: { ...EMPTY_MESSAGE_SEARCH },
    highlightMessageId: null,
    activeId: null,
    messages: [],
    loadingMessages: false,
    draft: '',
    promptHelper: { open: false, loading: false, variants: [], error: null },
    attachments: [],
    consoleLog: [],
    liveActivity: [],
    streamingReply: '',
    activeTurns: {},
    queuedTurns: {},
    queuePaused: {},
    activeActivity: {},
    lastTurnMeta: null,
    liveUsage: null,
    activeUsage: {},
    sidebarProjectId,
    showDoneTaskChats,
    pinnedConversation: null,
    taskChatContext: null,
    taskChatBadges: {},
    kbUsage: {},
    kbUsageByProject: {},
    kbStatus: null
  }
}

export function createChatStore(deps: ChatDeps): ChatStore {
  const client = deps.chat
  const kbBridge = client.kb
  const turn = client.turn
  const voice = deps.voice
  const now = deps.now ?? Date.now
  const delays: PipelineDelays = { ...DEFAULT_DELAYS, ...deps.delays }
  const core = createStoreCore<ChatState>(
    initialState(deps.prefs.get(SIDEBAR_PROJECT_KEY), deps.prefs.get(DONE_TASK_CHATS_KEY) === '1')
  )
  const { getState, setState } = core
  const fail = deps.fail ?? (() => {})
  const setError = deps.setError ?? (() => {})

  let conversationsRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchSeq = 0
  /**
   * Токен актуальности `conversations:get`: инкремент — при каждой смене чата.
   * Ответ применяется, только если за время полёта не было более позднего выбора.
   */
  let selectToken = 0
  /**
   * Ключ идемпотентности первой отправки. Стабилен между повторами: потерянный
   * HTTP-ответ не создаст второй разговор. Живёт до подтверждённого успеха.
   */
  let pendingDraftKey: string | null = null
  /** Открыта ли панель «Использование БЗ» (флагом владеет shellStore). */
  let kbUsagePanelOpen = false

  core.onDispose(() => {
    if (conversationsRefreshTimer) clearTimeout(conversationsRefreshTimer)
    if (searchTimer) clearTimeout(searchTimer)
    conversationsRefreshTimer = null
    searchTimer = null
  })

  // --- Состояние, принадлежащее конкретному чату ---------------------------

  /**
   * `chatScopedReset` — данные открытого разговора: лента и контекст задачи.
   * Их обнуляет любая смена `activeId`, иначе они залипают в следующем чате.
   */
  function chatScopedReset(): Pick<ChatState, 'messages' | 'taskChatContext'> {
    return { messages: [], taskChatContext: null }
  }

  /**
   * `chatSwitchReset` — то же плюс живое отображение прошлого хода: активность,
   * стрим, итоги и консоль. Серверный ход при этом НЕ отменяется: вернувшись в
   * разговор, его состояние восстанавливают `claude:active` и история.
   * Локальные запись и озвучка останавливаются в голосовом домене.
   */
  function chatSwitchReset(): Partial<ChatState> {
    return {
      ...chatScopedReset(),
      consoleLog: [],
      liveActivity: [],
      streamingReply: '',
      lastTurnMeta: null,
      liveUsage: null
    }
  }

  // --- Список бесед ---------------------------------------------------------

  function pinActiveIfHidden(all: Conversation[], query: string): void {
    const active = getState().activeId
    if (!active || query || all.some((c) => c.id === active)) return
    const state = getState()
    const conv =
      state.pinnedConversation?.id === active
        ? state.pinnedConversation
        : state.conversations.find((c) => c.id === active) ?? null
    if (conv) setState({ pinnedConversation: conv })
  }

  function keepPinned(list: Conversation[], pid: string | null, query: string): Conversation[] {
    const pinned = getState().pinnedConversation
    if (!pinned || pinned.id !== getState().activeId) return list
    if (query || (pinned.projectId ?? null) !== pid) return list
    return withConversation(list, pinned)
  }

  async function refreshConversations(
    { keepActiveListed = false }: { keepActiveListed?: boolean } = {}
  ): Promise<void> {
    const q = getState().searchQuery.trim()
    setState({ conversationsStatus: 'loading', conversationsError: null })
    try {
      const includeCompleted = getState().showDoneTaskChats
      const all = q
        ? await client['conversations:search']({ query: q, includeCompleted })
        : await client['conversations:list']({ includeCompleted })
      if (core.disposed()) return
      if (keepActiveListed) {
        const activeId = getState().activeId
        const activeHidden = activeId != null && !q && !all.some((c) => c.id === activeId)
        if (activeHidden) {
          const badge = (await client['conversations:taskChats']()).find((item) => item.conversationId === activeId)
          if (core.disposed()) return
          if (badge?.columnSemantic === 'cancelled') setState({ pinnedConversation: null })
          else pinActiveIfHidden(all, q)
        }
      }
      const pid = getState().sidebarProjectId
      const conversations = keepPinned(all.filter((c) => (c.projectId ?? null) === pid), pid, q)
      setState({
        conversations,
        conversationsStatus: 'ready',
        conversationsError: null,
        // Reader-чаты берём из полного ответа, до фильтра проекта.
        ...(q
          ? {}
          : {
              readerConversations: all.filter(isReaderConversation),
              playwrightReaderConversations: all.filter(isPlaywrightReaderConversation)
            })
      })
      void loadTaskChatBadges()
    } catch (err) {
      setState({
        conversationsStatus: 'error',
        conversationsError: err instanceof Error ? err.message : String(err)
      })
      throw err
    }
  }

  /**
   * Дебаунс-таймеры списка и поиска намеренно НЕ регистрируются в ядре: их не
   * должен снимать `clearTimers()` мок-пайплайна, который дёргают смена чата и
   * отмена хода. Иначе окно склейки осталось бы «открытым» навсегда, и список
   * перестал бы обновляться по событиям.
   */
  function scheduleConversationsRefresh(): void {
    if (conversationsRefreshTimer) return // окно уже открыто — повод склеится с прошлым
    conversationsRefreshTimer = setTimeout(() => {
      conversationsRefreshTimer = null
      if (core.disposed()) return
      void refreshConversations({ keepActiveListed: true }).catch(() => {
        /* ошибка уже в conversationsError; список на экране остаётся прежним */
      })
    }, CONVERSATIONS_REFRESH_DEBOUNCE_MS)
  }

  async function loadTaskChatBadges(): Promise<void> {
    try {
      const badges = await client['conversations:taskChats']()
      if (core.disposed()) return
      const byConversation: Record<string, TaskChatBadge> = {}
      for (const badge of badges) byConversation[badge.conversationId] = badge
      setState({ taskChatBadges: byConversation })
      deps.onTaskBadgeRuns?.(badges)
    } catch {
      /* подсветка — украшение: список чатов работает и без неё */
    }
  }

  // --- Поиск ----------------------------------------------------------------

  function cancelPendingMessageSearch(): void {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = null
    searchSeq += 1 // обесценивает ответы всех улетевших запросов
  }

  function scheduleMessageSearch(): void {
    cancelPendingMessageSearch()
    const query = getState().searchQuery.trim()
    if (!query) {
      setState({ messageSearch: { ...EMPTY_MESSAGE_SEARCH } })
      return
    }
    setState({ messageSearch: { ...getState().messageSearch, status: 'loading', error: null } })
    searchTimer = setTimeout(() => {
      searchTimer = null
      if (core.disposed()) return
      void runMessageSearch(query)
    }, MESSAGE_SEARCH_DEBOUNCE_MS)
  }

  async function runMessageSearch(query: string): Promise<void> {
    if (!query) return
    searchSeq += 1
    const seq = searchSeq
    setState({ messageSearch: { ...getState().messageSearch, query, status: 'loading', error: null } })
    try {
      const res = await client['messages:search']({
        query,
        projectId: getState().sidebarProjectId,
        limit: MESSAGE_SEARCH_PAGE
      })
      if (seq !== searchSeq || core.disposed()) return // ответ на устаревший запрос
      setState({
        messageSearch: { query, status: 'ready', hits: res.hits, nextCursor: res.nextCursor, loadingMore: false, error: null }
      })
    } catch (err) {
      if (seq !== searchSeq || core.disposed()) return
      setState({
        messageSearch: {
          ...getState().messageSearch,
          query,
          status: 'error',
          error: err instanceof Error ? err.message : String(err)
        }
      })
    }
  }

  // --- Сообщения ------------------------------------------------------------

  async function persistMessage(
    role: MessageRole,
    text: string,
    engine?: LlmProvider,
    meta?: TurnMeta,
    execTarget?: string | null,
    attachments?: MessageAttachment[]
  ): Promise<Message | undefined> {
    const conversationId = getState().activeId
    if (!conversationId) return undefined
    const message = await client['messages:add']({
      conversationId,
      role,
      text,
      time: formatTime(now()),
      ...(engine ? { engine } : {}),
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
      ...(execTarget !== undefined ? { execTarget } : {}),
      ...(attachments?.length ? { attachments } : {})
    })
    setState({ messages: [...getState().messages, message] })
    return message
  }

  function appendPersisted(message: Message): void {
    if (getState().messages.some((m) => m.id === message.id)) return
    setState({ messages: [...getState().messages, message] })
  }

  /** Атомарно сохраняет локальный черновик вместе с первой репликой. */
  async function ensureConversation(
    titleSeed: string,
    firstMessage: Parameters<ChatClient['conversations:createDraft']>[0]['message']
  ): Promise<boolean> {
    if (getState().activeId) return false
    pendingDraftKey ??= globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}-${Math.random()}`
    const result = await client['conversations:createDraft']({
      idempotencyKey: pendingDraftKey,
      title: titleFromText(titleSeed),
      projectId: getState().sidebarProjectId,
      message: firstMessage
    })
    pendingDraftKey = null
    setState({
      activeId: result.conversation.id,
      ...chatScopedReset(),
      messages: result.messages,
      conversations: withConversation(getState().conversations, result.conversation)
    })
    await refreshConversations()
    return true
  }

  function activeConversation(): Conversation | undefined {
    return getState().conversations.find((c) => c.id === getState().activeId)
  }

  function activeConversationExecTarget(): string | null {
    return activeConversation()?.execTarget ?? null
  }

  /** Если у текущего разговора есть недоигранный ход — восстанавливаем стрим. */
  function restoreStreamIfActive(): void {
    const state = getState()
    const id = state.activeId
    if (!id) return
    const partial = state.activeTurns[id]
    if (partial === undefined) return
    if (!voice.restoreThinking()) return
    setState({
      streamingReply: partial,
      lastTurnMeta: null,
      // Счётчики действий и токенов продолжаются с накопленного, а не с нуля.
      liveActivity: state.activeActivity[id] ?? [],
      liveUsage: state.activeUsage[id] ?? null
    })
  }

  // --- Ход модели -----------------------------------------------------------

  /** Роутинг ответа: реальный LLM (стрим событиями) или мок-пайплайн. */
  function beginReply(
    segments: SttSegmentWire[],
    attachments: string[] = [],
    execTarget: string | null = activeConversationExecTarget(),
    messageId?: string
  ): void {
    const activeId = getState().activeId
    if (turn.enabled && turn.send && activeId) {
      setState({ streamingReply: '', lastTurnMeta: null, liveActivity: [], liveUsage: null })
      voice.beginTurn()
      // verbose=true всегда: активность нужна для живого статуса и подробного вида.
      if (messageId) turn.send(activeId, segments, attachments, true, execTarget, messageId)
      else if (execTarget === null) turn.send(activeId, segments, attachments, true)
      else turn.send(activeId, segments, attachments, true, execTarget)
      return
    }
    const prompt = segments.map((s) => s.text).join(' ')
    core.timer(() => void finishReply(mockReply(prompt)), delays.think)
  }

  /** Фиксация ответа и переход thinking → speaking → idle (без стрима). */
  async function finishReply(
    fullText: string,
    engine?: LlmProvider,
    meta?: TurnMeta,
    persisted?: Message
  ): Promise<void> {
    const text = fullText.trim()
    setState({ streamingReply: '' })
    if (!text) {
      if (voice.state() === 'thinking') voice.dispatch('reset') // пустой ответ → idle
      return
    }
    if (persisted) appendPersisted(persisted)
    else await persistMessage('ai', text, engine, meta)
    await refreshConversations()
    if (!voice.dispatch('reply_ready')) return // thinking → speaking
    voice.speakReply(text)
  }

  /** Отмена текущего ответа: запрос к LLM и озвучка. */
  function cancelReply(): void {
    turn.cancel?.(getState().activeId ?? undefined)
    voice.cancelSpeech()
    if (getState().streamingReply) setState({ streamingReply: '' })
  }

  function cancelRequest(): void {
    const v = voice.state()
    if (v !== 'thinking' && v !== 'speaking') return
    core.clearTimers()
    voice.cancelTimers()
    cancelReply()
    voice.dispatch('reset') // thinking/speaking → idle
  }

  /**
   * Если текст — команда «открой консоль/проводник», сохраняет ai-сообщение с
   * tool-блоком (виджет прямо в ответе) и возвращает true (в LLM не идём).
   */
  async function maybeOpenUtility(text: string): Promise<boolean> {
    const agents = deps.listAgents()
    const tool = detectOpenUtility(text, agents)
    if (!tool) return false
    if (activeConversationExecTarget() === 'none') {
      await persistMessage('ai', 'Команды отключены: для этого сообщения выбрано «Без машины».')
      await refreshConversations()
      return true
    }
    const agent = tool.agentId ? agents.find((a) => a.id === tool.agentId) : undefined
    const label = tool.kind === 'console' ? 'Консоль' : 'Проводник'
    const where = agent ? ` — машина «${agent.name}»` : ''
    const spec: ToolSpec = { kind: tool.kind, ...(tool.agentId ? { agentId: tool.agentId } : {}) }
    await persistMessage('ai', `🖥 ${label}${where}\n\n${toolBlock(spec)}`)
    await refreshConversations()
    return true
  }

  /**
   * Авто-переход статуса по завершению хода: режим «План» → «планирование
   * закончено», иначе (Разработка) → «разработка закончена».
   */
  async function bumpTurnStatus(convId: string, meta?: TurnMeta): Promise<void> {
    const conv = getState().conversations.find((c) => c.id === convId)
    const mode =
      (meta?.request?.permissionMode as PermissionMode | undefined) ??
      conv?.permissionMode ??
      deps.getSettings().permissionMode
    await setConversationStatus(convId, mode === 'plan' ? 'planning_done' : 'development_done')
  }

  async function setConversationStatus(id: string, status: ConversationStatus): Promise<void> {
    const conversation = await client['conversations:setStatus']({ id, status })
    setState({ conversations: getState().conversations.map((c) => (c.id === id ? conversation : c)) })
  }

  async function setConversationExecTarget(
    id: string,
    execTarget: string | null,
    workdir?: string | null,
    skillNames?: string[],
    llmProvider?: LlmProvider | null,
    llmModel?: string | null,
    permissionMode?: PermissionMode | null,
    kbContextMode?: KbContextMode,
    llmEngineId?: string | null
  ): Promise<void> {
    const conversation = await client['conversations:setExecTarget']({
      id,
      execTarget,
      workdir,
      skillNames,
      llmEngineId,
      llmProvider,
      llmModel,
      permissionMode,
      kbContextMode
    })
    setState({ conversations: getState().conversations.map((c) => (c.id === id ? conversation : c)) })
  }

  // --- Выбор и создание разговора ------------------------------------------

  async function newConversation(assistantKind?: 'web-recorder' | 'playwright-reader'): Promise<string | null> {
    selectToken++ // недолетевший ответ прежнего выбора не перетрёт новый чат
    core.clearTimers()
    // Ход текущего разговора не отменяем — он доиграет на сервере.
    voice.resetForChatSwitch()
    pendingDraftKey = null
    const common = {
      ...chatSwitchReset(),
      loadingMessages: false,
      draft: '',
      promptHelper: { open: false, loading: false, variants: [], error: null },
      attachments: [] as UploadInfo[]
    }
    if (!assistantKind) {
      setState({ activeId: null, ...common })
      return null
    }
    // Web Reader — сохраняемый lifecycle, а не ручной черновик.
    const state = getState()
    const readerList =
      assistantKind === 'playwright-reader' ? state.playwrightReaderConversations : state.readerConversations
    const prefix = assistantKind === 'playwright-reader' ? 'Playwright Reader' : 'Web Reader'
    let number = 1
    while (readerList.some((item) => item.title === `${prefix} ${number}`)) number++
    const conversation = await client['conversations:create']({ title: `${prefix} ${number}`, assistantKind })
    setState({
      activeId: conversation.id,
      readerConversations:
        assistantKind === 'web-recorder'
          ? withConversation(getState().readerConversations, conversation)
          : getState().readerConversations,
      playwrightReaderConversations:
        assistantKind === 'playwright-reader'
          ? withConversation(getState().playwrightReaderConversations, conversation)
          : getState().playwrightReaderConversations,
      ...common
    })
    await refreshConversations()
    return conversation.id
  }

  async function createConversation(input: { title: string; projectId?: string | null }): Promise<string> {
    await newConversation()
    let conversation = await client['conversations:create']({ title: input.title.trim() || 'Новый разговор' })
    if (input.projectId) {
      conversation = await client['conversations:setProject']({ id: conversation.id, projectId: input.projectId })
    }
    setState({
      activeId: conversation.id,
      conversations: withConversation(getState().conversations, conversation),
      loadingMessages: false,
      messages: []
    })
    await refreshConversations({ keepActiveListed: true })
    return conversation.id
  }

  async function selectConversation(id: string): Promise<boolean> {
    const token = ++selectToken
    core.clearTimers()
    voice.resetForChatSwitch() // ход прежнего разговора доиграет на сервере
    setState({ ...chatSwitchReset(), loadingMessages: true })
    let opened: Conversation | null = null
    let known = true
    try {
      const res = await client['conversations:get']({ id })
      // Пока ответ летел, выбрали другой чат — этот ответ отбрасываем молча.
      if (token !== selectToken || core.disposed()) return false
      if (res) {
        opened = res.conversation
        known = getState().conversations.some((c) => c.id === res.conversation.id)
        setState({ activeId: res.conversation.id, messages: res.messages })
        restoreStreamIfActive()
      }
    } finally {
      if (token === selectToken) setState({ loadingMessages: false })
    }
    if (!opened) {
      setError('Разговор не найден: возможно, он удалён.')
      return false
    }
    // Чата нет в списке сайдбара (ссылка на чат другого проекта) — переключаем фильтр.
    if (!known) await setSidebarProject(opened.projectId ?? null)
    const listed = getState().conversations.some((c) => c.id === opened.id)
    setState({
      pinnedConversation: listed ? null : opened,
      conversations: listed ? getState().conversations : withConversation(getState().conversations, opened)
    })
    // Шапку чата задачи грузим отдельно, чтобы не задерживать показ сообщений.
    void loadTaskChatContext(id)
    return true
  }

  async function loadTaskChatContext(id: string): Promise<void> {
    setState({ taskChatContext: null })
    try {
      const ctx = await client['conversations:taskContext']({ id })
      if (getState().activeId === id) {
        setState({
          taskChatContext: ctx,
          ...(ctx?.columnSemantic === 'cancelled'
            ? { pinnedConversation: null, conversations: getState().conversations.filter((item) => item.id !== id) }
            : {})
        })
      }
    } catch {
      /* шапка необязательна — молча без неё */
    }
  }

  async function setSidebarProject(projectId: string | null): Promise<void> {
    if (projectId) deps.prefs.set(SIDEBAR_PROJECT_KEY, projectId)
    else deps.prefs.remove(SIDEBAR_PROJECT_KEY)
    setState({ sidebarProjectId: projectId })
    // Поиск по сообщениям тоже сужен проектом — перезапрашиваем.
    if (getState().searchScope === 'messages') scheduleMessageSearch()
    await refreshConversations()
  }

  // --- Отправка -------------------------------------------------------------

  async function performSubmitText(previewElement?: PreviewElementPayload): Promise<boolean> {
    const state = getState()
    const text = state.draft.trim()
    const atts = state.attachments
    if (!text && atts.length === 0 && !previewElement) return false
    const v = voice.state()
    // Ход уже идёт: реплика уходит в серверную очередь, второй локальный ход не стартует.
    const queueOnly = v === 'thinking' || v === 'speaking' || v === 'transcribing'
    setError(null)
    const messageAttachments = atts.map((file) => ({
      uploadId: file.id,
      path: file.path,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      ...(file.agentId ? { agentId: file.agentId } : {})
    }))
    const messageText = composeUserText(text, atts)
    const messageMeta = previewElement ? { previewElement } : undefined
    const created = await ensureConversation(text || atts.map((a) => a.name).join(', '), {
      role: 'u1',
      text: messageText,
      time: formatTime(now()),
      ...(messageMeta ? { meta: messageMeta } : {}),
      ...(messageAttachments.length ? { attachments: messageAttachments } : {})
    })
    const execTarget = activeConversationExecTarget()
    const persisted = created
      ? [...getState().messages].reverse().find((message) => message.role !== 'ai')
      : await persistMessage('u1', messageText, undefined, messageMeta, execTarget, messageAttachments)
    // Текст и вложения чистим только после успешной отправки.
    setState({ draft: '', attachments: [] })
    await refreshConversations()
    // Команда «открой консоль/проводник» → виджет в ответе, без обращения к LLM.
    if (!queueOnly && atts.length === 0 && !previewElement && (await maybeOpenUtility(text))) return true
    if (!queueOnly && !voice.dispatch('submit_text')) return false // idle → thinking
    const segments = [
      { speakerId: 1, text: withPreviewElementContext(text || 'См. приложенные файлы.', previewElement) }
    ]
    const activeId = getState().activeId
    if (queueOnly && turn.enabled && turn.send && activeId) {
      turn.send(activeId, segments, atts.map((a) => a.id), true, execTarget, persisted?.id)
    } else {
      beginReply(segments, atts.map((a) => a.id), execTarget)
    }
    return true
  }

  let submitTextInFlight: Promise<boolean> | null = null

  function submitText(previewElement?: PreviewElementPayload): Promise<boolean> {
    // Два keydown/click до первого ответа API видят один и тот же черновик.
    // Выполняем только первый вызов; после его завершения следующий ввод снова доступен.
    if (submitTextInFlight) return Promise.resolve(false)
    const pending = performSubmitText(previewElement)
    submitTextInFlight = pending
    const clear = (): void => {
      if (submitTextInFlight === pending) submitTextInFlight = null
    }
    void pending.then(clear, clear)
    return pending
  }

  /** Персист распознанных сегментов как реплик пользователя, затем ответ. */
  async function submitVoiceSegments(segments: LiveSegment[]): Promise<void> {
    const first = segments[0]
    if (!first) return
    const diarization = deps.getSettings().diarization
    const firstRole = `u${diarization ? first.speakerId : 1}` as MessageRole
    const created = await ensureConversation(first.text, {
      role: firstRole,
      text: first.text,
      time: formatTime(now())
    })
    for (const seg of created ? segments.slice(1) : segments) {
      const role = `u${diarization ? seg.speakerId : 1}` as MessageRole
      await persistMessage(role, seg.text)
    }
    await refreshConversations()
    // Голосовая команда «открой консоль/проводник» → виджет в ответе, без LLM.
    if (await maybeOpenUtility(segments.map((s) => s.text).join(' '))) {
      voice.dispatch('reset') // thinking → idle
      return
    }
    beginReply(segments)
  }

  // --- Realtime-кадры хода --------------------------------------------------

  function applyClaudeLog(entry: ClaudeLogEntry, conversationId?: string): void {
    const state = getState()
    const next = [...state.consoleLog, entry]
    const patch: Partial<ChatState> = {
      consoleLog: next.length > CONSOLE_LOG_CAP ? next.slice(-CONSOLE_LOG_CAP) : next
    }
    if (conversationId !== undefined) {
      const acc = [...(state.activeActivity[conversationId] ?? []), entry]
      patch.activeActivity = {
        ...state.activeActivity,
        [conversationId]: acc.length > CONSOLE_LOG_CAP ? acc.slice(-CONSOLE_LOG_CAP) : acc
      }
    }
    // (conversationId не задан у клиентских таймингов stt/tts — считаем их своими.)
    if (conversationId === undefined || conversationId === state.activeId) {
      const live = [...state.liveActivity, entry]
      patch.liveActivity = live.length > CONSOLE_LOG_CAP ? live.slice(-CONSOLE_LOG_CAP) : live
    }
    setState(patch)
  }

  function applyClaudeToken(delta: string, conversationId?: string): void {
    const state = getState()
    const convId = conversationId ?? state.activeId
    if (convId) {
      setState({
        activeTurns: { ...state.activeTurns, [convId]: (state.activeTurns[convId] ?? '') + delta }
      })
    }
    if (convId !== getState().activeId) return // фоновый разговор — в ленту не рисуем
    // Снапшот claude.active мог быть пропущен (гонка подписки WS) — поднимаем
    // стрим из накопленного и выходим (delta уже учтён выше).
    if (convId && voice.state() === 'idle' && (getState().activeTurns[convId] ?? '') !== '') {
      restoreStreamIfActive()
      return
    }
    const v = voice.state()
    if (v !== 'thinking' && v !== 'speaking') return
    setState({ streamingReply: getState().streamingReply + delta })
    voice.speakDelta(delta)
  }

  async function applyClaudeDone(
    text: string,
    meta?: TurnMeta,
    engine?: LlmProvider,
    message?: Message,
    conversationId?: string
  ): Promise<void> {
    const convId = conversationId ?? getState().activeId
    let statusUpdate: Promise<void> = Promise.resolve()
    if (convId) {
      const state = getState()
      const { [convId]: _done, ...rest } = state.activeTurns
      const { [convId]: _act, ...restActivity } = state.activeActivity
      const { [convId]: _usage, ...restUsage } = state.activeUsage
      setState({ activeTurns: rest, activeActivity: restActivity, activeUsage: restUsage })
      statusUpdate = bumpTurnStatus(convId, meta).catch((error: unknown) => {
        console.warn('[conversation] не удалось обновить статус завершённого хода:', error)
      })
    }
    if (convId !== getState().activeId) {
      // Фоновый разговор: ответ уже сохранён сервером — обновляем только сайдбар.
      await statusUpdate
      if (message) await refreshConversations()
      return
    }
    if (getState().liveActivity.length) setState({ liveActivity: [] })
    if (getState().liveUsage) setState({ liveUsage: null }) // итог хода — в meta
    if (meta && Object.keys(meta).length > 0) setState({ lastTurnMeta: meta })
    const v = voice.state()
    if (v !== 'thinking' && v !== 'speaking') {
      setState({ streamingReply: '' })
      voice.beginTurn()
      // Ход доиграл, пока вкладка была в idle (например, после F5).
      if (message) appendPersisted(message)
      await Promise.all([statusUpdate, message ? refreshConversations() : Promise.resolve()])
      return
    }

    if (!voice.autoSpeakActive()) {
      // Запускаем фиксацию сразу, до сетевого обновления статуса. Иначе сервер
      // успевает продвинуть очередь, а первые токены следующего ответа попадают
      // в ещё не очищенный streamingReply предыдущего хода.
      const replyUpdate = finishReply(text || getState().streamingReply, engine, meta, message)
      await Promise.all([statusUpdate, replyUpdate])
      return
    }

    const full = (text || getState().streamingReply).trim()
    setState({ streamingReply: '' })
    await statusUpdate
    if (full) {
      if (message) appendPersisted(message)
      else await persistMessage('ai', full, engine, meta)
      await refreshConversations()
    }
    if (!voice.finishStreamedTurn()) {
      // Нечего озвучивать (пустой ответ) — возвращаемся в idle.
      if (voice.state() === 'thinking') voice.dispatch('reset')
      else if (voice.state() === 'speaking') voice.dispatch('speaking_done')
    }
  }

  function applyClaudeError(message: string, conversationId?: string): void {
    const state = getState()
    const convId = conversationId ?? state.activeId
    if (convId) {
      const { [convId]: _failed, ...rest } = state.activeTurns
      const { [convId]: _act, ...restActivity } = state.activeActivity
      const { [convId]: _usage, ...restUsage } = state.activeUsage
      setState({ activeTurns: rest, activeActivity: restActivity, activeUsage: restUsage })
    }
    if (convId !== getState().activeId) return // ошибка фонового хода — UI не трогаем
    const warning = message.startsWith('WARNING:')
    const visibleMessage = warning ? message.slice('WARNING:'.length).trim() : message
    console.warn(`[claude] ${warning ? 'предупреждение' : 'ошибка'}:`, visibleMessage)
    if (warning) {
      setError(visibleMessage)
      return
    }
    voice.cancelSpeech()
    setState({ streamingReply: '', liveActivity: [], liveUsage: null })
    setError(message)
    const v = voice.state()
    if (v === 'thinking' || v === 'speaking') voice.dispatch('error')
  }

  function applyClaudeActive(turns: ActiveTurn[]): void {
    setState({
      activeTurns: Object.fromEntries(turns.map((t) => [t.conversationId, t.partial])),
      activeActivity: Object.fromEntries(
        turns.filter((t) => t.activity && t.activity.length > 0).map((t) => [t.conversationId, t.activity ?? []])
      ),
      activeUsage: Object.fromEntries(turns.flatMap((t) => (t.usage ? [[t.conversationId, t.usage] as const] : [])))
    })
    restoreStreamIfActive()
  }

  function applyClaudeQueue(conversationId: string, items: QueuedTurn[], paused: boolean, published?: Message): void {
    const state = getState()
    const queuedIds = new Set(items.map((item) => item.messageId))
    const patch: Partial<ChatState> = {
      queuedTurns: { ...state.queuedTurns, [conversationId]: items },
      queuePaused: { ...state.queuePaused, [conversationId]: paused }
    }
    if (conversationId === state.activeId) {
      const visible = state.messages.filter((message) => !queuedIds.has(message.id))
      const publishedIndex = published ? visible.findIndex((message) => message.id === published.id) : -1
      patch.messages = published
        ? publishedIndex >= 0
          ? visible.map((message) => (message.id === published.id ? published : message))
          : [...visible, published]
        : visible
      if (publishedIndex >= 0) {
        // Тот же messageId означает замену активного запроса через «Отправить
        // сейчас»: старый partial не должен стать началом нового ответа.
        patch.streamingReply = ''
        patch.liveActivity = []
        patch.liveUsage = null
        patch.lastTurnMeta = null
      }
    }
    setState(patch)
  }

  function applyClaudeUsage(usage: TurnUsage, conversationId?: string): void {
    const state = getState()
    const patch: Partial<ChatState> = {}
    if (conversationId !== undefined) {
      patch.activeUsage = { ...state.activeUsage, [conversationId]: usage }
    }
    if (conversationId === undefined || conversationId === state.activeId) {
      patch.liveUsage = usage
    }
    setState(patch)
  }

  function applyChatMessage(conversationId: string, message: Message): void {
    if (conversationId !== getState().activeId) {
      scheduleConversationsRefresh()
      return
    }
    const existing = getState().messages.some((item) => item.id === message.id)
    if (existing) {
      setState({ messages: getState().messages.map((item) => (item.id === message.id ? message : item)) })
    } else appendPersisted(message)
  }

  // --- Использование базы знаний -------------------------------------------

  function patchKbUsage(conversationId: string, fn: (cache: KbUsageCache) => KbUsageCache): void {
    const prev = getState().kbUsage[conversationId] ?? emptyKbUsageCache()
    setState({ kbUsage: { ...getState().kbUsage, [conversationId]: fn(prev) } })
  }

  function patchKbProjectUsage(projectId: string, fn: (cache: KbUsageCache) => KbUsageCache): void {
    const prev = getState().kbUsageByProject[projectId] ?? emptyKbUsageCache()
    setState({ kbUsageByProject: { ...getState().kbUsageByProject, [projectId]: fn(prev) } })
  }

  /** Фолбэк для старых чатов и для desktop без моста: отчёт из истории ходов. */
  function kbUsageFallback(conversationId: string): ReturnType<typeof buildKbUsageFromMessages> {
    const state = getState()
    const conv = state.conversations.find((c) => c.id === conversationId)
    return buildKbUsageFromMessages(conversationId === state.activeId ? state.messages : [], {
      conversationId,
      projectId: conv?.projectId ?? null,
      kbContextMode: conv?.kbContextMode ?? 'auto',
      available: state.kbStatus ? state.kbStatus.available : true
    })
  }

  async function loadKbUsage(conversationId: string, markViewed = false): Promise<void> {
    const fallback = kbUsageFallback(conversationId)
    if (!kbBridge) {
      patchKbUsage(conversationId, () => kbUsageSnapshot(fallback))
      return
    }
    patchKbUsage(conversationId, (c) => ({ ...c, loading: true, error: null }))
    try {
      const report = await kbBridge.getConversationUsage(conversationId)
      patchKbUsage(conversationId, () => kbUsageSnapshot(mergeKbUsage(report, fallback)))
      if (markViewed) {
        const viewed = await kbBridge.markConversationUsageViewed(conversationId, report.lastSeq)
        patchKbUsage(conversationId, (c) =>
          c.report ? { ...c, report: { ...c.report, unreadCount: viewed.unreadCount } } : c
        )
      }
    } catch (err) {
      patchKbUsage(conversationId, (c) => ({
        ...c,
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      }))
    }
  }

  // --- Публичные действия ---------------------------------------------------

  return {
    getState,
    subscribe: core.subscribe,
    dispose: core.dispose,
    actions: {
      async loadConversationIndex() {
        setState({ loadingMessages: true, conversationsStatus: 'loading', conversationsError: null })
        try {
          const conversations = await client['conversations:list']({ includeCompleted: getState().showDoneTaskChats })
          const pid = getState().sidebarProjectId
          setState({
            conversations: conversations.filter((c) => (c.projectId ?? null) === pid),
            readerConversations: conversations.filter(isReaderConversation),
            playwrightReaderConversations: conversations.filter(isPlaywrightReaderConversation),
            conversationsStatus: 'ready',
            conversationsError: null
          })
          void loadTaskChatBadges()
          return conversations
        } catch (err) {
          // Иначе сайдбар остался бы со скелетоном навсегда.
          setState({
            loadingMessages: false,
            conversationsStatus: 'error',
            conversationsError: err instanceof Error ? err.message : String(err)
          })
          throw err
        }
      },
      refreshConversations,
      scheduleConversationsRefresh,
      async retryConversations() {
        try {
          await refreshConversations()
        } catch {
          /* состояние уже помечено ошибкой — сайдбар её показывает */
        }
      },
      newConversation,
      createConversation,
      selectConversation,
      async deleteConversation(id) {
        try {
          await client['conversations:delete']({ id })
          // Иначе закреплённая строка удалённого чата вернулась бы в список.
          if (getState().pinnedConversation?.id === id) setState({ pinnedConversation: null })
          setState({
            readerConversations: getState().readerConversations.filter((c) => c.id !== id),
            playwrightReaderConversations: getState().playwrightReaderConversations.filter((c) => c.id !== id)
          })
          const wasActive = getState().activeId === id
          await refreshConversations()
          if (wasActive) {
            const next = getState().conversations[0]
            if (next) await selectConversation(next.id)
            else await newConversation()
          }
        } catch (err) {
          fail(err)
        }
      },
      async renameConversation(id, title) {
        const name = title.trim()
        if (!name) return
        await client['conversations:rename']({ id, title: name })
        await refreshConversations()
      },
      setConversationExecTarget,
      async setConversationProject(id, projectId) {
        const conversation = await client['conversations:setProject']({ id, projectId })
        setState({ conversations: getState().conversations.map((c) => (c.id === id ? conversation : c)) })
      },
      async setConversationPreviewUrl(id, previewUrl) {
        const conversation = await client['conversations:setPreviewUrl']({ id, previewUrl })
        setState({
          conversations: getState().conversations.map((c) => (c.id === id ? conversation : c)),
          // previewUrl меняет принадлежность к reader-чатам.
          readerConversations: isReaderConversation(conversation)
            ? withConversation(
                getState().readerConversations.map((c) => (c.id === id ? conversation : c)),
                conversation
              )
            : getState().readerConversations.filter((c) => c.id !== id)
        })
      },
      setConversationStatus,
      fetchConversationMachines: (id, projectId) => client['conversations:listMachines']({ id, projectId }),
      async setSearchQuery(query) {
        setState({ searchQuery: query })
        if (getState().searchScope === 'messages') {
          scheduleMessageSearch()
          return
        }
        await refreshConversations()
      },
      async setSearchScope(scope) {
        if (scope === getState().searchScope) return
        setState({ searchScope: scope })
        if (scope === 'messages') {
          scheduleMessageSearch()
          return
        }
        cancelPendingMessageSearch()
        setState({ messageSearch: { ...EMPTY_MESSAGE_SEARCH } })
        await refreshConversations()
      },
      async retryMessageSearch() {
        cancelPendingMessageSearch()
        await runMessageSearch(getState().searchQuery.trim())
      },
      async loadMoreMessageSearch() {
        const search = getState().messageSearch
        const cursor = search.nextCursor
        if (!cursor || search.loadingMore || search.status !== 'ready') return
        const seq = searchSeq
        const query = search.query
        setState({ messageSearch: { ...search, loadingMore: true } })
        try {
          const res = await client['messages:search']({
            query,
            projectId: getState().sidebarProjectId,
            limit: MESSAGE_SEARCH_PAGE,
            cursor
          })
          if (seq !== searchSeq || core.disposed()) return // запрос успел смениться
          setState({
            messageSearch: {
              ...getState().messageSearch,
              hits: [...getState().messageSearch.hits, ...res.hits],
              nextCursor: res.nextCursor,
              loadingMore: false
            }
          })
        } catch (err) {
          if (seq !== searchSeq || core.disposed()) return
          setState({
            messageSearch: {
              ...getState().messageSearch,
              loadingMore: false,
              status: 'error',
              error: err instanceof Error ? err.message : String(err)
            }
          })
        }
      },
      focusMessage(messageId) {
        setState({ highlightMessageId: messageId })
      },
      clearMessageHighlight() {
        if (getState().highlightMessageId) setState({ highlightMessageId: null })
      },
      setSidebarProject,
      async setShowDoneTaskChats(show) {
        if (getState().showDoneTaskChats === show) return
        if (show) deps.prefs.set(DONE_TASK_CHATS_KEY, '1')
        else deps.prefs.remove(DONE_TASK_CHATS_KEY)
        setState({ showDoneTaskChats: show })
        try {
          await refreshConversations()
        } catch {
          /* состояние уже помечено ошибкой — сайдбар покажет «Повторить» */
        }
      },
      exportConversation(format) {
        const state = getState()
        const conv = state.conversations.find((c) => c.id === state.activeId)
        if (!conv) return
        if (format === 'json') {
          deps.download.file(
            exportFileName(conv.title, 'json'),
            'application/json',
            conversationToJson(conv, state.messages)
          )
        } else {
          deps.download.file(
            exportFileName(conv.title, 'md'),
            'text/markdown',
            conversationToMarkdown(conv, state.messages)
          )
        }
      },
      setDraft(value) {
        setState({ draft: value })
      },
      submitText,
      submitVoiceSegments,
      async suggestPrompts(modifiers) {
        const text = getState().draft.trim()
        if (!text || getState().promptHelper.loading) return
        setState({ promptHelper: { open: true, loading: true, variants: [], error: null } })
        try {
          const { variants } = await client['prompt:suggest']({
            prompt: text,
            modifiers: modifiers.filter((item) => item.enabled)
          })
          // Черновик мог поменяться, но панель по-прежнему про этот запрос.
          if (!getState().promptHelper.open) return
          setState({
            promptHelper: {
              open: true,
              loading: false,
              variants: variants.map((item) => item.text),
              error: variants.length ? null : 'Не удалось предложить варианты'
            }
          })
        } catch (err) {
          if (!getState().promptHelper.open) return
          const message = err instanceof Error ? err.message : 'Не удалось получить подсказки'
          setState({ promptHelper: { open: true, loading: false, variants: [], error: message } })
        }
      },
      applyPromptSuggestion(text) {
        setState({ draft: text, promptHelper: { open: false, loading: false, variants: [], error: null } })
      },
      closePromptSuggestions() {
        setState({ promptHelper: { open: false, loading: false, variants: [], error: null } })
      },
      async answerQuestions(text) {
        const t = text.trim()
        if (!t || voice.state() !== 'idle' || !getState().activeId) return
        setError(null)
        const execTarget = activeConversationExecTarget()
        await persistMessage('u1', t, undefined, undefined, execTarget)
        await refreshConversations()
        if (!voice.dispatch('submit_text')) return // idle → thinking
        beginReply([{ speakerId: 1, text: t }], [], execTarget)
      },
      async executePlan(answerId) {
        const state = getState()
        if (!state.activeId || voice.state() !== 'idle') return
        const answerIndex = state.messages.findIndex((m) => m.id === answerId && m.role === 'ai')
        if (answerIndex < 0 || state.messages[answerIndex].meta?.request?.permissionMode !== 'plan') return
        const source = state.messages.slice(0, answerIndex).reverse().find((m) => m.role !== 'ai')
        const conversation = state.conversations.find((item) => item.id === state.activeId)
        if (!source || !conversation) return
        // acceptEdits разрешает применить план, не выдавая полный bypass.
        await setConversationExecTarget(
          conversation.id,
          conversation.execTarget,
          conversation.workdir,
          conversation.skillNames,
          conversation.llmProvider,
          conversation.llmModel,
          'acceptEdits'
        )
        const execTarget = activeConversationExecTarget()
        await persistMessage('u1', source.text, undefined, undefined, execTarget)
        await refreshConversations()
        if (!voice.dispatch('submit_text')) return
        beginReply([{ speakerId: 1, text: source.text }], [], execTarget)
      },
      cancelRequest,
      async deleteMessage(id) {
        const activeId = getState().activeId
        if (!activeId) return
        await client['messages:delete']({ conversationId: activeId, messageId: id })
        setState({ messages: getState().messages.filter((m) => m.id !== id) })
        await refreshConversations()
      },
      async editMessage(id, newText) {
        const text = newText.trim()
        const activeId = getState().activeId
        if (!activeId || !text) return
        const idx = getState().messages.findIndex((m) => m.id === id)
        if (idx < 0) return
        const source = getState().messages[idx]
        const role = source.role
        if (role === 'ai') return
        // WS сохраняет порядок: cancel обрабатывается раньше новой отправки.
        const v = voice.state()
        if (v === 'thinking' || v === 'speaking') cancelRequest()
        const messageExecTarget = source.execTarget ?? null
        const removed = getState().messages.slice(idx)
        for (const m of removed) {
          await client['messages:delete']({ conversationId: activeId, messageId: m.id })
        }
        setState({ messages: getState().messages.slice(0, idx) })
        setError(null)
        const sourceAttachments = source.attachments ?? []
        await persistMessage(role, text, undefined, source.meta, messageExecTarget, sourceAttachments)
        await refreshConversations()
        if (!voice.dispatch('submit_text')) return // idle → thinking
        beginReply(
          [{ speakerId: 1, text }],
          sourceAttachments.flatMap((item) => (item.uploadId ? [item.uploadId] : [])),
          messageExecTarget
        )
      },
      async updateTaskLaunchStatus(messageId, proposalId, status, result) {
        const activeId = getState().activeId
        if (!activeId) return
        const message = getState().messages.find((item) => item.id === messageId)
        if (!message?.meta) return
        const proposals = message.meta.taskLaunches?.length
          ? message.meta.taskLaunches
          : message.meta.taskLaunch
            ? [{ id: 'legacy', ...message.meta.taskLaunch }]
            : []
        const meta = {
          ...message.meta,
          taskLaunches: proposals.map((proposal) =>
            proposal.id === proposalId ? { ...proposal, status, ...(result ? { taskId: result.taskId, result } : {}) } : proposal
          )
        }
        const updated = await client['messages:updateMeta']({ conversationId: activeId, messageId, meta })
        setState({ messages: getState().messages.map((item) => (item.id === messageId ? updated : item)) })
        // Другие вкладки того же пользователя подхватят правку через storage-событие.
        deps.prefs.set(
          MESSAGE_META_UPDATE_KEY,
          JSON.stringify({ conversationId: activeId, message: updated, at: Date.now() })
        )
      },
      async addAttachment(file) {
        try {
          const dataBase64 = await fileToBase64(file)
          const conversation = activeConversation()
          const selectedTarget = conversation?.execTarget ?? deps.getSettings().execTarget
          const agentId = selectedTarget && selectedTarget !== 'none' ? selectedTarget : undefined
          const info = await client['uploads:add']({
            name: file.name,
            dataBase64,
            ...(file.type ? { mimeType: file.type } : {}),
            ...(agentId ? { agentId } : {}),
            ...(conversation?.id ? { conversationId: conversation.id } : {})
          })
          setState({ attachments: [...getState().attachments, info] })
        } catch (err) {
          setError(`Не удалось загрузить файл: ${err instanceof Error ? err.message : String(err)}`)
        }
      },
      removeAttachment(id) {
        setState({ attachments: getState().attachments.filter((a) => a.id !== id) })
      },
      applyClaudeToken,
      applyClaudeDone,
      applyClaudeError,
      applyClaudeActive,
      applyClaudeQueue,
      applyClaudeUsage,
      applyClaudeLog,
      editQueued(id, text) {
        const activeId = getState().activeId
        if (!activeId || !text.trim()) return
        turn.editQueued?.(activeId, id, text.trim())
      },
      deleteQueued(id) {
        const activeId = getState().activeId
        if (!activeId) return
        turn.deleteQueued?.(activeId, id)
      },
      sendQueuedNow(id) {
        const activeId = getState().activeId
        if (!activeId) return
        turn.sendQueuedNow?.(activeId, id)
      },
      applyChatMessage,
      async reloadActiveMessages() {
        const activeId = getState().activeId
        if (!activeId) return
        const res = await client['conversations:get']({ id: activeId }).catch(() => null)
        if (res && res.conversation.id === getState().activeId) setState({ messages: res.messages })
      },
      loadTaskChatContext,
      async adoptConversation(conversation, messages) {
        selectToken++ // ответ прежнего выбора не перетрёт открытый resume
        setState({ activeId: conversation.id, ...chatScopedReset(), messages })
        await refreshConversations()
      },
      loadKbUsage,
      async loadProjectKbUsage(projectId) {
        if (!kbBridge) return
        patchKbProjectUsage(projectId, (c) => ({ ...c, loading: true, error: null }))
        try {
          const report = await kbBridge.getProjectUsage(projectId)
          // Проектный отчёт кладём в тот же кэш: у него те же итоги и лента.
          patchKbProjectUsage(projectId, () => ({
            ...kbUsageSnapshot({
              conversationId: '',
              projectId,
              kbContextMode: 'auto',
              toolEnabled: report.toolEnabled,
              available: report.available,
              lastSeq: 0,
              unreadCount: 0,
              totals: report.totals,
              sections: report.sections,
              recent: report.recent
            }),
            conversations: report.conversations
          }))
        } catch (err) {
          patchKbProjectUsage(projectId, (c) => ({
            ...c,
            loading: false,
            error: err instanceof Error ? err.message : String(err)
          }))
        }
      },
      applyKbUsageQuery(conversationId, projectId, query) {
        // Кадры приходят по пользователю: незагруженные чаты пропускаем.
        if (getState().kbUsage[conversationId]?.report) {
          patchKbUsage(conversationId, (c) => applyKbUsageFrame(c, query))
          if (query.status !== 'pending' && kbBridge) {
            if (kbUsagePanelOpen && getState().activeId === conversationId) {
              void kbBridge
                .markConversationUsageViewed(conversationId, query.seq)
                .then((viewed) =>
                  patchKbUsage(conversationId, (c) =>
                    c.report ? { ...c, report: { ...c.report, unreadCount: viewed.unreadCount } } : c
                  )
                )
            } else {
              // Подхватываем границу, которую могло продвинуть другое окно.
              void loadKbUsage(conversationId)
            }
          }
        }
        if (projectId && getState().kbUsageByProject[projectId]?.report) {
          patchKbProjectUsage(projectId, (c) => applyKbUsageFrame(c, query))
        }
      },
      async refreshKbStatus() {
        try {
          setState({ kbStatus: await client['kb:status']() })
        } catch {
          // Статус индекса — украшение пустого состояния.
        }
      },
      setKbUsagePanelOpen(open) {
        kbUsagePanelOpen = open
      },
      forgetAgent(id) {
        setState({
          conversations: getState().conversations.map((c) => (c.execTarget === id ? { ...c, execTarget: null } : c))
        })
      },
      reset() {
        core.clearTimers()
        if (conversationsRefreshTimer) clearTimeout(conversationsRefreshTimer)
        if (searchTimer) clearTimeout(searchTimer)
        conversationsRefreshTimer = null
        searchTimer = null
        selectToken++
        searchSeq++
        pendingDraftKey = null
        core.resetState(initialState(getState().sidebarProjectId, getState().showDoneTaskChats))
      }
    }
  }
}


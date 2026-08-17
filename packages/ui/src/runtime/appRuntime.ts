// AppRuntime — координатор доменных хранилищ (CHAT-236).
//
// Он создаёт stores и внедряет в них клиентов, ведёт bootstrap после входа,
// маршрутизирует входящие realtime-события их владельцам, применяет logout ко
// всем доменам и освобождает ресурсы. Своих копий доменных данных у него нет и
// универсального `setState` он не предоставляет: любые изменения идут через
// публичные actions владельца.

import type { AgentInfo } from '@shared/agentProtocol'
import type { Board } from '@shared/projects'
import type { CcItem } from '@shared/cc'
import type { CxItem } from '@shared/codexSessions'
import type { KbUsageQuery } from '@shared/kb'
import type { ActiveTurn, QueuedTurn } from '@shared/protocol'
import type { LoginStatusMap } from '@shared/auth'
import type { SttUpdate } from '@shared/ipc'
import type {
  CiFixAttempt,
  CiInteraction,
  CiLogLine,
  CiRun,
  CiRunConclusion,
  CiRunDetail,
  CiRunStep,
  CiRunSummary
} from '@shared/ci'
import type { ClaudeLogEntry, LlmProvider, Message, SessionUser, TurnMeta, TurnUsage } from '@shared/types'
import type { AppClients } from '../clients/types'
import type { PipelineDelays } from '../store/mockPipeline'
import { createShellStore, type ShellStore } from '../store/domains/shellStore'
import { createSessionStore, type SessionStore } from '../store/domains/sessionStore'
import { createSettingsStore, type SettingsStore } from '../store/domains/settingsStore'
import { createChatStore, type ChatStore } from '@voicechat/chat-app'
import { createVoiceStore, type VoiceStore } from '../store/domains/voiceStore'
import { createOperationsStore, type OperationsStore } from '../store/domains/operationsStore'
import { createAdminStore, type AdminStore } from '@voicechat/admin-app'
import { createProjectsStore, type ProjectsStore } from '../store/domains/projectsStore'

/** Входящие realtime-кадры: их владельца знает только runtime. */
export interface RealtimeHandlers {
  authStatus(status: LoginStatusMap): void
  sttPartial(update: SttUpdate): void
  sttFinal(update: SttUpdate): void
  sttError(message: string): void
  modelDownloadProgress(percent: number): void
  modelDownloadDone(): void
  modelDownloadError(message: string): void
  turnToken(delta: string, conversationId?: string): void
  turnDone(text: string, meta?: TurnMeta, engine?: LlmProvider, message?: Message, conversationId?: string): void
  turnError(message: string, conversationId?: string): void
  turnActive(turns: ActiveTurn[]): void
  turnQueue(conversationId: string, items: QueuedTurn[], paused: boolean, published?: Message): void
  turnUsage(usage: TurnUsage, conversationId?: string): void
  turnLog(entry: ClaudeLogEntry, conversationId?: string): void
  ccTail(items: CcItem[]): void
  cxTail(items: CxItem[]): void
  agents(list: AgentInfo[]): void
  boardUpdate(projectId: string, board: Board): void
  ciSnapshot(runId: string, detail: CiRunDetail, log: CiLogLine[]): void
  ciRun(runId: string, run: CiRun): void
  ciStep(runId: string, step: CiRunStep): void
  ciLog(runId: string, line: CiLogLine): void
  ciFix(runId: string, attempt: CiFixAttempt): void
  ciDone(runId: string, run: CiRun, conclusion?: CiRunConclusion): void
  ciSummary(projectId: string, summary: CiRunSummary): void
  ciInteraction(runId: string, interaction: CiInteraction): void
  chatMessage(conversationId: string, message: Message): void
  kbUsage(conversationId: string, projectId: string | null, query: KbUsageQuery): void
  ttsAudio(audio: ArrayBuffer): void
  ttsError(message: string): void
  voiceDownloadProgress(id: string, percent: number): void
  voiceDownloadDone(id: string): void
  voiceDownloadError(id: string, message: string): void
}

/** Подключение источника realtime-кадров; возвращает функцию отписки. */
export type RealtimeConnect = (handlers: RealtimeHandlers) => () => void

export interface AppRuntimeDeps {
  clients: AppClients
  /** Источник входящих кадров (в тестах отсутствует). */
  realtime?: RealtimeConnect
  now?: () => number
  delays?: Partial<PipelineDelays>
}

export interface AppRuntime {
  shell: ShellStore
  session: SessionStore
  settings: SettingsStore
  chat: ChatStore
  voice: VoiceStore
  operations: OperationsStore
  admin: AdminStore
  projects: ProjectsStore
  /** Проверка сессии и, при успехе, защищённый bootstrap. Идемпотентен. */
  start(preferredChatId?: string | null): Promise<void>
  /** Вход по логину/паролю: успех → тот же защищённый bootstrap. */
  login(name: string, password: string): Promise<void>
  /** Выход: очистка всех пользовательских доменов и закрытие подписок. */
  logout(): Promise<void>
  /** Открытие админки: ленивый домен, обычный bootstrap его не грузит. */
  openAdmin(): Promise<void>
  /** Продолжить сессию Claude Code: наблюдатель отдаёт разговор, Chat его открывает. */
  resumeCcSession(slug: string, id: string): Promise<string | null>
  /** То же для Codex; следующий ход должен продолжиться именно через Codex. */
  resumeCxSession(id: string): Promise<string | null>
  /** Панель «Использование БЗ»: флаг оболочки + отметка просмотра в Chat. */
  openKbUsage(): void
  closeKbUsage(): void
  /** Маршрутизация входящих кадров (используется тестами и адаптером). */
  handlers: RealtimeHandlers
  dispose(): void
}

export function createAppRuntime(deps: AppRuntimeDeps): AppRuntime {
  const { clients } = deps
  const now = deps.now ?? Date.now

  const shell = createShellStore({ prefs: clients.prefs })
  const session = createSessionStore({ ...(clients.session ? { session: clients.session } : {}) })

  const settings = createSettingsStore({
    settings: clients.settings,
    stt: clients.stt,
    tts: clients.tts,
    notifyError: (message) => shell.actions.setError(message)
  })

  const voice = createVoiceStore({
    voiceInput: clients.voiceInput ?? null,
    stt: clients.stt,
    tts: clients.tts,
    getSettings: () => settings.actions.selectEffectiveVoiceSettings(),
    now,
    ...(deps.delays ? { delays: deps.delays } : {}),
    // Готовая транскрипция адресуется Chat здесь, а не внутри голосового стора.
    onTranscriptFinal: (final) => chat.actions.submitVoiceSegments(final.segments),
    onTiming: (kind, label, ms) =>
      chat.actions.applyClaudeLog({ kind, summary: `${label}: ${(ms / 1000).toFixed(1)} с`, raw: JSON.stringify({ kind, label, ms }) }),
    onError: (message) => shell.actions.setError(message),
    onMicsChanged: () => void settings.actions.refreshMics()
  })

  const chat: ChatStore = createChatStore({
    chat: clients.chat,
    prefs: clients.prefs,
    download: clients.download,
    now,
    ...(deps.delays ? { delays: deps.delays } : {}),
    voice: {
      state: () => voice.getState().voice,
      dispatch: (event) => voice.actions.dispatch(event),
      restoreThinking: () => voice.actions.restoreThinking(),
      beginTurn: () => voice.actions.beginTurn(),
      speakDelta: (delta) => voice.actions.speakDelta(delta),
      finishStreamedTurn: () => voice.actions.finishStreamedTurn(),
      speakReply: (text) => voice.actions.speakReply(text),
      autoSpeakActive: () => voice.actions.autoSpeakActive(),
      cancelSpeech: () => voice.actions.cancelSpeech(),
      cancelTimers: () => voice.actions.cancelTimers(),
      resetForChatSwitch: () => voice.actions.resetForChatSwitch()
    },
    getSettings: () => settings.getState().settings,
    listAgents: () => operations.getState().agents,
    onTaskBadgeRuns: (badges) => projects.actions.applyTaskChatRuns(badges),
    setError: (message) => shell.actions.setError(message),
    fail: (err, retry) => shell.actions.fail(err, retry)
  })

  const operations: OperationsStore = createOperationsStore({
    operations: clients.operations,
    download: clients.download,
    activeChat: () => {
      const state = chat.getState()
      const conv = state.conversations.find((c) => c.id === state.activeId)
      return {
        execTarget: conv?.execTarget ?? null,
        workdir: conv?.workdir ?? null,
        projectId: conv?.projectId ?? undefined
      }
    },
    fail: (err, retry) => shell.actions.fail(err, retry),
    onAgentDeleted: (id) => {
      // Машину удалили — её ссылки убирают владельцы своих данных.
      chat.actions.forgetAgent(id)
      settings.actions.forgetAgent(id)
    }
  })

  const admin = createAdminStore({
    client: clients.admin,
    session: {
      currentUser: () => session.getState().currentUser,
      refreshSession: () => session.actions.check(),
      refreshOwnLlmAccess: async () => { await settings.actions.load() },
      onAdminAccessLost: () => admin.actions.reset()
    },
    fail: (err, retry) => shell.actions.fail(err, retry),
    notify: (notice) => shell.actions.notify(notice)
  })

  const projects: ProjectsStore = createProjectsStore({
    projects: clients.projects,
    now,
    chat: {
      scheduleConversationsRefresh: () => chat.actions.scheduleConversationsRefresh(),
      refreshConversations: (options) => chat.actions.refreshConversations(options),
      selectConversation: (id) => chat.actions.selectConversation(id),
      reloadActiveMessages: () => chat.actions.reloadActiveMessages()
    },
    fail: (err, retry) => shell.actions.fail(err, retry),
    notify: (notice) => shell.actions.notify(notice)
  })

  const stores = [shell, session, settings, voice, chat, operations, admin, projects]

  // --- Маршрутизация realtime-кадров ---------------------------------------

  const handlers: RealtimeHandlers = {
    authStatus: (status) => settings.actions.applyLoginStatus(status),
    sttPartial: (update) => voice.actions.applySttPartial(update),
    sttFinal: (update) => void voice.actions.applySttFinal(update),
    sttError: (message) => voice.actions.applySttError(message),
    modelDownloadProgress: (percent) => settings.actions.applyDownloadProgress(percent),
    modelDownloadDone: () => settings.actions.applyDownloadDone(),
    modelDownloadError: (message) => settings.actions.applyDownloadError(message),
    turnToken: (delta, conversationId) => chat.actions.applyClaudeToken(delta, conversationId),
    turnDone: (text, meta, engine, message, conversationId) =>
      void chat.actions.applyClaudeDone(text, meta, engine, message, conversationId),
    turnError: (message, conversationId) => chat.actions.applyClaudeError(message, conversationId),
    turnActive: (turns) => chat.actions.applyClaudeActive(turns),
    turnQueue: (conversationId, items, paused, published) =>
      chat.actions.applyClaudeQueue(conversationId, items, paused, published),
    turnUsage: (usage, conversationId) => chat.actions.applyClaudeUsage(usage, conversationId),
    turnLog: (entry, conversationId) => chat.actions.applyClaudeLog(entry, conversationId),
    ccTail: (items) => operations.actions.applyCcTailItems(items),
    cxTail: (items) => operations.actions.applyCxTailItems(items),
    agents: (list) => operations.actions.applyAgents(list),
    boardUpdate: (projectId, board) => projects.actions.applyBoardUpdate(projectId, board),
    ciSnapshot: (runId, detail, log) => projects.actions.applyCiSnapshot(runId, detail, log),
    ciRun: (runId, run) => projects.actions.applyCiRun(runId, run),
    ciStep: (runId, step) => projects.actions.applyCiStep(runId, step),
    ciLog: (runId, line) => projects.actions.applyCiLog(runId, line),
    ciFix: (runId, attempt) => projects.actions.applyCiFix(runId, attempt),
    ciDone: (runId, run, conclusion) => projects.actions.applyCiDone(runId, run, conclusion),
    ciSummary: (projectId, summary) => projects.actions.applyCiSummary(projectId, summary),
    ciInteraction: (runId, interaction) => projects.actions.applyCiInteraction(runId, interaction),
    chatMessage: (conversationId, message) => chat.actions.applyChatMessage(conversationId, message),
    kbUsage: (conversationId, projectId, query) => chat.actions.applyKbUsageQuery(conversationId, projectId, query),
    ttsAudio: (audio) => {
      voice.actions.applyTtsAudioReceived() // замер: пришло синтезированное аудио
      clients.playback?.enqueue(audio, () => voice.actions.applyTtsDone())
    },
    ttsError: (message) => voice.actions.applyTtsError(message),
    voiceDownloadProgress: (id, percent) => settings.actions.applyVoiceProgress(id, percent),
    voiceDownloadDone: (id) => void settings.actions.applyVoiceDone(id),
    voiceDownloadError: (id, message) => settings.actions.applyVoiceError(id, message)
  }

  const disconnect = deps.realtime?.(handlers)

  // --- Bootstrap ------------------------------------------------------------

  let bootstrapping: Promise<void> | null = null
  let disposed = false

  /**
   * Защищённый bootstrap. Идемпотентен: повторный вход в той же вкладке не
   * запускает второй граф загрузки, а ошибка необязательного домена не
   * превращает приложение в экран логина и не стирает загруженный чат.
   */
  async function bootstrap(preferredChatId?: string | null): Promise<void> {
    if (bootstrapping) return bootstrapping
    const run = (async () => {
      // 1) Права и каталог движков — раньше любой фильтрации моделей.
      const settingsLoad = settings.actions.load().catch((err: unknown) => {
        shell.actions.fail(err, () => void settings.actions.load())
      })
      // 2) Индекс разговоров: его ошибку показывает сам сайдбар.
      const conversationsLoad = chat.actions.loadConversationIndex().catch(() => [])
      const [, conversations] = await Promise.all([settingsLoad, conversationsLoad])
      if (disposed) return
      // 3) Необязательные домены — параллельно и без права уронить bootstrap.
      await Promise.all([
        projects.actions.loadNavigation(),
        operations.actions.refreshAgents(),
        settings.actions.loadCatalogs().catch((err: unknown) => {
          console.warn('[settings] каталоги загружены не полностью', err)
        })
      ])
      if (disposed) return
      // 4) Адрес важнее «самого свежего»: чат по ссылке может быть и из другого
      // проекта — selectConversation сам переключит фильтр сайдбара.
      const visible = chat.getState().conversations
      const wanted = preferredChatId ?? null
      const target = (wanted && conversations.some((c) => c.id === wanted) ? wanted : null) ?? visible[0]?.id ?? null
      if (wanted && target !== wanted) shell.actions.setError('Разговор не найден: возможно, он удалён.')
      if (target) await chat.actions.selectConversation(target)
    })()
    bootstrapping = run
    try {
      await run
    } finally {
      bootstrapping = null
    }
  }

  /** Полная очистка пользовательских доменов (logout / вход другим пользователем). */
  function clearUserDomains(): void {
    voice.actions.reset()
    chat.actions.reset()
    operations.actions.reset()
    admin.actions.reset()
    projects.actions.reset()
    settings.actions.reset()
    shell.actions.reset()
  }

  session.actions.onEvent((event) => {
    if (event.type === 'session.userChanged') {
      // Вход другим пользователем в той же вкладке: чужих данных остаться не должно.
      clearUserDomains()
    }
    if (event.type === 'session.signedOut' || event.type === 'session.expired') {
      clearUserDomains()
    }
  })

  return {
    shell,
    session,
    settings,
    chat,
    voice,
    operations,
    admin,
    projects,
    handlers,
    async start(preferredChatId) {
      const user = await session.actions.check()
      if (!user) return // требуется вход — защищённый bootstrap не запускаем
      await bootstrap(preferredChatId ?? null)
    },
    async login(name, password) {
      const user: SessionUser | null = await session.actions.login(name, password)
      if (!user) return
      await bootstrap(null)
    },
    async logout() {
      await session.actions.logout()
    },
    async openAdmin() {
      await admin.actions.openUsers()
    },
    async resumeCcSession(slug, id) {
      const result = await operations.actions.resumeCcSession(slug, id)
      if (!result) return null
      await chat.actions.adoptConversation(result.conversation, result.messages)
      return result.conversation.id
    },
    async resumeCxSession(id) {
      const result = await operations.actions.resumeCxSession(id)
      if (!result) return null
      await chat.actions.adoptConversation(result.conversation, result.messages)
      if (settings.getState().settings.llmProvider !== 'codex') {
        await settings.actions.updateSettings({ llmProvider: 'codex' })
      }
      return result.conversation.id
    },
    openKbUsage() {
      shell.actions.openKbUsage()
      chat.actions.setKbUsagePanelOpen(true)
    },
    closeKbUsage() {
      shell.actions.closeKbUsage()
      chat.actions.setKbUsagePanelOpen(false)
    },
    dispose() {
      disposed = true
      disconnect?.()
      for (const store of stores) store.dispose()
    }
  }
}


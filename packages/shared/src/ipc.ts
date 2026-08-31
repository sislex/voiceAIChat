// Единый контракт IPC между main и renderer.
// И preload, и main строятся от этих типов — рассинхрон ловится компилятором.

import type { MakeCheckIssue, MakeFileContent, MakeImportMode, MakeProjectState, MakeSearchMatch, MakeSnapshotDiff, MakeStoryFile, MakeStoryShot, MakeLibraryItem, MakeUsage, MakeCleanupOptions, MakeCleanupResult, MakeComment, MakeSharedState, MakePresenceClient, MakeShareRole, MakeTestFile, MakeProjectNotes } from './make'
import type { MakeReplacePreviewLine } from './makeSearch'
import type {
  BrowserCommand,
  BrowserSessionMetadata,
  BrowserSelectorResult,
  BrowserInspectResult,
  BrowserViewport,
  ClaudeLogEntry,
  Conversation,
  ConversationStatus,
  LlmProvider,
  KbContextMode,
  Message,
  MessageAttachment,
  ModifierPrompt,
  MessageRole,
  MessageSearchResult,
  PermissionMode,
  SessionUser,
  SessionUsage,
  Settings,
  TtsVoiceCatalog,
  TtsVoiceInfo,
  TurnMeta,
  TurnUsage,
  WhisperModel,
  WhisperModelInfo, SessionInfo, LoginChallenge, UserRole } from './types'
import type { HealthResponse, QueuedTurn, ServerFileInfo, SystemCapabilities, TurnTarget, ActiveTurn } from './protocol'
import type { GitAccessDiagnostics, GitAccessResult } from './gitAccess'
import type {
  GitBranchList, GitCheckoutResult, GitCommitResult, GitFileContent, GitFileDiff,
  GitPushResult, GitSaveFileResult, GitTreeListing, GitWorkspaceRef, GitWorkspaceStatus
} from './gitWorkspace'
import type { PreviewAction, PreviewActionResult } from './previewActions'
import type {
  AdminLlmEngine,
  AdminLlmEngineHealth,
  AdminLlmEngineInput,
  LlmEngineOption,
  AdminUserInfo,
  UserProfileInfo,
  UsageReport,
  UsageUnit, SecurityEvent, InviteInfo, SignupConfig } from './admin'
import type { McpServer } from './mcp'
import type { LoginStatusMap } from './auth'
import type { CcProject, CcSession, CcItem } from './cc'
import type { CxProject, CxSession, CxItem } from './codexSessions'
import type { AgentCreated, AgentExecResult, AgentInfo, AgentPolicy, FsResult, FsCopyResult, MachineCommandRecord, MachineCommandSource, MachineCommandEvent, MachineStatusEvent, BatchExecResult } from './agentProtocol'
import type {
  Board,
  KanbanColumn,
  ProjectDetail,
  ProjectSummary,
  Task,
  TaskChatBadge,
  TaskChatContext,
  TaskPriority,
  WorkItemDefaultSkills,
  MachineStorage,
  ChatStorageBinding, ChatStorageView,
  ProjectMachineDirectoryAssignments,
  ProjectMachineDirectoryKind
} from './projects'

import type { KbContextBundle, KbDocument, KbDocumentDraft, KbDocumentSummary, KbResearchRun, KbScope, KbSearchRequest, KbSearchResult, KbStatus } from './kb'
import type { TaskPreparationRun } from './qa'

/** Статус локальной модели Whisper. */
export interface SttStatus {
  /** Файл модели на месте и пригоден. */
  present: boolean
  /** Текущая модель из настроек. */
  model: WhisperModel
}

/** Разговор вместе с его сообщениями (ответ на conversations:get). */
export interface ConversationWithMessages {
  conversation: Conversation
  messages: Message[]
}

export interface AddMessageArgs {
  conversationId: string
  role: MessageRole
  text: string
  time: string
  /** Движок ответа (для роли 'ai'); запекается в сообщение. */
  engine?: LlmProvider
  /** Метаданные хода (токены/тайминги/детали запроса) — для роли 'ai'. */
  meta?: TurnMeta
  /** Цель этой реплики: id машины, null — сервер, 'none' — команды запрещены. */
  execTarget?: string | null
  /** Компактные метаданные вложений; байтов в IPC-сообщении нет. */
  attachments?: MessageAttachment[]
}

/** Метаданные загруженного вложения. */
export interface UploadInfo {
  id: string
  name: string
  path: string
  mimeType: string
  size: number
  agentId?: string
}

/**
 * Карта invoke-каналов: имя → { arg; result }.
 * `arg: void` означает вызов без аргументов.
 */
export interface IpcInvokeMap {
  'app:ping': { arg: void; result: HealthResponse }
  'kb:status': { arg: void; result: KbStatus }
  /** Оглавление доступных разделов; фильтр по разделу/проекту — необязательный. */
  'kb:topics': { arg: { scope?: KbScope; projectId?: string | null } | void; result: KbDocumentSummary[] }
  'kb:search': { arg: KbSearchRequest; result: KbSearchResult[] }
  'kb:document': { arg: { id: string }; result: KbDocument | null }
  'kb:context': { arg: { query: string; budget?: number }; result: KbContextBundle }
  /** Создать/переписать статью раздела «Настройки пользователя» или «Разработка проекта». */
  'kb:saveDocument': { arg: KbDocumentDraft; result: KbDocument }
  'kb:deleteDocument': { arg: { id: string }; result: void }
  /** «Исследовать проект»: запустить сверку статей с кодом и получить состояние. */
  'kb:research': { arg: { projectId: string }; result: KbResearchRun }
  'kb:researchStatus': { arg: { projectId: string }; result: KbResearchRun | null }
  /**
   * Помощник промптов: по черновику запроса вернуть несколько переформулировок.
   * Одноразовый LLM-вызов, историю разговора не трогает.
   */
  'prompt:suggest': {
    arg: { prompt: string; modifiers: ModifierPrompt[] }
    result: { variants: Array<{ id: string; text: string }> }
  }
  /**
   * Список бесед. `includeCompleted` — вместе с чатами задач, лежащих в колонке
   * «Готово»: по умолчанию сервер их не отдаёт (переключатель «Показывать чаты
   * завершённых задач»).
   */
  'conversations:list': { arg: { includeCompleted?: boolean }; result: Conversation[] }
  /** Make: состояние проекта разговора (файлы, снимки, rev) и операции с файлами. */
  'make:state': { arg: { conversationId: string }; result: MakeProjectState }
  'make:read': { arg: { conversationId: string; path: string }; result: MakeFileContent }
  'make:write': { arg: { conversationId: string; path: string; content: string }; result: MakeProjectState }
  'make:delete': { arg: { conversationId: string; path: string }; result: MakeProjectState }
  'make:rename': { arg: { conversationId: string; from: string; to: string }; result: MakeProjectState }
  'make:snapshot': { arg: { conversationId: string; label?: string }; result: MakeProjectState }
  'make:restore': { arg: { conversationId: string; snapshotId: string }; result: MakeProjectState }
  'make:reset': { arg: { conversationId: string }; result: MakeProjectState }
  /** snapshotId — закрепить публикацию за снимком; null/отсутствует — публиковать текущее состояние. */
  'make:publish': { arg: { conversationId: string; snapshotId?: string | null; slug?: string | null; password?: string | null; allowComments?: boolean }; result: MakeProjectState }
  'make:unpublish': { arg: { conversationId: string }; result: MakeProjectState }
  'make:check': { arg: { conversationId: string }; result: { issues: MakeCheckIssue[] } }
  'make:template': { arg: { conversationId: string; templateId: string }; result: MakeProjectState }
  /** Загрузка бинарного файла (картинка, шрифт) — содержимое в base64. */
  'make:upload': { arg: { conversationId: string; path: string; dataBase64: string }; result: MakeProjectState }
  'make:search': { arg: { conversationId: string; query: string; regex?: boolean; matchCase?: boolean }; result: { matches: MakeSearchMatch[] } }
  'make:stories': { arg: { conversationId: string }; result: { files: MakeStoryFile[] } }
  /** Замена по всем текстовым файлам проекта; перед заменой — снимок. */
  /** `dryRun` — только предпросмотр (`preview`), файлы не меняются. `regex` — запрос как регулярное выражение с `$1`-подстановками. */
  'make:replace': { arg: { conversationId: string; query: string; replacement: string; matchCase?: boolean; regex?: boolean; dryRun?: boolean }; result: { files: number; replacements: number; state: MakeProjectState; preview?: MakeReplacePreviewLine[] } }
  'make:snapshotDiff': { arg: { conversationId: string; snapshotId: string }; result: MakeSnapshotDiff }
  /** Текст файла из снимка — для diff-вью. */
  'make:library': { arg: Record<string, never>; result: { items: MakeLibraryItem[] } }
  /** Сохранить файлы проекта в библиотеку под именем. */
  'make:libraryExport': { arg: { conversationId: string; name: string; paths: string[] }; result: { item: MakeLibraryItem } }
  /** Вставить компонент из библиотеки в проект (существующие файлы перезаписываются). */
  /** `autoImported` — компоненты, import которых добавлен в точку входа (roadmap-4 п.13). */
  'make:libraryInsert': { arg: { conversationId: string; slug: string }; result: { state: MakeProjectState; mergedTokens: number; autoImported: string[] } }
  'make:libraryRemove': { arg: { slug: string }; result: { items: MakeLibraryItem[] } }
  'make:shots': { arg: { conversationId: string }; result: { shots: MakeStoryShot[] } }
  'make:tests': { arg: { conversationId: string }; result: { files: MakeTestFile[] } }
  'make:notes': { arg: { conversationId: string }; result: MakeProjectNotes }
  'make:setNotes': { arg: { conversationId: string } & Partial<MakeProjectNotes>; result: MakeProjectNotes }
  'make:usage': { arg: { conversationId: string }; result: MakeUsage }
  'make:share': { arg: { conversationId: string }; result: MakeProjectState }
  'make:unshare': { arg: { conversationId: string }; result: MakeProjectState }
  /** Именной доступ (roadmap-3 п.6): role null — убрать. */
  'make:shareGrant': { arg: { conversationId: string; user: string; role: MakeShareRole | null }; result: MakeProjectState }
  'make:shared': { arg: { token: string }; result: MakeSharedState }
  'make:sharedFile': { arg: { token: string; path: string }; result: MakeFileContent }
  'make:sharedStories': { arg: { token: string }; result: { files: MakeStoryFile[] } }
  'make:comments': { arg: { conversationId: string }; result: { comments: MakeComment[] } }
  /** Heartbeat presence (каждые ~15 с и при смене файла/грязности); ответ — все живые вкладки. */
  'make:presence': { arg: { conversationId: string; clientId: string; path: string | null; editing: boolean; leave?: boolean }; result: { clients: MakePresenceClient[] } }
  'make:commentAdd': { arg: { conversationId: string; selector: string; elementLabel: string; text: string }; result: { comments: MakeComment[] } }
  'make:commentUpdate': { arg: { conversationId: string; commentId: string; resolved?: boolean; text?: string; status?: 'pending' | 'approved' }; result: { comments: MakeComment[] } }
  'make:commentRemove': { arg: { conversationId: string; commentId: string }; result: { comments: MakeComment[] } }
  'make:cleanup': { arg: { conversationId: string } & MakeCleanupOptions; result: MakeCleanupResult }
  'make:shot': { arg: { conversationId: string; file: string; story: string; dataBase64: string }; result: { shots: MakeStoryShot[] } }
  'make:snapshotFile': { arg: { conversationId: string; snapshotId: string; path: string }; result: MakeFileContent }
  'make:restoreFile': { arg: { conversationId: string; snapshotId: string; path: string }; result: MakeProjectState }
  /** Импорт ZIP (base64) — replace очищает проект, merge дописывает поверх. */
  'make:import': { arg: { conversationId: string; dataBase64: string; mode: MakeImportMode }; result: MakeProjectState }
  /** Импорт страницы по URL: HTML + same-origin css/js/картинки. */
  'make:importUrl': { arg: { conversationId: string; url: string; mode: MakeImportMode }; result: MakeProjectState }
  'conversations:create': { arg: { title?: string; projectId?: string | null; assistantKind?: 'web-recorder' | 'playwright-reader' | 'console-reader' | 'make' }; result: Conversation }
  /** Атомарно сохраняет новый обычный разговор и его первую пользовательскую реплику. */
  'conversations:createDraft': {
    arg: { idempotencyKey: string; title: string; projectId?: string | null; message: Omit<AddMessageArgs, 'conversationId'> }
    result: ConversationWithMessages
  }
  /** Создать или получить приватный проектный чат канбан-ассистента. */
  'kanbanAssistant:get': {
    arg: { projectId: string; conversationId?: string }
    result: ConversationWithMessages & { effectiveLlm: { llmEngineId: string | null; provider: LlmProvider; model: string; inherited: boolean } }
  }
  'widget:describe': { arg: import('./widgetAssistant').WidgetToolScope; result: import('./widgetAssistant').WidgetToolDescription }
  'widget:query': { arg: import('./widgetAssistant').WidgetToolQueryRequest; result: import('./widgetAssistant').WidgetToolQueryResult }
  'widget:get': { arg: import('./widgetAssistant').WidgetToolGetRequest; result: import('./widgetAssistant').WidgetToolGetResult }
  'widget:action': { arg: import('./widgetAssistant').WidgetToolActionRequest; result: import('./widgetAssistant').WidgetToolActionResult }
  'conversations:get': { arg: { id: string }; result: ConversationWithMessages | null }
  'conversations:contextSnapshot': { arg: { id: string }; result: import('./types').ConversationContextSnapshot | null }
  'conversations:setContextItem': { arg: { id: string; itemId: string; enabled: boolean }; result: import('./types').ConversationContextSnapshot | null }
  /** Доступные текущему пользователю машины в контексте разговора/проекта. */
  'conversations:listMachines': { arg: { id: string; projectId?: string | null }; result: import('./agentProtocol').AgentInfo[] }
  /**
   * Поиск разговоров по названию и содержимому сообщений (регистронезависимо).
   * Состав тот же, что у `conversations:list`, включая `includeCompleted`.
   */
  'conversations:search': { arg: { query: string; includeCompleted?: boolean }; result: Conversation[] }
  /**
   * Полнотекстовый поиск по сообщениям (FTS5 на сервере). Пустой `query` —
   * пустой результат. `projectId`: undefined — по всем беседам, null — только
   * беседы без проекта. Постранично через `cursor` из прошлого ответа.
   */
  'messages:search': {
    arg: {
      query: string
      projectId?: string | null
      conversationId?: string
      limit?: number
      cursor?: string | null
    }
    result: MessageSearchResult
  }
  'conversations:rename': { arg: { id: string; title: string }; result: void }
  /** Привязать/отвязать чат к проекту; сервер применяет настройки проекта. */
  'conversations:setProject': { arg: { id: string; projectId: string | null }; result: Conversation }
  'conversations:setPreviewUrl': { arg: { id: string; previewUrl: string | null }; result: Conversation }
  /** Контекст задачи для шапки связанного чата; null — чат не привязан к задаче. */
  'conversations:taskContext': { arg: { id: string }; result: TaskChatContext | null }
  /** Метки чатов задач для списка бесед: ключ, тип и последний ран. */
  'conversations:taskChats': { arg: void; result: TaskChatBadge[] }
  /** Сменить статус жизненного цикла чата. */
  'conversations:setStatus': { arg: { id: string; status: ConversationStatus }; result: Conversation }
  'conversations:setExecTarget': {
    arg: {
      id: string
      execTarget: string | null
      workdir?: string | null
      skillNames?: string[]
      /** Исполнитель разговора; null — из общих настроек. undefined — не менять. */
      llmEngineId?: string | null
      /** Движок разговора; null — из общих настроек. undefined — не менять. */
      llmProvider?: LlmProvider | null
      /** Модель разговора (действует вместе с llmProvider). undefined — не менять. */
      llmModel?: string | null
      /** Режим прав разговора; null — из общих настроек. undefined — не менять. */
      permissionMode?: PermissionMode | null
      /** Режим автоматического KB-контекста. */
      kbContextMode?: KbContextMode
    }
    result: Conversation
  }
  'conversations:getStorage': { arg: { id: string }; result: ChatStorageView | null }
  'conversations:setStorage': { arg: { id: string; machineId: string; storageId: string; relativePath?: string }; result: ChatStorageBinding }
  'conversations:delete': { arg: { id: string }; result: void }
  'messages:add': { arg: AddMessageArgs; result: Message }
  'messages:updateMeta': { arg: { conversationId: string; messageId: string; meta: TurnMeta }; result: Message }
  'messages:delete': { arg: { conversationId: string; messageId: string }; result: void }
  'uploads:add': { arg: { name: string; dataBase64: string; mimeType?: string; agentId?: string; conversationId?: string }; result: UploadInfo }
  'images:retouch': { arg: import('./imageRetouch').ImageRetouchRequest; result: import('./imageRetouch').ImageRetouchResult }
  'settings:get': { arg: void; result: Settings }
  'llm:access': { arg: void; result: import('./llmAccess').UserLlmAccess[] }
  /** Свой профиль и свой журнал безопасности: те же данные, что видит админ, но только о себе. */
  'me:profile': { arg: void; result: UserProfileInfo }
  'me:security': { arg: { limit?: number }; result: SecurityEvent[] }
  'llm:engines': { arg: void; result: LlmEngineOption[] }
  /**
   * Патч настроек: сервер применяет только присланные поля. Полный объект тоже
   * допустим, но именно патч не даёт вкладке со своим (уже устаревшим) снимком
   * затереть то, что человек только что поменял в другой вкладке. В ответе —
   * настройки целиком, какими они стали: клиент принимает их как истину и не
   * расходится с сервером после конкурентного патча.
   */
  'settings:save': { arg: Partial<Settings>; result: Settings }
  /** Возможности системы по ресурсам контейнера (блокировка STT/TTS при нехватке памяти). */
  'system:capabilities': { arg: void; result: SystemCapabilities }
  'stt:status': { arg: void; result: SttStatus }
  /** Список всех моделей Whisper с наличием и размером (управление местом). */
  'stt:models': { arg: void; result: WhisperModelInfo[] }
  /** Удалить файл модели Whisper (освободить место). */
  'stt:deleteModel': { arg: { model: WhisperModel }; result: void }
  'tts:voices': { arg: void; result: TtsVoiceInfo[] }
  'tts:catalog': { arg: void; result: TtsVoiceCatalog }
  /** Удалить установленный голос Piper (освободить место). */
  'tts:deleteVoice': { arg: { id: string }; result: void }
  /** Список подключённых MCP-серверов (read-only, из `claude mcp list`). */
  'mcp:list': { arg: void; result: McpServer[] }
  /** Статус авторизации CLI claude/codex (залогинен ли пользователь). */
  'auth:status': { arg: void; result: LoginStatusMap }
  /** Машины-агенты для удалённого выполнения команд (только web-режим). */
  'agents:list': { arg: void; result: AgentInfo[] }
  /** Постоянные файловые хранилища выбранной машины с фактическим состоянием. */
  'agents:listStorages': { arg: { id: string }; result: MachineStorage[] }
  /** Проверить и атомарно зарегистрировать корень ChatAI на машине. */
  'agents:registerStorage': { arg: { id: string; rootPath: string }; result: MachineStorage }
  /** Создать машину-агента; токен возвращается один раз. */
  'agents:create': { arg: { name: string }; result: AgentCreated }
  /** Удалить машину-агента (отзывает токен, рвёт соединение). */
  'agents:delete': { arg: { id: string }; result: void }
  /** Задать политику возможностей машины. */
  'agents:setPolicy': { arg: { id: string; policy: AgentPolicy }; result: void }
  /** Перевыпустить токен (старый перестаёт работать); токен возвращается один раз. */
  'agents:regenerateToken': { arg: { id: string; ttlDays?: number }; result: { token: string } }
  /** Отозвать токен машины: агент отключается, новый токен — через перевыпуск (п.11). */
  'agents:revokeToken': { arg: { id: string }; result: { ok: true } }
  /** Привязать токен к IP последнего подключения. */
  'agents:setPinIp': { arg: { id: string; pin: boolean }; result: { ok: true } }
  /** Обновить агента на машине: сервер выполняет на ней команду установки. */
  'agents:update': { arg: { id: string }; result: { ok: true; os: string } }
  /** Одна команда на несколько машин со сводкой (machines-roadmap п.15). */
  'agents:execBatch': { arg: { machineIds: string[]; command: string; projectId?: string }; result: BatchExecResult }
  /** Журнал команд машины: новые сверху; q — подстрока команды, source — фильтр источника. */
  'agents:commands': { arg: { id: string; limit?: number; q?: string; source?: MachineCommandSource }; result: MachineCommandRecord[] }
  /** Абсолютный URL артефакта для скачивания (десктоп/агент-приложение/скрипт). */
  'downloads:url': { arg: { kind: 'desktop' | 'agent-app' | 'agent-script' }; result: string }
  /** Строка подключения (адрес+токен) для настройки агента (приложение и скрипт). */
  'agents:connectionString': { arg: { token: string }; result: string }
  /** Проекты Claude Code (~/.claude/projects). */
  'cc:projects': { arg: void; result: CcProject[] }
  /** Сессии проекта Claude Code. */
  'cc:sessions': { arg: { slug: string }; result: CcSession[] }
  /** Транскрипт сессии (последние `limit` записей). */
  'cc:transcript': {
    arg: { slug: string; id: string; limit?: number }
    result: { items: CcItem[]; usage: SessionUsage }
  }
  /**
   * Продолжить сессию Claude Code: создаёт разговор с импортом истории и
   * привязкой к session-id (следующий ход — через `claude --resume`).
   */
  'cc:resume': { arg: { slug: string; id: string }; result: ConversationWithMessages }
  /** «Проекты» Codex (cwd-группы сессий ~/.codex/sessions). */
  'cx:projects': { arg: void; result: CxProject[] }
  /** Сессии Codex с указанным cwd. */
  'cx:sessions': { arg: { cwd: string }; result: CxSession[] }
  /** Транскрипт сессии Codex по id (последние `limit` записей). */
  'cx:transcript': { arg: { id: string; limit?: number }; result: { items: CxItem[]; usage: SessionUsage } }
  /**
   * Продолжить сессию Codex: создаёт разговор с импортом истории и привязкой
   * к session-id (следующий ход — через `codex exec resume <id>`).
   */
  'cx:resume': { arg: { id: string }; result: ConversationWithMessages }
  // --- Админ-страница пользователей (только admin) ---
  'admin:users': { arg: void; result: AdminUserInfo[] }
  /** Сессии пользователя и их отзыв администратором (auth-roadmap п.4). */
  'admin:userSessions': { arg: { name: string }; result: { sessions: SessionInfo[] } }
  'admin:revokeSession': { arg: { sid: string }; result: { ok: true } }
  /** Журнал безопасности (auth-roadmap п.7). */
  'admin:securityEvents': { arg: { user?: string; limit?: number; group?: string }; result: { events: SecurityEvent[] } }
  /** Инвайты (auth-roadmap п.8). */
  'admin:invites': { arg: void; result: { invites: InviteInfo[] } }
  'admin:inviteCreate': { arg: { role: UserRole; ttlHours?: number; maxUses?: number; note?: string; email?: string }; result: InviteInfo }
  'admin:inviteDelete': { arg: { token: string }; result: { ok: true } }
  /** Одноразовый код сброса пароля (auth-roadmap п.10). */
  'admin:resetCode': { arg: { name: string }; result: { code: string; expiresAt: number } }
  'admin:usageSummary': { arg: { from?: number; to?: number } | void; result: import('./admin').UserUsageSummary[] }
  'admin:makeStats': { arg: void; result: import('./admin').AdminMakeStats }
  /** Обновить агента на машине любого пользователя (machines-roadmap п.16). */
  'admin:updateMachine': { arg: { id: string }; result: { ok: true; os: string } }
  /** Метрики машин для дашборда админа (п.5). */
  'admin:machineStats': { arg: void; result: import('./admin').AdminMachineStats }
  'admin:revokeMachineToken': { arg: { id: string }; result: { ok: true } }
  /** Ролевые правила команд (п.10). */
  'admin:commandPolicy': { arg: void; result: { roles: import('./commandPolicy').RoleCommandPolicies } }
  'admin:setCommandPolicy': { arg: { roles: import('./commandPolicy').RoleCommandPolicies }; result: { roles: import('./commandPolicy').RoleCommandPolicies } }
  'admin:llmAccess': { arg: { name: string }; result: import('./llmAccess').UserLlmAccess[] }
  'admin:saveLlmAccess': { arg: { name: string; access: import('./llmAccess').UserLlmAccess[] }; result: import('./llmAccess').UserLlmAccess[] }
  'admin:createUser': { arg: { name: string; password: string; role: import('./types').UserRole; mustChangePassword?: boolean }; result: AdminUserInfo }
  'admin:updateUserRole': { arg: { name: string; role: import('./types').UserRole }; result: AdminUserInfo }
  /** Месячный лимит расхода LLM (auth-roadmap п.17); null — без лимита. */
  'admin:setUserLlmLimit': { arg: { name: string; llmLimitUsd: number | null }; result: AdminUserInfo }
  /** Открытая регистрация: настройка. */
  'admin:signupConfig': { arg: void; result: SignupConfig }
  'admin:setSignupConfig': { arg: { enabled?: boolean; role?: UserRole; ownedProjectLimit?: number; sessionLimit?: number }; result: SignupConfig }
  'admin:setBlocked': { arg: { name: string; blocked: boolean; reason?: string }; result: void }
  /** Машины одного человека: список людей их не содержит. */
  'admin:userMachines': { arg: { name: string }; result: import('./admin').AdminAgentInfo[] }
  'admin:deleteUser': { arg: { name: string }; result: void }
  'admin:usage': { arg: { name: string; unit: UsageUnit; from?: number; to?: number; conversationId?: string }; result: UsageReport }
  /** Личный расход текущей сессии; userId намеренно не передаётся. */
  'usage:report': { arg: { unit: UsageUnit; from?: number; to?: number; conversationId?: string }; result: UsageReport }
  'admin:conversations': { arg: { name: string }; result: Conversation[] }
  'admin:messages': { arg: { name: string; conversationId: string }; result: Message[] }
  'admin:modelPrices': { arg: void; result: import('./admin').ModelPrice[] }
  'admin:saveModelPrice': { arg: import('./admin').ModelPriceInput; result: import('./admin').ModelPrice }
  'admin:deleteModelPrice': { arg: { provider: string; model: string }; result: void }
  'admin:llmEngines': { arg: void; result: AdminLlmEngine[] }
  /** Очередь типов проекта на утверждение и решение по заявке. */
  'admin:projectTypes': { arg: void; result: import('./projectTypes').ProjectTypeNode[] }
  'admin:reviewProjectType': { arg: { id: string; decision: 'approve' | 'reject'; note?: string }; result: import('./projectTypes').ProjectTypeNode }
  'admin:createLlmEngine': { arg: AdminLlmEngineInput; result: AdminLlmEngine }
  'admin:updateLlmEngine': { arg: { id: string; patch: AdminLlmEngineInput }; result: AdminLlmEngine }
  'admin:deleteLlmEngine': { arg: { id: string }; result: void }
  'admin:checkLlmEngineHealth': { arg: { id: string }; result: AdminLlmEngineHealth }
  // --- Проекты + канбан ---
  /** Проекты, где текущий пользователь — участник. */
  'projects:list': { arg: void; result: ProjectSummary[] }
  'projects:quota': { arg: void; result: import('./projects').ProjectQuota }
  'projects:create': {
    arg: { name: string; typeId?: string; description?: string; gitUrl?: string; technologies?: string[]; skills?: string[]; defaultSkills?: Partial<WorkItemDefaultSkills>; commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'; mergeTransport?: 'local' | 'github_pull_request'; agentPlanApprovalMode?: 'manual' | 'automatic' }
    result: ProjectDetail
  }

  'projects:get': { arg: { id: string }; result: ProjectDetail | null }

  // --- Приглашения в проект ---
  /** Живые приглашения проекта (владельцу). */
  'projects:invitations': { arg: { id: string }; result: import('./projects').ProjectInvitation[] }
  'projects:invite': {
    arg: { id: string; invitee: string; role?: import('./projects').ProjectRole }
    /** `link` — одноразовая ссылка приглашения; в списках её нет. */
    result: { invitation: import('./projects').ProjectInvitation; mailed: boolean; link: string }
  }
  'projects:resendInvitation': { arg: { id: string; invitationId: string }; result: { invitation: import('./projects').ProjectInvitation; mailed: boolean; link: string } }
  'projects:revokeInvitation': { arg: { id: string; invitationId: string }; result: { ok: true } }
  /** Мои приглашения: адрес вне проекта — приглашённый ещё не участник. */
  'invitations:list': { arg: void; result: import('./projects').ProjectInvitationForUser[] }
  'invitations:accept': { arg: { token: string }; result: { projectId: string } }
  'invitations:decline': { arg: { token: string }; result: { ok: boolean } }

  // --- Дерево типов проекта ---
  /** Каталог: встроенные, опубликованные и собственные узлы пользователя. */
  'projectTypes:list': { arg: void; result: import('./projectTypes').ProjectTypeNode[] }
  'projectTypes:create': {
    arg: { name: string; parentId?: string | null; description?: string; features?: import('./projectTypes').ProjectFeatureOverride; defaults?: import('./projectTypes').ProjectTypeDefaults }
    result: import('./projectTypes').ProjectTypeNode
  }
  'projectTypes:update': {
    arg: { id: string; name?: string; parentId?: string | null; description?: string; features?: import('./projectTypes').ProjectFeatureOverride; defaults?: import('./projectTypes').ProjectTypeDefaults }
    result: import('./projectTypes').ProjectTypeNode
  }
  'projectTypes:delete': { arg: { id: string }; result: { ok: boolean } }
  /** Сохранить настроенный проект как подтип его текущего типа. */
  'projects:deriveType': { arg: { id: string; name: string }; result: import('./projectTypes').ProjectTypeNode }
  /** Отправка на утверждение администратором. */
  'projectTypes:publish': { arg: { id: string }; result: import('./projectTypes').ProjectTypeNode }
  'projectTypes:unpublish': { arg: { id: string }; result: import('./projectTypes').ProjectTypeNode }
  'releases:branches': { arg: { projectId: string }; result: import('./release').ReleaseBranch[] }
  'releases:createBranch': { arg: { projectId: string; branch: string; baseBranch?: string }; result: import('./release').ProjectRelease }
  'releases:list': { arg: { projectId: string }; result: import('./release').ProjectReleaseSummary[] }
  'releases:get': { arg: { projectId: string; releaseId: string }; result: import('./release').ProjectRelease | null }
  'releases:deploy': { arg: { projectId: string; branch: string }; result: import('./release').ProjectRelease }
  'releases:managedPreflight': { arg: { projectId: string }; result: import('./release').ManagedPreflightConfirmation }
  'releases:managedConfirm': { arg: { projectId: string; confirmationToken: string }; result: ProjectDetail }
  'projects:bootstrapProduction': { arg: { id: string; agentId: string; storageId?: string; deployCommand?: string; healthCheckCommand?: string }; result: import('./release').ProductionBootstrapResult }
  'releases:delete': { arg: { projectId: string; releaseId: string; branch: string }; result: { deleted: true } }
  'projects:update': {
    arg: {
      id: string
      /** Узел дерева типов: меняет живые возможности, доску не трогает. */
      typeId?: string
      name?: string
      description?: string
      gitUrl?: string | null
      previewUrl?: string | null
      testUsers?: import('./projects').ProjectTestUser[]
      technologies?: string[]
      skills?: string[]
      defaultSkills?: Partial<WorkItemDefaultSkills>
      commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'
      mergeTransport?: 'local' | 'github_pull_request'
      agentPlanApprovalMode?: 'manual' | 'automatic'
      testCommand?: string
      productionDeployCommand?: string
      productionAgentId?: string | null
      productionEnvironmentMode?: 'legacy' | 'managed'
      productionCheckoutPath?: string
      productionHealthCheckCommand?: string
      releaseTimeouts?: import('./release').ReleaseTimeouts
      ciBaseBranch?: string
      ciBranchTemplate?: string
      ciReuseStrategy?: 'reuse' | 'clean' | 'fail'
      ciExecAuthRef?: string
      doneRetentionDays?: number | null
      /** Режим и сценарий этапа Automated QA — их пишет и запись из Reader. */
      automatedQaMode?: import('./qa').AutomatedQaMode
      automatedQaScenarios?: import('./qa').AutomatedQaScenario[]
    }
    result: ProjectDetail
  }
  'projects:delete': { arg: { id: string }; result: void }

  /** Добавить участника (только владелец). */
  'projects:addMember': { arg: { id: string; username: string }; result: ProjectDetail }
  'projects:updateMemberRole': { arg: { id: string; username: string; role: 'owner' | 'member' }; result: ProjectDetail }
  'projects:removeMember': { arg: { id: string; username: string }; result: ProjectDetail }
  /** Привязать/отвязать машину-агента к проекту (только владелец). */
  'projects:linkMachine': { arg: { id: string; agentId: string; storageId?: string }; result: ProjectDetail }
  'projects:unlinkMachine': { arg: { id: string; agentId: string }; result: ProjectDetail }
  /** Уровень доступа предоставленной проекту машины (machines-roadmap п.18); только владелец машины. */
  'projects:setMachineShareAccess': { arg: { id: string; agentId: string; access: import('./agentProtocol').MachineShareAccess }; result: ProjectDetail }
  'projects:configureMachineStorage': { arg: { id: string; agentId: string; storageId: string; directories?: ProjectMachineDirectoryAssignments }; result: ProjectDetail }
  'projects:resetMachineDirectory': { arg: { id: string; agentId: string; kind: ProjectMachineDirectoryKind }; result: ProjectDetail }
  /** Задать папку проекта на конкретной машине (только владелец). */
  'projects:setReposRoot': { arg: { id: string; agentId: string; reposRoot: string }; result: ProjectDetail }
  'projects:setMachineSsh': { arg: { id: string; agentId: string; sshHost: string; sshUser: string }; result: ProjectDetail }
  'projects:setMachinePath': { arg: { id: string; agentId: string; path: string }; result: ProjectDetail }
  'projects:gitAccessStatus': { arg: { id: string; agentId: string; repositoryUrl: string }; result: GitAccessResult }
  'projects:configureGitAccess': { arg: { id: string; agentId: string; repositoryUrl: string; token: string }; result: GitAccessResult }
  'projects:verifyGitAccess': { arg: { id: string; agentId: string; repositoryUrl: string; refspec: string }; result: GitAccessResult }
  'projects:deleteGitAccess': { arg: { id: string; agentId: string; repositoryUrl: string }; result: GitAccessResult }
  'projects:gitAccessDiagnostics': { arg: { id: string; agentId: string; repositoryUrl: string }; result: GitAccessResult & { diagnostics?: GitAccessDiagnostics } }
  // --- Git в рабочей копии задачи/сессии ---
  // `workspace` — id рабочей копии (`GitWorkspaceRef.id`), а не путь: путь и машину
  // знает только сервер.
  'projects:gitWorkspaces': { arg: { id: string }; result: GitWorkspaceRef[] }
  'projects:gitStatus': { arg: { id: string; workspace: string }; result: GitWorkspaceStatus }
  'projects:gitBranches': { arg: { id: string; workspace: string; refresh?: boolean }; result: GitBranchList }
  'projects:gitTree': { arg: { id: string; workspace: string; dir: string; ref?: string }; result: GitTreeListing }
  'projects:gitFile': { arg: { id: string; workspace: string; path: string; ref?: string }; result: GitFileContent }
  'projects:gitDiff': { arg: { id: string; workspace: string; path: string; base?: string }; result: GitFileDiff }
  'projects:gitSaveFile': { arg: { id: string; workspace: string; path: string; content: string }; result: GitSaveFileResult }
  'projects:gitCheckout': { arg: { id: string; workspace: string; branch: string; confirmDirty?: boolean }; result: GitCheckoutResult }
  'projects:gitCreateBranch': { arg: { id: string; workspace: string; name: string; from?: string }; result: GitCheckoutResult }
  'projects:gitCommit': { arg: { id: string; workspace: string; message: string; paths?: string[]; all?: boolean }; result: GitCommitResult }
  'projects:gitPush': { arg: { id: string; workspace: string; branch?: string }; result: GitPushResult }
  /** Назначить legacy/production-машину проекта по умолчанию (только владелец). */
  'projects:setDefaultMachine': { arg: { id: string; agentId: string }; result: ProjectDetail }
  /**
   * Разовый прогон набора сценариев Automated QA по требованию. До него набор
   * можно было проверить только задачей на доске: записал сценарий — и жди
   * следующего рана, чтобы узнать, работает ли он.
   */
  'projects:checkAutomatedQa': { arg: { id: string; scenarioIndex?: number }; result: { results: import('./qa').AutomatedQaCheckResult[] } }
  /** Назначить персональную машину пользователя по умолчанию для проекта. */
  'projects:setUserDefaultMachine': { arg: { id: string; agentId: string }; result: ProjectDetail }
  /** Снапшот доски (колонки + задачи); includeCompleted — вместе со скрытыми завершёнными. */
  'board:get': { arg: { id: string; includeCompleted?: boolean }; result: Board }
  /** Вид доски человека в проекте (фильтры и раскладка) — хранится на сервере. */
  'board:getView': { arg: { id: string }; result: import('./projects').BoardView }
  /** Патч вида доски: присланные поля поверх сохранённых, в ответе — весь вид. */
  'board:saveView': { arg: { id: string; view: Partial<import('./projects').BoardView> }; result: import('./projects').BoardView }
  'columns:create': { arg: { projectId: string; name: string }; result: KanbanColumn }
  'columns:rename': { arg: { projectId: string; columnId: string; name?: string; wipLimit?: number | null }; result: void }
  'columns:setHidden': { arg: { projectId: string; columnId: string; hidden: boolean }; result: void }
  'columns:reorder': { arg: { projectId: string; order: string[] }; result: void }
  'columns:delete': { arg: { projectId: string; columnId: string }; result: void }
  /** Полная задача по id (тяжёлые поля, которых нет в лёгкой доске): грузит TaskModal. */
  'tasks:get': { arg: { projectId: string; taskId: string }; result: Task | null }
  'tasks:create': {
    arg: {
      projectId: string
      columnId: string
      title: string
      description?: string
      acceptanceCriteria?: string
      type?: 'epic' | 'story' | 'task'
      parentId?: string | null
      priority?: TaskPriority
      assignee?: string | null
      agentId?: string | null
      labels?: string[]
      skills?: string[]
      storyPoints?: number | null
      dueDate?: number | null
    }
    result: Task
  }
  'tasks:createFromProposalInPreparation': {
    arg: {
      projectId: string; proposalId: string; title: string; description?: string; acceptanceCriteria?: string
      type?: 'epic' | 'story' | 'task'; parentId?: string | null; priority?: TaskPriority; assignee?: string | null
      labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null
      selection?: import('./qa').TaskPreparationLlmSelection
    }
    result: import('./types').TaskLaunchResult
  }
  'tasks:update': {

    arg: {
      projectId: string
      taskId: string
      title?: string
      description?: string
      acceptanceCriteria?: string
      type?: 'epic' | 'story' | 'task'
      parentId?: string | null
      priority?: TaskPriority
      assignee?: string | null
      agentId?: string | null
      labels?: string[]
      skills?: string[]
      storyPoints?: number | null
      dueDate?: number | null
      flagged?: boolean
    }
    result: Task
  }

  /** Переместить задачу в колонку между соседями afterId/beforeId (смена статуса). */
  'tasks:move': {
    arg: { projectId: string; taskId: string; columnId: string; fromColumnId?: string | null; afterId?: string | null; beforeId?: string | null }
    result: Task
  }
  'tasks:listPreparationRuns': { arg: { projectId: string; taskId: string }; result: TaskPreparationRun[] }
  /** Один ран по id: точечная догрузка по WS-событию preparation.run.updated (без перезапроса всего списка). */
  'tasks:getPreparationRun': { arg: { runId: string }; result: TaskPreparationRun | null }
  'tasks:startPreparationRun': { arg: { projectId: string; taskId: string; selection?: import('./qa').TaskPreparationLlmSelection }; result: TaskPreparationRun }
  'tasks:cancelPreparationRun': { arg: { runId: string }; result: TaskPreparationRun }
  'tasks:retryPreparationRun': { arg: { runId: string; selection?: import('./qa').TaskPreparationLlmSelection }; result: TaskPreparationRun }
  'tasks:answerPreparationQuestion': { arg: { questionId: string; answer: string }; result: import('./qa').PreparationAnswerResult }
  'tasks:listPreparationNotifications': { arg: void; result: import('./qa').PreparationClarificationNotification[] }
  'tasks:dismissPreparationNotification': { arg: { questionId: string }; result: { dismissed: boolean } }
  'tasks:exportPreparationRun': { arg: { runId: string; format: 'md' | 'json' }; result: void }
  'tasks:delete': { arg: { projectId: string; taskId: string }; result: void }
  /** Открыть (или создать) связанный с задачей чат текущего пользователя. */
  'tasks:openChat': { arg: { projectId: string; taskId: string }; result: Conversation }
  /** Дизайны карточки: связи с Make-проектами проекта. */
  'tasks:designs': { arg: { projectId: string; taskId: string }; result: import('./projects').TaskDesignLink[] }
  'tasks:linkDesign': {
    arg: { projectId: string; taskId: string; conversationId: string; path?: string; label?: string }
    result: import('./projects').TaskDesignLink[]
  }
  'tasks:unlinkDesign': { arg: { projectId: string; taskId: string; linkId: string }; result: import('./projects').TaskDesignLink[] }
  /** Make-проекты, привязанные к проекту: выбор источника дизайна в карточке. */
  'projects:designSources': { arg: { id: string }; result: import('./projects').ProjectDesignSource[] }
  /** Обратная связь в панели Make: какие задачи ссылаются на проект/страницу. */
  'make:taskLinks': { arg: { conversationId: string; path?: string }; result: import('./projects').MakeTaskLink[] }
  'make:linkTask': { arg: { conversationId: string; taskId: string; path?: string; label?: string }; result: import('./projects').MakeTaskLink[] }
  /** Задачи проекта Make-чата — выбор в диалоге «Связать с задачей». */
  'make:linkableTasks': { arg: { conversationId: string }; result: import('./projects').MakeLinkableTask[] }
}

export type IpcChannel = keyof IpcInvokeMap
export type IpcArg<C extends IpcChannel> = IpcInvokeMap[C]['arg']
export type IpcResult<C extends IpcChannel> = IpcInvokeMap[C]['result']

/** Один чанк захваченного аудио: Int16 PCM mono (ArrayBuffer — дружелюбен к structured-clone). */
export interface AudioChunkMessage {
  /** Порядковый номер чанка в текущей сессии записи (с 0). */
  seq: number
  /** Частота дискретизации чанка (обычно 16000). */
  sampleRate: number
  /** Сэмплы Int16 mono как ArrayBuffer. */
  pcm: ArrayBuffer
}

/**
 * Односторонние сообщения renderer → main (ipcRenderer.send). Используются для
 * потока аудио: invoke-модель «запрос/ответ» здесь не подходит (высокая частота,
 * без ответа).
 */
export interface IpcSendMap {
  'audio:start': { conversationId: string | null; sampleRate: number }
  'audio:chunk': AudioChunkMessage
  'audio:stop': void
  /** Запрос ответа Claude на реплику (сегменты хода + вложения + режим консоли). */
  'claude:send': {
    conversationId: string
    messageId?: string
    segments: SttSegmentWire[]
    attachments?: string[]
    verbose?: boolean
    /** Цель именно этого хода: id машины, null — сервер, 'none' — без команд. */
    execTarget?: string | null
    /** Неперсистентный безопасный контекст служебного ассистента виджета. */
    assistantContext?: import('./widgetAssistant').WidgetAssistantContext
  }
  /** Прервать запрос к Claude (conversationId — какой ход; без него — все). */
  'claude:cancel': { conversationId?: string } | undefined
  /** Запустить скачивание текущей модели Whisper. */
  'stt:download': void
  /** Озвучить текст (TTS). */
  'tts:speak': { text: string; voice: string }
  /** Прервать озвучку. */
  'tts:cancel': void
  /** Скачать голос Piper по id. */
  'tts:downloadVoice': { id: string }
  /** Начать live-слежение за сессией Claude Code. */
  'cc:tailStart': { slug: string; id: string }
  /** Остановить live-слежение. */
  'cc:tailStop': void
  /** Начать live-слежение за сессией Codex. */
  'cx:tailStart': { id: string }
  /** Остановить live-слежение Codex. */
  'cx:tailStop': void
}

export type IpcSendChannel = keyof IpcSendMap
export type IpcSendPayload<C extends IpcSendChannel> = IpcSendMap[C]

export const IPC_SEND_CHANNELS: IpcSendChannel[] = [
  'audio:start',
  'audio:chunk',
  'audio:stop',
  'claude:send',
  'claude:cancel',
  'stt:download',
  'tts:speak',
  'tts:cancel',
  'tts:downloadVoice',
  'cc:tailStart',
  'cc:tailStop',
  'cx:tailStart',
  'cx:tailStop'
]

/**
 * Мост потокового аудио, доступный в renderer как `window.audio`.
 * Отдельно от `window.api` (invoke), т.к. это односторонний поток без ответа.
 */
export interface RendererAudioBridge {
  audioStart(payload: IpcSendPayload<'audio:start'>): void
  audioChunk(payload: AudioChunkMessage): void
  audioStop(): void
}

/** Сегмент распознавания для передачи в renderer (совпадает по форме с main SttSegment). */
export interface SttSegmentWire {
  speakerId: number
  text: string
  start?: number
  end?: number
}

/** Обновление распознавания (частичное или финальное). */
export interface SttUpdate {
  segments: SttSegmentWire[]
  text: string
}

/**
 * События main → renderer (webContents.send). Поток результатов STT.
 */
export interface IpcEventMap {
  'stt:partial': SttUpdate
  'stt:final': SttUpdate
  'stt:error': { message: string }
  /** Очередной фрагмент ответа Claude. */
  'claude:start': { conversationId: string } & TurnTarget
  'claude:token': { conversationId: string; delta: string }
  /** Ответ Claude завершён (полный текст + метаданные хода + движок ответа). */
  'claude:done': {
    conversationId: string
    text: string
    meta?: TurnMeta
    engine?: LlmProvider
    /** Сообщение, сохранённое сервером (клиент добавляет его в ленту как есть). */
    message?: Message
  }
  /** Ошибка при запросе к Claude. */
  'claude:error': { conversationId: string; message: string }
  /** Запись активности агента (режим консоли). */
  'claude:log': { conversationId: string; entry: ClaudeLogEntry }

  /** Живые счётчики токенов текущего хода (кумулятивные). */
  'claude:usage': { conversationId: string; usage: TurnUsage }
  /** Снапшот активных ходов при (пере)подключении — восстановление стрима. */
  'claude:active': { turns: ActiveTurn[] }
  'claude:queue': { conversationId: string; items: QueuedTurn[]; paused: boolean; published?: Message; removedMessageIds?: string[] }
  /** Прогресс скачивания модели Whisper (0–100). */
  'stt:downloadProgress': { percent: number }
  /** Скачивание модели завершено. */
  'stt:downloadDone': void
  /** Ошибка скачивания модели. */
  'stt:downloadError': { message: string }
  /** Синтезированное аудио ответа (байты WAV) для воспроизведения в renderer. */
  'tts:audio': { audio: ArrayBuffer }
  /** Ошибка озвучки (синтеза). */
  'tts:error': { message: string }
  /** Прогресс скачивания голоса (0–100). */
  'tts:voiceProgress': { id: string; percent: number }
  /** Голос скачан. */
  'tts:voiceDone': { id: string }
  /** Ошибка скачивания голоса. */
  'tts:voiceError': { id: string; message: string }
  /** Новые записи транскрипта отслеживаемой сессии Claude Code (live-tail). */
  'cc:tail': { slug: string; id: string; items: CcItem[] }
  /** Новые записи транскрипта отслеживаемой сессии Codex (live-tail). */
  'cx:tail': { id: string; items: CxItem[] }
}

export type IpcEventChannel = keyof IpcEventMap
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventMap[C]

export const IPC_EVENT_CHANNELS: IpcEventChannel[] = [
  'stt:partial',
  'stt:final',
  'stt:error',
  'claude:start',
  'claude:token',
  'claude:done',
  'claude:error',
  'claude:log',
  'claude:usage',
  'claude:active',
  'claude:queue',
  'stt:downloadProgress',
  'stt:downloadDone',
  'stt:downloadError',
  'tts:audio',
  'tts:error',
  'tts:voiceProgress',
  'tts:voiceDone',
  'tts:voiceError',
  'cc:tail',
  'cx:tail'
]

/**
 * Мост событий STT, доступный в renderer как `window.stt`. Каждый метод
 * подписывается на событие и возвращает функцию отписки.
 */
export interface RendererSttBridge {
  onPartial(cb: (update: SttUpdate) => void): () => void
  onFinal(cb: (update: SttUpdate) => void): () => void
  onError(cb: (err: { message: string }) => void): () => void
  /** Запустить скачивание модели (renderer → main). */
  download(): void
  onDownloadProgress(cb: (p: { percent: number }) => void): () => void
  onDownloadDone(cb: () => void): () => void
  onDownloadError(cb: (err: { message: string }) => void): () => void
}

/**
 * Мост живого списка машин-агентов, доступный как `window.agents`: подписка на
 * обновления статуса/списка по WebSocket (web-режим). В desktop отсутствует.
 */
export interface RendererAgentsBridge {
  onChange(cb: (agents: AgentInfo[]) => void): () => void
}

/**
 * Мост живой канбан-доски (web, поверх WS): подписка на доску проекта и приём
 * инвалидаций board.changed. В desktop отсутствует → без живой синхронизации.
 */
export interface RendererRealtimeBridge {
  /** Каждое успешное WS-подключение, включая reconnect. */
  onConnected(cb: () => void): () => void
  /** Открыт ли WS прямо сейчас (для самодиагностики транспорта). */
  connected(): boolean
  /** Invalidation-only событие; полный снимок читается по HTTP. */
  onTaskPreparationNotificationsInvalidated(cb: (m: { projectId: string }) => void): () => void
  /** Приглашения текущего пользователя изменились (позвали, отозвали, истекло). */
  onInvitationsInvalidated?(cb: () => void): () => void
  /** Состав участников или роль в проекте изменились: перечитать проект и список. */
  onProjectMembershipChanged?(cb: (projectId: string) => void): () => void
  /** Долгая команда машины завершилась — тост/уведомление (machines-roadmap п.17). */
  onMachineCommand?(cb: (event: MachineCommandEvent) => void): () => void
  /** Watchdog: машина пропала/вернулась (machines-roadmap п.1). */
  onMachineStatus?(cb: (event: MachineStatusEvent) => void): () => void
}

export interface RendererBoardBridge {
  /** Подписаться на инвалидации доски проекта. */
  subscribe(projectId: string): void
  /** Отписаться от текущей доски. */
  unsubscribe(): void
  /** Подписка на инвалидации доски. */
  onChanged(cb: (m: { projectId: string }) => void): () => void
  /** Успешное открытие общего WebSocket, включая reconnect. */
  onConnected(cb: () => void): () => void
  /** Адресная инвалидация истории подготовки задачи. */
  onPreparationRunUpdated(cb: (m: { projectId: string; taskId: string; runId: string }) => void): () => void
  /** Адресная инвалидация списка репозиториев задачи. */
  onTaskRepositoriesUpdated(cb: (m: { projectId: string; taskId: string }) => void): () => void
  /** Успешное восстановление WS после уже состоявшегося подключения. */
  onReconnect(cb: () => void): () => void
}

/**
 * Мост действий веб-превью (web, поверх WS): сервер транслирует вызовы
 * инструментов mcp__browser__* хода модели, клиент выполняет их в панели
 * превью и возвращает результат. В desktop отсутствует — действия недоступны.
 */
export interface RendererPreviewBridge {
  /** Подписка на действия сервера (preview.action). */
  onAction(cb: (m: { conversationId: string; requestId: string; action: PreviewAction }) => void): () => void
  /** Успешное действие Reader: живое состояние и запись ленты. */
  onChanged?(cb: (m: { conversationId: string; address: string | null; title: string | null; navigated: boolean; action: PreviewAction }) => void): () => void
  /** Ответ на действие (preview.result). */
  result(m: { conversationId?: string; registrationId?: string; requestId: string; ok: boolean; result?: PreviewActionResult; error?: string }): void
}

/**
 * Мост сессии (только web): вход/выход/текущий пользователь. В desktop отсутствует
 * (аутентификация приложения не нужна) — UI трактует это как «без логина».
 */
export interface RendererAuthBridge {
  onStatus(cb: (status: import('./auth').LoginStatusMap) => void): () => void
}

/**
 * Мост изолированного Chromium Playwright Reader (только web, поверх REST).
 * Сервер держит сессию на разговор в browser-runner: `start` поднимает Chromium,
 * `command` шлёт навигацию/ввод/вкладки/resize, `screenshot` тянет кадр (пиксели
 * настоящей страницы, а не DOM-клон), `stop` закрывает. Screencast здесь —
 * поллинг `screenshot`; incarnation из `start` защищает от команд мёртвой сессии.
 * В desktop отсутствует.
 */
export type RendererBrowserCommand = Exclude<BrowserCommand, { type: 'screenshot' }>
export interface RendererBrowserScreenshotOptions {
  incarnation: string
  tabId?: string
  fullPage?: boolean
  format?: 'png' | 'jpeg' | 'webp'
  quality?: number
}
export interface RendererBrowserBridge {
  /** Идемпотентно поднимает Chromium-сессию разговора и возвращает её метаданные. */
  start(conversationId: string, viewport?: BrowserViewport): Promise<BrowserSessionMetadata>
  /**
   * Команда живой сессии. incarnation — из `start`.
   *
   * Тип ответа зависит от команды, и раньше он был объявлен неверно: сигнатура
   * обещала метаданные сессии всегда, хотя `selector` отдаёт результат чтения и
   * поиска, а `inspect` — журналы страницы. Из-за этого панель не могла
   * показать ошибки страницы, не соврав компилятору.
   */
  command(conversationId: string, req: { incarnation: string; tabId?: string; command: RendererBrowserCommand }): Promise<BrowserSessionMetadata | BrowserSelectorResult | BrowserInspectResult>
  /** Кадр текущей вкладки как data-URL (поллинг для screencast). */
  screenshot(conversationId: string, req: RendererBrowserScreenshotOptions): Promise<{ dataUrl: string }>
  /** Закрывает Chromium-сессию разговора. */
  stop(conversationId: string): Promise<void>
}

export interface RendererSessionBridge {
  /** Вход: пользователь, `null` при отказе или вызов второго фактора (auth-roadmap п.6) — тогда нужен `login2fa`. */
  login(creds: { name: string; password: string; remember?: boolean }): Promise<SessionUser | LoginChallenge | null>
  login2fa?(input: { ticket: string; code: string }): Promise<SessionUser | null>
  /** Уведомления безопасности — входы с нового устройства (auth-roadmap п.16): получить непросмотренные и отметить. */
  /** `type` нужен клиенту: вход с нового устройства и вытеснение лимитом — разные новости. */
  securityNotices?(): Promise<Array<{ at: number; ip: string; userAgent: string; type: string }>>
  securityNoticesSeen?(): Promise<void>
  /** Сброс пароля кодом администратора (п.10) и смена своего пароля (пп.11–12). */
  resetPassword?(input: { name: string; code: string; password: string }): Promise<{ ok: true } | { error: string }>
  requestPasswordReset?(email: string): Promise<{ ok: true; message: string } | { error: string }>
  resetPasswordByEmail?(input: { token: string; password: string }): Promise<{ ok: true } | { error: string }>
  changePassword?(input: { current: string; next: string }): Promise<{ ok: true } | { error: string }>
  /** Открытая регистрация с подтверждением email (web). */
  /**
   * Держится ли сессия на cookie (web). `false` после успешного входа означает,
   * что браузер не сохранил `Set-Cookie` — тогда сессия живёт только в памяти
   * страницы и умрёт от перезагрузки, о чём интерфейс обязан предупредить.
   * В desktop мост метод не реализует: там сессии нет вовсе.
   */
  hasCookieSession?(): boolean
  signupEnabled?(): Promise<boolean>
  signup?(input: { name: string; email: string; password: string }): Promise<{ ok: true; mailSent: boolean } | { error: string }>
  signupResend?(email: string): Promise<void>
  verifyEmail?(token: string): Promise<{ ok: true } | { error: string }>
  /**
   * Публичный превью приглашения в проект по ссылке из письма. Доступен до входа:
   * человек должен понимать, куда его зовут, ещё на экране входа.
   */
  projectInvitationPreview?(token: string): Promise<import('./projects').ProjectInvitationPreview | null>
  /** Саморегистрация по инвайту (auth-roadmap п.8, web). */
  inviteInfo?(token: string): Promise<{ role: string; expiresAt: number; note: string } | null>
  register?(input: { token: string; name: string; password: string }): Promise<{ ok: true } | { error: string }>
  /** Настройка второго фактора (web): секрет/ссылка, включить по коду, выключить по коду, статус. */
  twoFactor?: { status(): Promise<{ enabled: boolean }>; setup(): Promise<{ secret: string; otpauth: string }>; enable(code: string): Promise<void>; disable(code: string): Promise<void> }
  /**
   * Транспорт получил 401. Рантайм по этому сигналу гасит сессию и показывает
   * вход, вместо того чтобы оставлять человека на сломанном экране.
   */
  onUnauthorized?(cb: () => void): () => void
  me(): Promise<SessionUser | null>
  logout(): Promise<void>
  /**
   * Сессии пользователя (auth-roadmap п.4). Методы необязательные, но в обоих
   * клиентах есть: desktop ставит те же remote-мосты поверх REST/WS, что и web.
   */
  sessions?(): Promise<SessionInfo[]>
  /** Завершить остальные сессии; `includeCurrent` — выйти везде, включая эту. */
  logoutAll?(options?: { includeCurrent?: boolean }): Promise<void>
  revokeSession?(sid: string): Promise<void>
  /** Имя устройства от пользователя; null возвращает автоматическую подпись. */
  renameSession?(sid: string, label: string | null): Promise<void>
  /** Доверенное устройство не спрашивает второй фактор при следующем входе. */
  trustSession?(sid: string, trusted: boolean): Promise<void>
  /** Недавно завершённые сессии — справка «я точно закрыл тот вход». */
  endedSessions?(): Promise<SessionInfo[]>
  /** «Это не я»: гасит все сессии и требует смену пароля при следующем входе. */
  panicSessions?(): Promise<void>
  /** События безопасности конкретного устройства — «что тут было». */
  sessionHistory?(sid: string): Promise<Array<{ id: number; at: number; type: string; details: string }>>
  /** Снять доверие со всех своих устройств. */
  untrustAllSessions?(): Promise<void>
  /**
   * Живые изменения сессий: список устарел либо эту сессию завершили с другого
   * устройства. Второе приходит адресно — иначе вкладка узнаёт о потере доступа
   * только на следующем запросе к API.
   */
  onSessionsChanged?(cb: (event: { type: 'update' } | { type: 'revoked'; sid: string }) => void): () => void
  /**
   * Выпускает HttpOnly-cookie превью из действующего Bearer-токена. Нужен сессиям,
   * восстановленным без повторного login (токен из localStorage, перезапуск браузера):
   * без cookie same-origin iframe /api/preview получает 401. Нет в desktop-мосте.
   */
  ensurePreview?(): Promise<boolean>
}

/**
 * Мост файлового проводника по машине-агенту (только web). Все операции —
 * request/response поверх REST; возвращают FsResult (листинг/содержимое файла).
 */
export interface RendererFsBridge {
  list(agentId: string, path: string, projectId?: string): Promise<FsResult>
  read(agentId: string, path: string, projectId?: string): Promise<FsResult>
  write(agentId: string, path: string, dataBase64: string, projectId?: string): Promise<FsResult>
  remove(agentId: string, path: string, projectId?: string): Promise<FsResult>
  /** Корзина машины (агент ≥ 0.15.0): результат содержит trashedPath для отката. */
  trash?(agentId: string, path: string, projectId?: string): Promise<FsResult>
  /** Скопировать файл на другую машину (targetDir пуст — `ChatAI/incoming` целевой машины). */
  copyTo?(agentId: string, path: string, targetAgentId: string, targetDir?: string, projectId?: string): Promise<FsCopyResult>
  rename(agentId: string, from: string, to: string, projectId?: string): Promise<FsResult>
  mkdir(agentId: string, path: string, projectId?: string): Promise<FsResult>
  /**
   * Выполнить команду на машине (утилита «Консоль»). `signal` — «Стоп» в консоли:
   * обрыв запроса доходит до сервера, тот шлёт агенту `exec.cancel`, и команда
   * на машине снимается вместе с деревом процессов.
   */
  exec(agentId: string, command: string, signal?: AbortSignal, projectId?: string): Promise<AgentExecResult>
}

/**
 * Мост чтения файлов с диска СЕРВЕРА (только web). Нужен для картинок, которые
 * создаёт сам CLI: они лежат в профиле пользователя на сервере, а не на машине.
 * Сервер отдаёт только «свою» область; чужой или несуществующий путь → null,
 * чтобы вызывающий мог спокойно попробовать прочитать файл с машины.
 */
export interface RendererFilesBridge {
  read(path: string): Promise<ServerFileInfo | null>
}

/**
 * Мост живого PTY-терминала по машине (web = поверх WS). Отправка — start/input/
 * resize/kill; подписки — output/exit/error. Отсутствует в desktop → терминал
 * деградирует до однострочной консоли.
 */
/** Мост Make (web): сервер сообщает об изменении файлов проекта — панель обновляет превью и дерево. */
export interface RendererMakeBridge {
  onChanged(cb: (m: { conversationId: string; rev: number; paths: string[] }) => void): () => void
  /** Presence вкладок (roadmap-2 п.14); у старых хостов может отсутствовать. */
  onPresence?(cb: (m: { conversationId: string; clients: MakePresenceClient[] }) => void): () => void
}

export interface RendererPtyBridge {
  start(params: { agentId: string; ptyId: string; cols: number; rows: number; cwd?: string; projectId?: string }): void
  input(params: { ptyId: string; data: string }): void
  resize(params: { ptyId: string; cols: number; rows: number }): void
  kill(params: { ptyId: string }): void
  /** Вызывается после каждого (пере)подключения WS, чтобы живые вкладки переподписались. */
  onConnected(cb: () => void): () => void
  onOutput(cb: (m: { ptyId: string; data: string }) => void): () => void
  onExit(cb: (m: { ptyId: string; exitCode: number | null }) => void): () => void
  onError(cb: (m: { ptyId: string; message: string }) => void): () => void
}

/**
 * Мост Claude, доступный в renderer как `window.claude`: отправка реплики,
 * отмена и подписка на поток ответа (main → renderer).
 */
export interface RendererClaudeBridge {
  send(payload: IpcSendPayload<'claude:send'>): void
  cancel(payload?: IpcSendPayload<'claude:cancel'>): void
  editQueued?(payload: { conversationId: string; id: string; text: string; segments: SttSegmentWire[] }): void
  deleteQueued?(payload: { conversationId: string; id: string }): void
  reorderQueued?(payload: { conversationId: string; ids: string[] }): void
  sendQueuedNow?(payload: { conversationId: string; id: string }): void
  onToken(cb: (msg: IpcEventPayload<'claude:token'>) => void): () => void
  /** Старт хода: движок/модель/машина для шапки живого ответа (только remote-мост). */
  onStart?(cb: (msg: IpcEventPayload<'claude:start'>) => void): () => void
  onDone(cb: (msg: IpcEventPayload<'claude:done'>) => void): () => void
  onError(cb: (msg: IpcEventPayload<'claude:error'>) => void): () => void
  /** Подписка на активность агента (режим консоли). */
  onLog(cb: (msg: IpcEventPayload<'claude:log'>) => void): () => void
  /** Живые счётчики токенов хода (только remote-мост; desktop-main не шлёт). */
  onUsage?(cb: (msg: IpcEventPayload<'claude:usage'>) => void): () => void
  /** Снапшот активных ходов (только remote-мост; desktop-main его не шлёт). */
  onActive?(cb: (msg: IpcEventPayload<'claude:active'>) => void): () => void
  onQueue?(cb: (msg: IpcEventPayload<'claude:queue'>) => void): () => void
}

/**
 * Мост Проводника Claude Code, доступный в renderer как `window.cc`:
 * live-tail активной сессии (invoke-часть — через `window.api`).
 */
export interface RendererCcBridge {
  /** Начать слежение за сессией. */
  tailStart(payload: IpcSendPayload<'cc:tailStart'>): void
  /** Остановить слежение. */
  tailStop(): void
  /** Подписка на новые записи транскрипта. */
  onTail(cb: (msg: IpcEventPayload<'cc:tail'>) => void): () => void
}

/**
 * Мост Проводника Codex, доступный в renderer как `window.codex`:
 * live-tail активной сессии (invoke-часть — через `window.api`).
 */
export interface RendererCodexBridge {
  /** Начать слежение за сессией Codex. */
  tailStart(payload: IpcSendPayload<'cx:tailStart'>): void
  /** Остановить слежение. */
  tailStop(): void
  /** Подписка на новые записи транскрипта. */
  onTail(cb: (msg: IpcEventPayload<'cx:tail'>) => void): () => void
}

/**
 * Мост TTS, доступный в renderer как `window.tts`: озвучка, отмена и подписка
 * на завершение/ошибку.
 */
export interface RendererTtsBridge {
  speak(payload: IpcSendPayload<'tts:speak'>): void
  cancel(): void
  onAudio(cb: (msg: IpcEventPayload<'tts:audio'>) => void): () => void
  onError(cb: (err: { message: string }) => void): () => void
  /** Скачать голос Piper по id. */
  downloadVoice(payload: IpcSendPayload<'tts:downloadVoice'>): void
  onVoiceProgress(cb: (msg: IpcEventPayload<'tts:voiceProgress'>) => void): () => void
  onVoiceDone(cb: (msg: IpcEventPayload<'tts:voiceDone'>) => void): () => void
  onVoiceError(cb: (msg: IpcEventPayload<'tts:voiceError'>) => void): () => void
}

export const IPC_CHANNELS: IpcChannel[] = [
  'app:ping',
  'kb:status',
  'kb:topics',
  'kb:search',
  'kb:document',
  'kb:context',
  'kb:saveDocument',
  'kb:deleteDocument',
  'kb:research',
  'kb:researchStatus',
  'prompt:suggest',
  'conversations:list',
  'make:state',
  'make:read',
  'make:write',
  'make:delete',
  'make:rename',
  'make:snapshot',
  'make:restore',
  'make:reset',
  'make:publish',
  'make:unpublish',
  'make:usage',
  'make:cleanup',
  'make:share',
  'make:unshare',
  'make:shareGrant',
  'make:shared',
  'make:sharedFile',
  'make:sharedStories',
  'make:comments',
  'make:presence',
  'make:commentAdd',
  'make:commentUpdate',
  'make:commentRemove',
  'make:check',
  'make:template',
  'make:upload',
  'make:search',
  'make:stories',
  'make:replace',
  'make:snapshotDiff',
  'make:library',
  'make:libraryExport',
  'make:libraryInsert',
  'make:libraryRemove',
  'make:shots',
  'make:tests',
  'make:notes',
  'make:setNotes',
  'make:shot',
  'make:snapshotFile',
  'make:restoreFile',
  'make:import',
  'make:importUrl',
  'conversations:create',
  'conversations:createDraft',
  'conversations:get',
  'conversations:contextSnapshot',
  'conversations:setContextItem',
  'conversations:listMachines',
  'conversations:search',
  'messages:search',
  'conversations:rename',
  'conversations:setProject',
  'conversations:setPreviewUrl',
  'conversations:taskContext',
  'conversations:taskChats',
  'conversations:setStatus',
  'conversations:setExecTarget',
  'conversations:delete',
  'messages:add',
  'messages:updateMeta',
  'messages:delete',
  'uploads:add',
  'settings:get',
  'llm:access',
  'me:profile',
  'me:security',
  'settings:save',
  'system:capabilities',
  'stt:status',
  'stt:models',
  'stt:deleteModel',
  'tts:voices',
  'tts:catalog',
  'tts:deleteVoice',
  'mcp:list',
  'auth:status',
  'agents:list',
  'agents:create',
  'agents:delete',
  'agents:setPolicy',
  'agents:regenerateToken',
  'agents:revokeToken',
  'agents:setPinIp',
  'agents:update',
  'agents:commands',
  'agents:execBatch',
  'downloads:url',
  'agents:connectionString',
  'cc:projects',
  'cc:sessions',
  'cc:transcript',
  'cc:resume',
  'cx:projects',
  'cx:sessions',
  'cx:transcript',
  'cx:resume',
  'admin:users',
  'admin:userSessions',
  'admin:revokeSession',
  'admin:securityEvents',
  'admin:invites',
  'admin:inviteCreate',
  'admin:inviteDelete',
  'admin:resetCode',
  'admin:setUserLlmLimit',
  'admin:signupConfig',
  'admin:setSignupConfig',
  'admin:makeStats',
  'admin:updateMachine',
  'admin:machineStats',
  'admin:revokeMachineToken',
  'admin:commandPolicy',
  'admin:setCommandPolicy',
  'admin:llmAccess',
  'admin:saveLlmAccess',
  'admin:createUser',
  'admin:setBlocked',
  'admin:userMachines',
  'admin:deleteUser',
  'admin:usage',
  'usage:report',
  'admin:conversations',
  'admin:messages',
  'admin:llmEngines',
  'admin:projectTypes',
  'admin:reviewProjectType',
  'admin:createLlmEngine',
  'admin:updateLlmEngine',
  'admin:deleteLlmEngine',
  'admin:checkLlmEngineHealth',
  'projects:list',
  'projects:quota',
  'projects:create',
  'projects:get',
  'projects:invitations',
  'projects:invite',
  'projects:resendInvitation',
  'projects:revokeInvitation',
  'invitations:list',
  'invitations:accept',
  'invitations:decline',
  'projectTypes:list',
  'projectTypes:create',
  'projectTypes:update',
  'projectTypes:delete',
  'projects:deriveType',
  'projectTypes:publish',
  'projectTypes:unpublish',
  'releases:branches',
  'releases:createBranch',
  'releases:list',
  'releases:get',
  'releases:deploy',
  'releases:managedPreflight',
  'releases:managedConfirm',
  'projects:bootstrapProduction',
  'releases:delete',
  'projects:update',
  'projects:delete',
  'projects:addMember',
  'projects:updateMemberRole',
  'projects:removeMember',
  'projects:linkMachine',
  'projects:checkAutomatedQa',
  'projects:unlinkMachine',
  'projects:setMachineShareAccess',
  'projects:configureMachineStorage',
  'projects:resetMachineDirectory',
  'projects:setMachinePath',
  'projects:gitAccessStatus',
  'projects:configureGitAccess',
  'projects:verifyGitAccess',
  'projects:deleteGitAccess',
  'projects:gitAccessDiagnostics',
  'projects:gitWorkspaces',
  'projects:gitStatus',
  'projects:gitBranches',
  'projects:gitTree',
  'projects:gitFile',
  'projects:gitDiff',
  'projects:gitSaveFile',
  'projects:gitCheckout',
  'projects:gitCreateBranch',
  'projects:gitCommit',
  'projects:gitPush',
  'projects:setReposRoot',
  'projects:setMachineSsh',
  'projects:setDefaultMachine',
  'projects:setUserDefaultMachine',
  'board:get',
  'board:getView',
  'board:saveView',
  'columns:create',
  'columns:rename',
  'columns:setHidden',
  'columns:reorder',
  'columns:delete',
  'tasks:get',
  'tasks:create',
  'tasks:createFromProposalInPreparation',
  'tasks:update',
  'tasks:move',
  'tasks:listPreparationRuns',
  'tasks:getPreparationRun',
  'tasks:cancelPreparationRun',
  'tasks:startPreparationRun',
  'tasks:retryPreparationRun',
  'tasks:answerPreparationQuestion',
  'tasks:listPreparationNotifications',
  'tasks:dismissPreparationNotification',
  'tasks:exportPreparationRun',
  'tasks:delete',
  'tasks:openChat',
  'tasks:designs',
  'tasks:linkDesign',
  'tasks:unlinkDesign',
  'projects:designSources',
  'make:taskLinks',
  'make:linkTask',
  'make:linkableTasks'
]

/**
 * Форма моста, доступного в renderer как `window.api`.
 * Каждый канал становится методом с типизированным аргументом и Promise-результатом.
 */
export type RendererApi = {
  [C in IpcChannel]: IpcArg<C> extends void
    ? () => Promise<IpcResult<C>>
    : (arg: IpcArg<C>) => Promise<IpcResult<C>>
}

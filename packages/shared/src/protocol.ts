import type { MakePresenceClient } from './make'
// Контракт клиент↔сервер (Ф1). HTTP REST — запрос/ответ; WebSocket — стриминг.
// Семантика соответствует прежним Electron-IPC каналам (1:1), но транспорт-нейтральна.

import type {
  ClaudeLogEntry,
  Conversation,
  LlmProvider,
  Message,
  MessageAttachment,
  MessageRole,
  SttSegment,
  TurnMeta,
  TurnUsage,
  WhisperModel
} from './types'
import type { CcItem } from './cc'
import type { CxItem } from './codexSessions'
import type { AgentInfo } from './agentProtocol'
import type { CiRunDetail, CiLogLine, CiRun, CiRunStep, CiFixAttempt, CiRunConclusion, CiRunSummary, CiInteraction } from './ci'
import type { KbUsageQuery } from './kb'
import type { PreviewAction, PreviewActionResult } from './previewActions'
import type { LoginStatusMap } from './auth'

// --- Общие ---------------------------------------------------------------

/** Сегмент для передачи по сети (совпадает с SttSegment). */
export type SttSegmentWire = SttSegment

/** Обновление распознавания (частичное/финальное). */
export interface SttUpdate {
  segments: SttSegmentWire[]
  text: string
}

/** Статус локальной модели Whisper. */
export interface SttStatus {
  present: boolean
  model: WhisperModel
}

/** Доступность одной функции (STT/TTS) на этой машине/в контейнере. */
export interface CapabilityStatus {
  /** Функция разрешена (ресурсов достаточно). */
  available: boolean
  /** Причина недоступности для показа в UI ('' — если доступно). */
  reason: string
}

/**
 * Возможности системы по ресурсам контейнера. Считаются на сервере при старте:
 * если памяти меньше порога — распознавание речи (STT) и/или озвучка (TTS)
 * блокируются (и в настройках, и жёстко на сервере).
 */
export interface SystemCapabilities {
  stt: CapabilityStatus
  tts: CapabilityStatus
  /** Лимит памяти контейнера (cgroup) либо память хоста, байты. */
  memoryLimitBytes: number
  /** Число доступных CPU (cgroup-квота либо ядра хоста). */
  cpuCount: number
}

// --- HTTP REST -----------------------------------------------------------
//
// GET    /api/health                         -> { ok, version }
// GET    /api/conversations                  -> Conversation[]
// POST   /api/conversations {title?}         -> Conversation
// GET    /api/conversations/:id              -> ConversationWithMessages | 404
// PATCH  /api/conversations/:id {title}      -> Conversation
// DELETE /api/conversations/:id              -> { ok }
// POST   /api/conversations/:id/messages AddMessageArgs -> Message
// POST   /api/migrations/desktop DesktopMigrationBundle -> DesktopMigrationResult
// GET    /api/settings                       -> Settings
// PUT    /api/settings  Settings             -> Settings
// GET    /api/system/capabilities            -> SystemCapabilities
// GET    /api/stt/status                     -> SttStatus
// GET    /api/tts/voices                     -> TtsVoiceInfo[]
// GET    /api/tts/catalog                    -> TtsVoiceCatalog

export interface ConversationWithMessages {
  conversation: Conversation
  messages: Message[]
}

export interface AddMessageArgs {
  role: MessageRole
  text: string
  time: string
  /** Движок ответа (для роли 'ai'); запекается в сообщение. */
  engine?: LlmProvider
  /** Метаданные хода (токены/тайминги/детали запроса) — для роли 'ai'. */
  meta?: TurnMeta
  /** Цель этой реплики: id машины, null — сервер, 'none' — команды запрещены. */
  execTarget?: string | null
  /** Только метаданные вложений, без байтов. */
  attachments?: MessageAttachment[]
}

/** Legacy-данные монолитного desktop для одноразового идемпотентного импорта. */
export interface DesktopMigrationBundle {
  conversations: Array<{
    conversation: Pick<Conversation, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'claudeSessionId' | 'execTarget'>
    messages: Message[]
  }>
}

export interface DesktopMigrationResult {
  conversationsImported: number
  messagesImported: number
}

export interface HealthResponse {
  ok: true
  /** Номер версии собранного релиза; null, если release-метаданные не переданы. */
  version: string | null
  /** ISO-время сборки/выпуска релиза. */
  releasedAt: string
  /** Короткий Git SHA собранного релиза; null вне Git-сборки. */
  commit: string | null
  /** Номер связанной задачи в формате chat-149; null, если определить нельзя. */
  task: string | null
}

/** Пути REST (единый источник для сервера и клиентов). */
export const REST = {
  health: '/api/health',
  kbStatus: '/api/kb/status',
  kbTopics: '/api/kb/topics',
  kbSearch: '/api/kb/search',
  kbContext: '/api/kb/context',
  kbDocument: (id: string) => `/api/kb/documents/${encodeURIComponent(id)}`,
  /** Запись статьи БЗ (создание/правка); раздел и проект — в теле запроса. */
  kbDocuments: '/api/kb/documents',
  /** «Исследовать проект»: POST — запустить, GET — состояние последнего прогона. */
  projectKbResearch: (id: string) => `/api/projects/${encodeURIComponent(id)}/kb/research`,
  /** Телеметрия обращений модели к БЗ: по одному чату и агрегат по проекту. */
  conversationKbUsage: (id: string) => `/api/conversations/${encodeURIComponent(id)}/kb-usage`,
  conversationKbUsageViewed: (id: string) => `/api/conversations/${encodeURIComponent(id)}/kb-usage/viewed`,
  projectKbUsage: (id: string) => `/api/projects/${encodeURIComponent(id)}/kb-usage`,
  sessionLogin: '/api/session/login',
  sessionMe: '/api/session/me',
  sessionLogout: '/api/session/logout',
  /** Сессии текущего пользователя и «выйти везде» (auth-roadmap п.4). */
  sessionList: '/api/session/list',
  /** Bearer → HttpOnly cookie-сессия + CSRF (auth-roadmap п.5). */
  sessionCookie: '/api/session/cookie',
  /** Второй фактор TOTP (auth-roadmap п.6): код после пароля, настройка и отключение. */
  session2fa: '/api/session/2fa',
  session2faSetup: '/api/session/2fa/setup',
  session2faEnable: '/api/session/2fa/enable',
  session2faDisable: '/api/session/2fa/disable',
  sessionLogoutAll: '/api/session/logout-all',
  sessionRevoke: (sid: string) => `/api/session/${encodeURIComponent(sid)}`,
  adminSessions: (user: string) => `/api/admin/users/${encodeURIComponent(user)}/sessions`,
  adminSessionRevoke: (sid: string) => `/api/admin/sessions/${encodeURIComponent(sid)}`,
  sessionPreview: '/api/session/preview',
  conversations: '/api/conversations',
  /** Make: состояние/файлы проекта разговора. */
  makeState: (id: string) => `/api/make/${encodeURIComponent(id)}`,
  makeFile: (id: string) => `/api/make/${encodeURIComponent(id)}/file`,
  makeRename: (id: string) => `/api/make/${encodeURIComponent(id)}/rename`,
  makeSnapshots: (id: string) => `/api/make/${encodeURIComponent(id)}/snapshots`,
  makeRestore: (id: string, snapshotId: string) => `/api/make/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}/restore`,
  makeReset: (id: string) => `/api/make/${encodeURIComponent(id)}/reset`,
  makePublish: (id: string) => `/api/make/${encodeURIComponent(id)}/publish`,
  makeCheck: (id: string) => `/api/make/${encodeURIComponent(id)}/check`,
  makeTemplate: (id: string) => `/api/make/${encodeURIComponent(id)}/template`,
  makeUpload: (id: string) => `/api/make/${encodeURIComponent(id)}/upload`,
  makeSearch: (id: string) => `/api/make/${encodeURIComponent(id)}/search`,
  makeReplace: (id: string) => `/api/make/${encodeURIComponent(id)}/replace`,
  makeSnapshotDiff: (id: string, snapshotId: string) => `/api/make/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}/diff`,
  makeSnapshotFile: (id: string, snapshotId: string) => `/api/make/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}/file`,
  makeRestoreFile: (id: string, snapshotId: string) => `/api/make/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}/restore-file`,
  makeImport: (id: string) => `/api/make/${encodeURIComponent(id)}/import`,
  makeImportUrl: (id: string) => `/api/make/${encodeURIComponent(id)}/import-url`,
  makeNotes: (id: string) => `/api/make/${encodeURIComponent(id)}/notes`,
  makeTests: (id: string) => `/api/make/${encodeURIComponent(id)}/tests`,
  makeTestsPage: (id: string, file: string) => `/api/preview/make/${encodeURIComponent(id)}/__tests__?file=${encodeURIComponent(file)}`,
  makeStories: (id: string) => `/api/make/${encodeURIComponent(id)}/stories`,
  /** Страница-раннер сториз внутри превью (cookie-аутентификация, как у превью). */
  makeLibrary: '/api/make/library',
  makeLibraryExport: (id: string) => `/api/make/${encodeURIComponent(id)}/library`,
  makeLibraryInsert: (id: string, slug: string) => `/api/make/${encodeURIComponent(id)}/library/${encodeURIComponent(slug)}/insert`,
  makeLibraryItem: (slug: string) => `/api/make/library/${encodeURIComponent(slug)}`,
  makeShots: (id: string) => `/api/make/${encodeURIComponent(id)}/shots`,
  makeUsage: (id: string) => `/api/make/${encodeURIComponent(id)}/usage`,
  makeComments: (id: string) => `/api/make/${encodeURIComponent(id)}/comments`,
  makePresence: (id: string) => `/api/make/${encodeURIComponent(id)}/presence`,
  makeComment: (id: string, commentId: string) => `/api/make/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`,
  /** Комментарии зрителей публикации (roadmap-4 п.34): GET — одобренные, POST — новый (в модерацию). */
  makePublicComments: (token: string) => `/p/${encodeURIComponent(token)}/__comments__`,
  makeCleanup: (id: string) => `/api/make/${encodeURIComponent(id)}/cleanup`,
  makeShotImage: (id: string, shotId: string) => `/api/preview/make/${encodeURIComponent(id)}/__shots__/${encodeURIComponent(shotId)}.png`,
  makeGalleryPage: (id: string) => `/api/preview/make/${encodeURIComponent(id)}/__gallery__`,
  makeStoriesPage: (id: string) => `/api/preview/make/${encodeURIComponent(id)}/__stories__`,
  /** Превью и ZIP-экспорт живут под /api/preview/…: там действует preview-cookie для iframe и ссылок. */
  makePreview: (id: string) => `/api/preview/make/${encodeURIComponent(id)}/`,
  makeShare: (id: string) => `/api/make/${encodeURIComponent(id)}/share`,
  makeShareGrants: (id: string) => `/api/make/${encodeURIComponent(id)}/share/grants`,
  makeShared: (token: string) => `/api/make/shared/${encodeURIComponent(token)}`,
  makeSharedFile: (token: string, path: string) => `/api/make/shared/${encodeURIComponent(token)}/file?path=${encodeURIComponent(path)}`,
  makeSharedStories: (token: string) => `/api/make/shared/${encodeURIComponent(token)}/stories`,
  makeSharedPreview: (token: string) => `/api/preview/make-shared/${encodeURIComponent(token)}/`,
  makeExport: (id: string) => `/api/preview/make/${encodeURIComponent(id)}/export.zip`,
  conversationDraft: '/api/conversations/draft',
  conversationsSearch: '/api/conversations/search',
  /** Полнотекстовый поиск по сообщениям пользователя (FTS5). */
  messagesSearch: '/api/search',
  conversation: (id: string) => `/api/conversations/${id}`,
  conversationMachines: (id: string) => `/api/conversations/${encodeURIComponent(id)}/machines`,
  conversationContextSnapshot: (id: string) => `/api/conversations/${encodeURIComponent(id)}/context-snapshot`,
  /** Включить/выключить пункт контекста разговора (тумблер инспектора). */
  conversationContextItem: (id: string, itemId: string) => `/api/conversations/${encodeURIComponent(id)}/context/${encodeURIComponent(itemId)}`,
  conversationProject: (id: string) => `/api/conversations/${encodeURIComponent(id)}/project`,
  conversationStatus: (id: string) => `/api/conversations/${encodeURIComponent(id)}/status`,
  messages: (id: string) => `/api/conversations/${id}/messages`,
  desktopMigration: '/api/migrations/desktop',
  message: (id: string, messageId: string) => `/api/conversations/${id}/messages/${messageId}`,
  uploads: '/api/uploads',
  /** Локальная AI-ретушь: crop+маска обрабатываются отдельно, результат публикуется сообщением. */
  imageRetouch: '/api/images/retouch',
  /** Явная публикация временного managed-результата в artifacts разговора. */
  artifactPublish: '/api/artifacts/publish',
  /** Чтение файла с диска сервера (только «своя» область) — картинки от CLI. */
  serverFile: '/api/files/read',
  /** Same-origin прокси внешнего сайта для iframe-превью. */
  preview: (url: string) => `/api/preview?url=${encodeURIComponent(url)}`,
  /** Playwright Reader: оркестрация изолированной Chromium-сессии разговора. */
  browserSessionStart: (id: string) => `/api/browser/${encodeURIComponent(id)}/start`,
  browserSessionCommand: (id: string) => `/api/browser/${encodeURIComponent(id)}/command`,
  browserSessionScreenshot: (id: string) => `/api/browser/${encodeURIComponent(id)}/screenshot`,
  browserSession: (id: string) => `/api/browser/${encodeURIComponent(id)}`,
  settings: '/api/settings',
  llmAccess: '/api/llm-access',
  /** Личные данные текущей сессии; uid никогда не передаётся клиентом. */
  meLlmAccess: '/api/me/llm-access',
  /** Личный отчёт по расходу моделей текущего пользователя. */
  usage: '/api/usage',
  meUsage: '/api/me/usage',
  llmEngines: '/api/llm-engines',
  /** Помощник промптов: переформулировки черновика запроса (одноразовый LLM-вызов). */
  promptSuggest: '/api/prompt/suggest',
  systemCapabilities: '/api/system/capabilities',
  sttStatus: '/api/stt/status',
  sttModels: '/api/stt/models',
  sttModel: (model: string) => `/api/stt/models/${model}`,
  ttsVoices: '/api/tts/voices',
  ttsCatalog: '/api/tts/catalog',
  ttsVoice: (id: string) => `/api/tts/voices/${id}`,
  ttsVoiceDownload: (id: string) => `/api/tts/voices/${id}/download`,
  sttDownload: '/api/stt/download',
  mcpServers: '/api/mcp/servers',
  authStatus: '/api/auth/status',
  agents: '/api/agents',
  agentScript: '/api/agents/script',
  agentInstallAndroid: '/api/agents/install-android.sh',
  agentInstallWindows: '/api/agents/install-windows.ps1',
  agentInstallLinux: '/api/agents/install-linux.sh',
  agentInstallMacos: '/api/agents/install-macos.sh',
  agentApp: '/api/agents/app',
  desktopApp: '/api/app/desktop',
  agent: (id: string) => `/api/agents/${encodeURIComponent(id)}`,
  agentStorages: (id: string) => `/api/agents/${encodeURIComponent(id)}/storages`,
  conversationStorage: (id: string) => `/api/conversations/${encodeURIComponent(id)}/storage`,
  agentPolicy: (id: string) => `/api/agents/${encodeURIComponent(id)}/policy`,
  agentToken: (id: string) => `/api/agents/${encodeURIComponent(id)}/token`,
  /** Обновить агента на машине: сервер выполняет на ней ту же команду установки. */
  agentUpdate: (id: string) => `/api/agents/${encodeURIComponent(id)}/update`,
  // --- Файловый проводник по машине ---
  agentFs: (id: string) => `/api/agents/${encodeURIComponent(id)}/fs`,
  agentFsFile: (id: string) => `/api/agents/${encodeURIComponent(id)}/fs/file`,
  agentFsRename: (id: string) => `/api/agents/${encodeURIComponent(id)}/fs/rename`,
  agentFsMkdir: (id: string) => `/api/agents/${encodeURIComponent(id)}/fs/mkdir`,
  agentFsTrash: (id: string) => `/api/agents/${encodeURIComponent(id)}/fs/trash`,
  agentFsCopyTo: (id: string) => `/api/agents/${encodeURIComponent(id)}/fs/copy-to`,
  agentExec: (id: string) => `/api/agents/${encodeURIComponent(id)}/exec`,
  /** Последняя доступная версия агента (публично; для «Проверить обновления»). */
  agentLatestVersion: '/api/agents/version',
  ccProjects: '/api/cc/projects',
  ccSessions: (slug: string) => `/api/cc/projects/${encodeURIComponent(slug)}/sessions`,
  ccTranscript: (slug: string, id: string) =>
    `/api/cc/projects/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(id)}`,
  ccResume: '/api/cc/resume',
  cxProjects: '/api/cx/projects',
  cxSessions: '/api/cx/sessions',
  cxTranscript: '/api/cx/transcript',
  cxResume: '/api/cx/resume',
  // --- Админ-страница пользователей (только admin) ---
  adminUsers: '/api/admin/users',
  adminUsersUsageSummary: '/api/admin/users/usage-summary',
  /** Журнал безопасности (auth-roadmap п.7): `?user=&limit=`. */
  adminSecurity: '/api/admin/security',
  /** Инвайты на саморегистрацию (auth-roadmap п.8). */
  adminInvites: '/api/admin/invites',
  adminInvite: (token: string) => `/api/admin/invites/${encodeURIComponent(token)}`,
  sessionInvite: (token: string) => `/api/session/invite/${encodeURIComponent(token)}`,
  sessionRegister: '/api/session/register',
  /** Открытая регистрация с подтверждением email: статус, заявка, подтверждение, повторное письмо; настройка в админке. */
  sessionSignup: '/api/session/signup',
  sessionSignupResend: '/api/session/signup/resend',
  sessionVerify: '/api/session/verify',
  adminSignup: '/api/admin/signup',
  /** Сброс пароля кодом администратора (п.10) и смена своего пароля (пп.11–12). */
  sessionReset: '/api/session/reset',
  sessionPassword: '/api/session/password',
  /** Отметить уведомления безопасности просмотренными (п.16). */
  sessionNoticesSeen: '/api/session/notices/seen',
  adminUserResetCode: (name: string) => `/api/admin/users/${encodeURIComponent(name)}/reset-code`,
  adminUser: (name: string) => `/api/admin/users/${encodeURIComponent(name)}`,
  adminUserBlock: (name: string) => `/api/admin/users/${encodeURIComponent(name)}/block`,
  adminUserLlmAccess: (name: string) => `/api/admin/users/${encodeURIComponent(name)}/llm-access`,
  adminUserUsage: (name: string) => `/api/admin/users/${encodeURIComponent(name)}/usage`,
  adminUserConversations: (name: string) =>
    `/api/admin/users/${encodeURIComponent(name)}/conversations`,
  adminUserMessages: (name: string) => `/api/admin/users/${encodeURIComponent(name)}/messages`,
  adminLlmEngines: '/api/admin/llm-engines',
  adminModelPrices: '/api/admin/model-prices',
  adminMakeStats: '/api/admin/make/stats',
  adminMakeMetrics: '/api/admin/make/metrics',
  adminModelPrice: (provider: string, model: string) => '/api/admin/model-prices/' + encodeURIComponent(provider) + '/' + encodeURIComponent(model),
  adminLlmEngine: (id: string) => `/api/admin/llm-engines/${encodeURIComponent(id)}`,
  adminLlmEngineHealth: (id: string) => `/api/admin/llm-engines/${encodeURIComponent(id)}/health`,
  /** Запустить безопасный host-side деплой (только admin). */
  adminDeploy: '/api/admin/deploy',
  // --- Проекты + канбан ---
  projects: '/api/projects',
  project: (id: string) => `/api/projects/${encodeURIComponent(id)}`,
  projectMembers: (id: string) => `/api/projects/${encodeURIComponent(id)}/members`,
  projectMember: (id: string, username: string) =>
    `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(username)}`,
  projectMachines: (id: string) => `/api/projects/${encodeURIComponent(id)}/machines`,
  projectMachine: (id: string, agentId: string) =>
    `/api/projects/${encodeURIComponent(id)}/machines/${encodeURIComponent(agentId)}`,
  projectDefaultMachine: (id: string) => `/api/projects/${encodeURIComponent(id)}/default-machine`,
  projectUserDefaultMachine: (id: string) => `/api/projects/${encodeURIComponent(id)}/machines/default`,
  /** Снапшот доски; includeCompleted=1 добавляет давно завершённые задачи. */
  projectBoard: (id: string, includeCompleted?: boolean) =>
    `/api/projects/${encodeURIComponent(id)}/board${includeCompleted ? '?includeCompleted=1' : ''}`,
  projectColumns: (id: string) => `/api/projects/${encodeURIComponent(id)}/columns`,
  projectColumnsReorder: (id: string) => `/api/projects/${encodeURIComponent(id)}/columns/reorder`,
  projectColumn: (id: string, columnId: string) =>
    `/api/projects/${encodeURIComponent(id)}/columns/${encodeURIComponent(columnId)}`,
  projectColumnHidden: (id: string, columnId: string) =>
    `/api/projects/${encodeURIComponent(id)}/columns/${encodeURIComponent(columnId)}/hidden`,
  projectTasks: (id: string) => `/api/projects/${encodeURIComponent(id)}/tasks`,
  projectTask: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`,
  projectTaskMove: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/move`,
  projectTaskChat: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/chat`,
  taskMergeStart: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/merge`,
  taskMergeMachines: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/merge/machines`,
  mergeRun: (runId: string) => `/api/merge/runs/${encodeURIComponent(runId)}`,
  taskRepositories: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/repositories`,
  taskMergeRuns: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/merge/runs`,
  mergeRunDeploy: (runId: string) => `/api/merge/runs/${encodeURIComponent(runId)}/deploy`,
  taskQa: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa`,
  taskComponentQa: (id:string,taskId:string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa/component`,
  taskComponentQaRuns: (id:string,taskId:string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa/component/runs`,
  taskComponentQaAction: (id:string,taskId:string,runId:string,action:'cancel'|'complete'|'fix') =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa/component/runs/${encodeURIComponent(runId)}/${action}`,
  taskQaCriteria: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa/criteria`,
  taskQaCriterion: (id: string, taskId: string, criterionId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa/criteria/${encodeURIComponent(criterionId)}`,
  taskQaPreparationComplete: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa/preparation/complete`,
  taskQaPreparationRetry: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa/preparation/retry`,
  taskQaSessions: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa/sessions`,
  taskQaSession: (id: string, taskId: string, sessionId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa/sessions/${encodeURIComponent(sessionId)}`,
  taskQaResult: (id: string, taskId: string, resultId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa/results/${encodeURIComponent(resultId)}`,
  taskQaComplete: (id: string, taskId: string, sessionId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa/sessions/${encodeURIComponent(sessionId)}/complete`,
  taskQaFix: (id: string, taskId: string, sessionId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/qa/sessions/${encodeURIComponent(sessionId)}/fix`,

  // --- CI-раннер (Авто-подготовка окружения для таска) ---
  ciCommands: '/api/ci/commands',
  ciCommand: (id: string) => `/api/ci/commands/${encodeURIComponent(id)}`,
  ciCommandUsage: (id: string) => `/api/ci/commands/${encodeURIComponent(id)}/usage`,
  ciSettings: '/api/ci/settings',
  ciSuggestions: '/api/ci/suggestions',
  ciSuggestion: (id: string) => `/api/ci/suggestions/${encodeURIComponent(id)}`,
  ciWorkspaces: '/api/ci/workspaces',
  projectReleaseBranches: (id: string) => `/api/projects/${encodeURIComponent(id)}/releases/branches`,
  projectReleases: (id: string) => `/api/projects/${encodeURIComponent(id)}/releases`,
  projectReleaseDeploy: (id: string) => `/api/projects/${encodeURIComponent(id)}/releases/deploy`,
  projectManagedProductionPreflight: (id: string) => `/api/projects/${encodeURIComponent(id)}/releases/managed/preflight`,
  projectManagedProductionConfirm: (id: string) => `/api/projects/${encodeURIComponent(id)}/releases/managed/confirm`,
  /** Авто-подготовка прод-машины: storage/привязка/каталоги/команды/managed за один запрос. */
  projectProductionBootstrap: (id: string) => `/api/projects/${encodeURIComponent(id)}/production/bootstrap`,
  projectRelease: (id: string, releaseId: string) => `/api/projects/${encodeURIComponent(id)}/releases/${encodeURIComponent(releaseId)}`,
  projectCi: (id: string) => `/api/projects/${encodeURIComponent(id)}/ci`,
  projectCiLlm: (id: string) => `/api/projects/${encodeURIComponent(id)}/ci/llm`,
  taskCiLlm: (id: string, taskId: string) => `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/ci/llm`,
  taskCi: (id: string, taskId: string) => `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/ci`,
  taskCiMachines: (id: string, taskId: string) => `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/ci/machines`,
  ciRunStart: (id: string, taskId: string) => `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/ci/run`,
  /** Принудительный запуск на явно указанной машине (даже из очереди). */
  ciRunForceStart: (id: string, taskId: string) => `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/ci/run-on-machine`,
  ciMetrics: (id: string) => `/api/projects/${encodeURIComponent(id)}/ci/metrics`,
  ciRun: (runId: string) => `/api/ci/runs/${encodeURIComponent(runId)}`,
  ciRunLog: (runId: string) => `/api/ci/runs/${encodeURIComponent(runId)}/log`,
  /** Обращения модели к БЗ внутри одного рана и агрегат по всем ранам задачи. */
  ciRunKbUsage: (runId: string) => `/api/ci/runs/${encodeURIComponent(runId)}/kb-usage`,
  taskKbUsage: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/kb-usage`,
  /** Отчёт по расходу модели: один ран и все раны задачи (раздел «Отчёт» карточки). */
  ciRunReport: (runId: string) => `/api/ci/runs/${encodeURIComponent(runId)}/report`,
  taskCiReport: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/report`,
  taskTimeline: (id: string, taskId: string) =>
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/timeline`,
  ciRunCancel: (runId: string) => `/api/ci/runs/${encodeURIComponent(runId)}/cancel`,
  /** Убрать только ещё ожидающий ран; ответ отличает гонку с началом выполнения. */
  ciRunDequeue: (runId: string) => `/api/ci/runs/${encodeURIComponent(runId)}/dequeue`,
  ciRunRetry: (runId: string) => `/api/ci/runs/${encodeURIComponent(runId)}/retry`,
  ciRunRetryFromStep: (runId: string) => `/api/ci/runs/${encodeURIComponent(runId)}/retry-from-step`,
  ciRunDiscardAndRetry: (runId: string) => `/api/ci/runs/${encodeURIComponent(runId)}/discard-and-retry`,
  ciConsoleExec: (runId: string) => `/api/ci/runs/${encodeURIComponent(runId)}/console`,
  ciConsoleMode: (runId: string) => `/api/ci/runs/${encodeURIComponent(runId)}/console/mode`,
  ciRunInteraction: (runId: string, interactionId: string) =>
    `/api/ci/runs/${encodeURIComponent(runId)}/interactions/${encodeURIComponent(interactionId)}`,
  conversationTaskContext: (id: string) => `/api/conversations/${encodeURIComponent(id)}/task-context`,
  /** Метки всех чатов пользователя, привязанных к задачам (подсветка списка бесед). */
  conversationTaskChats: '/api/conversations/task-chats'
} as const

// --- WebSocket -----------------------------------------------------------
//
// Аудио-чанки (Int16 PCM) шлются бинарными кадрами. Остальное — JSON-кадры {t,...}.
// Синтезированное аудио TTS сервер шлёт бинарными кадрами с префиксом-заголовком
// (см. кодирование ниже) либо base64 в JSON `tts.audio` (реализация выберёт).

/** Метаданные загруженного вложения (ответ POST /api/uploads). */
export interface UploadInfo {
  /** id загруженного файла на сервере (для передачи в claude.send). */
  id: string
  /** Имя файла (для отображения). */
  name: string
  /** Фактический путь, сохраняемый в истории только как метаданные. */
  path: string
  mimeType: string
  size: number
  agentId?: string
}

/** Содержимое файла с диска сервера (ответ GET /api/files/read). */
export interface ServerFileInfo {
  /** Имя файла (для скачивания и заголовка). */
  name: string
  /** Содержимое в base64. */
  dataBase64: string
}

/** Серверная запись очереди следующего хода. Payload хранится в SQLite, поэтому
 * карточка и вложения восстанавливаются после reconnect/restart. */
export interface QueueTurnPayload {
  segments: SttSegmentWire[]
  attachments?: string[]
  verbose?: boolean
  execTarget?: string | null
  assistantContext?: import('./widgetAssistant').WidgetAssistantContext
}

export interface QueuedTurn {
  id: string
  conversationId: string
  messageId: string
  text: string
  attachments: string[]
  /** Метаданные для превью; upload-id в attachments остаются авторитетным payload запуска. */
  attachmentDetails?: MessageAttachment[]
  position: number
  status: 'queued' | 'failed'
  createdAt: number
}

/** Активный (незавершённый) ход модели — для восстановления стрима после reconnect. */
/** Кем и где выполняется ход — для шапки живого ответа до его завершения. */
export interface TurnTarget {
  provider: LlmProvider
  /** Модель, ушедшая в CLI ('' — умолчание движка). */
  model: string
  /** Машина выполнения: id агента, null — сервер, 'none' — без выполнения. */
  execTarget: string | null
}

export interface ActiveTurn extends Partial<TurnTarget> {
  conversationId: string
  /** Накопленный частичный текст ответа. */
  partial: string
  /** Активность хода — восстановление живого статуса и счётчика действий. */
  activity?: ClaudeLogEntry[]
  /** Накопленные счётчики токенов хода — восстановление живого счётчика. */
  usage?: TurnUsage
}

/** client → server. */
export type ClientMessage =
  | { t: 'audio.start'; sampleRate: number }
  | { t: 'audio.stop' }
  | {
      t: 'claude.send'
      conversationId: string
      /** Сохранённая пользовательская реплика; служит идемпотентным ключом очереди. */
      messageId?: string
      segments: SttSegmentWire[]
      /** id вложений (из POST /api/uploads), которые Claude должен учесть. */
      attachments?: string[]
      /** Режим консоли: слать активность агента (claude.log). */
      verbose?: boolean
      /** Цель именно этого хода: id машины, null — сервер, 'none' — без команд. */
      execTarget?: string | null
      assistantContext?: import('./widgetAssistant').WidgetAssistantContext
    }
  | { t: 'claude.cancel'; conversationId?: string }
  | { t: 'claude.queue.edit'; conversationId: string; id: string; text: string; segments: SttSegmentWire[] }
  | { t: 'claude.queue.delete'; conversationId: string; id: string }
  /** Полный желаемый порядок ожидающих элементов; сервер применяет его атомарно. */
  | { t: 'claude.queue.reorder'; conversationId: string; ids: string[] }
  | { t: 'claude.queue.now'; conversationId: string; id: string }
  | { t: 'tts.speak'; text: string; voice: string }
  | { t: 'tts.cancel' }
  | { t: 'tts.downloadVoice'; id: string }
  | { t: 'stt.download' }
  | { t: 'cc.tail.start'; slug: string; id: string }
  | { t: 'cc.tail.stop' }
  | { t: 'cx.tail.start'; id: string }
  | { t: 'cx.tail.stop' }
  | { t: 'pty.start'; agentId: string; ptyId: string; cols: number; rows: number; cwd?: string; projectId?: string }
  | { t: 'pty.input'; ptyId: string; data: string }
  | { t: 'pty.resize'; ptyId: string; cols: number; rows: number }
  | { t: 'pty.kill'; ptyId: string }
  | { t: 'board.subscribe'; projectId: string }
  | { t: 'board.unsubscribe' }
  | { t: 'ci.subscribe'; runId: string }
  | { t: 'ci.unsubscribe'; runId: string }
  /**
   * Ответ клиента на preview.action: результат действия в панели превью.
   * `requestId` — из запроса; `result` уходит модели сериализованным JSON.
   */
  | { t: 'preview.result'; conversationId?: string; registrationId?: string; requestId: string; ok: boolean; result?: PreviewActionResult; error?: string }

/** server → client. */
export type ServerMessage =
  | { t: 'auth.status'; v: 1; status: LoginStatusMap }
  | { t: 'stt.partial'; update: SttUpdate }
  | { t: 'stt.final'; update: SttUpdate }
  | { t: 'stt.error'; message: string }
  /** Ход стартовал: движок/модель/машина известны сразу, а не только в claude.done. */
  | ({ t: 'claude.start'; conversationId: string } & TurnTarget)
  | { t: 'claude.token'; conversationId: string; delta: string }
  | {
      t: 'claude.done'
      conversationId: string
      text: string
      meta?: TurnMeta
      engine?: LlmProvider
      /** Сообщение, сохранённое сервером в БД (клиент не сохраняет сам). */
      message?: Message
    }
  | { t: 'claude.error'; conversationId: string; message: string }
  | { t: 'claude.log'; conversationId: string; entry: ClaudeLogEntry }
  | { t: 'claude.usage'; conversationId: string; usage: TurnUsage }
  | { t: 'claude.active'; turns: ActiveTurn[] }
  | { t: 'claude.queue'; conversationId: string; items: QueuedTurn[]; paused: boolean; published?: Message; removedMessageIds?: string[] }
  | { t: 'tts.audio'; audio: string } // base64 WAV (или бинарный кадр — см. реализацию)
  | { t: 'tts.error'; message: string }
  | { t: 'tts.voiceProgress'; id: string; percent: number }
  | { t: 'tts.voiceDone'; id: string }
  | { t: 'tts.voiceError'; id: string; message: string }
  | { t: 'stt.downloadProgress'; percent: number }
  | { t: 'stt.downloadDone' }
  | { t: 'stt.downloadError'; message: string }
  | { t: 'cc.tail'; slug: string; id: string; items: CcItem[] }
  | { t: 'cx.tail'; id: string; items: CxItem[] }
  | { t: 'agents'; agents: AgentInfo[] }
  | { t: 'pty.output'; ptyId: string; data: string }
  | { t: 'pty.exit'; ptyId: string; exitCode: number | null }
  | { t: 'pty.error'; ptyId: string; message: string }
  | { t: 'board.changed'; projectId: string }
  | { t: 'preparation.run.updated'; projectId: string; taskId: string; runId: string }
  | { t: 'task.repositories.updated'; projectId: string; taskId: string }
  /** Снимок уведомлений подготовки изменился; содержимое читается только по HTTP. */
  | { t: 'task-preparation.notifications.invalidate'; v: 1; projectId: string }
  | { t: 'ci.snapshot'; runId: string; detail: CiRunDetail; log: CiLogLine[] }
  | { t: 'ci.run'; runId: string; run: CiRun }
  | { t: 'ci.step'; runId: string; step: CiRunStep }
  | { t: 'ci.log'; runId: string; line: CiLogLine }
  | { t: 'ci.fix'; runId: string; attempt: CiFixAttempt }
  | { t: 'ci.done'; runId: string; run: CiRun; conclusion?: CiRunConclusion }
  | { t: 'ci.summary'; projectId: string; summary: CiRunSummary }
  | { t: 'ci.interaction'; runId: string; interaction: CiInteraction }
  | { t: 'merge.snapshot'; runId: string; run: import('./merge').MergeRun }
  /**
   * Сообщение, которое сервер сам дописал в чат (резюме CI-рана): открытый чат
   * должен показать его сразу, а не после переоткрытия. Ход модели здесь не при
   * чём — поэтому это не `claude.done`.
   */
  | { t: 'chat.message'; conversationId: string; message: Message }
  /**
   * Обращение к базе знаний (авто-инъекция сервером или вызов mcp__kb__*
   * моделью). Рассылается по userId, как `claude.usage`, — подписки нет.
   * `query.status: 'pending'` приходит в начале обращения, терминальный статус —
   * вторым кадром с тем же `query.id`; гонку «REST-снапшот vs инкремент» клиент
   * закрывает монотонным `query.seq`.
   */
  | { t: 'kb.usage'; conversationId: string; projectId: string | null; query: KbUsageQuery }
  /**
   * Действие модели в панели веб-превью (инструменты mcp__browser__*).
   * Выполняет его только клиент, у которого чат `conversationId` активен;
   * остальные отвечают preview.result с ok:false — сервер ждёт первый успех.
   */
  | { t: 'preview.action'; conversationId: string; requestId: string; action: PreviewAction }
  /** Make: файлы проекта изменились (ассистентом или пользователем) — превью и дерево обновляются. */
  | { t: 'make.changed'; conversationId: string; rev: number; paths: string[] }
  /** Presence вкладок проекта Make (roadmap-2 п.14): кто открыл проект и какой файл правит. */
  | { t: 'make.presence'; conversationId: string; clients: MakePresenceClient[] }

export type ClientMessageType = ClientMessage['t']
export type ServerMessageType = ServerMessage['t']

/** Полный список типов сообщений — для проверок контракта в тестах. */
export const CLIENT_MESSAGE_TYPES: ClientMessageType[] = [
  'audio.start',
  'audio.stop',
  'claude.send',
  'claude.cancel',
  'claude.queue.edit',
  'claude.queue.delete',
  'claude.queue.reorder',
  'claude.queue.now',
  'tts.speak',
  'tts.cancel',
  'tts.downloadVoice',
  'stt.download',
  'cc.tail.start',
  'cc.tail.stop',
  'cx.tail.start',
  'cx.tail.stop',
  'pty.start',
  'pty.input',
  'pty.resize',
  'pty.kill',
  'board.subscribe',
  'board.unsubscribe',
  'ci.subscribe',
  'ci.unsubscribe',
  'preview.result'
]

export const SERVER_MESSAGE_TYPES: ServerMessageType[] = [
  'auth.status',
  'stt.partial',
  'stt.final',
  'stt.error',
  'claude.start',
  'claude.token',
  'claude.done',
  'claude.error',
  'claude.log',
  'claude.usage',
  'claude.active',
  'claude.queue',
  'tts.audio',
  'tts.error',
  'tts.voiceProgress',
  'tts.voiceDone',
  'tts.voiceError',
  'stt.downloadProgress',
  'stt.downloadDone',
  'stt.downloadError',
  'cc.tail',
  'cx.tail',
  'agents',
  'pty.output',
  'pty.exit',
  'pty.error',
  'board.changed',
  'preparation.run.updated',
  'task.repositories.updated',
  'task-preparation.notifications.invalidate',
  'ci.snapshot',
  'ci.run',
  'ci.step',
  'ci.log',
  'ci.fix',
  'ci.done',
  'ci.summary',
  'ci.interaction',
  'merge.snapshot',
  'chat.message',
  'kb.usage',
  'preview.action'
]

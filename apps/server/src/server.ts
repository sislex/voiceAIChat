// Сборка Fastify-приложения (HTTP + WebSocket). Экспортируется отдельно от запуска,
// чтобы тестировать через fastify.inject / ws-клиент.

import { mkdirSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, extname } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import { ciToolOutputLimits, REST, clampModel, firstAllowedProvider, isProviderAllowed, imageBlock, parseImages, type ImageRetouchRequest, type ImageRetouchResult, type ArtifactPublishRequest, type ArtifactPublishResult, type MessageAttachment, type HealthResponse, type SttStatus, type WhisperModel } from '@voicechat/shared'
import type { ServerConfig } from './config.js'
import { attachWs, type WsHandlers } from './ws.js'
import { VoiceChatDb } from './db/database.js'
import { registerRest } from './routes/rest.js'
import { registerAdminRoutes } from './routes/admin.js'










import { shellQuote } from './ci/executor.js'

import { createAutomatedQaScenarioRunner } from './ci/automatedQaScenario.js'
import { sweepQaScreenshots } from './ci/qaScreenshots.js'
import { sweepBrowserShots } from './browser/checkShots.js'

import { syncProjectWithRetry } from './projectSync.js'






import { CI_COMMANDS_MCP_PATH } from './ci/ciCommandsMcp.js'
import type { CommandExecutor, CiKbUpdateHook } from './ci/types.js'
import { registerAuth, resolveActiveUser, uid } from './users/auth.js'
import { createManagedChatStorage } from './chatStorage.js'
import { GitWorkspaceService } from './git/workspaceService.js'
import { registerProjectGitRoutes } from './routes/projectGit.js'
import { registerProjectComponentsRoutes } from './routes/projectComponents.js'
import { StorybookSessions } from './components/storybookSessions.js'
import { ComponentTicketService } from './components/componentTicket.js'
import { createMailer, type Mailer } from './users/mailer.js'
import type { GeoResolver } from '@voicechat/sessions-core'
import { SessionHub } from './users/sessionHub.js'

/**
 * Токен сессии из заголовка Cookie при WS-upgrade (auth-roadmap п.5).
 * Имён два: по https cookie называется `__Secure-vc_session` (см. разведение
 * имён по схеме в `users/auth.ts`), по http — `vc_session`. Защищённое имя
 * приоритетнее: если в браузере лежат оба, актуально то, что поставил https.
 */
function cookieToken(header: string | undefined): string | undefined {
  if (!header) return undefined
  let plain: string | undefined
  for (const item of header.split(';')) {
    const [k, ...rest] = item.trim().split('=')
    if (k === '__Secure-vc_session') return rest.join('=')
    if (k === 'vc_session') plain = rest.join('=')
  }
  return plain
}
import { loadOrCreateSecret, verifyToken } from './users/accounts.js'
import type { SessionUser } from '@voicechat/shared'
import type { AgentRegistry } from './agents/registry.js'
import { createDbCommandGate, createMachinesModule } from './machines/module.js'
import { HttpMachines } from './machinesBridge/httpMachines.js'
import { registerAgentWsProxy, registerMachinesProxy } from './machinesBridge/proxy.js'
import { registerMachinesInternalApi } from './machines/internalApi.js'
import { registerServiceProxy } from './makeBridge/proxy.js'
import type { MachinesService } from './machines/service.js'
import { registerRemoteBashMcp, RemoteFileBroker, REMOTE_BASH_MCP_PATH } from './mcp/remoteBashMcp.js'
import { registerConsoleMcp, CONSOLE_MCP_PATH } from './mcp/consoleMcp.js'
import { ImageStudioStore } from './images/studio.js'
import { registerImageStudioRoutes } from './routes/imageStudio.js'
import { llmImageStudioGenerator } from './llm/imageStudioGenerator.js'

import { KANBAN_MCP_PATH } from './mcp/kanbanMcp.js'
import { WidgetContextStore } from './mcp/widgetContext.js'
import { WidgetUiRelay } from './mcp/widgetUiRelay.js'

import { createKanbanModule } from './kanban/module.js'
import { createLocalKanbanCore } from './kanbanBridge/localCore.js'
import { createRemoteKanban } from './kanbanBridge/remote.js'
import { registerKanbanProxy } from './kanbanBridge/proxy.js'
import { machinesSnapshot } from './kanbanBridge/internal.js'
import type { KanbanService } from './kanban/service.js'
import { UserFrameHub } from './frameHub.js'
export { parseQaPreparationResponse, taskPreparationModel, taskPreparationFailure } from './kanban/preparation.js'
import { createMakeModule, MAKE_MCP_PATH, type MakeHub, type MakeService } from '@voicechat/make'
import { LocalMakeCore } from './makeBridge/localCore.js'
import { createRemoteMake } from './makeBridge/remote.js'
import { registerMakeProxy } from './makeBridge/proxy.js'
import { registerInternalRoutes } from './routes/internal.js'
import { buildPublicMcpUrl } from './mcp/publicBase.js'
import { createSession } from './session.js'
import { createTurnManager } from './turns.js'
import { RemoteLlmClient } from './llm/remoteClient.js'
import { RunnerFsClient } from './llm/runnerFsClient.js'
import { PromptSuggester } from './prompt/suggester.js'
// Локальные spawn-реализации CLI живут в отдельном воркспейсе исполнителя
// (apps/llm-runner), а buildServer здесь выбирает между ними и HTTP-клиентом
// RemoteLlmClient по конфигу окружения.
import { ClaudeCli, CodexCli, ensureCliProfile, getLoginStatus as getRunnerLoginStatus } from '@voicechat/llm-runner/cli'
import type { LlmClient } from './claude/types.js'
import type { SttEngine } from './stt/types.js'
import type { SttClient } from './stt/client.js'
import { RemoteSttClient } from './stt/remoteClient.js'
import { ModelDownloadManager } from './stt/downloadManager.js'
import { StubDiarizationEngine } from './diarization/stubDiarization.js'
import { UploadStore, machineManagedFilePath, machineUploadDir, machineUploadPath } from './uploads.js'
import type { UploadInfo } from '@voicechat/shared'
import { RemoteTtsClient } from './tts/client/remoteTtsClient.js'
import type { TtsClient } from './tts/client/types.js'
import type { TtsVoiceCatalog } from '@voicechat/shared'
import { registerAnthropicGateway } from './anthropic/gateway.js'
import { detectResources } from './system/resources.js'
import { computeCapabilities } from './system/capabilities.js'
import type { SystemCapabilities } from '@voicechat/shared'
import { FileKnowledgeBaseService } from './kb/service.js'
import { registerKbRoutes, registerKbResearchRoutes } from './kb/routes.js'
import { ScopedKnowledgeBase } from './kb/scoped.js'
import { kbViewOf } from './kb/access.js'
import { KbResearchManager } from './kb/research.js'
import type { KnowledgeBaseService } from './kb/types.js'
import { LlmKbReranker } from './kb/reranker.js'
import { createKbUsageTracker, type KbUsageTracker } from './kb/usage.js'
import { registerKbMcp, kbToolBroker, KB_MCP_PATH } from './kb/kbMcp.js'
import { PreviewActionRelay } from './mcp/previewMcp.js'
import { createPreviewTurnTokens } from './reader/turnToken.js'
import { createReaderModule } from './reader/module.js'
import { previewMcpBaseUrlOf } from './reader/mcpBase.js'
import { createLocalReaderCore } from './readerBridge/localCore.js'
import { registerReaderProxy } from './readerBridge/proxy.js'
import { registerBrowserRoutes } from './routes/browser.js'
import { createBrowserRunnerClient, type BrowserRunnerClient } from './browser/runnerClient.js'
import { PreviewRunKeys } from './browser/machinePreview.js'
import { readUserFile } from './serverFiles.js'
import { UnixDeployClient, type DeployTrigger } from './routes/admin.js'
import { AuthStatusState } from './auth/statusState.js'
import { processImageRetouch, saveRetouchedImage, type RetouchGenerator } from './imageRetouch.js'
import { llmRetouchGenerator } from './llm/imageRetouchGenerator.js'
import { GeneratedCleanupService, withGeneratedFileLease, type GeneratedCleanupCounters } from './generatedCleanup.js'

const VERSION = process.env.VC_RELEASE_VERSION?.trim() || null
const RELEASED_AT = process.env.VC_RELEASED_AT?.trim() || new Date().toISOString()
const RELEASE_COMMIT = process.env.VC_RELEASE_COMMIT?.trim() || null
const RELEASE_TASK = process.env.VC_RELEASE_TASK?.trim() || null

export interface BuildOptions {
  config: ServerConfig
  /** Готовый экземпляр БД (для тестов, напр. :memory:). Иначе создаётся из config. */
  db?: VoiceChatDb
  /** Read-only база знаний (для тестов — мок). */
  kbService?: KnowledgeBaseService
  /** Телеметрия обращений к БЗ (для тестов — мок/выключено). */
  kbUsage?: KbUsageTracker
  /**
   * LLM-клиент (для тестов — мок). По умолчанию RemoteLlmClient, если задан адрес
   * исполнителя (config.llmRunnerClaudeUrl), иначе локальный ClaudeCli.
   */
  claude?: LlmClient
  /** Codex-клиент (для тестов — мок). По умолчанию — как claude, но kind='codex'. */
  codex?: LlmClient
  /** Legacy fake engine нужен только существующим unit-тестам сессии. */
  sttEngine?: SttEngine
  /** STT transport; production всегда использует RemoteSttClient. */
  sttClient?: SttClient
  /** TTS-клиент (для тестов — FakeTtsClient). По умолчанию HTTP к TTS Runner. */
  ttsClient?: TtsClient
  /** Переопределение обработчиков WS (для тестов). Иначе — реальная сессия. */
  createWsHandlers?: () => WsHandlers
  /** Секрет подписи токенов сессии (для тестов). Иначе — из dataDir/эфемерный. */
  sessionSecret?: string
  /** Мейлер регистрации (для тестов — фейк). Иначе SMTP из config или консольный. */
  mailer?: Mailer
  /** Определение места входа по IP; в тестах подменяется, по умолчанию офлайн. */
  geo?: GeoResolver
  /** Реестр машин (для маршрутных тестов с фейковыми fs-ответами). */
  agentRegistry?: AgentRegistry
  /** Исполнитель CI-команд (в тестах — мок). По умолчанию поверх AgentRegistry. */
  ciExecutor?: CommandExecutor
  /** Хук шага «Актуализировать базу знаний» (в тестах — мок). По умолчанию — из createCiModelHooks. */
  ciKbUpdate?: CiKbUpdateHook
  /** Запуск host-side деплоя (в тестах — мок). */
  deployTrigger?: DeployTrigger
  /** Relay действий веб-превью (в тестах — свой, чтобы дёргать request напрямую). */
  previewRelay?: PreviewActionRelay
  /** Единое auth-состояние (инъекция для WS/HTTP тестов). */
  authStatus?: AuthStatusState
  /** Генератор crop для локальной ретуши; тесты инъектируют детерминированный ответ. */
  imageRetouchGenerator?: RetouchGenerator
  /** Sink структурированного итога TTL-очистки. */
  generatedCleanupLog?: (result: GeneratedCleanupCounters) => void
  /** Клиент browser-runner (Playwright Reader). По умолчанию — HTTP, если задан config.browserRunnerUrl. */
  browserRunner?: BrowserRunnerClient
}

export interface BuiltServer {
  app: FastifyInstance
  db: VoiceChatDb
}



/**
 * Обновляет общую базовую ветку до origin только fast-forward. Имя переменной
 * worktree_status намеренно не сокращается до status: в zsh status — read-only.
 *
 * Каталог `projectWorkdir` создаётся привязкой машины пустым (`materializeProjectMachine`
 * делает только mkdir), клона в него никто не кладёт — поэтому при известном
 * `gitUrl` пустой или отсутствующий каталог клонируется здесь же, как это делают
 * релизы и preview. Непустой каталог без репозитория остаётся ошибкой: чужие файлы
 * не перезаписываются. Репозиторием считается корень рабочего дерева (в том числе
 * созданный `git worktree add`, где `.git` — файл), а не подкаталог чужого репозитория.
 *
 * Копия общая: её же берут Git-панель проекта и чаты задач, поэтому к началу
 * синхронизации в ней штатно оказываются чужая ветка и незакоммиченные правки.
 * Раньше это останавливало подготовку до ручного разбора, теперь скрипт лечит
 * сам и ничего не выбрасывает: правки уходят в именованный stash
 * (`vc-autosync-<UTC>`), копия возвращается на базовую ветку, а строка
 * `AUTOHEAL=` в выводе рассказывает, что было сделано и как вернуть спрятанное.
 * Остановка остаётся там, где автолечение небезопасно: git отказал в stash
 * (например незавершённый merge с конфликтом), дерево осталось грязным, ветку
 * не удалось переключить или базовая ветка разошлась с origin.
 */
export function projectMainRefreshScript(path: string, branch: string, gitUrl?: string | null): string {
  const repo = shellQuote(path)
  const base = shellQuote(branch)
  const url = shellQuote(gitUrl ?? '')
  return `set -eu
repo=${repo}
base=${base}
url=${url}
if [ ! -d "$repo" ] || [ -z "$(ls -A "$repo" 2>/dev/null)" ]; then
  test -n "$url" || { echo "Рабочая директория проекта не является Git-репозиторием: $repo" >&2; exit 65; }
  mkdir -p "$repo"
  git clone --no-tags --origin origin --branch "$base" -- "$url" "$repo" || { echo "Не удалось клонировать $url (ветка $base) в $repo" >&2; exit 69; }
fi
toplevel="$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null || true)"
test -n "$toplevel" && test "$toplevel" = "$(cd "$repo" && pwd -P)" || { echo "Рабочая директория проекта не является Git-репозиторием: $repo" >&2; exit 65; }
worktree_status="$(git -C "$repo" status --porcelain --untracked-files=all)"
notice=''
if [ -n "$worktree_status" ]; then
  # Общая копия делится с человеком, Git-панелью проекта и чатами задач, поэтому
  # к началу синхронизации в ней остаются чужие незакоммиченные правки. Прежний
  # отказ блокировал подготовку до ручного разбора; теперь ничего не выбрасывается —
  # правки уезжают в именованный stash, и синхронизация идёт дальше сама.
  dirty_count="$(printf '%s\n' "$worktree_status" | grep -c . || true)"
  dirty_head="$(printf '%s\n' "$worktree_status" | awk 'NR<=5 { sub(/^ */, ""); gsub(/  */, " "); if (shown++) printf "; "; printf "%s", $0 }')"
  stash_name="vc-autosync-$(date -u +%Y%m%d-%H%M%S)"
  # Identity задаётся флагами: stash делает коммит, а на свежей машине агента
  # user.email может быть не настроен — иначе автолечение падало бы на нём.
  stash_log="$(git -C "$repo" -c user.name='voiceAIChat autosync' -c user.email='autosync@voicechat.local' stash push --include-untracked --message "$stash_name" 2>&1)" || {
    echo "Рабочая копия проекта содержит локальные изменения, и спрятать их в stash не удалось; синхронизация с origin/$base остановлена. Копия: $repo. Изменено записей: $dirty_count. Первые: $dirty_head. Ответ git: $stash_log. Закоммитьте нужное или уберите лишнее в этой копии и повторите." >&2
    exit 66
  }
  left="$(git -C "$repo" status --porcelain --untracked-files=all)"
  test -z "$left" || {
    left_head="$(printf '%s\n' "$left" | awk 'NR<=5 { sub(/^ */, ""); gsub(/  */, " "); if (shown++) printf "; "; printf "%s", $0 }')"
    echo "Рабочая копия проекта осталась с локальными изменениями после автоматического stash «\${stash_name}»; синхронизация с origin/$base остановлена. Копия: $repo. Осталось: $left_head. Уберите лишнее в этой копии и повторите." >&2
    exit 66
  }
  notice="незакоммиченные изменения ($dirty_count зап.: $dirty_head) спрятаны в stash «\${stash_name}»; вернуть их: git -C $repo stash apply 'stash^{/$stash_name}'"
fi
git -C "$repo" fetch --no-tags origin "refs/heads/\${base}:refs/remotes/origin/\${base}"
current="$(git -C "$repo" branch --show-current)"
if [ "$current" != "$base" ]; then
  # Ветку задачи в общей копии оставляет чат задачи или Git-панель. Дерево здесь
  # уже чистое, поэтому возврат на базовую ветку ничего не теряет, а прежний
  # отказ (exit 67) требовал ручного checkout перед каждой следующей подготовкой.
  head_label="$current"
  test -n "$head_label" || head_label='detached HEAD'
  git -C "$repo" checkout "$base" >/dev/null 2>&1 || git -C "$repo" checkout -B "$base" "refs/remotes/origin/$base" >/dev/null 2>&1 || { echo "Копия проекта $repo стоит на «\${head_label}», переключить её на $base не удалось" >&2; exit 67; }
  if [ -z "$notice" ]; then notice="копия возвращена на $base с ветки «\${head_label}»"; else notice="$notice; копия возвращена на $base с ветки «\${head_label}»"; fi
fi
git -C "$repo" merge --ff-only "refs/remotes/origin/$base"
local_sha="$(git -C "$repo" rev-parse HEAD)"
remote_sha="$(git -C "$repo" rev-parse "refs/remotes/origin/$base")"
test "$local_sha" = "$remote_sha" || { echo "Локальная ветка $base не совпадает с origin/$base после fast-forward" >&2; exit 68; }
test -z "$notice" || printf 'AUTOHEAL=%s\\n' "$notice"
printf 'BASE_SHA=%s\\n' "$local_sha"`
}

export async function buildServer(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const corsOrigins = new Set(opts.config.corsOrigins)
  const corsMethods = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  const corsHeaders = 'Content-Type, Authorization, x-vc-csrf, x-vc-client-version'
  app.decorateRequest('corsAllowed', false)
  // CORS обязан отработать до auth: preflight не несёт ни body, ни credentials.
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    if (origin && corsOrigins.has(origin)) {
      req.corsAllowed = true
      reply.header('access-control-allow-origin', origin)
      reply.header('access-control-allow-credentials', 'true')
      reply.header('vary', 'Origin')
      if (req.method === 'OPTIONS') {
        reply.header('access-control-allow-methods', corsMethods)
        reply.header('access-control-allow-headers', corsHeaders)
      }
    }
    if (req.method === 'OPTIONS' && req.url.startsWith('/api/')) await reply.code(204).send()
  })
  // Толерантный JSON-парсер: пустое тело (напр. DELETE с Content-Type) → undefined,
  // а не 400. Делает REST устойчивым к любым клиентам.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      if (!body || (typeof body === 'string' && body.trim() === '')) {
        done(null, undefined)
        return
      }
      try {
        done(null, JSON.parse(body as string))
      } catch (err) {
        done(err as Error, undefined)
      }
    }
  )
  // fs.read передаёт до 32 MiB как base64 в одном сообщении (~42.7 MiB + JSON).
  // Явный предел делает допустимый размер независимым от дефолта библиотеки ws.
  await app.register(fastifyWebsocket, { options: { maxPayload: 48 * 1024 * 1024 } })

  // Домен «релизы» может жить на встроенном Postgres (VC_DB_RELEASES=pglite): порт
  // подменяется фабрикой, остальные домены — в SQLite как раньше.
  const db = opts.db ?? (() => {
    mkdirSync(opts.config.dataDir, { recursive: true })
    // Движок базы: Postgres по VC_DB_URL, иначе SQLite-файл в каталоге данных.
    return new VoiceChatDb(join(opts.config.dataDir, 'voicechat.db'), opts.config.dbUrl ? { postgres: { url: opts.config.dbUrl } } : {})
  })()
  // Схема и миграции применяются асинхронно; дальше сервер полагается на готовую базу.
  await db.ready
  app.log.info({ engine: db.engine }, 'база данных готова')

  // Аутентификация приложения (многопользовательский режим web): секрет подписи
  // токенов из dataDir (переживает рестарт); в тестах (opts.db) — эфемерный, без диска.
  const sessionSecret =
    opts.sessionSecret ??
    (opts.db ? randomBytes(32).toString('hex') : loadOrCreateSecret(opts.config.dataDir))
  await db.identity.ensureAdmin(opts.config.adminPassword) // сид админа (пароль из VC_ADMIN_PASSWORD)
  // Мейлер один на приложение: им пользуются и подтверждение регистрации, и
  // приглашения в проект. Без VC_SMTP_URL это «консольный» мейлер — письмо
  // уходит в лог, и оба потока остаются проверяемыми на стенде.
  const mailer = opts.mailer ?? createMailer({ smtpUrl: opts.config.smtpUrl, mailFrom: opts.config.mailFrom }, (m, extra) => app.log.warn(extra ?? {}, m))
  // Хаб сессий один на процесс: его слушают WS-соединения, а публикуют в него
  // и сессионные роуты, и админский отзыв чужой сессии.
  const sessionHub = new SessionHub()
  // Ключи Chromium к прокси превью: изолированный браузер открывает dev-сервер
  // машины от лица владельца задачи, а Bearer-заголовка у навигации нет.
  const previewRunKeys = new PreviewRunKeys()
  // Адрес сервера, видимый из контейнера browser-runner (в compose — http://voicechat:8787);
  // без него остаёмся на loopback dev-сервера, где раннер и сервер — один хост.
  const runnerFacingBase = opts.config.browserPreviewBase ?? opts.config.mcpPublicBase ?? `http://127.0.0.1:${opts.config.port}`
  const { authenticate } = await registerAuth(app, db, sessionSecret, { mailer, publicUrl: opts.config.publicUrl, sessions: sessionHub, previewRunKeys, ...(opts.geo ? { geo: opts.geo } : {}) })

  app.get(REST.health, async (): Promise<HealthResponse> => ({
    ok: true,
    version: VERSION,
    releasedAt: RELEASED_AT,
    commit: RELEASE_COMMIT,
    task: RELEASE_TASK
  }))

  const runnerFs =
    opts.config.llmRunnerClaudeUrl || opts.config.llmRunnerCodexUrl
      ? new RunnerFsClient({
          claudeBaseUrl: opts.config.llmRunnerClaudeUrl,
          codexBaseUrl: opts.config.llmRunnerCodexUrl,
          ...(opts.config.llmRunnerToken ? { token: opts.config.llmRunnerToken } : {})
        })
      : null

  const authStatus = opts.authStatus ?? new AuthStatusState(async (userId) => {
    if (runnerFs) return runnerFs.authStatus(userId)
    return getRunnerLoginStatus({ home: ensureCliProfile(opts.config.dataDir, userId).home })
  })
  // Реестр создаётся до REST: task-chat context обязан показывать ту же effective
  // online-машину, которую затем использует фактический ход.
  // Шина кадров ядра для WS-сессий (журнал команд машины, watchdog, снимки проверки).
  const frames = new UserFrameHub()
  // Машины: реестр, WS агентов `/agent`, роуты и установщики, политика команд, журнал команд, watchdog,
  // перенос хранилищ — отдельным модулем; ядро видит только порт `MachinesService` (docs/plans/machines-service.md).
  // В режиме `remote` реестр живёт в отдельном процессе машин: ядро читает зеркало по шине событий, зовёт
  // RPC/потоковый exec и переправляет туда REST машин и WebSocket агентов.
  const machinesRemote = opts.config.machinesMode === 'remote'
  if (machinesRemote && !(opts.config.machinesUrl && opts.config.internalToken)) throw new Error('VC_MACHINES_MODE=remote требует VC_MACHINES_URL и VC_INTERNAL_TOKEN')
  if (machinesRemote && !opts.config.dbUrl && !opts.db) throw new Error('VC_MACHINES_MODE=remote требует общую базу VC_DB_URL (Postgres)')
  const remoteMachines = machinesRemote
    ? new HttpMachines({ machinesUrl: opts.config.machinesUrl!, token: opts.config.internalToken!, publish: (message, userId) => frames.publish(message, userId), log: (level, message, extra) => app.log[level](extra ?? {}, message) })
    : null
  const machinesModule = remoteMachines ? null : await createMachinesModule({
    app, db, config: opts.config,
    publish: (message, userId) => frames.publish(message, userId),
    ...(opts.agentRegistry ? { registry: opts.agentRegistry } : {})
  })
  const agentRegistry: MachinesService = remoteMachines ?? machinesModule!.machines
  const commandGate = machinesModule?.commandGate ?? createDbCommandGate(db)
  // Во встроенном режиме ядро само отдаёт машины соседям (админке) тем же внутренним API, что и процесс машин.
  if (machinesModule && opts.config.internalToken) registerMachinesInternalApi(app, { registry: machinesModule.registry, token: opts.config.internalToken })
  if (remoteMachines) {
    remoteMachines.start()
    app.addHook('onClose', async () => remoteMachines.stop())
    registerMachinesProxy(app, { machinesUrl: opts.config.machinesUrl! })
    registerAgentWsProxy(app, { machinesUrl: opts.config.machinesUrl! })
  }
  /**
   * Системная граница актуальности общей копии проекта. Модель не участвует:
   * чистая базовая ветка обновляется только fast-forward, а посторонние
   * незакоммиченные правки и оставленная чужая ветка лечатся автоматически
   * (stash + возврат на базовую ветку) — `autoHealed` описывает, что сделано,
   * чтобы это попало в лог подготовки и в промпт хода.
   */
  const projectMainRefreshes = new Map<string, Promise<{ baseSha: string; autoHealed?: string }>>()
  const ensureProjectMainCurrent = async (args: { userId: string; projectId: string; conversationId: string | null; agentId: string; path: string; branch: string; gitUrl?: string | null }): Promise<{ baseSha: string; autoHealed?: string }> => {
    const key = [args.projectId, args.agentId, args.path, args.branch].join('\u0000')
    const activeRefresh = await projectMainRefreshes.get(key)
    if (activeRefresh) return activeRefresh
    const script = projectMainRefreshScript(args.path, args.branch, args.gitUrl)
    const operation = syncProjectWithRetry(() =>
      agentRegistry.exec(args.agentId, script, 120_000, undefined, { userId: args.userId, conversationId: args.conversationId, source: 'system' }))
    projectMainRefreshes.set(key, operation)
    void operation.finally(() => { if (projectMainRefreshes.get(key) === operation) projectMainRefreshes.delete(key) }).catch(() => {})
    return operation
  }
  await registerRest(app, db, opts.config.dataDir, {
    runnerFs: runnerFs ?? undefined,
    authStatus,
    isAgentOnline: (agentId) => agentRegistry.isOnline(agentId),
    // Геттером, а не объектом: `kb` создаётся ниже, а нужен только в запросе
    // (предпросмотр автоконтекста БЗ для черновика сообщения).
    kb: () => kb,
    fsRead: (agentId, path) => agentRegistry.fsRead(agentId, path),
    // Свои машины на странице «Мой аккаунт» показываются с тем же живым статусом,
    // что и в разделе «Машины»: реестр знает версию и телеметрию только пока агент подключён.
    // Тот же контекст Make, что уходит в ход: инспектор обязан показывать его,
    // а не «здесь ещё что-то будет».
    makeContext: (id) => make.service.promptContext(id),
    liveAgents: (agents) => agents.map((agent) => ({
      ...agent,
      online: agentRegistry.isOnline(agent.id),
      version: agentRegistry.versionOf(agent.id),
      telemetry: agentRegistry.telemetryOf(agent.id)
    })),
    // Новый Make-чат начинает от актуального main: копию обновляет сервер один
    // раз при создании чата — единственное, что Make делает с репозиторием.
    // Ошибка (нет машины, offline, dirty без возможности stash) не мешает
    // создать чат: мастерская работает и без свежей копии, а причина уходит в лог.
    refreshProjectMain: async (userId, projectId) => {
      const project = await db.projects.getProject(userId, projectId)
      if (!project?.gitUrl) return
      const machine = (project.machines ?? []).find((candidate) => candidate.canUse !== false && candidate.path.trim() && agentRegistry.isOnline(candidate.agentId))
      if (!machine) return
      void ensureProjectMainCurrent({
        userId, projectId, conversationId: null, agentId: machine.agentId,
        path: machine.path, branch: project.ciBaseBranch || 'main', gitUrl: project.gitUrl
      }).then(
        (snapshot) => app.log.info({ event: 'make_chat_project_refresh', projectId, baseSha: snapshot.baseSha, ...(snapshot.autoHealed ? { autoHealed: snapshot.autoHealed } : {}) }),
        (error) => app.log.warn({ event: 'make_chat_project_refresh_failed', projectId, error: error instanceof Error ? error.message : String(error) })
      )
    }
  })
  const profileHome = (userId: string): string =>
    ensureCliProfile(opts.config.dataDir, userId).home
  // Движок либо запускается рядом (spawn CLI), либо живёт в контейнере-исполнителе
  // и вызывается по HTTP. Выбор — по наличию адреса в env; реестра исполнителей
  // пока нет (docs/plans/llm-runners.md, срез 2).
  const runner = async (kind: 'claude' | 'codex', baseUrl: string): Promise<LlmClient> =>
    new RemoteLlmClient({
      kind,
      baseUrl,
      ...(opts.config.llmRunnerToken ? { token: opts.config.llmRunnerToken } : {}),
      ...(opts.config.llmRunnerConnectTimeoutMs
        ? { connectTimeoutMs: opts.config.llmRunnerConnectTimeoutMs }
        : {})
    })
  const claude =
    await (opts.claude ??
    (opts.config.llmRunnerClaudeUrl
      ? runner('claude', opts.config.llmRunnerClaudeUrl)
      : new ClaudeCli({ profileHome })))
  const codex =
    await (opts.codex ??
    (opts.config.llmRunnerCodexUrl
      ? runner('codex', opts.config.llmRunnerCodexUrl)
      : new CodexCli({ profileHome })))
  const reranker = opts.config.kbRerankProvider === 'disabled'
    ? undefined
    : new LlmKbReranker(await (opts.config.kbRerankProvider === 'claude' ? claude : codex))
  // Файловые темы docs/kb — раздел «Использование» (общий для всех); поверх них
  // ScopedKnowledgeBase добавляет статьи из БД (персональные и проектные) и
  // решает, что кому видно.
  const fileKb = opts.kbService ?? new FileKnowledgeBaseService(opts.config.kbRoot, reranker)
  const kb = new ScopedKnowledgeBase(fileKb, db, reranker)
  // Телеметрия обращений к БЗ: одна на процесс (как реестр ходов) — её события
  // рассылаются всем соединениям пользователя, а строки живут в БД.
  const kbUsage = opts.kbUsage ?? createKbUsageTracker({ db })
  registerKbRoutes(app, kb, { db, toolEnabled: opts.config.kbToolEnabled })

  // Помощник формулировки — одноразовый вызов выбранного пользователем CLI.
  // Историю разговора не трогает, shell выключен.
  app.post<{ Body: { prompt?: string; modifiers?: import('@voicechat/shared').ModifierPrompt[] } }>(REST.promptSuggest, async (req, reply) => {
    const prompt = (req.body?.prompt ?? '').trim()
    if (!prompt) return { variants: [] as Array<{ id: string; text: string }> }
    const settings = await db.settings.getSettings(uid(req))
    const access = await db.identity.getUserLlmAccess(uid(req))
    const provider = isProviderAllowed(access, settings.aiAssistProvider)
      ? settings.aiAssistProvider
      : firstAllowedProvider(access)
    if (!provider) return reply.code(403).send({ error: 'Нет доступных моделей' }) as never
    const requestedModel = settings.aiAssistModel || (provider === 'claude' ? 'haiku' : '')
    const model = clampModel(access, provider, requestedModel)
    if (!model) return reply.code(403).send({ error: 'Нет доступных моделей' }) as never
    const client = await (provider === 'codex' ? codex : claude)
    const modifiers = (req.body?.modifiers ?? []).filter((item) => item.enabled && item.text.trim())
    try {
      const texts = await new PromptSuggester(client, model).suggest(prompt, modifiers, uid(req))
      return { variants: texts.map((text, index) => ({ id: `${Date.now()}-${index}`, text })) }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось получить подсказки'
      return reply.code(502).send({ error: message }) as never
    }
  })

  // Входящий Anthropic Messages API для подключения внешнего Claude Code CLI.
  // Авторизация клиента намеренно отсутствует: маршрут предназначен для закрытой сети.
  registerAnthropicGateway(app, {
    backend: opts.config.claudeGatewayBackend,
    codex: await codex,
    upstreamUrl: opts.config.claudeGatewayUpstreamUrl,
    upstreamApiKey: opts.config.claudeGatewayUpstreamKey,
    authMode: opts.config.claudeGatewayAuthMode,
    modelMap: opts.config.claudeGatewayModelMap
  })

  // Машины-агенты: MCP-мост для проброса Bash (реестр и роуты машин — в модуле машин выше).
  // Секрет MCP: в режиме remote общий с процессом Make (он проверяет им scope-токены), иначе — свой на процесс.
  const mcpSecret = opts.config.mcpSecret || randomBytes(16).toString('hex')
  const remoteFileBroker = new RemoteFileBroker()
  const deployTrigger = opts.deployTrigger ?? (opts.config.deployApiSocket
    ? new UnixDeployClient(opts.config.deployApiSocket)
    : undefined)
  // Лимиты ответов инструментов моста — из настроек CI, на каждый вызов: они
  // режут размер контекста хода, а его цена = контекст × число запросов.
  registerRemoteBashMcp(
    app,
    agentRegistry,
    mcpSecret,
    async () => ciToolOutputLimits(await db.ci.getCiSettings()),
    // Машины проекта для адресации операций (query `project` дописывает
    // отправитель хода — turns.ts у чата, modelHooks.ts у CI-рана).
    async (projectId) => await db.machines.listProjectMachines(projectId),
    (token) => remoteFileBroker.get(token),
    commandGate
  )
  // Консоль с ассистентом (mcp__console__*): ход адресуется query `conv`, а
  // инструменты пишут/читают ту же живую PTY-сессию, что видит пользователь.
  registerConsoleMcp(app, agentRegistry, mcpSecret)
  // Make (mcp__make__*): файлы проекта разговора в <dataDir>/make/<conv>; изменения
  // уходят владельцу кадром make.changed. Ядро и Make видят друг друга только через
  // порты MakeCore / MakeService (docs/plans/make-standalone.md): здесь — единственная
  // точка, где Make получает доступ к данным чата, канбана и машин.
  const makeCore = new LocalMakeCore({
    db,
    // boardChanged — ленивая ссылка: канбан собирается ниже, а зовут её уже в запросе.
    boardChanged: (projectId) => kanban.service.board.changed(projectId),
    // Чтение репозитория проекта: файловый мост машины только на чтение —
    // Make копирует файлы к себе, но в общую копию проекта не пишет.
    machineFs: {
      list: (agentId, path) => agentRegistry.fsList(agentId, path),
      read: (agentId, path) => agentRegistry.fsRead(agentId, path),
      isOnline: (agentId) => agentRegistry.isOnline(agentId)
    }
  })
  const makeRemote = opts.config.makeMode === 'remote'
  if (makeRemote && !(opts.config.makeUrl && opts.config.internalToken && opts.config.mcpSecret)) {
    throw new Error('VC_MAKE_MODE=remote требует VC_MAKE_URL, VC_INTERNAL_TOKEN и VC_MCP_SECRET')
  }
  // В remote MCP Make слушает процесс Make: исполнителю нужен его адрес, а не адрес ядра.
  const makeMcpBaseUrl = makeRemote
    ? `${(opts.config.makeMcpPublicBase ?? opts.config.makeUrl!).replace(/\/+$/, '')}${MAKE_MCP_PATH}?k=${mcpSecret}`
    : buildPublicMcpUrl(opts.config, MAKE_MCP_PATH, mcpSecret)
  const make: { service: MakeService; hub: MakeHub; register?: (app: FastifyInstance) => void } = makeRemote
    ? createRemoteMake({ makeUrl: opts.config.makeUrl!, token: opts.config.internalToken!, mcpSecret, mcpBaseUrl: makeMcpBaseUrl })
    : createMakeModule({ dataDir: opts.config.dataDir, mcpSecret, mcpBaseUrl: makeMcpBaseUrl, core: makeCore })
  make.register?.(app)
  // Стенд доступен и напрямую портом ядра, минуя Caddy, — пути Make ядро переправляет в его процесс само.
  if (makeRemote) registerMakeProxy(app, { makeUrl: opts.config.makeUrl! })
  // Канбан отдельным процессом: общая база (Postgres), пути канбана ядро переправляет туда, состояние
  // машин/KB/виджета отдаёт по `/internal/*`, ленты событий принимает обратно (docs/plans/kanban-service.md).
  const kanbanRemote = opts.config.kanbanMode === 'remote'
  if (kanbanRemote && !(opts.config.kanbanUrl && opts.config.internalToken && opts.config.mcpSecret)) {
    throw new Error('VC_KANBAN_MODE=remote требует VC_KANBAN_URL, VC_INTERNAL_TOKEN и VC_MCP_SECRET')
  }
  if (kanbanRemote && !opts.config.dbUrl && !opts.db) throw new Error('VC_KANBAN_MODE=remote требует общую базу VC_DB_URL (Postgres)')
  // Снимок «что открыто» у виджета и мост в браузер: состояние ядра, которое mcp__kanban__* читает через
  // порт `KanbanCore.widgets`; сам MCP канбана регистрирует кластер.
  const widgetContexts = new WidgetContextStore()
  const widgetUiRelay = new WidgetUiRelay()
  // Студия картинок: галерея на разговор + генерация/правка через LLM — тем же
  // способом, что ретушь (модель сохраняет PNG и показывает fenced-блоком).
  const imageStudioStore = new ImageStudioStore(join(opts.config.dataDir, 'image-studio'))
  registerImageStudioRoutes(app, {
    db,
    store: imageStudioStore,
    generator: async (userId) => llmImageStudioGenerator({
      client: codex,
      userId,
      model: (await db.settings.getSettings(userId)).codexModel,
      cwd: profileHome(userId),
      readGenerated: async (path) => {
        if (runnerFs) return runnerFs.readFile(userId, path)
        const local = readUserFile(path, [profileHome(userId)])
        return local.ok ? local.file : null
      }
    })
  })

  // Инструменты БЗ для модели (mcp__kb__*): тот же секрет процесса, ход
  // адресуется токеном ?turn= (его выдаёт и снимает TurnManager).
  registerKbMcp(app, {
    kb,
    secret: mcpSecret,
    usage: kbUsage,
    db,
    viewOf: async (entry) => ({ ...(await kbViewOf(db, entry.userId)), ...(entry.projectId ? { projectId: entry.projectId } : {}) }),
    agents: {
      isOnline: (agentId) => agentRegistry.isOnline(agentId),
      versionOf: (agentId) => agentRegistry.versionOf(agentId),
      platformOf: (agentId) => agentRegistry.platformOf(agentId)
    },
    deployTrigger
  })
  // Действия веб-превью (mcp__browser__*): relay «сервер → клиенты пользователя»,
  // сессии WS подписываются на подключении; сам MCP собирает модуль ридера ниже.
  const previewRelay = opts.previewRelay ?? new PreviewActionRelay()
  // Playwright Reader: REST-оркестрация изолированного Chromium в browser-runner.
  // Клиент создаётся, только если задан адрес раннера; иначе роуты отвечают 501.
  const browserRunner = opts.browserRunner ?? (opts.config.browserRunnerUrl && opts.config.browserRunnerToken
    ? createBrowserRunnerClient({ baseUrl: opts.config.browserRunnerUrl, token: opts.config.browserRunnerToken })
    : undefined)
  // Кадры браузерной проверки задач: файл на диске, в ленте рана — ссылка.
  const browserShotsRoot = join(opts.config.dataDir, 'ci-browser-shots')
  registerBrowserRoutes(app, { db, shotsRoot: browserShotsRoot, ...(browserRunner ? { runner: browserRunner } : {}) })
  // Снимки вердикта Playwright-этапа: файл на диске, а не base64 в result_json —
  // строка рана иначе распухала бы на сотни килобайт с каждой попыткой.
  const automatedQaScreenshotDir = join(opts.config.dataDir, 'qa-screenshots')
  // Снимки не удалялись ни при удалении задачи (каскад чистит строку рана, но не
  // файл), ни по возрасту. Уборка при старте и раз в сутки.
  const sweepScreenshots = async (): Promise<void> => {
    try { sweepQaScreenshots({ dir: automatedQaScreenshotDir, knownRunIds: await db.qa.qaStageRunIds(), maxAgeMs: 30 * 24 * 60 * 60_000 }) }
    catch (error) { app.log.warn({ error }, 'qa screenshot sweep failed') }
  }
  await sweepScreenshots()
  // Кадры проверки живут короче снимков вердикта: их за ран много, а смысл
  // они имеют, пока лента этого рана кому-то интересна.
  const sweepBrowserCheckShots = async (): Promise<void> => {
    try { sweepBrowserShots({ root: browserShotsRoot, knownRunIds: await db.ci.ciRunIds(), maxAgeMs: 7 * 24 * 60 * 60_000 }) }
    catch (error) { app.log.warn({ error }, 'browser check shot sweep failed') }
  }
  await sweepBrowserCheckShots()
  const browserShotSweepTimer = setInterval(sweepBrowserCheckShots, 24 * 60 * 60_000)
  browserShotSweepTimer.unref?.()
  app.addHook('onClose', async () => clearInterval(browserShotSweepTimer))
  const screenshotSweepTimer = setInterval(sweepScreenshots, 24 * 60 * 60_000)
  screenshotSweepTimer.unref?.()
  app.addHook('onClose', async () => clearInterval(screenshotSweepTimer))

  // Раннер сценариев нужен и этапу, и разовой проверке набора из настроек,
  // поэтому создаётся рядом с каталогом снимков, до регистрации роутов.
  const automatedQaScenarioRunner = browserRunner ? createAutomatedQaScenarioRunner({
    browser: browserRunner,
    screenshotDir: automatedQaScreenshotDir,
    screenshotUrl: (runId) => `/api/qa/runs/${runId}/screenshot`
  }) : undefined
  const remoteBashMcpBaseUrl = buildPublicMcpUrl(opts.config, REMOTE_BASH_MCP_PATH, mcpSecret)
  const kbMcpBaseUrl = buildPublicMcpUrl(opts.config, KB_MCP_PATH, mcpSecret)
  // В remote MCP канбана и CI-команд слушает процесс канбана: исполнителю нужен его адрес, а не адрес ядра.
  const kanbanMcpBase = (opts.config.kanbanMcpPublicBase ?? opts.config.kanbanUrl ?? '').replace(/\/+$/, '')
  const ciCommandsMcpBaseUrl = kanbanRemote ? `${kanbanMcpBase}${CI_COMMANDS_MCP_PATH}?k=${mcpSecret}` : buildPublicMcpUrl(opts.config, CI_COMMANDS_MCP_PATH, mcpSecret)
  // Web Reader отдельным процессом: MCP «browser» слушает он — исполнителю нужен его адрес (docs/plans/web-reader-service.md).
  const readerRemote = opts.config.readerMode === 'remote'
  if (readerRemote && !(opts.config.readerUrl && opts.config.internalToken && opts.config.mcpSecret)) throw new Error('VC_READER_MODE=remote требует VC_READER_URL, VC_INTERNAL_TOKEN и VC_MCP_SECRET')
  const previewMcpBaseUrl = previewMcpBaseUrlOf(opts.config, mcpSecret)
  const consoleMcpBaseUrl = buildPublicMcpUrl(opts.config, CONSOLE_MCP_PATH, mcpSecret)
  const kanbanMcpBaseUrl = kanbanRemote ? `${kanbanMcpBase}${KANBAN_MCP_PATH}?k=${mcpSecret}` : buildPublicMcpUrl(opts.config, KANBAN_MCP_PATH, mcpSecret)

  // «Исследовать проект»: модель на машине проекта сверяет статьи раздела
  // «Разработка проекта» с кодом. Живёт рядом с MCP-мостом — ей нужен тот же
  // remote-bash, что и ходам модели.
  registerKbResearchRoutes(
    app,
    db,
    new KbResearchManager({
      db,
      claude: await claude,
      codex: await codex,
      mcpBaseUrl: remoteBashMcpBaseUrl,
      agentNameOf: (agentId) => agentRegistry.nameOf(agentId)
    })
  )

  // Админ-страница пользователей (роуты под guard requireAdmin).
  // Админка отдельным процессом: ядро переправляет `/api/admin/*` (кроме типов проектов — они у канбана), а деплой и
  // уведомления об отзыве сессий отдаёт по `/internal/admin/rpc`.
  const adminRemote = opts.config.adminMode === 'remote'
  if (adminRemote && !(opts.config.adminUrl && opts.config.internalToken && opts.config.mcpSecret)) throw new Error('VC_ADMIN_MODE=remote требует VC_ADMIN_URL, VC_INTERNAL_TOKEN и VC_MCP_SECRET')
  if (adminRemote) registerServiceProxy(app, { name: 'admin', baseUrl: opts.config.adminUrl!, prefixes: ['/api/admin'] })
  else registerAdminRoutes(app, db, agentRegistry, deployTrigger, make.service, mailer, opts.config.publicUrl, sessionHub)

  // Проекты + канбан-доска (членство в проекте) + живой board.changed по WS.
  // Модель Whisper — общий машинный ресурс (файлы моделей одни на сервер), поэтому
  // её выбор берём у канонического пользователя (admin), а не per-user.
  const machineWhisperModel = async (): Promise<WhisperModel> => (await db.settings.getSettings('admin')).whisperModel

  const sttClient = opts.sttClient ?? (opts.config.sttRunnerUrl && opts.config.sttRunnerToken
    ? new RemoteSttClient({ baseUrl: opts.config.sttRunnerUrl, token: opts.config.sttRunnerToken, connectTimeoutMs: opts.config.sttRunnerConnectTimeoutMs })
    : undefined)
  let sttRunnerHealthy = Boolean(opts.sttEngine)
  let runnerModels: import('@voicechat/shared').WhisperModelInfo[] = []
  const refreshSttHealth = async () => {
    if (!sttClient) { sttRunnerHealthy = Boolean(opts.sttEngine); return }
    try {
      const health = await sttClient.health()
      sttRunnerHealthy = health.ok && health.whisper.available
      runnerModels = health.models
    } catch { sttRunnerHealthy = false; runnerModels = [] }
  }
  await refreshSttHealth()
  const sttHealthTimer = setInterval(() => void refreshSttHealth(), 10_000)
  app.addHook('onClose', async () => clearInterval(sttHealthTimer))

  app.get(REST.sttStatus, async (): Promise<SttStatus> => {
    await refreshSttHealth()
    const model = await machineWhisperModel()
    return { present: sttRunnerHealthy && runnerModels.some((item) => item.model === model && item.present), model: await model }
  })

  const resources = detectResources()
  const capabilities = async (): Promise<SystemCapabilities> => {
    const whisperModel = await machineWhisperModel()
    const value = computeCapabilities(resources, whisperModel, undefined, { stt: opts.config.minMemSttBytes, tts: opts.config.minMemTtsBytes })
    if (!sttRunnerHealthy) value.stt = { available: false, reason: 'Сервис распознавания речи недоступен' }
    else if (sttClient && !runnerModels.some((item) => item.model === whisperModel && item.present)) value.stt = { available: false, reason: 'Модель распознавания речи не установлена' }
    if (!opts.ttsClient && (!opts.config.ttsRunnerUrl || !opts.config.ttsRunnerToken)) {
      value.tts = { available: false, reason: 'Нет доступного сервиса озвучки: TTS Runner не настроен' }
    }
    return value
  }
  app.get(REST.systemCapabilities, async (): Promise<SystemCapabilities> => { await refreshSttHealth(); return capabilities() })

  app.get(REST.sttModels, async () => sttClient ? sttClient.models() : import('@voicechat/shared').then(({ WHISPER_MODELS }) => WHISPER_MODELS.map((model) => ({ model, present: false, sizeBytes: 0 }))))
  app.delete<{ Params: { model: WhisperModel } }>('/api/stt/models/:model', async (req) => {
    if (!sttClient) return { ok: true }
    await sttClient.deleteModel(req.params.model)
    await refreshSttHealth()
    return { ok: true }
  })
  const sttEngine = opts.sttEngine
  const modelDownload = sttClient ? new ModelDownloadManager(async (onProgress) => sttClient.downloadModel(await machineWhisperModel(), onProgress)) : undefined
  const ttsClient = opts.ttsClient ?? new RemoteTtsClient({ baseUrl: opts.config.ttsRunnerUrl ?? 'http://127.0.0.1:8791', token: opts.config.ttsRunnerToken ?? '' })
  const diarization = new StubDiarizationEngine()

  // Вложения разговора с выбранной машиной постоянно хранятся на ней. Сервер
  // только принимает байты запроса и пересылает агенту; без машины сохраняется
  // совместимый локальный режим.
  const uploads = new UploadStore(join(opts.config.dataDir, 'uploads'))
  // Каталог ChatAI по умолчанию: при подключении машины и перед первой записью файлов чата.
  // Хранилище разговора на машине — общий helper ядра и модуля машин (полный лог долгой команды из чата).
  const { ensureChatStorage, managedChatStorage } = createManagedChatStorage({ db, machines: agentRegistry, log: (m, extra) => app.log.info(extra ?? {}, m) })
  const generatedCleanup = new GeneratedCleanupService({
    targets: async () => await db.machines.listGeneratedCleanupTargets(),
    ttlDays: async (userId) => (await db.settings.getSettings(userId)).generatedFilesTtlDays,
    messages: async (userId, conversationId) => await db.chat.listMessages(userId, conversationId),
    resolve: managedChatStorage,
    list: (machineId, path) => agentRegistry.fsList(machineId, path),
    deleteFile: (machineId, path) => agentRegistry.fsDeleteFileSafe(machineId, path),
    defer: async (target, error, nextAttemptAt) => await db.machines.deferGeneratedCleanup(target.userId, target.conversationId, error, nextAttemptAt),
    complete: async (target) => await db.machines.completeGeneratedCleanup(target.conversationId),
    log: opts.generatedCleanupLog ?? ((result) => app.log.info({ event: 'generated_cleanup', ...result }))
  })
  // Тестовые buildServer используют фейковые реестры и запускают сервис явно.
  // Production-процесс делает первый проход после старта и затем каждые шесть часов.
  if (!process.env.VITEST) {
    // Фоновая очистка Make (roadmap-2 п.16): снимки и PNG стори старше 30 дней, раз в 6 часов и при старте.
    // В режиме remote чистит сам процесс Make — здесь только встроенный.
    const makeSweep = async (): Promise<void> => {
      if (makeRemote) return
      try { const r = await make.service.sweep(); if (r.snapshots || r.shots) app.log.info({ event: 'make_sweep', ...r }) } catch (error) { app.log.warn({ event: 'make_sweep_failed', error: String(error) }) }
    }
    const makeSweepTimer = setInterval(() => { void makeSweep() }, 6 * 60 * 60 * 1000)
    makeSweepTimer.unref()
    app.addHook('onClose', async () => clearInterval(makeSweepTimer))
    queueMicrotask(() => { void makeSweep() })
    // Учётки и сессии (auth-roadmap п.18): раз в сутки чистим истёкшие сессии/инвайты и отключаем неактивных (VC_INACTIVE_DAYS, 0 — выкл).
    const inactiveDays = Number(process.env.VC_INACTIVE_DAYS ?? 180)
    const accountsSweep = async (): Promise<void> => {
      try {
        // Брошенные сессии сначала гасим, потом чистим: порядок важен, иначе
        // только что отозванная строка ждала бы неделю до следующего прохода.
        const staleDays = Number(process.env.VC_SESSION_STALE_DAYS ?? 90)
        const stale = await db.identity.revokeStaleSessions(Number.isFinite(staleDays) ? staleDays : 0)
        const sessions = await db.identity.pruneSessions(), invites = await db.identity.pruneInvites()
        const blocked = inactiveDays > 0 ? await db.identity.blockInactiveUsers(inactiveDays) : []
        for (const name of blocked) await db.identity.logSecurityEvent({ user: name, type: 'inactive_blocked', details: `нет входов ${inactiveDays} дн.` })
        if (sessions || invites || stale || blocked.length) app.log.info({ event: 'accounts_sweep', sessions, invites, stale, blocked }, 'accounts sweep')
      } catch (error) { app.log.warn({ error }, 'accounts sweep failed') }
    }
    await accountsSweep()
    const accountsTimer = setInterval(accountsSweep, 24 * 60 * 60 * 1000)
    accountsTimer.unref()
    app.addHook('onClose', async () => clearInterval(accountsTimer))
    const cleanupTimer = setInterval(() => { void generatedCleanup.run() }, 6 * 60 * 60 * 1000)
    cleanupTimer.unref()
    app.addHook('onClose', async () => clearInterval(cleanupTimer))
    queueMicrotask(() => { void generatedCleanup.run() })
  }

  app.post<{ Body: { name?: string; dataBase64?: string; agentId?: string; conversationId?: string; mimeType?: string } }>(
    REST.uploads,
    { bodyLimit: 64 * 1024 * 1024 }, // до 64 МБ на вложение (base64 раздувает ~на треть)
    async (req, reply): Promise<UploadInfo> => {
      const { name, dataBase64, agentId: requestedAgentId, conversationId, mimeType } = req.body ?? {}
      const userId = uid(req)
      if (conversationId && !await db.chat.getConversation(userId, conversationId)) return reply.code(404).send({ error: 'conversation not found' }) as never
      const resolvedMachine = !requestedAgentId && conversationId
        ? await db.chat.resolveConversationMachine(userId, conversationId, { isOnline: (id) => agentRegistry.isOnline(id) })
        : null
      const agentId = requestedAgentId ?? (resolvedMachine?.source === 'disabled' ? undefined : resolvedMachine?.agentId ?? undefined)
      if (!dataBase64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64) || dataBase64.length % 4 !== 0) return reply.code(400).send({ error: 'invalid data' }) as never
      const bytes = Buffer.from(dataBase64, 'base64')
      if (bytes.byteLength > 32 * 1024 * 1024) return reply.code(413).send({ error: 'too large' }) as never
      const uploadName = name ?? 'file'
      const safeMime = typeof mimeType === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : 'application/octet-stream'
      let managed: Awaited<ReturnType<typeof managedChatStorage>> = null
      if (conversationId) {
        try {
          managed = await managedChatStorage(userId, conversationId)
        } catch (error) {
          return reply.code(503).send({ error: error instanceof Error ? error.message : String(error) }) as never
        }
      }
      if (managed && requestedAgentId && requestedAgentId !== managed.binding.machineId) {
        return reply.code(409).send({ error: 'Разговор привязан к другой машине хранения' }) as never
      }
      const writeAgentId = managed?.binding.machineId ?? agentId
      if (writeAgentId) {
        if (!(await db.machines.listAgents(userId)).some((agent) => agent.id === writeAgentId)) {
          return reply.code(404).send({ error: 'machine not found' }) as never
        }
        try {
          const root = managed ? managed.storage.rootPath : (await agentRegistry.fsList(writeAgentId, '')).root
          const directory = managed?.attachments ?? machineUploadDir(root)
          const target = managed
            ? machineManagedFilePath(directory, randomBytes(16).toString('hex'), uploadName)
            : machineUploadPath(root, randomBytes(16).toString('hex'), uploadName)
          await agentRegistry.fsMkdir(writeAgentId, directory)
          await agentRegistry.fsWrite(writeAgentId, target, dataBase64)
          const rec = uploads.saveRemote(uploadName, target, writeAgentId, bytes.byteLength, safeMime, userId)
          return { id: rec.id, name: rec.name, path: rec.path, mimeType: rec.mimeType, size: rec.size, agentId: rec.agentId }
        } catch (err) {
          return reply.code(503).send({ error: err instanceof Error ? err.message : String(err) }) as never
        }
      }
      const rec = uploads.save(uploadName, bytes, safeMime, userId)
      return { id: rec.id, name: rec.name, path: rec.path, mimeType: rec.mimeType, size: rec.size }
    }
  )

  app.post<{ Body: ImageRetouchRequest }>(
    REST.imageRetouch,
    { bodyLimit: 2 * 1024 * 1024 },
    async (req, reply): Promise<ImageRetouchResult> => {
      const userId = uid(req)
      const body = req.body
      if (!body || !await db.chat.getConversation(userId, body.conversationId)) return reply.code(404).send({ error: 'Разговор не найден' }) as never
      if (!body.prompt?.trim() || body.prompt.length > 4000) return reply.code(400).send({ error: 'Введите описание ретуши длиной до 4000 символов' }) as never
      const historyFiles = (await db.chat.listMessages(userId, body.conversationId)).flatMap((message) => message.attachments ?? [])
      const allowed = (file: MessageAttachment): boolean => {
        if (historyFiles.some((known) => known.path === file.path && known.agentId === file.agentId)) return true
        const upload = file.uploadId ? uploads.get(file.uploadId) : undefined
        return Boolean(upload && upload.path === file.path && upload.agentId === file.agentId)
      }
      if (!allowed(body.source) || (body.references ?? []).some((file) => !allowed(file))) return reply.code(403).send({ error: 'Изображение не принадлежит этому разговору' }) as never

      const readAttachment = async (file: MessageAttachment): Promise<Buffer> => {
        if (file.agentId) {
          if (!(await db.machines.listAgents(userId)).some((agent) => agent.id === file.agentId)) throw new Error('Машина-источник недоступна')
          const result = await agentRegistry.fsRead(file.agentId, file.path)
          if (!result.dataBase64) throw new Error(`Файл ${file.name} не найден на машине-источнике`)
          return Buffer.from(result.dataBase64, 'base64')
        }
        if (runnerFs) {
          const result = await runnerFs.readFile(userId, file.path)
          if (result?.dataBase64) return Buffer.from(result.dataBase64, 'base64')
        }
        const settings = await db.settings.getSettings(userId)
        const local = readUserFile(file.path, [profileHome(userId), join(opts.config.dataDir, 'uploads'), ...(settings.workdir ? [settings.workdir] : [])])
        if (!local.ok) throw new Error(`Файл ${file.name} не найден на сервере`)
        return Buffer.from(local.file.dataBase64, 'base64')
      }

      try {
        const managed = await managedChatStorage(userId, body.conversationId)
        const executeRetouch = async (): Promise<ImageRetouchResult> => {
        const original = await readAttachment(body.source)
        const references = await Promise.all((body.references ?? []).map(readAttachment))
        const generator = opts.imageRetouchGenerator ?? llmRetouchGenerator({
          client: codex,
          userId,
          model: (await db.settings.getSettings(userId)).codexModel,
          readGenerated: async (path) => {
            if (runnerFs) return runnerFs.readFile(userId, path)
            const local = readUserFile(path, [profileHome(userId)])
            return local.ok ? local.file : null
          }
        })
        const processed = await processImageRetouch({ original, selection: body.selection, prompt: body.prompt, references, generate: generator })
        const name = `retouch-${randomBytes(12).toString('hex')}.png`
        const outputAgentId = managed?.binding.machineId ?? body.source.agentId
        const path = await saveRetouchedImage({
          image: processed.image,
          name,
          localRoot: profileHome(userId),
          ...(managed ? { targetDir: managed.generated } : {}),
          ...(outputAgentId ? {
            agentId: outputAgentId,
            remote: {
              root: async () => (await agentRegistry.fsList(outputAgentId, '')).root,
              mkdir: (dir) => agentRegistry.fsMkdir(outputAgentId, dir),
              write: (target, data) => agentRegistry.fsWrite(outputAgentId, target, data)
            }
          } : {})
        })
        const image: MessageAttachment = {
          path,
          name,
          mimeType: 'image/png',
          size: processed.image.byteLength,
          ...(outputAgentId ? { agentId: outputAgentId } : {}),
          retouch: { source: body.source, selection: body.selection, prompt: body.prompt.trim(), ...(body.references?.length ? { references: body.references } : {}) }
        }
        const text = imageBlock({ path, ...(image.agentId ? { agentId: image.agentId } : {}), caption: `Локальная ретушь: ${body.prompt.trim()}` })
        const now = new Date()
        const message = await db.chat.addMessage(userId, body.conversationId, 'ai', text, now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), 'codex', undefined, image.agentId ?? null, [image])
        return { message, image }
        }
        return managed
          ? await withGeneratedFileLease(managed.binding.machineId, body.source.path, executeRetouch)
          : await executeRetouch()
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        return reply.code(422).send({ error: message }) as never
      }
    }
  )

  app.post<{ Body: ArtifactPublishRequest }>(
    REST.artifactPublish,
    async (req, reply): Promise<ArtifactPublishResult> => {
      const userId = uid(req)
      const body = req.body
      if (!body || !await db.chat.getConversation(userId, body.conversationId)) return reply.code(404).send({ error: 'Разговор не найден' }) as never
      try {
        const managed = await managedChatStorage(userId, body.conversationId)
        if (!managed) return reply.code(409).send({ error: 'Публикация доступна только для разговора с MachineStorage' }) as never
        if (body.source.agentId !== managed.binding.machineId) return reply.code(403).send({ error: 'Файл относится к другой машине' }) as never
        const separator = managed.generated.includes('\\') && !managed.generated.includes('/') ? '\\' : '/'
        const sourceParent = body.source.path.slice(0, Math.max(body.source.path.lastIndexOf('/'), body.source.path.lastIndexOf('\\')))
        if (sourceParent !== managed.generated) return reply.code(403).send({ error: 'Публиковать можно только непосредственный файл из .generated этого разговора' }) as never
        const known = (await db.chat.listMessages(userId, body.conversationId)).some((message) =>
          (message.attachments ?? []).some((file) => file.path === body.source.path && file.agentId === body.source.agentId)
          || parseImages(message.text).images.some((image) => image.path === body.source.path && image.agentId === body.source.agentId)
        )
        if (!known) return reply.code(403).send({ error: 'Файл не принадлежит этому разговору' }) as never
        return await withGeneratedFileLease(managed.binding.machineId, body.source.path, async () => {
        const source = await agentRegistry.fsRead(managed.binding.machineId, body.source.path)
        if (!source.dataBase64) throw new Error('Временный файл не найден')
        await agentRegistry.fsMkdir(managed.binding.machineId, managed.artifacts)
        const rawName = (body.name || body.source.name || 'artifact').split(/[/\\]/).at(-1) || 'artifact'
        const safeName = rawName.replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/^\.+/, '') || `artifact${extname(body.source.name)}`
        const listing = await agentRegistry.fsList(managed.binding.machineId, managed.artifacts)
        const occupied = new Set((listing.entries ?? []).map((entry) => entry.name))
        let finalName = safeName
        if (!body.overwrite && occupied.has(finalName)) {
          const dot = finalName.lastIndexOf('.')
          const stem = dot > 0 ? finalName.slice(0, dot) : finalName
          const extension = dot > 0 ? finalName.slice(dot) : ''
          let suffix = 2
          while (occupied.has(`${stem}-${suffix}${extension}`)) suffix++
          finalName = `${stem}-${suffix}${extension}`
        }
        const target = `${managed.artifacts}${separator}${finalName}`
        await agentRegistry.fsWrite(managed.binding.machineId, target, source.dataBase64)
        const artifact: MessageAttachment = {
          path: target,
          name: finalName,
          mimeType: body.source.mimeType,
          size: body.source.size,
          agentId: managed.binding.machineId
        }
        const text = imageBlock({ path: target, agentId: managed.binding.machineId, caption: `Опубликованный результат: ${finalName}` })
        const now = new Date()
        const message = await db.chat.addMessage(userId, body.conversationId, 'ai', text, now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), 'codex', undefined, managed.binding.machineId, [artifact])
        return { artifact, message }
        })
      } catch (error) {
        return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) }) as never
      }
    }
  )

  // Публичные совместимые маршруты проксируют физический каталог TTS Runner.
  app.get(REST.ttsVoices, async () => ttsClient.listVoices())
  app.delete<{ Params: { id: string } }>('/api/tts/voices/:id', async (req, reply) => {
    if (!opts.ttsClient && (!opts.config.ttsRunnerUrl || !opts.config.ttsRunnerToken)) return { ok: true }
    if (!ttsClient.deleteVoice) return reply.code(503).send({ error: 'TTS runner unavailable' })
    await ttsClient.deleteVoice(req.params.id)
    return { ok: true }
  })
  app.get(REST.ttsCatalog, async (): Promise<TtsVoiceCatalog> => {
    const voices = await ttsClient.listVoices()
    return { downloadable: false, voices: voices.map((voice) => ({ ...voice, installed: true })) }
  })

  // Один реестр ходов LLM на процесс: ходы переживают обрыв WS-соединения,
  // ответ сохраняется в БД сервером, клиенты получают события broadcast'ом.
  const turnManager = createTurnManager({
    db,
    claude: await claude,
    codex: await codex,
    engineClient: (engine) => new RemoteLlmClient({ kind: engine.kind, baseUrl: engine.baseUrl, ...(engine.token ? { token: engine.token } : {}) }),
    kb,
    kbUsage,
    kbToolEnabled: opts.config.kbToolEnabled,
    kbTool: kbToolBroker,
    resolveUpload: async (id) => {
      const upload = uploads.get(id)
      if (!upload) return null
      if (!upload.agentId) return upload.path
      try {
        const file = await agentRegistry.fsRead(upload.agentId, upload.path)
        if (!file.dataBase64) return null
        return { serverPath: upload.path, runnerName: upload.name, dataBase64: file.dataBase64, preserveServerPath: true }
      } catch {
        return null
      }
    },
    agents: {
      isOnline: (id) => agentRegistry.isOnline(id),
      waitOnline: (id) => agentRegistry.waitForOnline(id),
      nameOf: (id) => agentRegistry.nameOf(id),
      policyOf: (id) => agentRegistry.policyOf(id),
      fsList: (id, path) => agentRegistry.fsList(id, path),
      fsRead: (id, path) => agentRegistry.fsRead(id, path),
      fsMkdir: (id, path) => agentRegistry.fsMkdir(id, path),
      fsWrite: (id, path, data) => agentRegistry.fsWrite(id, path, data)
    },
    ensureChatStorage,
    ensureProjectMainCurrent,
    // Студия картинок: изображения из ответа складываются в галерею разговора.
    studioContext: async (conversationId) => {
      const files = await imageStudioStore.list(conversationId)
      const listing = files.slice(0, 30).map((file) => `- ${file.path}${file.prompt ? ` (промпт: ${file.prompt.slice(0, 80)})` : ''}`).join('\n')
      return [
        '## Студия картинок',
        'Это чат студии картинок: пользователь собирает галерею изображений этого разговора.',
        'Когда рисуешь или правишь картинку — сохрани файл и обязательно покажи его штатным fenced-блоком image с абсолютным путём: только так он попадает в галерею.',
        listing ? `Сейчас в галерее:\n${listing}` : 'Галерея пока пуста.'
      ].join('\n')
    },
    captureStudioImages: async (userId, conversationId, finalText) => {
      const { parseImages } = await import('@voicechat/shared')
      for (const image of parseImages(finalText).images.slice(0, 10)) {
        try {
          const file = await (runnerFs ? runnerFs.readFile(userId, image.path) : Promise.resolve(readUserFile(image.path, [profileHome(userId)])).then((r) => r.ok ? r.file : null))
          if (!file?.dataBase64) continue
          const original = image.path.split('/').pop() ?? 'изображение.png'
          // Технические имена ранов («exec-<uuid>.png») в галерее нечитаемы.
          const readable = /^exec-[0-9a-f-]{20,}\./i.test(original) ? `из-чата${original.slice(original.lastIndexOf('.'))}` : original
          const name = await imageStudioStore.freeName(conversationId, readable)
          await imageStudioStore.writeBuffer(conversationId, name, Buffer.from(file.dataBase64, 'base64'))
        } catch {
          // не-картинка, квота или чтение не удалось — ход это не ломает
        }
      }
    },
    readServerFile: async (userId, path) => {
      if (runnerFs) return runnerFs.readFile(userId, path)
      const settings = await db.settings.getSettings(userId)
      const roots = [
        ensureCliProfile(opts.config.dataDir, userId).home,
        join(opts.config.dataDir, 'uploads'),
        ...(settings.workdir ? [settings.workdir] : [])
      ]
      const res = readUserFile(path, roots)
      return res.ok ? res.file : null
    },
    // MCP для исполнителя должен смотреть либо на loopback dev-сервера, либо на публичную базу из VC_MCP_PUBLIC_BASE.
    mcpBaseUrl: remoteBashMcpBaseUrl,
    kbMcpBaseUrl,
    previewMcpBaseUrl,
    consoleMcpBaseUrl,
    makeMcpBaseUrl,
    kanbanMcpBaseUrl,
    widgetContexts,
    make: make.service,
    previewTurns: createPreviewTurnTokens(mcpSecret),
    remoteFileTool: remoteFileBroker,
    onAuthError: (userId, provider, message) => { authStatus.reportRunError(userId, provider, message) }
  })

  // CI-раннер (Авто-подготовка окружения для таска): процесс-глобальный менеджер
  // ранов. Исполнитель команд — поверх потокового exec машины. Хуки модели/фикса
  // подключаются здесь же (Срез 4).
  // Канбан-кластер собирается отдельным модулем; ядро отдаёт ему зависимости явно (docs/plans/kanban-service.md).
  const kanbanCore = createLocalKanbanCore({ registry: agentRegistry, kb, uploads, widgets: { contexts: widgetContexts, ui: widgetUiRelay }, ensureProjectMainCurrent })
  const remoteKanban = kanbanRemote
    ? createRemoteKanban({ kanbanUrl: opts.config.kanbanUrl!, token: opts.config.internalToken!, onError: (error, what) => app.log.warn({ err: error, what }, 'kanban: фоновый вызов процесса канбана не удался') })
    : null
  const kanban: { service: KanbanService } = remoteKanban ?? await createKanbanModule({ app, db, config: opts.config, core: kanbanCore, claude, codex, kbUsage, make, browserRunner, mailer, mcpSecret, ...(opts.ciExecutor ? { ciExecutor: opts.ciExecutor } : {}), automatedQaScenarioRunner, automatedQaScreenshotDir, remoteBashMcpBaseUrl, kbMcpBaseUrl, previewMcpBaseUrl, ciCommandsMcpBaseUrl, ciKbUpdate: opts.ciKbUpdate })
  if (remoteKanban) {
    registerKanbanProxy(app, { kanbanUrl: opts.config.kanbanUrl! })
    // Зеркало машин у канбана: снимок после каждого изменения реестра (онлайн, политика, телеметрия);
    // телеметрия приходит часто, поэтому с небольшой задержкой — один пуш на пачку изменений.
    let pushTimer: NodeJS.Timeout | null = null
    const pushMachines = (): void => {
      if (pushTimer) return
      pushTimer = setTimeout(() => {
        pushTimer = null
        remoteKanban.pushMachines(machinesSnapshot(agentRegistry)).catch((error) => app.log.warn({ err: error }, 'kanban: снимок машин не доставлен'))
      }, 250)
      pushTimer.unref?.()
    }
    agentRegistry.onChange(pushMachines)
    app.addHook('onClose', async () => { if (pushTimer) clearTimeout(pushTimer) })
  }
  // Web Reader: прокси превью и MCP «browser» — модулем с портом к ядру (docs/plans/web-reader-service.md).
  // Порт ядра нужен и в `remote`: его отдаёт `/internal/reader/core` отдельному процессу ридера.
  const readerCore = createLocalReaderCore({
    db, relay: previewRelay, runKeys: previewRunKeys, shotsRoot: browserShotsRoot,
    publish: (message, userId) => frames.publish(message, userId),
    previews: () => kanban.service.previews.list()
  })
  if (readerRemote) registerReaderProxy(app, { readerUrl: opts.config.readerUrl! })
  else createReaderModule({ app, db, core: readerCore, machines: agentRegistry, mcpSecret, runnerFacingBase, ...(browserRunner ? { browserRunner } : {}) })
  // Внутренний API для соседних сервисов — только при заданном токене (compose); в dev/desktop его нет.
  if (opts.config.internalToken) {
    registerInternalRoutes(app, {
      token: opts.config.internalToken, makeCore, authenticate,
      ...(makeRemote ? { makeHub: make.hub } : { makeService: make.service }),
      admin: { ...(deployTrigger ? { deployTrigger } : {}), sessionHub },
      reader: readerCore,
      ...(remoteKanban ? { kanban: { core: kanbanCore, machinesSnapshot: () => machinesSnapshot(agentRegistry), tunnels: remoteKanban.tunnels, apply: (event) => remoteKanban.apply(event) } } : {})
    })
  }
  // Панель кода: git в рабочей копии задачи или сессии. Своего транспорта у неё нет —
  // всё через тот же exec/fs машины-агента, что у CI и проводника.
  const gitWorkspaces = new GitWorkspaceService({
    db,
    runtime: {
      exec: (agentId, command, timeoutMs, signal, meta) => agentRegistry.exec(agentId, command, timeoutMs, signal, meta),
      fsRead: (agentId, path) => agentRegistry.fsRead(agentId, path),
      fsWrite: (agentId, path, dataBase64) => agentRegistry.fsWrite(agentId, path, dataBase64),
      isOnline: (agentId) => agentRegistry.isOnline(agentId),
      policyOf: (agentId) => agentRegistry.policyOf(agentId),
      platformOf: (agentId) => agentRegistry.platformOf(agentId),
      nameOf: (agentId) => agentRegistry.nameOf(agentId)
    },
    gate: commandGate
  })
  registerProjectGitRoutes(app, gitWorkspaces)
  // Компоненты проекта в Make: тот же сервис рабочих копий плюс Storybook на машине.
  // Сессии живут в памяти процесса — перезапуск сервера оставляет dev-сервер сиротой,
  // поэтому панель показывает «остановлен» и предлагает запустить заново.
  const storybookSessions = new StorybookSessions({
    registry: {
      ptyStart: (agentId, ptyId, cols, rows, cwd, emit) => agentRegistry.ptyStart(agentId, ptyId, cols, rows, cwd, emit),
      ptyInput: (ptyId, data) => agentRegistry.ptyInput(ptyId, data),
      ptyKill: (ptyId) => agentRegistry.ptyKill(ptyId),
      ptyLive: (ptyId) => agentRegistry.ptyLive(ptyId),
      http: (agentId, request) => agentRegistry.http(agentId, request),
      isOnline: (agentId) => agentRegistry.isOnline(agentId),
      nameOf: (agentId) => agentRegistry.nameOf(agentId)
    }
  })
  registerProjectComponentsRoutes(app, {
    git: gitWorkspaces,
    storybook: storybookSessions,
    tickets: new ComponentTicketService({ db, git: gitWorkspaces }),
    tunnels: {
      isOnline: (agentId) => agentRegistry.isOnline(agentId),
      // Туннель поднимает только своя машина пользователя: чужой агент слушать порт не должен.
      ownsAgent: async (userId, agentId) => (await db.machines.listAgents(userId)).some((agent) => agent.id === agentId),
      create: async (id, sourceAgentId, targetAgentId, targetPort, authorize) =>
        agentRegistry.createTunnel(id, sourceAgentId, targetAgentId, targetPort, authorize),
      close: (id) => agentRegistry.closeTunnel(id)
    }
  })

  // Плановая остановка (деплой/SIGTERM → app.close()): сохранить частичные
  // ответы активных ходов, чтобы рестарт контейнера не терял набранный текст.
  app.addHook('onClose', async () => {
    await turnManager.flushInterrupted()
  })

  const makeHandlers = (user: SessionUser, sid: string | null): WsHandlers =>
    createSession({
      db,
      turns: turnManager,
      user,
      // Свой sid нужен, чтобы отличить «завершили эту вкладку» от «завершили
      // соседнюю»: первой полагается уйти на экран входа, второй — обновить список.
      sid,
      sessions: sessionHub,
      sttEngine,
      sttClient,
      getWhisperModel: machineWhisperModel,
      ttsClient,
      diarization,
      capabilities,
      modelDownload,
      agentsFeed: {
        // Список машин — только этого пользователя (изоляция).
        list: async () => {
          const online = agentRegistry.onlineIds()
          return (await db.machines.listAgents(user.name)).map((a) => ({
            ...a,
            online: online.has(a.id),
            version: agentRegistry.versionOf(a.id),
            telemetry: agentRegistry.telemetryOf(a.id),
            imageHost: agentRegistry.imageHostOf(a.id)
          }))
        },
        subscribe: (cb) => agentRegistry.onChange(cb)
      },
      ...(runnerFs
        ? {
            observerTail: {
              watchCc: (userId, slug, id, onItems) => runnerFs.watchCc(userId, slug, id, onItems),
              watchCx: (userId, id, onItems) => runnerFs.watchCx(userId, id, onItems)
            }
          }
        : {}),
      pty: {
        start: (agentId, ptyId, cols, rows, cwd, emit) =>
          agentRegistry.ptyStart(agentId, ptyId, cols, rows, cwd, emit),
        input: (ptyId, data) => agentRegistry.ptyInput(ptyId, data),
        resize: (ptyId, cols, rows) => agentRegistry.ptyResize(ptyId, cols, rows),
        detach: (ptyId) => agentRegistry.ptyDetach(ptyId),
        kill: (ptyId) => agentRegistry.ptyKill(ptyId)
      },
      // Живая канбан-доска: чтение снапшота (с проверкой членства) + подписка на изменения.
      board: {
        getBoard: async (projectId, includeCompleted) => await db.tasks.getBoard(user.name, projectId, { includeCompleted }),
        subscribe: kanban.service.board.subscribe,
        subscribePreparationRuns: kanban.service.board.subscribePreparationRuns,
        subscribeTaskRepositories: kanban.service.board.subscribeTaskRepositories,
        subscribeQaStages: kanban.service.board.subscribeQaStages,
        subscribeImprovements: kanban.service.board.subscribeImprovements
      },
      preparationNotifications: {
        canAccess: async (projectId) => await db.projects.getProject(user.name, projectId) !== null,
        subscribe: kanban.service.notifications.subscribe
      },
      ci: kanban.service.runs,
      frames,
      kbUsage,
      authStatus,
      preview: {
        subscribe: (userId, sink) => previewRelay.subscribe(userId, sink),
        resolve: (userId, requestId, outcome) => previewRelay.resolve(userId, requestId, outcome)
      },
      make: { subscribe: (userId, sink) => make.service.subscribe(userId, sink) },
      widgetUi: {
        subscribe: (userId, sink) => widgetUiRelay.subscribe(userId, sink),
        resolve: (userId, requestId, outcome, conversationId) => widgetUiRelay.resolve(userId, requestId, outcome, conversationId),
        // Снимок принимаем только от владельца разговора: чужой кадр не должен
        // подменять ассистенту представление о чужом экране.
        surfaceChanged: async (userId, conversationId, surface) => {
          if (await db.chat.conversationOwner(conversationId) === userId) widgetContexts.updateSurface(conversationId, surface)
        }
      }
    })

  await app.register(async (scoped) => {
    scoped.get('/ws', { websocket: true }, async (socket, request) => {
      // Тестовый оверрайд обработчиков — без аутентификации.
      if (opts.createWsHandlers) {
        await attachWs(socket, opts.createWsHandlers())
        return
      }
      // Аутентификация WS: токен в query (?token=…). Нет/неверный/заблокирован → закрываем.
      // Токен в query (desktop/старые клиенты) либо cookie-сессия web (п.5): браузер шлёт cookie при upgrade сам.
      const token = (request.query as { token?: string } | undefined)?.token ?? cookieToken(request.headers.cookie)
      // Кадры, пришедшие пока идёт проверка сессии (запросы к базе), нельзя терять: клиент шлёт
      // первое сообщение сразу после open, а слушатель появится только в attachWs. С SQLite проверка
      // укладывалась в микрозадачи и окно было незаметно; с Postgres оно — миллисекунды сети.
      const early: Array<[Buffer, boolean]> = []
      const buffer = (data: Buffer, isBinary: boolean): void => { early.push([data, isBinary]) }
      socket.on('message', buffer)
      const user = await resolveActiveUser(db, token, sessionSecret)
      socket.off('message', buffer)
      if (!user) {
        socket.close()
        return
      }
      await attachWs(socket, makeHandlers(user, verifyToken(token, sessionSecret)?.sid ?? null), {
        // Логгер Fastify выключен — пишем в stdout контейнера: по счётчикам видно, какие кадры забили очередь.
        onOverflow: (info) => console.warn('[ws] исходящая очередь переполнена, соединение разорвано:', JSON.stringify({ user: user.name, ...info }))
      })
      for (const [data, isBinary] of early) socket.emit('message', data, isBinary)
    })
  })

  // Два независимых frontend build раздаются тем же сервером и используют общий
  // backend. Recorder регистрируется первым под собственным prefix, чтобы его index
  // и assets никогда не попадали в SPA-fallback основного ChatAI.
  if (opts.config.webDir && existsSync(opts.config.webDir)) {
    const webDir = opts.config.webDir
    const recorderDir =
      opts.config.webRecorderDir && existsSync(opts.config.webRecorderDir)
        ? opts.config.webRecorderDir
        : null
    const { default: fastifyStatic } = await import('@fastify/static')
    if (recorderDir) {
      await app.register(fastifyStatic, {
        root: recorderDir,
        prefix: '/web-recorder/',
        wildcard: false,
        decorateReply: false
      })
    }
    await app.register(fastifyStatic, { root: webDir, wildcard: false })
    // SPA-fallback относится только к ChatAI. Отсутствующий recorder-артефакт
    // должен дать 404, а не маскироваться index.html другого приложения.
    app.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?')[0]
      if (
        req.method === 'GET' &&
        !url.startsWith('/api') &&
        !url.startsWith('/ws') &&
        !url.startsWith('/agent') &&
        !url.startsWith('/web-recorder')
      ) {
        return reply.type('text/html').sendFile('index.html')
      }
      return reply.code(404).send({ error: 'not found' })
    })
  }

  app.addHook('onClose', async () => {
    if (!opts.db) db.close() // закрываем только созданную нами БД
  })

  return app
}

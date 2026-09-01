// Конфигурация сервера из окружения.

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ServerConfig {
  port: number
  host: string
  /** Каталог данных (БД, модели). */
  dataDir: string
  /** Регистрация с подтверждением email: SMTP (smtp://user:pass@host:587 | smtps://…:465), отправитель и публичный URL для ссылок. */
  smtpUrl: string | null
  mailFrom: string | null
  publicUrl: string | null
  /** Каталог голосов Piper. */
  piperVoicesDir: string
  /** Путь к исполняемому piper (или python для `python -m piper`). */
  piperBin: string
  /** Префикс аргументов piper (['-m','piper'] при запуске через python). */
  piperArgsPrefix: string[]
  /** Путь к .dmg компаньон-приложения для скачивания (undefined — не собрано). */
  agentAppPath?: string
  /** Путь к macOS ARM64 DMG login-application. */
  loginApplicationMacosArm64Path?: string
  /** Сколько мс операции машины (exec/fs) ждут возврата офлайн-агента перед отказом; 0 — сразу отказ. */
  agentOfflineGraceMs: number
  /** Команда машины длиннее этого (мс) считается долгой: владелец получает уведомление, для чата сохраняется лог. */
  longCommandMs: number
  /** Watchdog: машина без агента дольше этого (мс) — тревога владельцу; 0 — выключено. */
  agentOfflineAlertMs: number
  /** Путь к .dmg десктоп-приложения для скачивания (undefined — не собрано). */
  desktopAppPath?: string
  /**
   * Каталог собранного web-приложения (apps/web/dist) для раздачи статики тем же
   * сервером. Задаётся только через env (VC_WEB_DIR) — в dev/тестах не задан, чтобы
   * не мешать Vite. В Docker указывает на скопированный билд.
   */
  webDir?: string
  /** Каталог standalone Web Recorder, раздаваемый под /web-recorder/. */
  webRecorderDir?: string
  /** Backend входящего Claude gateway: прозрачный upstream или локальный Codex CLI. */
  claudeGatewayBackend: 'upstream' | 'codex'
  /** Anthropic-compatible upstream для входящих запросов Claude Code. */
  claudeGatewayUpstreamUrl?: string
  /** API-ключ upstream; входящий gateway остаётся без авторизации. */
  claudeGatewayUpstreamKey?: string
  /** Способ передачи ключа upstream. */
  claudeGatewayAuthMode: 'x-api-key' | 'bearer' | 'both'
  /** Отображение имён моделей Claude Code в имена upstream. */
  claudeGatewayModelMap: Record<string, string>
  /** Корень read-only базы знаний Markdown. */
  kbRoot: string
  /** CLI для выборочного semantic reranking; disabled оставляет чистый BM25. */
  kbRerankProvider: 'disabled' | 'claude' | 'codex'
  /** Публичная база MCP-эндпоинтов для контейнера-исполнителя; без env остаётся loopback сервера. */
  mcpPublicBase?: string
  /** MCP-инструменты БЗ для модели (mcp__kb__*); VC_KB_TOOL=off выключает срез целиком. */
  kbToolEnabled: boolean
  /** Пароль пользователя admin при сиде новой БД (пусто — без пароля). */
  adminPassword: string
  /** Порог памяти для распознавания речи (STT), байты; undefined — дефолт по модели. */
  minMemSttBytes?: number
  /** Порог памяти для озвучки (TTS), байты; undefined — дефолт. */
  minMemTtsBytes?: number
  /** GitHub token для server-side PR merge. */
  githubToken?: string
  /**
   * База URL контейнера-исполнителя claude (`POST /v1/run`). Задана — сервер не
   * делает spawn, а ходит по HTTP (`llm/remoteClient.ts`). Реестра исполнителей
   * пока нет: адрес один и берётся из env.
   */
  llmRunnerClaudeUrl?: string
  /** То же для codex; по умолчанию — тот же исполнитель, что и для claude. */
  llmRunnerCodexUrl?: string
  /** Bearer-токен исполнителей (пусто — закрытая сеть без авторизации). */
  llmRunnerToken?: string
  /** Таймаут ожидания заголовков /v1/run, мс (сам ход не ограничен). */
  llmRunnerConnectTimeoutMs?: number
  /** Browser Runner (Playwright Reader): изолированный Chromium; сервер сам его не запускает. */
  browserRunnerUrl?: string
  /** Service-токен browser-runner (обязателен, если задан URL). */
  browserRunnerToken?: string
  /** Внутренний TTS Runner; сервер никогда не запускает TTS-бинари сам. */
  ttsRunnerUrl?: string
  /** Обязательный Bearer-токен TTS Runner. */
  ttsRunnerToken?: string
  /** Внутренний STT Runner; сервер никогда не открывает его браузеру. */
  sttRunnerUrl?: string
  sttRunnerToken?: string
  sttRunnerConnectTimeoutMs?: number
  /** Unix-сокет host-side API, запускающего voicechat-deploy. */
  deployApiSocket?: string
}

const DEFAULT_DATA_DIR = join(homedir(), '.voicechat-server')

// Авто-обнаружение готовых артефактов из desktop-приложения в этом монорепо —
// чтобы `npm run dev` в apps/server работал без env. В проде/на другой машине этих
// путей нет → откат к дефолтам, а env всегда имеет приоритет.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const REPO = {
  piperBin: join(REPO_ROOT, '.venv-piper/bin/piper'),
  piperVoicesDir: join(REPO_ROOT, 'apps/desktop/resources/piper-voices'),
  agentAppDir: join(REPO_ROOT, 'apps/agent-tray/release'),
  loginApplicationDir: join(REPO_ROOT, 'apps/login-application/release'),
  desktopAppDir: join(REPO_ROOT, 'apps/desktop/release')
}

/** Первый .dmg в каталоге (собранный компаньон-агент) или undefined. */
function findDmg(dir: string): string | undefined {
  try {
    const f = readdirSync(dir).find((n) => n.endsWith('.dmg'))
    return f ? join(dir, f) : undefined
  } catch {
    return undefined
  }
}

// Под тестами (vitest) авто-обнаружение репо-путей ОТКЛЮЧЕНО: иначе деструктивные
// операции в тестах (удаление модели/голоса) затронули бы реальные файлы репозитория.
const AUTODISCOVER = !process.env.VITEST

/** env → значение → in-repo артефакт (если существует и не тест) → дефолт. */
function pick(envVal: string | undefined, repoPath: string, fallback: string): string {
  if (envVal) return envVal
  if (AUTODISCOVER && existsSync(repoPath)) return repoPath
  return fallback
}

function parseModelMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
  } catch {
    throw new Error('VC_CLAUDE_MODEL_MAP должен быть JSON-объектом {\"входная-модель\":\"upstream-модель\"}')
  }
}

/** Разбирает порог памяти: число байт или с суффиксом G/M/K (напр. '1.5G'). undefined — не задан. */
function parseBytes(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const m = /^\s*([\d.]+)\s*([gmk])?b?\s*$/i.exec(raw)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return undefined
  const mult = { g: 1024 ** 3, m: 1024 ** 2, k: 1024 }[m[2]?.toLowerCase() ?? ''] ?? 1
  return Math.round(n * mult)
}

/** Целое положительное число из env; undefined — не задано или мусор. */
function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = env.VC_DATA_DIR ?? DEFAULT_DATA_DIR
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '127.0.0.1',
    dataDir,
    smtpUrl: env.VC_SMTP_URL ?? null,
    mailFrom: env.VC_MAIL_FROM ?? null,
    publicUrl: env.VC_PUBLIC_URL ?? null,
    piperVoicesDir: pick(env.VC_PIPER_VOICES_DIR, REPO.piperVoicesDir, join(dataDir, 'models', 'piper')),
    piperBin: pick(env.VC_PIPER_BIN, REPO.piperBin, 'piper'),
    piperArgsPrefix: env.VC_PIPER_ARGS ? env.VC_PIPER_ARGS.split(' ') : [],
    agentAppPath: env.VC_AGENT_APP ?? (AUTODISCOVER ? findDmg(REPO.agentAppDir) : undefined),
    loginApplicationMacosArm64Path: env.VC_LOGIN_APPLICATION_MACOS_ARM64 ?? (AUTODISCOVER ? findDmg(REPO.loginApplicationDir) : undefined),
    // В тестах — 0, чтобы офлайн-проверки отвечали мгновенно; в проде даём агенту 15 с на переподключение.
    agentOfflineAlertMs: env.VC_AGENT_OFFLINE_ALERT_MIN !== undefined ? Math.max(0, Number(env.VC_AGENT_OFFLINE_ALERT_MIN) || 0) * 60_000 : 10 * 60_000,
    longCommandMs: env.VC_LONG_COMMAND_MS !== undefined ? Math.max(0, Number(env.VC_LONG_COMMAND_MS) || 0) : 10_000,
    agentOfflineGraceMs: env.VC_AGENT_OFFLINE_GRACE_MS !== undefined ? Math.max(0, Number(env.VC_AGENT_OFFLINE_GRACE_MS) || 0) : (AUTODISCOVER ? 15_000 : 0),
    desktopAppPath: env.VC_DESKTOP_APP ?? (AUTODISCOVER ? findDmg(REPO.desktopAppDir) : undefined),
    webDir: env.VC_WEB_DIR,
    webRecorderDir: env.VC_WEB_RECORDER_DIR,
    claudeGatewayBackend: env.VC_CLAUDE_GATEWAY_BACKEND === 'codex' ? 'codex' : 'upstream',
    claudeGatewayUpstreamUrl: env.VC_CLAUDE_UPSTREAM_URL,
    claudeGatewayUpstreamKey: env.VC_CLAUDE_UPSTREAM_API_KEY,
    claudeGatewayAuthMode:
      env.VC_CLAUDE_UPSTREAM_AUTH === 'bearer' || env.VC_CLAUDE_UPSTREAM_AUTH === 'both'
        ? env.VC_CLAUDE_UPSTREAM_AUTH
        : 'x-api-key',
    claudeGatewayModelMap: parseModelMap(env.VC_CLAUDE_MODEL_MAP),
    kbRoot: env.VC_KB_ROOT ?? join(REPO_ROOT, 'docs/kb'),
    kbRerankProvider: env.VC_KB_RERANK_PROVIDER === 'disabled' || env.VC_KB_RERANK_PROVIDER === 'claude' ? env.VC_KB_RERANK_PROVIDER : 'codex',
    mcpPublicBase: env.VC_MCP_PUBLIC_BASE,
    kbToolEnabled: env.VC_KB_TOOL !== 'off',
    adminPassword: env.VC_ADMIN_PASSWORD ?? '',
    minMemSttBytes: parseBytes(env.VC_MIN_MEM_STT),
    minMemTtsBytes: parseBytes(env.VC_MIN_MEM_TTS),
    githubToken: env.VC_GITHUB_TOKEN,
    llmRunnerClaudeUrl: env.VC_LLM_RUNNER_CLAUDE_URL ?? env.VC_LLM_RUNNER_URL,
    llmRunnerCodexUrl: env.VC_LLM_RUNNER_CODEX_URL ?? env.VC_LLM_RUNNER_URL,
    llmRunnerToken: env.VC_LLM_RUNNER_TOKEN,
    browserRunnerUrl: env.VC_BROWSER_RUNNER_URL,
    browserRunnerToken: env.VC_BROWSER_RUNNER_TOKEN,
    llmRunnerConnectTimeoutMs: parsePositiveInt(env.VC_LLM_RUNNER_TIMEOUT_MS),
    ttsRunnerUrl: env.VC_TTS_RUNNER_URL,
    ttsRunnerToken: env.VC_TTS_RUNNER_TOKEN,
    sttRunnerUrl: env.VC_STT_RUNNER_URL,
    sttRunnerToken: env.VC_STT_RUNNER_TOKEN,
    sttRunnerConnectTimeoutMs: parsePositiveInt(env.VC_STT_RUNNER_TIMEOUT_MS),
    deployApiSocket: env.VC_DEPLOY_API_SOCKET
  }
}

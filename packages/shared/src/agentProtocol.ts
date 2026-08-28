// Протокол компаньон-агента: консольное приложение на машине пользователя
// подключается к серверу по WS /agent, авторизуется токеном и выполняет
// присланные shell-команды (проброс Bash через MCP-мост).

/** Результат выполнения команды на машине (утилита «Консоль»). */
export interface AgentExecResult {
  exitCode: number | null
  output: string
  timedOut: boolean
}

/** Элемент каталога в проводнике по машине. */
export interface FsEntry {
  name: string
  kind: 'file' | 'dir' | 'symlink' | 'other'
  /** Размер файла в байтах (0 для каталогов). */
  size: number
  /** Время изменения (UNIX мс). */
  mtime: number
}

/** Результат операции проводника (по opId). */
export interface FsResult {
  /** Абсолютный корень проводника на машине (каталог скрипта). */
  root: string
  /** Текущий каталог (относительно корня; '' — корень). */
  cwd: string
  /** Содержимое каталога (для fs.list). */
  entries?: FsEntry[]
  /** Содержимое файла в base64 (для fs.read). */
  dataBase64?: string
  /** Имя файла (для fs.read — для сохранения). */
  name?: string
  /** Куда перемещён элемент (для fs.trash) — по этому пути его можно вернуть fs.rename. */
  trashedPath?: string
}

/** Откуда пришла команда машины: консоль пользователя, инструмент модели в чате или сам сервер (обновление, релиз). */
export type MachineCommandSource = 'console' | 'chat' | 'system'

/** Запись журнала команд машины (machines-roadmap п.4). */
export interface MachineCommandRecord {
  id: number
  machineId: string
  /** Кто выполнял; для системных команд — владелец машины. */
  userId: string
  source: MachineCommandSource
  command: string
  exitCode: number | null
  timedOut: boolean
  /** Команда отклонена/упала до запуска (политика, офлайн) — текст ошибки. */
  error: string | null
  durationMs: number
  startedAt: number
  /** Чат, из которого модель выполнила команду (source = chat). */
  conversationId: string | null
  /** Первые ~500 символов вывода — чтобы понять, что произошло, без полного лога. */
  outputExcerpt: string
}

/** Результат копирования файла между машинами (`POST /api/agents/:id/fs/copy-to`): сервер читает с одной и пишет на другую. */
export interface FsCopyResult {
  /** Абсолютный путь файла на целевой машине. */
  path: string
  targetAgentId: string
  /** Размер скопированных байт. */
  size: number
}

/** Использование дискового раздела (байты). */
export interface DiskUsage {
  totalBytes: number
  freeBytes: number
}

/** Живая телеметрия машины-агента: ОС, загрузка, диск, батарея. */
export interface AgentTelemetry {
  /** Когда собрана (UNIX мс). */
  ts: number
  os: {
    /** os.platform(): 'linux' | 'darwin' | 'win32' … */
    platform: string
    /** Релиз/версия ядра (os.release()). */
    release: string
    /** Архитектура (os.arch()). */
    arch: string
    /** Работает ли агент в Termux (Android). */
    isAndroid: boolean
    /** Домашний каталог пользователя, нужен для рекомендуемого корня ChatAI. */
    homePath?: string
    /** Выбранный shell для exec/PTY (см. `platform.ts:resolveShellInfo`). Нет — старый агент. */
    shell?: string
    /** true — на Windows не нашли bash.exe и агент упал в cmd.exe (ограниченная функциональность). */
    shellDegraded?: boolean
  }
  cpu: {
    /** Число логических ядер. */
    count: number
    /** Загрузка CPU в процентах (0–100), усреднённая за интервал сбора. */
    loadPct: number
  }
  mem: {
    totalBytes: number
    usedBytes: number
  }
  disk: {
    /** Корневой раздел (/). */
    root?: DiskUsage
    /** Рабочий каталог агента. */
    work?: DiskUsage
  }
  /** Батарея (только Android с termux-api); иначе отсутствует. */
  battery?: {
    percent: number
    charging: boolean
  }
}

/**
 * HTTP-запрос сервера к loopback-порту машины: мост тестовых окружений Web
 * Reader (`http://<agentId>.machine.internal:<port>` в /api/preview). Агент
 * выполняет запрос строго к 127.0.0.1 — target host клиент задать не может,
 * как и в tunnel.connect.
 */
export interface AgentHttpRequest {
  method: string
  /** https — для локальных dev-серверов с самоподписанным сертификатом. */
  protocol?: 'http' | 'https'
  /** Порт на 127.0.0.1 машины (1–65535). */
  port: number
  /** Путь с query, начинается с '/'. */
  path: string
  headers: Record<string, string | string[]>
  /** Тело запроса (base64), только для методов с телом. */
  bodyBase64?: string
}

/** Ответ loopback-запроса; тело ограничено капом агента (5 MiB). */
export interface AgentHttpResponse {
  status: number
  headers: Record<string, string | string[]>
  bodyBase64: string
}

/** Сообщения агент → сервер. */
export type AgentToServer =
  | { t: 'agent.register'; token: string; version?: string; imageHost?: AgentImageHost }
  /** Раздача картинок поднялась/адреса машины сменились — обновить у сервера. */
  | { t: 'agent.imageHost'; imageHost: AgentImageHost }
  | { t: 'exec.chunk'; execId: string; stream: 'stdout' | 'stderr'; data: string }
  | { t: 'exec.done'; execId: string; exitCode: number | null; timedOut?: boolean }
  | { t: 'exec.error'; execId: string; message: string }
  | { t: 'pty.output'; ptyId: string; data: string }
  | { t: 'pty.exit'; ptyId: string; exitCode: number | null; signal?: number }
  | { t: 'pty.error'; ptyId: string; message: string }
  /** Живой контекст сессии (cwd/foreground/altScreen) — для консоли с ассистентом. */
  | { t: 'pty.context'; ptyId: string; context: import('./types').PtyContext }
  | { t: 'fs.result'; opId: string; result: FsResult }
  | { t: 'fs.error'; opId: string; message: string; code?: string }
  | { t: 'git.access.result'; requestId: string; result: import('./gitAccess').GitAccessResult }
  | { t: 'agent.setPolicy'; policy: AgentPolicy }
  | { t: 'agent.telemetry'; telemetry: AgentTelemetry }
  | { t: 'tunnel.listening'; tunnelId: string; port: number }
  | { t: 'tunnel.open'; tunnelId: string; connectionId: string }
  | { t: 'tunnel.connected'; tunnelId: string; connectionId: string }
  | { t: 'tunnel.data'; tunnelId: string; connectionId: string; data: string }
  | { t: 'tunnel.end'; tunnelId: string; connectionId: string }
  | { t: 'tunnel.error'; tunnelId: string; message: string }
  | { t: 'tunnel.connectionError'; tunnelId: string; connectionId: string; message: string }
  | { t: 'http.result'; requestId: string; response: AgentHttpResponse }
  | { t: 'http.error'; requestId: string; message: string }

/** Именованный скрипт («навык»), разрешённый к запуску на машине. */
export interface AgentSkill {
  name: string
  command: string
  description?: string
}

/** Политика возможностей машины-агента (что ему разрешено делать). */
export interface AgentPolicy {
  /** Разрешённые рабочие каталоги (пусто — любой). */
  allowedDirs: string[]
  /** Разрешён доступ в сеть/API. */
  allowNetwork: boolean
  /** Разрешены изменения файлов (создание/правка/удаление). */
  allowWrite: boolean
  /** Запрещённые паттерны команд (regex или подстрока). */
  denyPatterns: string[]
  /** Если непусто — разрешены только совпадающие с этими паттернами команды. */
  allowPatterns: string[]
  /** Навыки — именованные разрешённые скрипты. */
  skills: AgentSkill[]
}

export const DEFAULT_AGENT_POLICY: AgentPolicy = {
  allowedDirs: [],
  allowNetwork: true,
  allowWrite: true,
  denyPatterns: [],
  allowPatterns: [],
  skills: []
}

/** Результат проверки команды по политике. */
export interface PolicyVerdict {
  allowed: boolean
  reason?: string
}

const NETWORK_RE = /\b(curl|wget|nc|ncat|telnet|ssh|scp|sftp|ftp|rsync)\b/i
const WRITE_RE = /(\brm\b|\bmv\b|\brmdir\b|\btruncate\b|\bdd\b|\btee\b|\bmkdir\b|>>?)/

/** Совпадение паттерна: как regex (если компилируется), иначе подстрока (без регистра). */
function matchesPattern(pattern: string, command: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(command)
  } catch {
    return command.toLowerCase().includes(pattern.toLowerCase())
  }
}

/** Абсолютные пути из команды (грубо: токены, начинающиеся с /). */
function absolutePaths(command: string): string[] {
  return command.match(/(?:^|[\s='"(])(\/[^\s'"()]+)/g)?.map((m) => m.replace(/^[\s='"(]+/, '')) ?? []
}

/**
 * Проверяет команду по политике агента (чистая, тестируемая). Best-effort:
 * ловит явные нарушения по паттернам/каталогам/сети/записи, но не является
 * полноценной песочницей.
 */
export function evaluateAgentCommand(policy: AgentPolicy, command: string): PolicyVerdict {
  const cmd = command.trim()
  if (policy.allowPatterns.length > 0 && !policy.allowPatterns.some((p) => matchesPattern(p, cmd))) {
    return { allowed: false, reason: 'команда не входит в список разрешённых' }
  }
  for (const p of policy.denyPatterns) {
    if (matchesPattern(p, cmd)) return { allowed: false, reason: `запрещённый паттерн: ${p}` }
  }
  if (!policy.allowNetwork && NETWORK_RE.test(cmd)) {
    return { allowed: false, reason: 'доступ в сеть запрещён' }
  }
  if (!policy.allowWrite && WRITE_RE.test(cmd)) {
    return { allowed: false, reason: 'изменение файлов запрещено' }
  }
  if (policy.allowedDirs.length > 0) {
    const outside = absolutePaths(cmd).find(
      (p) => !policy.allowedDirs.some((d) => p === d || p.startsWith(d.endsWith('/') ? d : `${d}/`))
    )
    if (outside) return { allowed: false, reason: `путь вне разрешённых каталогов: ${outside}` }
  }
  return { allowed: true }
}

/** Файловая операция проводника (сервер → агент), path относительно корня. */
export type FsOp =
  | { t: 'fs.list'; opId: string; path: string }
  | { t: 'fs.read'; opId: string; path: string }
  | { t: 'fs.write'; opId: string; path: string; dataBase64: string }
  | { t: 'fs.delete'; opId: string; path: string }
  | { t: 'fs.delete-file-safe'; opId: string; path: string }
  /** Переместить файл/каталог в корзину машины (`<корень>/.voicechat_trash`), откат — fs.rename обратно. */
  | { t: 'fs.trash'; opId: string; path: string }
  | { t: 'fs.rename'; opId: string; from: string; to: string }
  | { t: 'fs.mkdir'; opId: string; path: string }

/** Сообщения сервер → агент. */
export type ServerToAgent =
  | { t: 'agent.registered'; id?: string; name: string; policy: AgentPolicy }
  | { t: 'agent.denied'; reason: string }
  | { t: 'agent.policy'; policy: AgentPolicy }
  | { t: 'agent.updateAvailable'; version: string }
  | { t: 'exec.start'; execId: string; command: string; timeoutMs: number }
  | { t: 'exec.cancel'; execId: string }
  | { t: 'git.access'; requestId: string; request: import('./gitAccess').GitAccessRequest }
  | { t: 'pty.start'; ptyId: string; cols: number; rows: number; cwd?: string }
  | { t: 'pty.input'; ptyId: string; data: string }
  | { t: 'pty.resize'; ptyId: string; cols: number; rows: number }
  | { t: 'pty.kill'; ptyId: string }
  | { t: 'tunnel.listen'; tunnelId: string }
  | { t: 'tunnel.connect'; tunnelId: string; connectionId: string; port: number }
  | { t: 'tunnel.data'; tunnelId: string; connectionId: string; data: string }
  | { t: 'tunnel.end'; tunnelId: string; connectionId: string }
  | { t: 'tunnel.close'; tunnelId: string }
  | { t: 'http.request'; requestId: string; request: AgentHttpRequest }
  | FsOp

/** Машина-агент для списка в настройках. */
export interface AgentInfo {
  id: string
  name: string
  online: boolean
  createdAt: number
  lastSeen: number | null
  policy: AgentPolicy
  /** Персональный default в контексте запрошенного чата. */
  isDefault?: boolean
  /** Фактически выбранная машина наследования с учётом online-fallback. */
  isEffective?: boolean
  effectiveSource?: 'personal_default' | 'fallback'
  /** Версия подключённого агента (только когда online; иначе не задана). */
  version?: string
  /** Последняя телеметрия машины (только когда online; иначе не задана). */
  telemetry?: AgentTelemetry
  /** Раздача картинок машиной (только когда online и агент это умеет). */
  imageHost?: AgentImageHost
}

/**
 * Раздача картинок машиной: агент поднимает у себя маленький HTTP-сервер над
 * `<rootDir>/.generated_images`, чтобы браузер тянул картинку прямо с машины,
 * не гоняя байты через сервер. Адрес НЕ сохраняется в сообщении: IP машины
 * меняется, поэтому клиент собирает URL заново из живого `AgentInfo`.
 */
export interface AgentImageHost {
  /** Порт HTTP-сервера картинок на машине. */
  port: number
  /** IPv4-адреса машины (без loopback), в порядке предпочтения. */
  hosts: string[]
}

/** Ответ на создание агента: токен возвращается только здесь, один раз. */
export interface AgentCreated {
  id: string
  name: string
  token: string
}

/** Параметры подключения агента (адрес WS + токен). */
export interface AgentConnectionParams {
  /** ws(s)://host:port/agent */
  server: string
  token: string
}

/** base64url без padding (для компактной строки подключения). */
function toBase64Url(s: string): string {
  const b64 = typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'utf8').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  return typeof atob === 'function'
    ? atob(b64)
    : Buffer.from(b64, 'base64').toString('utf8')
}

/**
 * Кодирует адрес+токен в одну строку для копирования в трей-приложение.
 * Формат: 'vcagent:' + base64url(JSON) — префикс помогает узнать строку.
 */
export function encodeAgentConnection(params: AgentConnectionParams): string {
  return `vcagent:${toBase64Url(JSON.stringify({ server: params.server, token: params.token }))}`
}

/** Разбирает строку подключения; null — если формат не распознан. */
export function decodeAgentConnection(raw: string): AgentConnectionParams | null {
  const s = raw.trim()
  if (!s.startsWith('vcagent:')) return null
  try {
    const obj = JSON.parse(fromBase64Url(s.slice('vcagent:'.length))) as Partial<AgentConnectionParams>
    if (typeof obj.server === 'string' && obj.server && typeof obj.token === 'string' && obj.token) {
      return { server: obj.server, token: obj.token }
    }
    return null
  } catch {
    return null
  }
}

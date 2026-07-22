// Протокол компаньон-агента: консольное приложение на машине пользователя
// подключается к серверу по WS /agent, авторизуется токеном и выполняет
// присланные shell-команды (проброс Bash через MCP-мост).

/** Сообщения агент → сервер. */
export type AgentToServer =
  | { t: 'agent.register'; token: string }
  | { t: 'exec.chunk'; execId: string; stream: 'stdout' | 'stderr'; data: string }
  | { t: 'exec.done'; execId: string; exitCode: number | null; timedOut?: boolean }
  | { t: 'exec.error'; execId: string; message: string }

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

/** Сообщения сервер → агент. */
export type ServerToAgent =
  | { t: 'agent.registered'; name: string; policy: AgentPolicy }
  | { t: 'agent.denied'; reason: string }
  | { t: 'agent.policy'; policy: AgentPolicy }
  | { t: 'exec.start'; execId: string; command: string; timeoutMs: number }
  | { t: 'exec.cancel'; execId: string }

/** Машина-агент для списка в настройках. */
export interface AgentInfo {
  id: string
  name: string
  online: boolean
  createdAt: number
  lastSeen: number | null
  policy: AgentPolicy
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

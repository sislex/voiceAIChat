// Протокол компаньон-агента: консольное приложение на машине пользователя
// подключается к серверу по WS /agent, авторизуется токеном и выполняет
// присланные shell-команды (проброс Bash через MCP-мост).

/** Сообщения агент → сервер. */
export type AgentToServer =
  | { t: 'agent.register'; token: string }
  | { t: 'exec.chunk'; execId: string; stream: 'stdout' | 'stderr'; data: string }
  | { t: 'exec.done'; execId: string; exitCode: number | null; timedOut?: boolean }
  | { t: 'exec.error'; execId: string; message: string }

/** Сообщения сервер → агент. */
export type ServerToAgent =
  | { t: 'agent.registered'; name: string }
  | { t: 'agent.denied'; reason: string }
  | { t: 'exec.start'; execId: string; command: string; timeoutMs: number }
  | { t: 'exec.cancel'; execId: string }

/** Машина-агент для списка в настройках. */
export interface AgentInfo {
  id: string
  name: string
  online: boolean
  createdAt: number
  lastSeen: number | null
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

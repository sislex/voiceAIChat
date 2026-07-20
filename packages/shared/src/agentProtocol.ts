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

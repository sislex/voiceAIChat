// Конфигурация компаньон-агента. Источники (по приоритету):
//   1) явные --server/--token (или env VC_AGENT_SERVER/VC_AGENT_TOKEN)
//   2) строка подключения --connection (или env VC_AGENT_CONNECTION) — vcagent:…
// Строка подключения копируется из веб-настроек и содержит адрес + токен.

import { decodeAgentConnection } from '@voicechat/shared'

export interface AgentConfig {
  /** ws://host:port/agent */
  serverUrl: string
  token: string
}

const USAGE = `Использование:
  voicechat-agent --connection vcagent:…            (строка подключения из настроек)
  voicechat-agent --server ws://host:8787/agent --token <токен>
Или через env: VC_AGENT_CONNECTION, либо VC_AGENT_SERVER + VC_AGENT_TOKEN.
Строка подключения и токен создаются в веб-настройках (раздел «Агент» → «Машины»).`

/** http(s):// → ws(s)://, добавляет /agent, если путь не указан. */
export function normalizeServerUrl(raw: string): string {
  let url = raw.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  if (!/^wss?:\/\//.test(url)) url = `ws://${url}`
  const u = new URL(url)
  if (u.pathname === '/' || u.pathname === '') u.pathname = '/agent'
  return u.toString()
}

export function loadConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): AgentConfig {
  let server = env.VC_AGENT_SERVER
  let token = env.VC_AGENT_TOKEN
  let connection = env.VC_AGENT_CONNECTION
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--server') server = argv[++i]
    else if (argv[i] === '--token') token = argv[++i]
    else if (argv[i] === '--connection') connection = argv[++i]
  }
  // Строка подключения — база; явные server/token её перекрывают.
  const parsed = connection ? decodeAgentConnection(connection) : null
  const finalServer = server ?? parsed?.server
  const finalToken = token ?? parsed?.token
  if (!finalServer || !finalToken) {
    console.error(USAGE)
    process.exit(1)
  }
  return { serverUrl: normalizeServerUrl(finalServer), token: finalToken }
}

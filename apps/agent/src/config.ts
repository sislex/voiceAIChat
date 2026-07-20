// Конфигурация компаньон-агента: URL сервера и токен — из флагов или env.

export interface AgentConfig {
  /** ws://host:port/agent */
  serverUrl: string
  token: string
}

const USAGE = `Использование: voicechat-agent --server ws://host:8787/agent --token <токен>
Или через env: VC_AGENT_SERVER, VC_AGENT_TOKEN.
Токен создаётся в настройках веб-клиента (раздел «Агент» → «Машины»).`

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
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--server') server = argv[++i]
    else if (argv[i] === '--token') token = argv[++i]
  }
  if (!server || !token) {
    console.error(USAGE)
    process.exit(1)
  }
  return { serverUrl: normalizeServerUrl(server), token }
}

// Разбор вывода `claude mcp list`. Чистая функция — тестируется на фикстурах.
//
// Форматы вывода (claude-code 2.x):
//   "No MCP servers configured. Use `claude mcp add` ..."   → []
//   "Checking MCP server health..."                          (строка-шум)
//   "name: npx -y some-server - ✓ Connected"                 → connected
//   "other: https://x/sse (SSE) - ✗ Failed to connect"       → не connected

/** Один подключённый MCP-сервер (для показа в настройках). */
export interface McpServer {
  /** Имя сервера. */
  name: string
  /** Команда/URL и прочее описание из строки. */
  detail: string
  /** Строка статуса как её напечатал CLI. */
  status: string
  /** Успешно ли подключён. */
  connected: boolean
}

// Разделитель статуса — « - » с пробелами с обеих сторон (чтобы не сломаться о «-y»
// в командах вроде «npx -y ...»).
const LINE_RE = /^([^:\s][^:]*):\s*(.*?)\s+-\s+(.+)$/

/** Разбирает stdout `claude mcp list` в список серверов (пустой при отсутствии). */
export function parseMcpList(stdout: string): McpServer[] {
  const servers: McpServer[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^no mcp servers/i.test(line)) return []
    if (/^checking mcp server health/i.test(line)) continue
    const m = LINE_RE.exec(line)
    if (!m) continue
    const status = m[3].trim()
    servers.push({
      name: m[1].trim(),
      detail: m[2].trim(),
      status,
      connected: /connected|✓/i.test(status) && !/✗|fail/i.test(status)
    })
  }
  return servers
}

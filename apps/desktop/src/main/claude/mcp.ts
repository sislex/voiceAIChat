// Получение списка MCP-серверов через `claude mcp list` (desktop).
// Ошибки/отсутствие CLI деградируют к пустому списку — фича необязательная.

import { execFile } from 'node:child_process'
import { parseMcpList, type McpServer } from '@shared/mcp'

/** Запускает `claude mcp list` и парсит вывод; при ошибке — []. */
export function listMcpServers(bin = 'claude'): Promise<McpServer[]> {
  return new Promise((resolve) => {
    try {
      execFile(bin, ['mcp', 'list'], { timeout: 8000 }, (_err, stdout) => {
        resolve(parseMcpList(stdout ?? ''))
      })
    } catch {
      resolve([])
    }
  })
}

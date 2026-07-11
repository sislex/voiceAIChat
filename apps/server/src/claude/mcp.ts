// Получение списка MCP-серверов через `claude mcp list`. Ошибки/недоступность CLI
// деградируют к пустому списку (фича необязательная, не должна ронять UI).

import { execFile } from 'node:child_process'
import { parseMcpList, type McpServer } from '@voicechat/shared'

export type ExecFileFn = (
  cmd: string,
  args: string[],
  cb: (err: unknown, stdout: string) => void
) => void

const defaultExec: ExecFileFn = (cmd, args, cb) =>
  execFile(cmd, args, { timeout: 8000 }, (err, stdout) => cb(err, stdout ?? ''))

/** Запускает `claude mcp list` и парсит вывод; при ошибке — []. */
export function listMcpServers(exec: ExecFileFn = defaultExec, bin = 'claude'): Promise<McpServer[]> {
  return new Promise((resolve) => {
    try {
      exec(bin, ['mcp', 'list'], (err, stdout) => {
        // Даже при ненулевом коде пытаемся распарсить stdout — там бывает список.
        void err
        resolve(parseMcpList(stdout || ''))
      })
    } catch {
      resolve([])
    }
  })
}

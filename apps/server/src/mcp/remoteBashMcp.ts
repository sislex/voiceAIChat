// MCP-эндпоинт для спавнутого claude: инструмент bash, выполняющий команду
// на выбранной машине-агенте. Stateless: на каждый POST — свежие сервер и
// транспорт (без SSE и session-id). Доступ только по секрету процесса `k` —
// эндпоинт выполняет команды и не должен быть открыт даже на LAN.

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AgentRegistry } from '../agents/registry.js'

export const REMOTE_BASH_MCP_PATH = '/mcp/remote-bash'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 300_000

export function registerRemoteBashMcp(
  app: FastifyInstance,
  registry: AgentRegistry,
  secret: string
): void {
  app.post<{ Querystring: { agent?: string; k?: string } }>(
    REMOTE_BASH_MCP_PATH,
    async (req, reply) => {
      if (req.query.k !== secret) return reply.code(403).send({ error: 'forbidden' })
      const agentId = req.query.agent ?? ''

      // Отмена команды именно этого запроса при обрыве (claude убит на barge-in),
      // не затрагивая параллельные команды на той же машине.
      const abort = new AbortController()
      req.raw.on('close', () => {
        if (!reply.raw.writableEnded) abort.abort()
      })

      const server = new McpServer({ name: 'remote', version: '1.0.0' })
      server.registerTool(
        'bash',
        {
          description:
            'Выполняет shell-команду на машине пользователя (не на сервере). ' +
            'Возвращает stdout+stderr и код выхода.',
          inputSchema: {
            command: z.string().describe('Команда для /bin/bash'),
            timeout_ms: z.number().optional().describe('Таймаут в мс (по умолчанию 120000)')
          }
        },
        async ({ command, timeout_ms }) => {
          try {
            const timeoutMs = Math.min(timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
            const res = await registry.exec(agentId, command, timeoutMs, abort.signal)
            const tail = `[exit code: ${res.exitCode ?? '?'}${res.timedOut ? ', таймаут' : ''}]`
            return {
              content: [{ type: 'text', text: `${res.output}\n${tail}`.trim() }],
              isError: res.exitCode !== 0
            }
          } catch (err) {
            return {
              content: [
                { type: 'text', text: err instanceof Error ? err.message : String(err) }
              ],
              isError: true
            }
          }
        }
      )

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: без session-id
        enableJsonResponse: true // обычный JSON-ответ вместо SSE
      })
      reply.hijack() // транспорт пишет в сырой res сам
      try {
        await server.connect(transport)
        await transport.handleRequest(req.raw, reply.raw, req.body)
      } catch (err) {
        // Иначе hijacked-ответ не завершится и MCP-клиент claude повиснет.
        if (!reply.raw.writableEnded) {
          try {
            reply.raw.writeHead(500, { 'content-type': 'application/json' })
            reply.raw.end(
              JSON.stringify({ error: err instanceof Error ? err.message : 'mcp transport error' })
            )
          } catch {
            /* соединение уже закрыто */
          }
        }
      }
    }
  )
}

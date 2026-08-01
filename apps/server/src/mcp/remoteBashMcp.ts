// MCP-эндпоинт для спавнутого claude: инструмент bash, выполняющий команду
// на выбранной машине-агенте. Stateless: на каждый POST — свежие сервер и
// транспорт (без SSE и session-id). Доступ только по секрету процесса `k` —
// эндпоинт выполняет команды и не должен быть открыт даже на LAN.

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AgentRegistry } from '../agents/registry.js'
import { evaluatePlanModeCommand } from './planMode.js'

export const REMOTE_BASH_MCP_PATH = '/mcp/remote-bash'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 300_000

/**
 * Экранирует `cwd` для одинарных кавычек bash и, на win32-машине, нормализует
 * слэши: путь вида `C:\Users\x` бэкслешами ломается внутри одинарных кавычек
 * git-bash (MSYS-транслятор путей ждёт `/`), поэтому меняем их на прямые —
 * `C:/Users/x` bash с Windows понимает как обычный Windows-путь.
 */
export function quoteCwd(cwd: string, platform?: string): string {
  const normalized = platform === 'win32' ? cwd.replace(/\\/g, '/') : cwd
  return normalized.replace(/'/g, `'"'"'`)
}

export function registerRemoteBashMcp(
  app: FastifyInstance,
  registry: AgentRegistry,
  secret: string
): void {
  // Тело читает сам транспорт, поэтому маршрут живёт в своей области видимости
  // с парсером-пустышкой: Fastify отдаёт управление, не трогая поток.
  // Если тело вычитает Fastify, hono/node-server внутри MCP-SDK (он вешает
  // слушатель 'end' уже после этого) решит, что клиент недослал запрос, и через
  // 500 мс «дренирует» соединение — рвёт сокет после каждого вызова, а на
  // ненастоящем сокете (`app.inject` в тестах) падает с `socket.destroySoon is
  // not a function` в таймере, то есть необработанным исключением процесса.
  app.register(async (scope) => {
    // Снимаем унаследованные парсеры (в т.ч. общий JSON из server.ts) — иначе
    // Fastify ругается «content type parser already present» на своей копии.
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', (_req, _payload, done) => {
      done(null, undefined)
    })
    scope.post<{ Querystring: { agent?: string; k?: string; cwd?: string; ro?: string } }>(
      REMOTE_BASH_MCP_PATH,
      async (req, reply) => {
        if (req.query.k !== secret) return reply.code(403).send({ error: 'forbidden' })
        const agentId = req.query.agent ?? ''
        // ro=1 — фаза плана CI: инструмент нужен для исследования рабочей копии,
        // но менять её нельзя (см. planMode.ts).
        const readOnly = req.query.ro === '1'

        // Отмена команды именно этого запроса при обрыве (claude убит на barge-in),
        // не затрагивая параллельные команды на той же машине. Слушаем close ОТВЕТА,
        // а не запроса: у req.raw 'close' срабатывает сразу после чтения тела (до
        // ответа) и отменял бы команду преждевременно. У ответа 'close' с
        // незавершённой записью = клиент реально отвалился.
        const abort = new AbortController()
        reply.raw.on('close', () => {
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
              timeout_ms: z
                .number()
                .optional()
                .describe('Таймаут в мс (по умолчанию 120000, максимум 300000)')
            }
          },
          async ({ command, timeout_ms }) => {
            try {
              if (readOnly) {
                const verdict = evaluatePlanModeCommand(command)
                if (!verdict.allowed) {
                  return {
                    content: [
                      {
                        type: 'text' as const,
                        text:
                          `Отклонено: режим «План» — ${verdict.reason}. Исследуй только чтением ` +
                          `(ls, cat, grep, git log/diff/status); правки начнутся после одобрения плана.`
                      }
                    ],
                    isError: true
                  }
                }
              }
              const timeoutMs = Math.min(timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
              const cwd = req.query.cwd
              const shellCommand = cwd
                ? `cd -- '${quoteCwd(cwd, registry.platformOf(agentId))}' && ${command}`
                : command
              const res = await registry.exec(agentId, shellCommand, timeoutMs, abort.signal)
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
          // Без третьего аргумента: тело не разобрано, транспорт читает поток сам.
          await transport.handleRequest(req.raw, reply.raw)
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
  })
}

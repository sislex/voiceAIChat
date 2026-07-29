// MCP-эндпоинт «ci»: инструмент модели для вызова именованных команд справочника
// в рабочей директории рана. Stateless (свежий сервер на POST), доступ по секрету
// процесса `k`; конкретный ран адресуется токеном `?run=` (см. брокер ниже).
// Каждый вызов = вложенный шаг ленты рана (создаётся раннером через runCommandById).

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

export const CI_COMMANDS_MCP_PATH = '/mcp/ci-commands'

/** Что раннер публикует модели на время шага «работа модели». */
export interface CiToolEntry {
  list(): Array<{ name: string; description: string }>
  invoke(name: string): Promise<{ output: string; exitCode: number | null; message?: string }>
}

/** In-memory брокер: токен рана → активный контекст инструментов. */
class CiToolBroker {
  private readonly map = new Map<string, CiToolEntry>()
  register(token: string, entry: CiToolEntry): void {
    this.map.set(token, entry)
  }
  unregister(token: string): void {
    this.map.delete(token)
  }
  get(token: string): CiToolEntry | undefined {
    return this.map.get(token)
  }
}

export const ciToolBroker = new CiToolBroker()

export function registerCiCommandsMcp(app: FastifyInstance, secret: string): void {
  app.post<{ Querystring: { k?: string; run?: string } }>(CI_COMMANDS_MCP_PATH, async (req, reply) => {
    if (req.query.k !== secret) return reply.code(403).send({ error: 'forbidden' })
    const entry = ciToolBroker.get(req.query.run ?? '')

    const server = new McpServer({ name: 'ci', version: '1.0.0' })
    server.registerTool(
      'list_commands',
      { description: 'Список доступных именованных команд CI-справочника (name + описание).', inputSchema: {} },
      async () => {
        const list = entry?.list() ?? []
        const text = list.length ? list.map((c) => `- ${c.name}: ${c.description || '(без описания)'}`).join('\n') : 'Доступных команд нет.'
        return { content: [{ type: 'text', text }] }
      }
    )
    server.registerTool(
      'run_command',
      {
        description: 'Выполнить именованную команду CI-справочника в рабочей директории рана. Аргумент name — имя команды из list_commands.',
        inputSchema: { name: z.string().describe('Имя команды из справочника') }
      },
      async ({ name }) => {
        if (!entry) return { content: [{ type: 'text', text: 'Контекст рана недоступен.' }], isError: true }
        const r = await entry.invoke(name)
        const tail = `[exit code: ${r.exitCode ?? '?'}]${r.message ? ` ${r.message}` : ''}`
        return { content: [{ type: 'text', text: `${r.output}\n${tail}`.trim() }], isError: r.exitCode !== 0 }
      }
    )

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    reply.hijack()
    try {
      await server.connect(transport)
      await transport.handleRequest(req.raw, reply.raw, req.body)
    } catch (err) {
      if (!reply.raw.writableEnded) {
        try {
          reply.raw.writeHead(500, { 'content-type': 'application/json' })
          reply.raw.end(JSON.stringify({ error: err instanceof Error ? err.message : 'mcp transport error' }))
        } catch {
          /* соединение уже закрыто */
        }
      }
    }
  })
}

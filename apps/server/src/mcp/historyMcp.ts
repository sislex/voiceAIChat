import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { VoiceChatDb } from '../db/database.js'

export const HISTORY_MCP_PATH = '/mcp/history'
export const HISTORY_SEARCH_SNIPPET_CHARS = 400
export const HISTORY_GET_MESSAGE_CHARS = 4_000

export interface HistoryTurnEntry { userId: string; conversationId: string }

export function createHistoryTurnBroker() {
  const entries = new Map<string, HistoryTurnEntry>()
  return {
    register(token: string, entry: HistoryTurnEntry) { entries.set(token, entry) },
    unregister(token: string) { entries.delete(token) },
    get(token: string) { return entries.get(token) }
  }
}

export const historyTurnBroker = createHistoryTurnBroker()

function truncate(text: string, cap: number): string {
  return text.length <= cap ? text : `${text.slice(0, cap - 1)}…`
}

export async function historySearch(db: VoiceChatDb, entry: HistoryTurnEntry, query: string, limit: number) {
  const messages = await db.chat.searchConversationHistory(entry.userId, entry.conversationId, query, limit)
  return messages.map(({ id: messageId, role, time, text }) => ({ messageId, role, time, snippet: truncate(text, HISTORY_SEARCH_SNIPPET_CHARS) }))
}

export async function historyGet(db: VoiceChatDb, entry: HistoryTurnEntry, messageId: string, around: number) {
  const messages = await db.chat.conversationHistoryAround(entry.userId, entry.conversationId, messageId, around)
  return messages.map(({ id: foundId, role, time, text }) => ({ messageId: foundId, role, time, text: truncate(text, HISTORY_GET_MESSAGE_CHARS) }))
}

export function registerHistoryMcp(app: FastifyInstance, opts: { db: VoiceChatDb; secret: string }): void {
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', (_req, _payload, done) => done(null, undefined))
    scope.post<{ Querystring: { k?: string; turn?: string } }>(HISTORY_MCP_PATH, async (req, reply) => {
      if (req.query.k !== opts.secret) return reply.code(403).send({ error: 'forbidden' })
      const entry = historyTurnBroker.get(req.query.turn ?? '')
      const server = new McpServer({ name: 'history', version: '1.0.0' })
      const unavailable = { content: [{ type: 'text' as const, text: 'Контекст хода недоступен.' }], isError: true }
      server.registerTool('history_search', {
        description: 'Полнотекстовый поиск только по опубликованным сообщениям текущего разговора, новые совпадения первыми.',
        inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(20).default(10) }
      }, async ({ query, limit }) => entry
        ? { content: [{ type: 'text', text: JSON.stringify(await historySearch(opts.db, entry, query, limit)) }] }
        : unavailable)
      server.registerTool('history_get', {
        description: 'Получить сообщение текущего разговора и соседние опубликованные сообщения.',
        inputSchema: { messageId: z.string().min(1), around: z.number().int().min(0).max(5).default(2) }
      }, async ({ messageId, around }) => entry
        ? { content: [{ type: 'text', text: JSON.stringify(await historyGet(opts.db, entry, messageId, around)) }] }
        : unavailable)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      reply.hijack()
      try {
        await server.connect(transport)
        await transport.handleRequest(req.raw, reply.raw)
      } catch (error) {
        if (!reply.raw.writableEnded) {
          reply.raw.writeHead(500, { 'content-type': 'application/json' })
          reply.raw.end(JSON.stringify({ error: error instanceof Error ? error.message : 'mcp transport error' }))
        }
      }
    })
  })
}

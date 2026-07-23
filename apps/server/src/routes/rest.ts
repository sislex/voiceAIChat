// REST-роуты поверх VoiceChatDb (Ф3): разговоры, сообщения, настройки.

import type { FastifyInstance } from 'fastify'
import {
  REST,
  ccResumeMessages,
  ccResumeTitle,
  ccTimeLabel,
  cxResumeMessages,
  cxResumeTitle,
  cxTimeLabel,
  type AddMessageArgs,
  type Settings
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { listMcpServers } from '../claude/mcp.js'
import { listProjects, listSessions, readTranscript } from '../cc/ccSessions.js'
import {
  listCxProjects,
  listCxSessions,
  readCxTranscript
} from '../codex/codexSessions.js'

export async function registerRest(app: FastifyInstance, db: VoiceChatDb): Promise<void> {
  app.get(REST.conversations, async () => db.listConversations())

  app.post<{ Body: { title?: string } }>(REST.conversations, async (req) =>
    db.createConversation(req.body?.title)
  )

  app.get<{ Querystring: { q?: string } }>(REST.conversationsSearch, async (req) =>
    db.searchConversations(req.query.q ?? '')
  )

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    const conversation = db.getConversation(req.params.id)
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    return { conversation, messages: db.listMessages(req.params.id) }
  })

  app.patch<{ Params: { id: string }; Body: { title: string } }>(
    '/api/conversations/:id',
    async (req, reply) => {
      db.renameConversation(req.params.id, req.body.title)
      const conversation = db.getConversation(req.params.id)
      if (!conversation) return reply.code(404).send({ error: 'not found' })
      return conversation
    }
  )

  app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (req) => {
    db.deleteConversation(req.params.id)
    return { ok: true }
  })

  app.post<{ Params: { id: string }; Body: AddMessageArgs }>(
    '/api/conversations/:id/messages',
    async (req) => {
      const { role, text, time, engine } = req.body
      return db.addMessage(req.params.id, role, text, time, engine)
    }
  )

  app.delete<{ Params: { id: string; messageId: string } }>(
    '/api/conversations/:id/messages/:messageId',
    async (req) => {
      db.deleteMessage(req.params.id, req.params.messageId)
      // История изменилась — сбрасываем сессию Claude, чтобы следующий запрос
      // пересобрал контекст из БД (модель «забудет» удалённое).
      db.setClaudeSession(req.params.id, null)
      return { ok: true }
    }
  )

  app.get(REST.mcpServers, async () => listMcpServers())

  app.get(REST.ccProjects, async () => listProjects())
  app.get<{ Params: { slug: string } }>(
    '/api/cc/projects/:slug/sessions',
    async (req) => listSessions(req.params.slug)
  )
  app.get<{ Params: { slug: string; id: string }; Querystring: { limit?: string } }>(
    '/api/cc/projects/:slug/sessions/:id',
    async (req) =>
      readTranscript(req.params.slug, req.params.id, {
        limit: req.query.limit ? Number(req.query.limit) : undefined
      })
  )

  app.post<{ Body: { slug: string; id: string } }>(REST.ccResume, async (req, reply) => {
    const { slug, id } = req.body ?? {}
    if (!slug || !id) return reply.code(400).send({ error: 'slug и id обязательны' })
    const items = readTranscript(slug, id)
    const conv = db.createConversation(ccResumeTitle(items))
    const now = Date.now()
    for (const m of ccResumeMessages(items)) {
      db.addMessage(conv.id, m.role, m.text, ccTimeLabel(m.ts, now))
    }
    // Привязка к session-id CC → следующий ход пойдёт через `claude --resume <id>`.
    db.setClaudeSession(conv.id, id)
    return { conversation: db.getConversation(conv.id), messages: db.listMessages(conv.id) }
  })

  // --- Проводник Codex ---------------------------------------------------
  app.get(REST.cxProjects, async () => listCxProjects())
  app.get<{ Querystring: { cwd?: string } }>(REST.cxSessions, async (req) =>
    listCxSessions(req.query.cwd ?? '')
  )
  app.get<{ Querystring: { id?: string; limit?: string } }>(REST.cxTranscript, async (req) =>
    readCxTranscript(req.query.id ?? '', {
      limit: req.query.limit ? Number(req.query.limit) : undefined
    })
  )

  app.post<{ Body: { id: string } }>(REST.cxResume, async (req, reply) => {
    const { id } = req.body ?? {}
    if (!id) return reply.code(400).send({ error: 'id обязателен' })
    const items = readCxTranscript(id)
    const conv = db.createConversation(cxResumeTitle(items))
    const now = Date.now()
    for (const m of cxResumeMessages(items)) {
      db.addMessage(conv.id, m.role, m.text, cxTimeLabel(m.ts, now), m.role === 'ai' ? 'codex' : undefined)
    }
    // Привязка к session-id Codex (префикс провайдера) → следующий ход пойдёт
    // через `codex exec resume <id>` (см. resumeIdFor в session.ts).
    db.setClaudeSession(conv.id, `codex:${id}`)
    return { conversation: db.getConversation(conv.id), messages: db.listMessages(conv.id) }
  })

  app.get(REST.settings, async () => db.getSettings())

  app.put<{ Body: Settings }>(REST.settings, async (req) => {
    db.saveSettings(req.body)
    return db.getSettings()
  })
}

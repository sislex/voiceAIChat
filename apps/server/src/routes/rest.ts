// REST-роуты поверх VoiceChatDb (Ф3): разговоры, сообщения, настройки.

import type { FastifyInstance } from 'fastify'
import { REST, type AddMessageArgs, type Settings } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'

export async function registerRest(app: FastifyInstance, db: VoiceChatDb): Promise<void> {
  app.get(REST.conversations, async () => db.listConversations())

  app.post<{ Body: { title?: string } }>(REST.conversations, async (req) =>
    db.createConversation(req.body?.title)
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
      const { role, text, time } = req.body
      return db.addMessage(req.params.id, role, text, time)
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

  app.get(REST.settings, async () => db.getSettings())

  app.put<{ Body: Settings }>(REST.settings, async (req) => {
    db.saveSettings(req.body)
    return db.getSettings()
  })
}

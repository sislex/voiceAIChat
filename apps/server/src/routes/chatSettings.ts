import type { FastifyInstance } from 'fastify'
import { REST } from '@voicechat/shared'
import { uid } from '@sislexa/identity/server/users/auth'
import type { VoiceChatDb } from '../db/database.js'
import { InvalidChatSettings, parseChatSettingsPatch } from '../chatSettingsValidation.js'

/** Internal authenticated clients share these routes regardless of their UI host. */
export function registerChatSettingsRoutes(app: FastifyInstance, db: VoiceChatDb): void {
  for (const path of [REST.chatSettings, '/api/conversations/:id/settings']) {
    app.get<{ Params: { id?: string } }>(path, async (req, reply) => {
      const result = await db.settings.getChatSettings(uid(req), req.params.id)
      if (result && req.headers['x-sislexa-delegation']) return { ...result, account: {} }
      return result ?? reply.code(404).send({ error: 'not found' })
    })
    const write = async (req: import('fastify').FastifyRequest<{ Params: { id?: string }; Body: unknown }>, reply: import('fastify').FastifyReply) => {
      try {
        const patch = parseChatSettingsPatch(req.body)
        if (patch.owner !== (req.params.id ? 'conversation' : 'account')) throw new InvalidChatSettings('Incorrect settings owner for route')
        if (req.params.id && !await db.chat.ownsConversation(uid(req), req.params.id)) return reply.code(404).send({ error: 'not found' })
        const role = (await db.identity.getUser(uid(req)))?.role ?? 'developer'
        if (patch.values.llmEngineId && !(await db.llm.listLlmEnginesForRole(role)).some(engine => engine.id === patch.values.llmEngineId)) {
          return reply.code(403).send({ error: 'llm engine is not available for role' })
        }
        const result = await db.settings.patchChatSettings(uid(req), patch, req.params.id)
        if (!result) return reply.code(404).send({ error: 'not found' })
        return reply.code('code' in result ? 409 : 200).send(result)
      } catch (error) {
        if (error instanceof InvalidChatSettings) return reply.code(400).send({ error: error.message })
        throw error
      }
    }
    app.patch<{ Params: { id?: string }; Body: unknown }>(path, write)
    app.put<{ Params: { id?: string }; Body: unknown }>(path, write)
  }
}

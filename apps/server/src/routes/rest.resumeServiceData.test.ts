import Fastify from 'fastify'
import { expect, it, vi } from 'vitest'
import { REST, stripServiceData, type TurnMeta } from '@voicechat/shared'
import { VoiceChatDb } from '../db/database.js'
import { registerRest } from './rest.js'
import type { RunnerFsClient } from '../llm/runnerFsClient.js'

for (const provider of ['cc', 'cx'] as const) {
  for (const enabled of [false, true]) {
    it(`projects ${provider} resume messages with loadServiceData=${enabled}`, async () => {
      const db = new VoiceChatDb(':memory:')
      const app = Fastify()
      const meta: TurnMeta = { activity: [{ kind: 'thinking', summary: 'Trace', raw: '{}' }],
        request: { provider: 'claude', model: 'sonnet', prompt: 'Full prompt', promptChars: 11, resumed: false } }
      await db.identity.createUser('alice', '', 'developer')
      const access = (await db.identity.getAccountAccess('alice'))!
      app.decorateRequest('user', null)
      app.addHook('preHandler', async req => { req.user = { name: 'alice', role: 'developer', account: { tenantId: access.tenant.id } } as NonNullable<typeof req.user> })
      // Resume creates a new conversation. Seed its setting and rich stored metadata
      // to exercise the response projection independently of transcript format.
      const create = db.chat.createConversation.bind(db.chat)
      vi.spyOn(db.chat, 'createConversation').mockImplementation(async (...args) => {
        const c = await create(...args)
        const settings = (await db.settings.getChatSettings('alice', c.id))!
        await db.settings.patchChatSettings('alice', { version: 1, owner: 'conversation', expectedRevision: settings.revision, values: { loadServiceData: enabled } }, c.id)
        return c
      })
      const add = db.chat.addMessage.bind(db.chat)
      vi.spyOn(db.chat, 'addMessage').mockImplementation(async (user, id, role, text, time, engine) => add(user, id, role, text, time, engine, meta))
      const transcript = { items: [{ kind: 'user', text: 'Question' }, { kind: 'assistant', text: 'Answer' }], usage: {} }
      await registerRest(app, db, process.env.DELIVERY_ATTEMPT_ROOT!, {
        runnerFs: { readCcTranscript: async () => transcript, readCxTranscript: async () => transcript } as unknown as RunnerFsClient
      })
      try {
        const response = await app.inject({ method: 'POST', url: provider === 'cc' ? REST.ccResume : REST.cxResume, payload: { slug: 'project', id: 'session' } })
        expect(response.statusCode).toBe(200)
        const result = response.json()
        expect(result.messages.length).toBeGreaterThan(0)
        for (const message of result.messages) expect(message.meta).toEqual(enabled ? meta : stripServiceData(meta))
        expect((await db.chat.listMessages('alice', result.conversation.id))[0].meta).toEqual(meta)
      } finally { await app.close(); await db.close() }
    })
  }
}

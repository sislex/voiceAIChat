import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { registerChatSettingsRoutes } from './chatSettings.js'

describe('chat settings HTTP adapter', () => {
  it('returns snapshots and 409 conflicts, rejects device and cross-owner writes', async () => {
    const db = new VoiceChatDb(':memory:')
    const app = Fastify()
    app.decorateRequest('user', null)
    app.addHook('preHandler', async req => { req.user = { name: 'alice', role: 'developer' } as NonNullable<typeof req.user> })
    registerChatSettingsRoutes(app, db)
    try {
      const c = await db.chat.createConversation('alice', 'A')
      const foreign = await db.chat.createConversation('bob', 'Private')
      const url = `/api/conversations/${c.id}/settings`
      const initial = (await app.inject({ method: 'GET', url })).json()
      const payload = { version: 1, expectedRevision: initial.revision, owner: 'conversation', values: { title: 'Changed' } }
      expect((await app.inject({ method: 'PATCH', url, payload })).statusCode).toBe(200)
      const conflict = await app.inject({ method: 'PUT', url, payload })
      expect(conflict.statusCode).toBe(409)
      expect(conflict.json()).toMatchObject({ code: 'settings_revision_conflict', current: { conversation: { title: 'Changed' }, device: {} } })
      expect((await app.inject({ method: 'PATCH', url: '/api/chat/settings', payload })).statusCode).toBe(400)
      expect((await app.inject({ method: 'PATCH', url, payload: { ...payload, owner: 'device', values: { micDeviceId: 'x' } } })).statusCode).toBe(400)
      expect((await app.inject({ method: 'GET', url: `/api/conversations/${foreign.id}/settings` })).statusCode).toBe(404)
      expect((await app.inject({ method: 'PATCH', url: `/api/conversations/${foreign.id}/settings`, payload })).statusCode).toBe(404)
    } finally { await app.close(); await db.close() }
  })
})

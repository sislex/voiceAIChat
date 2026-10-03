import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Sql } from '@sislexa/identity/storage-sql/types'
import { registerAuth } from '@sislexa/identity/server/users/auth'
import { signToken } from '@sislexa/identity/server/users/accounts'
import type { MakeCore } from '@voicechat/make-contracts'
import { VoiceChatDb } from '../db/database.js'
import { registerIntegrationTokenGuard } from '../auth/integrationTokens.js'
import { registerIntegrationTokenRoutes } from './integrationTokens.js'
import { registerInternalRoutes } from './internal.js'

for (const engine of ['sqlite', 'postgres'] as const) {
  describe.skipIf(engine === 'postgres' && !process.env.VC_TEST_DB_URL)(`integration tokens (${engine})`, () => {
    let db: VoiceChatDb
    let app: FastifyInstance
    let dir: string
    let projectId: string
    let otherId: string
    let now: number
    let sessionSecret: string
    let serviceToken: string
    const headers = (user = 'owner') => ({ authorization: 'Bearer ' + signToken({ name: user, role: user === 'admin' ? 'admin' : 'developer' }, sessionSecret) })
    const path = () => `/api/projects/${projectId}/integration-tokens`
    const create = () => app.inject({ method: 'POST', url: path(), headers: headers(), payload: { name: 'Board sync', scopes: ['tasks:external'] } })
    const whoami = (token: string, service = serviceToken) => app.inject({ method: 'POST', url: '/internal/whoami', headers: { authorization: 'Bearer ' + service }, payload: {
      method: 'PUT', url: `/api/projects/${projectId}/external-tasks/dc/one`, headers: { authorization: 'Bearer ' + token }
    } })
    const sql = () => (db as unknown as { sql: Sql }).sql
    beforeEach(async () => {
      now = 1000
      sessionSecret = randomUUID()
      serviceToken = randomUUID()
      dir = mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : process.cwd(), 'integration-tokens-'))
      db = new VoiceChatDb(join(dir, 'db.sqlite'), { now: () => now, ...(engine === 'postgres' ? { postgres: {
        url: process.env.VC_TEST_DB_URL!, schema: `tokens_${randomUUID().replace(/-/g, '')}`, dropSchemaOnClose: true
      } } : {}) })
      await db.ready
      for (const name of ['owner', 'member', 'outsider', 'admin']) await db.identity.createUser(name, '', name === 'admin' ? 'admin' : 'developer')
      projectId = (await db.projects.createProject('owner', { name: 'Project' })).id
      otherId = (await db.projects.createProject('owner', { name: 'Other' })).id
      await db.projects.addMember('owner', projectId, 'member')
      app = Fastify()
      registerIntegrationTokenGuard(app)
      const { authenticate } = await registerAuth(app, db, sessionSecret)
      registerIntegrationTokenRoutes(app, db)
      registerInternalRoutes(app, { token: serviceToken, identityCore: db, makeCore: {} as MakeCore, authenticate })
      for (const url of ['/', '/health', '/mcp/test', '/ws', '/api/public-test']) app.get(url, async () => ({ ok: true }))
    })
    afterEach(async () => { await app?.close(); await db?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })

    it('returns the secret once, stores only a hash and records whoami use', async () => {
      const response = await create()
      expect(response.statusCode).toBe(201)
      expect(response.headers['cache-control']).toBe('no-store')
      const created = response.json()
      expect(created.token).toMatch(/^sit_[A-Za-z0-9_-]{43}$/)
      const row = await sql().get('SELECT * FROM integration_tokens WHERE id = ?', [created.id])
      expect(row).toMatchObject({ token_hash: createHash('sha256').update(created.token).digest('hex'), created_by: 'owner', scopes: '["tasks:external"]', last_used_at: null, revoked_at: null })
      expect(JSON.stringify(row)).not.toContain(created.token)
      expect((await create()).json().token).not.toBe(created.token)
      now = 2000
      expect((await whoami(created.token)).json()).toEqual({ ok: true, principal: { kind: 'integration', projectId, scopes: ['tasks:external'] } })
      const list = (await app.inject({ url: path(), headers: headers() })).json()
      expect(list.find((item: { id: string }) => item.id === created.id)).toEqual({ id: created.id, projectId, name: 'Board sync', scopes: ['tasks:external'], createdAt: 1000, lastUsedAt: 2000 })
      expect(JSON.stringify(list)).not.toContain(created.token)
      expect(JSON.stringify(list)).not.toContain('token_hash')
      expect((await whoami(created.token, created.token)).statusCode).toBe(401)
    })

    it('requires project ownership, including for administrators, and enforces project isolation', async () => {
      const created = (await create()).json()
      for (const user of ['member', 'outsider', 'admin']) {
        for (const method of ['GET', 'POST', 'DELETE'] as const) {
          expect((await app.inject({ method, url: path(), headers: headers(user), ...(method === 'GET' ? {} : { payload: { id: created.id, name: 'Denied', scopes: ['tasks:external'] } }) })).statusCode).toBe(403)
        }
        expect(await db.projects.listIntegrationTokens(user, projectId)).toBeNull()
        expect(await db.projects.createIntegrationToken(user, projectId, 'Denied', ['tasks:external'])).toBeNull()
        expect(await db.projects.revokeIntegrationToken(user, projectId, created.id)).toBe(false)
      }
      expect((await app.inject({ url: path() })).statusCode).toBe(401)
      expect((await app.inject({ method: 'DELETE', url: `/api/projects/${otherId}/integration-tokens/${created.id}`, headers: headers() })).statusCode).toBe(404)
      expect((await whoami(created.token)).json().ok).toBe(true)
    })

    it('revokes immediately, preserves audit data and rejects unknown credentials', async () => {
      const created = (await create()).json()
      now = 3000
      expect((await app.inject({ method: 'DELETE', url: path(), headers: headers(), payload: { id: created.id } })).statusCode).toBe(204)
      expect((await whoami(created.token)).json()).toEqual({ ok: false, status: 401, error: 'unauthorized' })
      expect((await whoami('sit_' + randomUUID().slice(0, 7))).json().ok).toBe(false)
      expect(await db.projects.resolveIntegrationToken('Basic ' + created.token)).toBeNull()
      expect((await app.inject({ url: path(), headers: headers() })).json()).toEqual([])
      expect(await sql().get('SELECT revoked_at, last_used_at FROM integration_tokens WHERE id = ?', [created.id])).toMatchObject({ revoked_at: 3000, last_used_at: null })
    })

    it('rejects integration credentials on every public Core route, even with a valid user cookie', async () => {
      const { token, id } = (await create()).json()
      for (const credential of [token, 'sit_' + randomUUID().slice(0, 7)]) {
        for (const url of ['/', '/health', '/mcp/test', '/ws', '/api/public-test', path()]) {
          expect((await app.inject({ url, headers: { authorization: 'bearer ' + credential, cookie: 'vc_session=' + headers().authorization.slice(7) } })).statusCode).toBe(403)
        }
      }
      await db.projects.revokeIntegrationToken('owner', projectId, id)
      expect((await app.inject({ url: '/', headers: { authorization: 'Bearer ' + token } })).statusCode).toBe(403)
    })

    it('validates names and scopes without creating tokens', async () => {
      for (const payload of [{}, { name: ' ' }, { name: 'Sync', scopes: [] }, { name: 'Sync', scopes: ['admin'] }, { name: 'Sync', scopes: ['tasks:external', 'tasks:external'] }, { name: 'x'.repeat(201), scopes: ['tasks:external'] }]) {
        expect((await app.inject({ method: 'POST', url: path(), headers: headers(), payload })).statusCode).toBe(400)
      }
      expect(await db.projects.listIntegrationTokens('owner', projectId)).toEqual([])
    })

    it('preserves user whoami and cookie CSRF checks and recognizes delegated project ownership', async () => {
      const user = (await whoami(headers().authorization.slice(7))).json()
      expect(user.ok).toBe(true)
      expect(user.user.name).toBe('owner')
      expect(user.principal).toBeUndefined()
      expect((await app.inject({ method: 'POST', url: path(), headers: { cookie: 'vc_session=' + headers().authorization.slice(7) },
        payload: { name: 'CSRF', scopes: ['tasks:external'] } })).statusCode).toBe(403)
      await db.projects.updateMemberRole('owner', projectId, 'member', 'owner')
      expect((await app.inject({ method: 'POST', url: path(), headers: headers('member'), payload: { name: 'Co-owner', scopes: ['tasks:external'] } })).statusCode).toBe(201)
    })

    it('migrates an existing database without the table and cascades project deletion', async () => {
      await sql().exec('DROP TABLE integration_tokens')
      // Re-run the real bootstrap, retaining the old project and membership rows.
      await (db as unknown as { init(): Promise<void> }).init()
      const token = await db.projects.createIntegrationToken('owner', projectId, 'Migrated', ['tasks:external'])
      expect(token).not.toBeNull()
      await db.projects.deleteProject('owner', projectId)
      expect(await db.projects.resolveIntegrationToken('Bearer ' + token!.token)).toBeNull()
    })
  })
}

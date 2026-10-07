import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { VoiceChatDb } from '../db/database.js'
import { registerIntegrationTokenGuard } from '../auth/integrationTokens.js'
import { registerIntegrationIngress } from './integrationIngress.js'

describe('integration ingress', () => {
  let db: VoiceChatDb
  let app: FastifyInstance
  let dir: string
  let projectId: string
  let otherId: string
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ id: 'task' }), { status: 201, headers: { 'content-type': 'application/json' } }))
  const put = (project: string, authorization?: string) => app.inject({ method: 'PUT', url: `/integrations/v1/projects/${project}/external-tasks/delivery-control/run:B04`,
    headers: authorization ? { authorization } : {}, payload: { title: 'B04', state: 'running' } })

  beforeEach(async () => {
    fetchImpl.mockClear()
    dir = mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : process.cwd(), 'integration-ingress-'))
    db = new VoiceChatDb(join(dir, 'db.sqlite'))
    await db.ready
    await db.identity.createUser('owner', '', 'developer')
    projectId = (await db.projects.createProject('owner', { name: 'Project' })).id
    otherId = (await db.projects.createProject('owner', { name: 'Other' })).id
    app = Fastify()
    registerIntegrationTokenGuard(app)
    registerIntegrationIngress(app, db, { kanbanUrl: 'http://kanban:8789/', fetchImpl })
    app.put('/api/projects/:id/external-tasks/:source/:externalId', async () => ({ reached: true }))
  })
  afterEach(async () => { await app?.close(); await db?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('forwards an external task upsert of the token project to Kanban with the same credential', async () => {
    const { token } = (await db.projects.createIntegrationToken('owner', projectId, 'Board sync', ['tasks:external'], [projectId, otherId]))!
    const response = await put(otherId, 'Bearer ' + token)
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({ id: 'task' })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`http://kanban:8789/api/projects/${otherId}/external-tasks/delivery-control/run%3AB04`)
    expect(init).toMatchObject({ method: 'PUT', headers: { authorization: 'Bearer ' + token } })
    expect(JSON.parse(String(init!.body))).toEqual({ title: 'B04', state: 'running' })
  })

  it('rejects a missing, revoked or foreign-project token and never reaches Kanban', async () => {
    const created = (await db.projects.createIntegrationToken('owner', projectId, 'Board sync', ['tasks:external']))!
    expect((await put(projectId)).statusCode).toBe(401)
    expect((await put(otherId, 'Bearer ' + created.token)).statusCode).toBe(403)
    await db.projects.revokeIntegrationToken('owner', projectId, created.id)
    expect((await put(projectId, 'Bearer ' + created.token)).statusCode).toBe(401)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps integration tokens away from the proxied /api route and answers 503 without remote Kanban', async () => {
    const { token } = (await db.projects.createIntegrationToken('owner', projectId, 'Board sync', ['tasks:external']))!
    const direct = await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/external-tasks/dc/x`, headers: { authorization: 'Bearer ' + token }, payload: {} })
    expect(direct.statusCode).toBe(403)
    const offline = Fastify()
    registerIntegrationIngress(offline, db, {})
    const response = await offline.inject({ method: 'PUT', url: `/integrations/v1/projects/${projectId}/external-tasks/dc/x`, headers: { authorization: 'Bearer ' + token }, payload: {} })
    expect(response.statusCode).toBe(503)
    await offline.close()
  })
})

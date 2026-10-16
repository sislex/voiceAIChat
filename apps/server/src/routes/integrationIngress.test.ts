import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { VoiceChatDb } from '../db/database.js'
import { registerIntegrationTokenGuard } from '../auth/integrationTokens.js'
import { registerIntegrationIngress } from './integrationIngress.js'
import type { BoardCardsSnapshot } from '@voicechat/shared'

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
    fetchImpl.mockReset()
    fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ id: 'task' }), { status: 201, headers: { 'content-type': 'application/json' } }))
    dir = mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : process.cwd(), 'integration-ingress-'))
    db = new VoiceChatDb(join(dir, 'db.sqlite'))
    await db.ready
    await db.identity.createUser('owner', '', 'developer')
    projectId = (await db.projects.createProject('owner', { name: 'Project' })).id
    otherId = (await db.projects.createProject('owner', { name: 'Other' })).id
    app = Fastify()
    registerIntegrationTokenGuard(app)
    registerIntegrationIngress(app, db, { kanbanUrl: 'http://kanban:8789/', internalToken: 'service-token', fetchImpl })
    app.put('/api/projects/:id/external-tasks/:source/:externalId', async () => ({ reached: true }))
  })
  afterEach(async () => { await app?.close(); await db?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })

  const state = (project: string, token?: string) => app.inject({
    url: `/integrations/v1/projects/${project}/tasks/state`, headers: token ? { authorization: `Bearer ${token}` } : {}
  })

  it('forwards the board snapshot unchanged using internal authorization for an allowed project', async () => {
    const snapshot: BoardCardsSnapshot = { generatedAt: 1000, tasks: [{
      id: 'task', seq: 1, key: 'P-1', title: 'Task', column: { id: 'decision', name: 'Decision', semanticType: 'decision_required' },
      autoPilot: true, autoPilotFixCycles: 2, updatedAt: 900, labels: ['bug'],
      development: { runId: 'dev', status: 'failed', startedAt: 800, finishedAt: 900,
        failedStep: { title: 'Test', exitCode: 1, tail: 'token=[REDACTED]\nTest failed' } },
      qa: [{ stage: 'component_qa', status: 'failed', failedSummary: 'Test failed' }],
      merge: { runId: 'merge', status: 'failed', targetBranch: 'main', failedSummary: 'Conflict' }, decisionReason: 'Review required'
    }] }
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(snapshot), { headers: { 'content-type': 'application/json' } }))
    const { token } = (await db.projects.createIntegrationToken('owner', projectId, 'Read', ['tasks:read'], [projectId, otherId]))!
    const response = await state(otherId, token)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(snapshot)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(`http://kanban:8789/internal/kanban/projects/${otherId}/tasks/state`, {
      method: 'GET', headers: { authorization: 'Bearer service-token' }, signal: expect.any(AbortSignal)
    })
    expect((await put(projectId, `Bearer ${token}`)).statusCode).toBe(403)
  })

  it('requires tasks:read and project membership before forwarding', async () => {
    const read = (await db.projects.createIntegrationToken('owner', projectId, 'Read', ['tasks:read']))!
    const write = (await db.projects.createIntegrationToken('owner', projectId, 'Write', ['tasks:external']))!
    expect((await state(projectId)).statusCode).toBe(401)
    expect((await state(projectId, 'sit_unknown')).statusCode).toBe(401)
    expect((await state(projectId, write.token)).statusCode).toBe(403)
    expect((await state(otherId, read.token)).statusCode).toBe(403)
    await db.projects.revokeIntegrationToken('owner', projectId, read.id)
    expect((await state(projectId, read.token)).statusCode).toBe(401)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('preserves upstream errors and handles an unreachable board', async () => {
    const { token } = (await db.projects.createIntegrationToken('owner', projectId, 'Read', ['tasks:read']))!
    fetchImpl.mockResolvedValueOnce(new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } }))
    const response = await state(projectId, token)
    expect(response.statusCode).toBe(404)
    expect(response.body).toBe('missing')
    expect(response.headers['content-type']).toContain('text/plain')
    fetchImpl.mockRejectedValueOnce(new Error('unreachable'))
    expect((await state(projectId, token)).statusCode).toBe(502)
  })

  it('fails closed without the board URL or internal credential', async () => {
    const { token } = (await db.projects.createIntegrationToken('owner', projectId, 'Read', ['tasks:read']))!
    for (const opts of [{}, { kanbanUrl: 'http://kanban:8789' }, { internalToken: 'service-token' }]) {
      const offline = Fastify()
      try {
        registerIntegrationIngress(offline, db, { ...opts, fetchImpl })
        expect((await offline.inject({ url: `/integrations/v1/projects/${projectId}/tasks/state`, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(503)
      } finally { await offline.close() }
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

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

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { expect, it } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { ModuleKnowledgeBaseService } from './sources.js'
import { ScopedKnowledgeBase } from './scoped.js'
import { registerKbRoutes } from './routes.js'

it('filters authenticated REST queries while retaining stored document access and admin refresh checks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-module-routes-'))
  writeFileSync(join(dir, 'topic.md'), '---\nid: legacy-topic\nsymbols:\n  - Widget\n---\n# Core\n\nWidget documentation.')
  const source = new ModuleKnowledgeBaseService({ root: dir, dataDir: dir, sources: [] })
  const db = new VoiceChatDb(':memory:')
  const app = Fastify()
  app.addHook('preHandler', async req => {
    req.user = { name: 'admin', role: req.headers['x-test-admin'] ? 'admin' : 'developer' } as typeof req.user
  })
  registerKbRoutes(app, new ScopedKnowledgeBase(source, db), { db, toolEnabled: true })
  try {
    const saved = await db.kb.saveKbDocument({ id: null, scope: 'user', ownerId: 'admin', projectId: null,
      title: 'Widget personal', body: 'Widget personal knowledge.', createdBy: 'admin' })
    expect((await app.inject('/api/kb/modules')).json()).toMatchObject([{ id: 'core', status: 'ready' }])
    expect((await app.inject('/api/kb/topics')).json()).toHaveLength(2)
    expect((await app.inject('/api/kb/topics?module=core')).json()).toMatchObject([{ id: 'core:topic.md', module: 'core' }])
    expect((await app.inject('/api/kb/topics?module=unknown')).json()).toEqual([])
    expect((await app.inject('/api/kb/search?q=Widget&module=core')).json()).toMatchObject([{ module: 'core' }])
    expect((await app.inject('/api/kb/context?q=Widget&module=core')).json().relatedDocuments).toEqual(['core:topic.md'])
    expect((await app.inject('/api/kb/documents/legacy-topic')).json().id).toBe('core:topic.md')
    expect((await app.inject(`/api/kb/documents/${saved.id}`)).json().id).toBe(saved.id)
    expect((await app.inject({ method: 'POST', url: '/api/kb/modules/core/refresh' })).statusCode).toBe(403)
    writeFileSync(join(dir, 'topic.md'), '# Updated\n\nUpdated Core documentation.')
    const refreshed = await app.inject({ method: 'POST', url: '/api/kb/modules/core/refresh', headers: { 'x-test-admin': '1' } })
    expect(refreshed.json().status).toBe('ready')
    expect((await app.inject('/api/kb/documents/core:topic.md')).json().body).toContain('Updated Core')
    expect((await app.inject({ method: 'POST', url: '/api/kb/modules/missing/refresh', headers: { 'x-test-admin': '1' } })).statusCode).toBe(404)
  } finally {
    await app.close(); await source.close(); await db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

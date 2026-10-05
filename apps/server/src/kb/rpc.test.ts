import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KB_SERVICE_RPC, type KbServiceRpcArg, type KbServiceRpcMethod, type KbUsageRequest } from '@voicechat/shared'
import { VoiceChatDb } from '../db/database.js'
import { ModuleKnowledgeBaseService } from './sources.js'
import { ScopedKnowledgeBase } from './scoped.js'
import { createLocalKbRpc } from './rpc.js'

let db: VoiceChatDb
let root: string
let rpc: ReturnType<typeof createLocalKbRpc>
beforeEach(async () => {
  let clock = 1000
  db = new VoiceChatDb(':memory:', { now: () => ++clock })
  await db.identity.createUser('admin', '', 'admin')
  await db.identity.createUser('bob', '', 'developer')
  root = mkdtempSync(join(tmpdir(), 'kb-rpc-'))
  writeFileSync(join(root, 'topic.md'), '---\nid: legacy-topic\ntitle: WidgetEngine\nsymbols:\n  - WidgetEngine\n---\n# WidgetEngine\n\nWidgetEngine builds widgets.')
  const base = new ModuleKnowledgeBaseService({ root, dataDir: root, sources: [] })
  rpc = createLocalKbRpc(new ScopedKnowledgeBase(base, db), db, true)
})
afterEach(async () => { await db.close(); rmSync(root, { recursive: true, force: true }) })

describe('B01 RPC contract against the embedded knowledge package', () => {
  it('executes every registry method with file indexing and durable document writes', async () => {
    const seen = new Set<string>()
    const call = <M extends KbServiceRpcMethod>(method: M, arg: KbServiceRpcArg<M>) => {
      expect(KB_SERVICE_RPC[method](arg)).toBe(true)
      seen.add(method)
      return rpc(method, arg, 'admin')
    }
    expect((await call('status', undefined)).documents).toBe(1)
    expect((await call('modules', undefined))[0].id).toBe('core')
    expect((await call('topics', { module: 'core' }))[0].id).toBe('core:topic.md')
    expect((await call('document', { id: 'legacy-topic' }))?.id).toBe('core:topic.md')
    expect((await call('search', { query: 'WidgetEngine', module: 'core' }))[0].documentId).toBe('core:topic.md')
    expect((await call('context', { query: 'WidgetEngine' })).sections[0].text).toContain('builds widgets')
    const saved = await call('write', { scope: 'user', title: ' PrivateWidget ', body: 'PrivateWidget instructions' })
    expect(saved.title).toBe('PrivateWidget')
    expect((await db.kb.kbDocumentById(saved.id))?.ownerId).toBe('admin')
    expect((await call('search', { query: 'PrivateWidget' }))[0].documentId).toBe(saved.id)
    await call('write', { id: saved.id, scope: 'user', title: 'ChangedWidget', body: 'ChangedWidget instructions' })
    expect((await call('document', { id: saved.id }))?.title).toBe('ChangedWidget')
    const conversation = await db.chat.createConversation('admin')
    const usage = await call('usage', { target: 'conversation', conversationId: conversation.id })
    expect(usage.target).toBe('conversation')
    expect(usage.report.totals.queries).toBe(0)
    expect(await call('delete', { id: saved.id })).toBeUndefined()
    expect(await db.kb.kbDocumentById(saved.id)).toBeNull()
    expect(await call('document', { id: saved.id })).toBeNull()
    expect([...seen].sort()).toEqual(Object.keys(KB_SERVICE_RPC).sort())
  })

  it('enforces ownership, live project membership and argument validation', async () => {
    const doc = await rpc('write', { scope: 'user', title: 'PrivateWidget', body: 'PrivateWidget' }, 'admin')
    expect(await rpc('document', { id: doc.id, userId: 'admin' }, 'bob')).toBeNull()
    expect(await rpc('search', { query: 'PrivateWidget', userId: 'admin', projectIds: ['forged'] }, 'bob')).toEqual([])
    await expect(rpc('write', { id: doc.id, scope: 'user', title: 'Stolen', body: '' }, 'bob')).rejects.toMatchObject({ statusCode: 403 })
    await expect(rpc('delete', { id: doc.id }, 'bob')).rejects.toMatchObject({ statusCode: 403 })
    await expect(rpc('write', { scope: 'usage', title: 'Global', body: '' }, 'bob')).rejects.toMatchObject({ statusCode: 403 })
    const project = await db.projects.createProject('admin', { name: 'Private project' })
    const projectDoc = await rpc('write', { scope: 'project', projectId: project.id, title: 'ProjectWidget', body: 'ProjectWidget' }, 'admin')
    expect(await rpc('document', { id: projectDoc.id }, 'bob')).toBeNull()
    for (const method of ['topics', 'search', 'context'] as const) {
      await expect(rpc(method, { query: 'ProjectWidget', projectId: project.id }, 'bob')).rejects.toMatchObject({ statusCode: 403 })
    }
    await expect(rpc('search', { query: 'q', module: '../core' }, 'admin')).rejects.toThrow(TypeError)
    await expect(rpc('write', { scope: 'user', title: ' ', body: '' }, 'admin')).rejects.toMatchObject({ statusCode: 400 })
    await expect(rpc('delete', { id: 'missing' }, 'admin')).rejects.toMatchObject({ statusCode: 404 })
    await expect(rpc('topics', undefined, 'missing-user')).rejects.toMatchObject({ statusCode: 403 })
    await db.identity.setUserBlocked('admin', true)
    await expect(rpc('write', { scope: 'usage', title: 'Global', body: '' }, 'admin')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('serves all usage targets through the database access checks', async () => {
    const project = await db.projects.createProject('admin', { name: 'Project' })
    const column = await db.projects.createColumn('admin', project.id, 'Work')
    const task = await db.tasks.createTask('admin', project.id, { columnId: column!.id, title: 'Task' })
    const run = await db.ci.createCiRun({ projectId: project.id, taskId: task!.id, agentId: null,
      triggeredBy: 'admin', prevColumnId: column!.id, slotProgress: { done: 0, total: 1, phase: '' } })
    const conversation = await db.chat.createConversation('admin')
    const requests: KbUsageRequest[] = [
      { target: 'conversation', conversationId: conversation.id }, { target: 'project', projectId: project.id },
      { target: 'run', runId: run.id }, { target: 'task', projectId: project.id, taskId: task!.id }
    ]
    for (const request of requests) {
      expect((await rpc('usage', request, 'admin')).target).toBe(request.target)
      await expect(rpc('usage', request, 'bob')).rejects.toMatchObject({ statusCode: 404 })
    }
  })
})

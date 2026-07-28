import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'
import type { WorkspaceExecutor } from '../features/workspace.js'

const SECRET = 'feature-secret'
let app: FastifyInstance, db: VoiceChatDb, admin: string, bob: string
const pending = new Promise<never>(() => {})
const workspace: WorkspaceExecutor = {
  prepare: () => pending, commit: () => pending, run: () => pending,
  pushFeature: () => pending, mergeLocal: () => pending, cleanup: () => pending,
  remoteMainSha: () => pending, checkout: () => pending
}

beforeEach(async () => {
  let id = 0
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => 1000 + id })
  db.createUser('bob', '', 'user')
  app = await buildServer({ config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-feature-${Date.now()}`) }), db, sessionSecret: SECRET, workspaceExecutor: workspace })
  admin = signToken({ name: 'admin', role: 'admin' }, SECRET)
  bob = signToken({ name: 'bob', role: 'user' }, SECRET)
})
afterEach(async () => { await app.close(); db.close() })
const inj = (token: string, opts: { method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: object }) => app.inject({ ...opts, headers: { authorization: `Bearer ${token}` } })

function setupTask() {
  const project = db.createProject('admin', { name: 'P', gitUrl: 'git@github.com:x/y.git' })
  const agent = db.createAgent('admin', 'M')
  db.linkMachine('admin', project.id, agent.id)
  db.setProjectMachineFeatureReposRoot('admin', project.id, agent.id, '/repos')
  db.setProjectDefaultMachine('admin', project.id, agent.id)
  const ready = db.getBoard('admin', project.id)!.columns.find((c) => c.semanticType === 'ready')!
  return { project, task: db.createTask('admin', project.id, { columnId: ready.id, title: 'T' })! }
}

describe('feature routes', () => {
  it('создаёт Feature Run из Task и не раскрывает его не-участнику', async () => {
    const { project, task } = setupTask()
    const created = await inj(admin, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/feature`, payload: { autoMerge: true } })
    expect(created.statusCode).toBe(202)
    expect(created.json()).toMatchObject({ projectId: project.id, sourceTaskId: task.id, attempt: 1, autoMerge: true })
    const chat = await inj(admin, { method: 'GET', url: `/api/conversations/${created.json().conversationId}` })
    expect(chat.json().messages[0].text).toContain('Начни выполнение задачи')
    expect(chat.json().messages[0].text).toContain('Название: T')
    const list = await inj(admin, { method: 'GET', url: `/api/projects/${project.id}/features` })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toHaveLength(1)
    expect((await inj(bob, { method: 'GET', url: `/api/projects/${project.id}/features` })).statusCode).toBe(404)
  })

  it('запрещает вторую активную попытку одной Task', async () => {
    const { project, task } = setupTask()
    expect((await inj(admin, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/feature` })).statusCode).toBe(202)
    expect((await inj(admin, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/feature` })).statusCode).toBe(409)
  })

  it('запрещает удалять чат активной Feature и разрешает после отмены', async () => {
    const { project, task } = setupTask()
    const created = await inj(admin, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/feature` })
    const feature = created.json()

    const blocked = await inj(admin, { method: 'DELETE', url: `/api/conversations/${feature.conversationId}` })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toContain('активной Feature')
    expect(db.getConversation('admin', feature.conversationId)).not.toBeNull()

    db.transitionFeature('admin', feature.id, 'cancelled')
    const removed = await inj(admin, { method: 'DELETE', url: `/api/conversations/${feature.conversationId}` })
    expect(removed.statusCode).toBe(200)
    expect(db.getConversation('admin', feature.conversationId)).toBeNull()
    expect(db.getFeature('admin', feature.id)?.conversationId).toBeNull()
  })
})

// Роуты панели кода: проверяем именно гейты. Логика git проверена отдельно
// (`git/workspaceService.test.ts`), здесь важно, что чужой проект не отвечает,
// без параметров приходит 400, а запись требует роли и живой машины.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { ProjectDetail } from '@voicechat/shared'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'

const SECRET = 'test-secret'
let app: FastifyInstance
let db: VoiceChatDb
let adminTok: string
let bobTok: string
let testerTok: string

function inj(token: string, opts: { method: 'GET' | 'POST'; url: string; payload?: object }) {
  return app.inject({ ...opts, headers: { authorization: `Bearer ${token}` } })
}

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.createUser('bob', '', 'developer')
  db.createUser('tess', '', 'tester')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-git-${Date.now()}-${id}`) }),
    db,
    sessionSecret: SECRET
  })
  adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
  bobTok = signToken({ name: 'bob', role: 'developer' }, SECRET)
  testerTok = signToken({ name: 'tess', role: 'tester' }, SECRET)
})

afterEach(async () => {
  await app.close()
  db.close()
})

async function createProject(name = 'Панель кода'): Promise<ProjectDetail> {
  const res = await inj(adminTok, { method: 'POST', url: '/api/projects', payload: { name } })
  expect(res.statusCode).toBe(200)
  return res.json() as ProjectDetail
}

describe('REST панели кода', () => {
  it('список рабочих копий доступен участнику и пуст, пока ранов не было', async () => {
    const project = await createProject()
    const res = await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/git/workspaces` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('не участник не узнаёт даже о существовании проекта', async () => {
    const project = await createProject()
    for (const url of [
      `/api/projects/${project.id}/git/workspaces`,
      `/api/projects/${project.id}/git/status?workspace=ws:x`
    ]) {
      expect((await inj(bobTok, { method: 'GET', url })).statusCode).toBe(404)
    }
    const write = await inj(bobTok, {
      method: 'POST', url: `/api/projects/${project.id}/git/commit`,
      payload: { workspace: 'ws:x', message: 'fix' }
    })
    expect(write.statusCode).toBe(404)
  })

  it('без обязательных параметров — 400 с понятным текстом', async () => {
    const project = await createProject()
    const noWorkspace = await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/git/status` })
    expect(noWorkspace.statusCode).toBe(400)
    expect(String(noWorkspace.json().message)).toContain('workspace')
    const noPath = await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/git/file?workspace=ws:x` })
    expect(noPath.statusCode).toBe(400)
    expect(String(noPath.json().message)).toContain('path')
    const noMessage = await inj(adminTok, {
      method: 'POST', url: `/api/projects/${project.id}/git/commit`, payload: { workspace: 'ws:x' }
    })
    expect(noMessage.statusCode).toBe(400)
  })

  it('тестировщику запись запрещена глобальным гейтом права, чтение — нет', async () => {
    const project = await createProject()
    db.addMember('admin', project.id, 'tess')
    const read = await inj(testerTok, { method: 'GET', url: `/api/projects/${project.id}/git/workspaces` })
    expect(read.statusCode).toBe(200)
    for (const url of ['git/commit', 'git/push', 'git/checkout', 'git/file', 'git/branch']) {
      const res = await inj(testerTok, { method: 'POST', url: `/api/projects/${project.id}/${url}`, payload: { workspace: 'ws:x' } })
      expect(res.statusCode, url).toBe(403)
      expect(res.json(), url).toMatchObject({ error: 'forbidden', permission: 'repository:write' })
    }
  })

  it('неизвестная рабочая копия — 404 с кодом, а не пустой ответ', async () => {
    const project = await createProject()
    const res = await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/git/status?workspace=ws:missing` })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'workspace_not_found' })
  })

  it('форма «произвольный путь на машине» не принимается ни одной ручкой', async () => {
    const project = await createProject()
    const res = await inj(adminTok, {
      method: 'GET',
      url: `/api/projects/${project.id}/git/file?workspace=${encodeURIComponent('machine:a1:/etc')}&path=passwd`
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'workspace_not_found' })
  })
})

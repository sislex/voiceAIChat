// Роуты компонентов проекта: проверяем гейты и разбор запроса. Живая машина здесь не
// нужна — до неё запросы не доходят: чужой проект отвечает 404, тестировщику запись
// запрещена правом, а неизвестная рабочая копия отсекается резолвером.
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

function inj(token: string, opts: { method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: object }) {
  return app.inject({ ...opts, headers: { authorization: `Bearer ${token}` } })
}

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.createUser('bob', '', 'developer')
  db.createUser('tess', '', 'tester')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-components-${Date.now()}-${id}`) }),
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

async function createProject(name = 'Компоненты'): Promise<ProjectDetail> {
  const res = await inj(adminTok, { method: 'POST', url: '/api/projects', payload: { name } })
  expect(res.statusCode).toBe(200)
  return res.json() as ProjectDetail
}

describe('REST компонентов проекта', () => {
  it('не участник не узнаёт о существовании проекта', async () => {
    const project = await createProject()
    const read = await inj(bobTok, { method: 'GET', url: `/api/projects/${project.id}/components?workspace=ws:x` })
    expect(read.statusCode).toBe(404)
    const write = await inj(bobTok, {
      method: 'POST', url: `/api/projects/${project.id}/components/storybook`,
      payload: { workspace: 'ws:x', action: 'start' }
    })
    expect(write.statusCode).toBe(404)
  })

  it('без обязательных параметров — 400 с указанием, чего не хватает', async () => {
    const project = await createProject()
    const noWorkspace = await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/components` })
    expect(noWorkspace.statusCode).toBe(400)
    expect(String(noWorkspace.json().message)).toContain('workspace')

    const noPath = await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/components/stories?workspace=ws:x` })
    expect(noPath.statusCode).toBe(400)
    expect(String(noPath.json().message)).toContain('path')

    const badAction = await inj(adminTok, {
      method: 'POST', url: `/api/projects/${project.id}/components/storybook`,
      payload: { workspace: 'ws:x', action: 'launch' }
    })
    expect(badAction.statusCode).toBe(400)

    const noPaths = await inj(adminTok, {
      method: 'POST', url: `/api/projects/${project.id}/components/ticket`,
      payload: { workspace: 'ws:x', title: 'Кнопка шире' }
    })
    expect(noPaths.statusCode).toBe(400)
    expect(String(noPaths.json().message)).toContain('paths')
  })

  it('не-сториз файл в разбор не принимается', async () => {
    const project = await createProject()
    const res = await inj(adminTok, {
      method: 'GET',
      url: `/api/projects/${project.id}/components/stories?workspace=ws:x&path=${encodeURIComponent('src/Button.tsx')}`
    })
    expect(res.statusCode).toBe(400)
    expect(String(res.json().message)).toContain('сториз')
  })

  it('тестировщик может читать список, но не запускать Storybook и не заводить тикет', async () => {
    const project = await createProject()
    db.addMember('admin', project.id, 'tess')
    const read = await inj(testerTok, { method: 'GET', url: `/api/projects/${project.id}/components?workspace=ws:x` })
    expect(read.statusCode).toBe(404) // проект виден, а копии нет — резолвер отвечает после гейта права

    for (const url of ['components/storybook', 'components/ticket']) {
      const res = await inj(testerTok, {
        method: 'POST', url: `/api/projects/${project.id}/${url}`,
        payload: { workspace: 'ws:x', action: 'start', title: 'Правка', paths: ['a.tsx'] }
      })
      expect(res.statusCode, url).toBe(403)
      expect(res.json(), url).toMatchObject({ error: 'forbidden', permission: 'repository:write' })
    }
  })

  it('неизвестная рабочая копия отвечает кодом, а не пустотой', async () => {
    const project = await createProject()
    const res = await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/components/storybook?workspace=ws:missing` })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'workspace_not_found' })
  })

  it('состояние Storybook у неизвестной копии не создаёт сессию', async () => {
    const project = await createProject()
    const start = await inj(adminTok, {
      method: 'POST', url: `/api/projects/${project.id}/components/storybook`,
      payload: { workspace: 'ws:missing', action: 'start' }
    })
    expect(start.statusCode).toBe(404)
  })

  it('открытие кадра требует запущенного Storybook и живой копии', async () => {
    const project = await createProject()
    const res = await inj(adminTok, {
      method: 'POST', url: `/api/projects/${project.id}/components/storybook/open`,
      payload: { workspace: 'ws:missing' }
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'workspace_not_found' })

    const noWorkspace = await inj(adminTok, {
      method: 'POST', url: `/api/projects/${project.id}/components/storybook/open`, payload: {}
    })
    expect(noWorkspace.statusCode).toBe(400)
  })

  it('туннель кадра нельзя закрыть чужим и без рабочей копии', async () => {
    const project = await createProject()
    const stranger = await inj(bobTok, {
      method: 'DELETE', url: `/api/projects/${project.id}/components/storybook/tunnels/abc?workspace=ws:x`
    })
    expect(stranger.statusCode).toBe(404)

    const noWorkspace = await inj(adminTok, {
      method: 'DELETE', url: `/api/projects/${project.id}/components/storybook/tunnels/abc`
    })
    expect(noWorkspace.statusCode).toBe(400)

    // Копия участнику видна, но её не существует — резолвер отвечает раньше туннеля.
    const unknown = await inj(adminTok, {
      method: 'DELETE', url: `/api/projects/${project.id}/components/storybook/tunnels/abc?workspace=ws:missing`
    })
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json()).toMatchObject({ code: 'workspace_not_found' })
  })
})

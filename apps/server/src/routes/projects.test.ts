import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'
import type { Board, ProjectDetail, ProjectSummary, Task } from '@voicechat/shared'

const SECRET = 'test-secret'
let app: FastifyInstance
let db: VoiceChatDb
let adminTok: string
let bobTok: string

function inj(token: string, opts: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: object }) {
  return app.inject({ ...opts, headers: { authorization: `Bearer ${token}` } })
}

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.createUser('bob', '', 'user')
  db.createUser('carol', '', 'user')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-proj-${Date.now()}-${id}`) }),
    db,
    sessionSecret: SECRET
  })
  adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
  bobTok = signToken({ name: 'bob', role: 'user' }, SECRET)
})
afterEach(async () => {
  await app.close()
  db.close()
})

async function createProject(name = 'P1'): Promise<ProjectDetail> {
  const res = await inj(adminTok, { method: 'POST', url: '/api/projects', payload: { name } })
  expect(res.statusCode).toBe(200)
  return res.json() as ProjectDetail
}

describe('projects REST: доступ', () => {
  it('без токена → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(401)
  })

  it('создание, список, изоляция по членству', async () => {
    const p = await createProject()
    expect(p.role).toBe('owner')
    expect((p.members as ProjectDetail['members']).length).toBe(1)

    const mine = (await inj(adminTok, { method: 'GET', url: '/api/projects' })).json() as ProjectSummary[]
    expect(mine.map((x) => x.id)).toContain(p.id)

    // bob не участник
    expect(((await inj(bobTok, { method: 'GET', url: '/api/projects' })).json() as ProjectSummary[]).length).toBe(0)
    expect((await inj(bobTok, { method: 'GET', url: `/api/projects/${p.id}` })).statusCode).toBe(404)
    expect((await inj(bobTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).statusCode).toBe(404)
  })

  it('владелец добавляет участника; участник видит, но не управляет', async () => {
    const p = await createProject()
    const added = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'bob' } })
    expect(added.statusCode).toBe(200)

    const asBob = await inj(bobTok, { method: 'GET', url: `/api/projects/${p.id}` })
    expect(asBob.statusCode).toBe(200)
    expect((asBob.json() as ProjectDetail).role).toBe('member')

    // member не может патчить проект / добавлять участников
    expect((await inj(bobTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { name: 'x' } })).statusCode).toBe(403)
    expect((await inj(bobTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'carol' } })).statusCode).toBe(403)
  })

  it('добавление несуществующего пользователя → 400', async () => {
    const p = await createProject()
    expect((await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'ghost' } })).statusCode).toBe(400)
  })
})

describe('projects REST: доска', () => {
  it('колонки: reorder не перехватывается :columnId; hidden; delete', async () => {
    const p = await createProject()
    let board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(board.columns.map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Done'])

    const reversed = board.columns.map((c) => c.id).reverse()
    const reo = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/columns/reorder`, payload: { order: reversed } })
    expect(reo.statusCode).toBe(200)
    board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(board.columns.map((c) => c.id)).toEqual(reversed)

    const first = board.columns[0]
    expect((await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/columns/${first.id}/hidden`, payload: { hidden: true } })).statusCode).toBe(200)
    board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(board.columns.find((c) => c.id === first.id)!.hidden).toBe(true)

    expect((await inj(adminTok, { method: 'DELETE', url: `/api/projects/${p.id}/columns/${first.id}` })).statusCode).toBe(200)
    board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(board.columns.find((c) => c.id === first.id)).toBeUndefined()
  })

  it('задачи: создание, move, assignee-валидация, delete', async () => {
    const p = await createProject()
    const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    const [todo, doing] = board.columns

    const mk = async (title: string) =>
      (await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: todo.id, title } })).json() as Task
    const a = await mk('A')
    const b = await mk('B')

    // assignee не участник → 400; participant ok
    expect((await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: todo.id, title: 'C', assignee: 'bob' } })).statusCode).toBe(400)
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'bob' } })
    expect((await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: todo.id, title: 'C', assignee: 'bob' } })).statusCode).toBe(200)

    // move A в колонку doing
    const moved = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks/${a.id}/move`, payload: { columnId: doing.id } })
    expect(moved.statusCode).toBe(200)
    expect((moved.json() as Task).columnId).toBe(doing.id)

    // member (bob) может двигать задачи
    const bobMove = await inj(bobTok, { method: 'POST', url: `/api/projects/${p.id}/tasks/${b.id}/move`, payload: { columnId: doing.id, afterId: a.id } })
    expect(bobMove.statusCode).toBe(200)

    expect((await inj(adminTok, { method: 'DELETE', url: `/api/projects/${p.id}/tasks/${a.id}` })).statusCode).toBe(200)
    const final = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(final.tasks.find((t) => t.id === a.id)).toBeUndefined()
  })
})

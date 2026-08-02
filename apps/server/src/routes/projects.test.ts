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

describe('conversation status REST', () => {
  it('хранит статус, валидирует значение и изолирует владельца', async () => {
    const conv = db.createConversation('admin', 'Статус')
    expect(conv.status).toBe('developing')

    const changed = await inj(adminTok, {
      method: 'POST',
      url: `/api/conversations/${conv.id}/status`,
      payload: { status: 'planning_done' }
    })
    expect(changed.statusCode).toBe(200)
    expect(changed.json().status).toBe('planning_done')
    expect(db.getConversation('admin', conv.id)?.status).toBe('planning_done')

    expect((await inj(adminTok, {
      method: 'POST', url: `/api/conversations/${conv.id}/status`, payload: { status: 'unknown' }
    })).statusCode).toBe(400)
    expect((await inj(bobTok, {
      method: 'POST', url: `/api/conversations/${conv.id}/status`, payload: { status: 'done' }
    })).statusCode).toBe(404)
  })
})

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
    expect(board.columns.map((c) => c.name)).toEqual(['Бэклог', 'Готово к разработке', 'В разработке', 'Тестирование', 'Ожидает мержа', 'Готово'])

    const reversed = board.columns.map((c) => c.id).reverse()
    const reo = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/columns/reorder`, payload: { order: reversed } })
    expect(reo.statusCode).toBe(200)
    board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(board.columns.map((c) => c.id)).toEqual(reversed)

    const created = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/columns`, payload: { name: 'Custom' } })
    const first = created.json() as Board['columns'][number]
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

describe('projects REST: поля Jira-доски', () => {
  it('метки, стори-поинты, срок, флаг и сквозной номер задачи', async () => {
    const p = await createProject()
    const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    const col = board.columns[0]

    const a = (await inj(adminTok, {
      method: 'POST',
      url: `/api/projects/${p.id}/tasks`,
      payload: { columnId: col.id, title: 'A', labels: ['ui', 'срочно'], storyPoints: 3, dueDate: 1_700_000_000_000 }
    })).json() as Task
    expect(a.seq).toBe(1)
    expect(a.labels).toEqual(['ui', 'срочно'])
    expect(a.storyPoints).toBe(3)
    expect(a.dueDate).toBe(1_700_000_000_000)
    expect(a.flagged).toBe(false)

    const b = (await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: col.id, title: 'B' } })).json() as Task
    expect(b.seq).toBe(2)

    // Номера не переиспользуются после удаления — как ключи в Jira.
    expect((await inj(adminTok, { method: 'DELETE', url: `/api/projects/${p.id}/tasks/${b.id}` })).statusCode).toBe(200)
    const c = (await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: col.id, title: 'C' } })).json() as Task
    expect(c.seq).toBe(3)

    const upd = (await inj(adminTok, {
      method: 'PATCH',
      url: `/api/projects/${p.id}/tasks/${a.id}`,
      payload: { flagged: true, labels: ['api'], storyPoints: null }
    })).json() as Task
    expect(upd.flagged).toBe(true)
    expect(upd.labels).toEqual(['api'])
    expect(upd.storyPoints).toBeNull()
  })

  it('WIP-лимит колонки задаётся, сбрасывается и не принимает мусор', async () => {
    const p = await createProject()
    const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    const col = board.columns[0]
    expect(col.wipLimit).toBeNull()

    expect((await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}/columns/${col.id}`, payload: { wipLimit: 5 } })).statusCode).toBe(200)
    let after = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(after.columns[0].wipLimit).toBe(5)

    // Одновременно имя и лимит; нулевой лимит = снять.
    expect((await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}/columns/${col.id}`, payload: { name: 'Очередь', wipLimit: 0 } })).statusCode).toBe(200)
    after = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(after.columns[0].name).toBe('Очередь')
    expect(after.columns[0].wipLimit).toBeNull()

    expect((await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}/columns/${col.id}`, payload: {} })).statusCode).toBe(400)
  })
})

describe('projects REST: машины проекта (папка, дефолт) и привязка чата', () => {
  it('путь машины и дефолт — только владелец', async () => {
    const p = await createProject()
    const agent = db.createAgent('admin', 'M1')
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/machines`, payload: { agentId: agent.id } })
    // папка машины
    const setPath = await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}/machines/${agent.id}`, payload: { path: '/srv/x' } })
    expect(setPath.statusCode).toBe(200)
    expect((setPath.json() as ProjectDetail).machines.find((m) => m.agentId === agent.id)!.path).toBe('/srv/x')
    // дефолт
    const setDef = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/default-machine`, payload: { agentId: agent.id } })
    expect(setDef.statusCode).toBe(200)
    expect((setDef.json() as ProjectDetail).defaultAgentId).toBe(agent.id)
    // участник (не владелец) не может
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'bob' } })
    expect((await inj(bobTok, { method: 'PATCH', url: `/api/projects/${p.id}/machines/${agent.id}`, payload: { path: '/y' } })).statusCode).toBe(403)
    expect((await inj(bobTok, { method: 'POST', url: `/api/projects/${p.id}/default-machine`, payload: { agentId: agent.id } })).statusCode).toBe(403)
  })

  it('привязка чата к проекту применяет машину/папку/навыки; не-участник → 404', async () => {
    const create = await inj(adminTok, { method: 'POST', url: '/api/projects', payload: { name: 'P', skills: ['ts'] } })
    const p = create.json() as ProjectDetail
    const agent = db.createAgent('admin', 'M1')
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/machines`, payload: { agentId: agent.id } })
    await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}/machines/${agent.id}`, payload: { path: '/srv/p' } })
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/default-machine`, payload: { agentId: agent.id } })
    const conv = db.createConversation('admin', 'Chat')
    const linked = await inj(adminTok, { method: 'POST', url: `/api/conversations/${conv.id}/project`, payload: { projectId: p.id } })
    expect(linked.statusCode).toBe(200)
    const c = linked.json() as { execTarget: string | null; workdir: string | null; skillNames: string[]; projectId?: string | null }
    expect(c.projectId).toBe(p.id)
    expect(c.execTarget).toBe(agent.id)
    expect(c.workdir).toBe('/srv/p')
    expect(c.skillNames).toEqual(['ts'])
    // не-участник bob не может привязать свой чат к чужому проекту
    const convBob = db.createConversation('bob', 'Chat bob')
    expect((await inj(bobTok, { method: 'POST', url: `/api/conversations/${convBob.id}/project`, payload: { projectId: p.id } })).statusCode).toBe(404)
  })
})

describe('projects REST: навыки по умолчанию, навыки задачи и связанный чат', () => {
  it('PATCH проекта хранит defaultSkills; создание задачи наследует навыки по типу', async () => {
    const p = await createProject('Skills')
    const patched = await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { defaultSkills: { task: ['ts'], story: ['ux'] } } })
    expect(patched.statusCode).toBe(200)
    expect((patched.json() as ProjectSummary).defaultSkills).toEqual({ epic: [], story: ['ux'], task: ['ts'] })
    const col = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    const created = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: col.columns[0].id, title: 'T' } })
    expect((created.json() as Task).skills).toEqual(['ts'])
  })

  it('POST .../tasks/:id/chat создаёт/возвращает связанный чат (идемпотентно, гейт членства)', async () => {
    const p = await createProject('Chat')
    const col = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    const task = (await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: col.columns[0].id, title: 'Задача' } })).json() as Task
    const r1 = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks/${task.id}/chat` })
    expect(r1.statusCode).toBe(200)
    const c1 = r1.json() as { id: string; taskId?: string | null; projectId?: string | null }
    expect(c1.taskId).toBe(task.id)
    expect(c1.projectId).toBe(p.id)
    const r2 = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks/${task.id}/chat` })
    expect((r2.json() as { id: string }).id).toBe(c1.id)
    // не-участник не может
    expect((await inj(bobTok, { method: 'POST', url: `/api/projects/${p.id}/tasks/${task.id}/chat` })).statusCode).toBe(404)
  })
})

describe('projects REST: скрытие завершённых задач', () => {
  const boardOf = async (id: string, includeCompleted = false): Promise<Board> =>
    (await inj(adminTok, {
      method: 'GET',
      url: `/api/projects/${id}/board${includeCompleted ? '?includeCompleted=1' : ''}`
    })).json() as Board

  it('задача из «Готово» за порогом не приходит по умолчанию и приходит с includeCompleted=1', async () => {
    const p = await createProject('Done')
    expect(p.doneRetentionDays).toBe(14) // дефолт как в Jira
    const board = await boardOf(p.id)
    const dev = board.columns.find((c) => c.semanticType === 'development')!
    const done = board.columns.find((c) => c.semanticType === 'done')!
    const task = (await inj(adminTok, {
      method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: dev.id, title: 'T' }
    })).json() as Task
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks/${task.id}/move`, payload: { columnId: done.id } })
    // Свежезавершённая ещё на доске.
    expect((await boardOf(p.id)).tasks.map((t) => t.id)).toContain(task.id)

    // Порог 0 = «убрать в конце дня»: сегодня карточка ещё на доске. В «Готово»
    // её переносит и CI-ран после успешного мержа, а исчезнувшая в ту же секунду
    // карточка читается как потерянная работа (порог по дням — в db-тестах).
    const patched = await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { doneRetentionDays: 0 } })
    expect((patched.json() as ProjectSummary).doneRetentionDays).toBe(0)
    expect((await boardOf(p.id)).tasks.map((t) => t.id)).toContain(task.id)
    expect((await boardOf(p.id, true)).tasks.map((t) => t.id)).toContain(task.id)

    // Пустой порог — не скрывать никогда.
    await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { doneRetentionDays: null } })
    expect((await boardOf(p.id)).tasks.map((t) => t.id)).toContain(task.id)
  })

  it('мусор в пороге читается как «не скрывать», настройка — только владельцу', async () => {
    const p = await createProject('Retention')
    const bad = await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { doneRetentionDays: -5 } })
    expect((bad.json() as ProjectSummary).doneRetentionDays).toBeNull()
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'bob' } })
    expect((await inj(bobTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { doneRetentionDays: 3 } })).statusCode).toBe(403)
  })
})

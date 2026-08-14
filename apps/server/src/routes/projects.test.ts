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
  db.createUser('bob', '', 'developer')
  db.createUser('carol', '', 'developer')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-proj-${Date.now()}-${id}`) }),
    db,
    sessionSecret: SECRET
  })
  adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
  bobTok = signToken({ name: 'bob', role: 'developer' }, SECRET)
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

describe('conversation preview URL REST', () => {
  it('хранит override, очищает его и принимает только http/https', async () => {
    const conv = db.createConversation('admin', 'Preview')
    const url = `/api/conversations/${conv.id}/preview-url`
    const saved = await inj(adminTok, { method: 'POST', url, payload: { previewUrl: 'http://localhost:3000/path' } })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().previewUrl).toBe('http://localhost:3000/path')
    expect(db.getConversation('admin', conv.id)?.previewUrl).toBe('http://localhost:3000/path')
    expect((await inj(adminTok, { method: 'POST', url, payload: { previewUrl: 'file:///tmp/x' } })).statusCode).toBe(400)
    expect((await inj(adminTok, { method: 'POST', url, payload: { previewUrl: null } })).json().previewUrl).toBeNull()
    expect((await inj(bobTok, { method: 'POST', url, payload: { previewUrl: 'https://example.com' } })).statusCode).toBe(404)
  })
})

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

  it('developer создаёт и редактирует задачу, но получает 403 для настроек и release/deploy', async () => {
    const p = await createProject('RBAC')
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'bob' } })
    const board = (await inj(bobTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    const created = await inj(bobTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: board.columns[0].id, title: 'Developer task' } })
    expect(created.statusCode).toBe(200)
    const task = created.json() as Task
    expect((await inj(bobTok, { method: 'PATCH', url: `/api/projects/${p.id}/tasks/${task.id}`, payload: { description: 'updated' } })).statusCode).toBe(200)
    expect((await inj(bobTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { description: 'forbidden' } })).statusCode).toBe(403)
    expect((await inj(bobTok, { method: 'POST', url: `/api/projects/${p.id}/releases/branches`, payload: { branch: 'release/1.0.0' } })).statusCode).toBe(403)
    expect((await inj(bobTok, { method: 'POST', url: `/api/projects/${p.id}/releases/deploy`, payload: { branch: 'release/1.0.0' } })).statusCode).toBe(403)
  })

  it('release branches объясняет неполную конфигурацию машины вместо ложного 404', async () => {
    const p = await createProject('Release target')
    const response = await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/releases/branches` })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: 'В настройках проекта не выбрана машина по умолчанию'
    })
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

  it('хранит http/https URL превью проекта и отклоняет остальные протоколы', async () => {
    const p = await createProject()
    const saved = await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { previewUrl: 'https://example.com/app' } })
    expect(saved.statusCode).toBe(200)
    expect((saved.json() as ProjectDetail).previewUrl).toBe('https://example.com/app')
    const conversation = db.createConversation('admin', 'Inherited preview')
    db.setConversationProject('admin', conversation.id, p.id)
    expect(db.getConversation('admin', conversation.id)?.projectPreviewUrl).toBe('https://example.com/app')
    expect((await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { previewUrl: 'javascript:alert(1)' } })).statusCode).toBe(400)
    expect((await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { previewUrl: null } })).json().previewUrl).toBeNull()
  })
})

describe('projects REST: доска', () => {
  it('колонки: reorder не перехватывается :columnId; hidden; delete', async () => {
    const p = await createProject()
    let board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(board.columns.map((c) => c.name)).toEqual(['Бэклог', 'Готово к разработке', 'В разработке', 'Автотестирование', 'Создание сценариев ручного QA', 'Ручное QA', 'Ожидает мержа', 'Мерж', 'Требуется решение', 'Готово'])

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

  it('нормализует критерии одинаково при создании и обновлении', async () => {
    const p = await createProject()
    const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    const created = (await inj(adminTok, {
      method: 'POST',
      url: `/api/projects/${p.id}/tasks`,
      payload: { columnId: board.columns[0].id, title: 'Criteria', acceptanceCriteria: 'Первый\n\n4. Второй' }
    })).json() as Task
    expect(created.acceptanceCriteria).toBe('1. Первый\n2. Второй')

    const updated = (await inj(adminTok, {
      method: 'PATCH',
      url: `/api/projects/${p.id}/tasks/${created.id}`,
      payload: { acceptanceCriteria: '8. 2. Новый\n- [ ] Ещё один' }
    })).json() as Task
    expect(updated.acceptanceCriteria).toBe('1. Новый\n2. Ещё один')
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

  it('список доступен участнику, повторная привязка конфликтует, а управление запрещено', async () => {
    const p = await createProject()
    const agent = db.createAgent('admin', 'Shared Mac')
    expect((await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/machines/available` })).json()).toEqual([
      { id: agent.id, name: 'Shared Mac' }
    ])
    expect((await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/machines`, payload: { agentId: agent.id } })).statusCode).toBe(200)
    expect((await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/machines`, payload: { agentId: agent.id } })).statusCode).toBe(409)
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'bob' } })
    const list = await inj(bobTok, { method: 'GET', url: `/api/projects/${p.id}/machines` })
    expect(list.statusCode).toBe(200)
    expect(list.json()[0]).toMatchObject({ agentId: agent.id, name: 'Shared Mac', owner: 'admin' })
    expect((await inj(bobTok, { method: 'GET', url: `/api/projects/${p.id}/machines/available` })).statusCode).toBe(403)
    expect((await inj(bobTok, { method: 'DELETE', url: `/api/projects/${p.id}/machines/${agent.id}` })).statusCode).toBe(403)
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

  it('API возвращает «Готово» в порядке последнего входа, не реагируя на правку', async () => {
    const p = await createProject('Done order')
    await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { doneRetentionDays: null } })
    const board = await boardOf(p.id)
    const dev = board.columns.find((column) => column.semanticType === 'development')!
    const done = board.columns.find((column) => column.semanticType === 'done')!
    const first = (await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: dev.id, title: 'Первая' } })).json() as Task
    const second = (await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: dev.id, title: 'Вторая' } })).json() as Task
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks/${first.id}/move`, payload: { columnId: done.id } })
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks/${second.id}/move`, payload: { columnId: done.id } })
    await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}/tasks/${second.id}`, payload: { title: 'Вторая (исправлена)' } })
    expect((await boardOf(p.id)).tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([second.id, first.id])

    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks/${first.id}/move`, payload: { columnId: dev.id } })
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks/${first.id}/move`, payload: { columnId: done.id } })
    expect((await boardOf(p.id)).tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([first.id, second.id])
  })

  it('мусор в пороге читается как «не скрывать», настройка — только владельцу', async () => {
    const p = await createProject('Retention')
    const bad = await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { doneRetentionDays: -5 } })
    expect((bad.json() as ProjectSummary).doneRetentionDays).toBeNull()
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'bob' } })
    expect((await inj(bobTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { doneRetentionDays: 3 } })).statusCode).toBe(403)
  })
})

describe('projects REST: merge run', () => {
  it('проверяет статус, права и машину; старт атомарен и идемпотентен', async () => {
    const p = await createProject('Merge')
    const agent = db.createAgent('admin', 'Merge machine')
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/machines`, payload: { agentId: agent.id } })
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/default-machine`, payload: { agentId: agent.id } })
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'bob' } })
    const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
    const awaiting = board.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const merge = board.columns.find((column) => column.semanticType === 'merge')!
    const task = (await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: backlog.id, title: 'Ready' } })).json() as Task
    const url = `/api/projects/${p.id}/tasks/${task.id}/merge`
    expect((await inj(adminTok, { method: 'POST', url, payload: {} })).statusCode).toBe(409)
    const workspace = db.createCiWorkspace({ projectId: p.id, taskId: task.id, agentId: agent.id, path: '/work/task' })
    db.recordCiWorkspaceRevision(workspace.id, 'feature/task', 'abc123')
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks/${task.id}/move`, payload: { columnId: awaiting.id } })
    expect((await inj(bobTok, { method: 'POST', url, payload: {} })).statusCode).toBe(200)
    const first = await inj(adminTok, { method: 'POST', url, payload: {} })
    expect(first.statusCode).toBe(200)
    const second = await inj(adminTok, { method: 'POST', url, payload: {} })
    expect(second.statusCode).toBe(200)
    expect(second.json().id).toBe(first.json().id)
    const refreshed = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(refreshed.tasks.find((item) => item.id === task.id)?.columnId).toBe(merge.id)
  })
})

describe('widget tool gateway', () => {
  it('предпочитает UI, делает API-fallback и применяет подтверждённый action идемпотентно', async () => {
    const p = await createProject('Widgets')
    const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    const task = (await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: board.columns[0].id, title: 'API card' } })).json() as Task
    const conversation = db.ensureKanbanAssistantConversation('admin', p.id)!
    const userTurn = db.addMessage('admin', conversation.id, 'u0', 'Найди UI', '12:00')
    const proposalTurn = db.addMessage('admin', conversation.id, 'ai', 'proposal', '12:01')
    const scope = { version: 1, widgetKind: 'kanban', widgetInstanceId: p.id, projectId: p.id, conversationId: conversation.id, turnId: userTurn.id }

    const fromUi = await inj(adminTok, { method: 'POST', url: '/api/widget-tools/query', payload: { ...scope, text: 'UI', ui: { revision: 'ui-7', items: [{ id: 'ui-epic', kind: 'epic', title: 'UI', version: '7', data: { title: 'UI' } }] } } })
    expect(fromUi.json()).toMatchObject({ source: 'ui', revision: 'ui-7', items: [{ id: 'ui-epic', kind: 'epic' }] })
    const fallback = await inj(adminTok, { method: 'POST', url: '/api/widget-tools/query', payload: { ...scope, text: 'API' } })
    expect(fallback.json()).toMatchObject({ source: 'api', items: [{ id: task.id }] })
    expect((await inj(bobTok, { method: 'POST', url: '/api/widget-tools/query', payload: scope })).statusCode).toBe(404)

    const unconfirmed = await inj(adminTok, { method: 'POST', url: '/api/widget-tools/action', payload: { ...scope, action: { name: 'kanban.task.update', taskId: task.id, expectedVersion: String(task.updatedAt), patch: { title: 'Changed' } }, idempotencyKey: 'one' } })
    expect(unconfirmed.statusCode).toBe(400)
    const payload = { ...scope, turnId: proposalTurn.id, action: { name: 'kanban.task.update', taskId: task.id, expectedVersion: String(task.updatedAt), patch: { title: 'Changed' } }, confirmation: { confirmed: true, proposalId: proposalTurn.id }, idempotencyKey: 'one' }
    expect((await inj(adminTok, { method: 'POST', url: '/api/widget-tools/action', payload })).json()).toMatchObject({ applied: true, replayed: false, item: { title: 'Changed' } })
    expect((await inj(adminTok, { method: 'POST', url: '/api/widget-tools/action', payload })).json()).toMatchObject({ applied: true, replayed: true })
    expect((await inj(adminTok, { method: 'POST', url: '/api/widget-tools/action', payload: { ...payload, idempotencyKey: 'stale' } })).statusCode).toBe(409)
  })
})

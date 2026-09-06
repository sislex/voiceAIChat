import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'
import type { Board, BoardStatuses, ProjectDetail, ProjectSummary, Task } from '@voicechat/shared'
import { BUILTIN_PROJECT_TYPE_IDS } from '@voicechat/shared'

const SECRET = 'test-secret'
let app: FastifyInstance
let db: VoiceChatDb
let adminTok: string
let bobTok: string

function inj(token: string, opts: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: object; headers?: Record<string, string> }) {
  return app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${token}` } })
}

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.identity.createUser('bob', '', 'developer')
  db.identity.createUser('carol', '', 'developer')
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

async function reworkFixture() {
  const project = await createProject('Rework')
  const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/board` })).json() as Board
  const done = board.columns.find((column) => column.semanticType === 'done')!
  const preparation = board.columns.find((column) => column.semanticType === 'preparation')!
  const task = (await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: { columnId: done.id, title: 'Rework task' } })).json() as Task
  const run = db.ci.createCiRun({ projectId: project.id, taskId: task.id, agentId: null, triggeredBy: 'admin', prevColumnId: null, slotProgress: { done: 1, total: 1, phase: 'done' } })
  db.ci.updateCiRun(run.id, { status: 'success', finishedAt: Date.now() })
  return { project, task, done, preparation }
}

async function createProject(name = 'P1'): Promise<ProjectDetail> {
  const res = await inj(adminTok, { method: 'POST', url: '/api/projects', payload: { name } })
  expect(res.statusCode).toBe(200)
  return res.json() as ProjectDetail
}

describe('task rework cycles REST', () => {
  // @testCase TC-API-1
  it('читает полную серверную историю по sequence и скрывает её от неучастника', async () => {
    const { project, task, done } = await reworkFixture()
    const url = `/api/projects/${project.id}/tasks/${task.id}/rework-cycles`
    const payload = { description: 'Первый', criteria: ['A'], makeMode: 'files', makePaths: ['src/A.ts'], uploadIds: [], idempotencyKey: 'one' }
    expect((await inj(adminTok, { method: 'POST', url, payload })).statusCode).toBe(200)
    db.tasks.moveTask('admin', project.id, task.id, { columnId: done.id })
    expect((await inj(adminTok, { method: 'POST', url, payload: { ...payload, description: 'Второй', idempotencyKey: 'two' } })).statusCode).toBe(200)
    const history = (await inj(adminTok, { method: 'GET', url })).json()
    expect(history.map((cycle: { sequence: number }) => cycle.sequence)).toEqual([1, 2])
    expect(history[0]).toMatchObject({ description: 'Первый', criteria: ['A'] })
    expect((await inj(bobTok, { method: 'GET', url })).statusCode).toBe(404)
  })

  // @testCase TC-API-2
  it('повторяет одинаковый idempotency key без второго цикла или перехода', async () => {
    const { project, task, preparation } = await reworkFixture()
    const url = `/api/projects/${project.id}/tasks/${task.id}/rework-cycles`
    const payload = { description: 'Один раз', criteria: [], makeMode: 'whole_project', uploadIds: [], idempotencyKey: 'rework-fixed-key' }
    const first = await inj(adminTok, { method: 'POST', url, payload })
    const second = await inj(adminTok, { method: 'POST', url, payload })
    expect(second.json().id).toBe(first.json().id)
    expect((await inj(adminTok, { method: 'GET', url })).json()).toHaveLength(1)
    expect(db.tasks.getTaskDetail('admin', project.id, task.id)?.columnId).toBe(preparation.id)
    expect((await inj(adminTok, { method: 'POST', url, payload: { ...payload, description: 'Другой' } })).json().code).toBe('idempotency_conflict')
  })

  // @testCase TC-NEG-1
  it('активный ран запрещает создание и остаётся активным', async () => {
    const { project, task } = await reworkFixture()
    const active = db.ci.createCiRun({ projectId: project.id, taskId: task.id, agentId: null, triggeredBy: 'admin', prevColumnId: null, slotProgress: { done: 0, total: 1, phase: 'running' } })
    const response = await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/rework-cycles`, payload: { description: 'Нет', makeMode: 'whole_project', uploadIds: [], idempotencyKey: 'active' } })
    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('active_run')
    expect(db.ci.getCiRunRaw(active.id)?.status).toBe('queued')
    expect(db.tasks.listTaskReworkCycles('admin', project.id, task.id)).toHaveLength(0)
  })

  // @testCase TC-NEG-2
  it('отклоняет чужой upload до транзакции', async () => {
    const { project, task, done } = await reworkFixture()
    const upload = await inj(bobTok, { method: 'POST', url: '/api/uploads', payload: { name: 'foreign.txt', mimeType: 'text/plain', dataBase64: 'eA==' } })
    const response = await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/rework-cycles`, payload: { description: 'Нет', makeMode: 'whole_project', uploadIds: [upload.json().id], idempotencyKey: 'foreign' } })
    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('invalid_upload')
    expect(db.tasks.getTaskDetail('admin', project.id, task.id)?.columnId).toBe(done.id)
    expect(db.tasks.listTaskReworkCycles('admin', project.id, task.id)).toHaveLength(0)
  })

  // @testCase TC-INT-1
  it('атомарно сохраняет содержимое и возвращает задачу в preparation', async () => {
    const { project, task, preparation } = await reworkFixture()
    const upload = await inj(adminTok, { method: 'POST', url: '/api/uploads', payload: { name: 'proof.txt', mimeType: 'text/plain', dataBase64: 'cHJvb2Y=' } })
    const response = await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/rework-cycles`, payload: { description: 'Доработать', criteria: ['A', 'B'], makeMode: 'files', makePaths: ['src/A.ts'], uploadIds: [upload.json().id], idempotencyKey: 'atomic' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ sequence: 1, criteria: ['A', 'B'], attachments: [{ name: 'proof.txt' }] })
    expect(db.tasks.getTaskDetail('admin', project.id, task.id)?.columnId).toBe(preparation.id)
  })
})

describe('разовый прогон набора Automated QA', () => {
  it('без браузерного раннера отвечает 501 человеческим текстом, чужому проекту — 404', async () => {
    const project = await createProject('QA')
    const mine = await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/automated-qa/check`, payload: {} })
    expect(mine.statusCode).toBe(501)
    expect(mine.json()).toMatchObject({ error: 'browser_runner_unavailable' })
    expect(String((mine.json() as { message: string }).message)).toContain('Chromium')
    // Не участник не должен даже узнавать, что проект существует.
    const alien = await inj(bobTok, { method: 'POST', url: `/api/projects/${project.id}/automated-qa/check`, payload: {} })
    expect(alien.statusCode).toBe(404)
  })
})

describe('conversation preview URL REST', () => {
  it('хранит override, очищает его и принимает только http/https', async () => {
    const conv = db.chat.createConversation('admin', 'Preview')
    const url = `/api/conversations/${conv.id}/preview-url`
    const saved = await inj(adminTok, { method: 'POST', url, payload: { previewUrl: 'http://localhost:3000/path' } })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().previewUrl).toBe('http://localhost:3000/path')
    expect(db.chat.getConversation('admin', conv.id)?.previewUrl).toBe('http://localhost:3000/path')
    expect((await inj(adminTok, { method: 'POST', url, payload: { previewUrl: 'file:///tmp/x' } })).statusCode).toBe(400)
    expect((await inj(adminTok, { method: 'POST', url, payload: { previewUrl: null } })).json().previewUrl).toBeNull()
    expect((await inj(bobTok, { method: 'POST', url, payload: { previewUrl: 'https://example.com' } })).statusCode).toBe(404)
  })
})

describe('conversation status REST', () => {
  it('хранит статус, валидирует значение и изолирует владельца', async () => {
    const conv = db.chat.createConversation('admin', 'Статус')
    expect(conv.status).toBe('developing')

    const changed = await inj(adminTok, {
      method: 'POST',
      url: `/api/conversations/${conv.id}/status`,
      payload: { status: 'planning_done' }
    })
    expect(changed.statusCode).toBe(200)
    expect(changed.json().status).toBe('planning_done')
    expect(db.chat.getConversation('admin', conv.id)?.status).toBe('planning_done')

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

  it('свой проект создаёт любая роль и садится в нём владельцем', async () => {
    db.identity.createUser('tess', '', 'tester')
    db.identity.createUser('olga', '', 'observer')
    for (const [name, role] of [['bob', 'developer'], ['tess', 'tester'], ['olga', 'observer']] as const) {
      const token = signToken({ name, role }, SECRET)
      const created = await inj(token, { method: 'POST', url: '/api/projects', payload: { name: `Проект ${name}` } })
      expect(created.statusCode, `${role} должен создавать свой проект`).toBe(200)
      const detail = created.json() as ProjectDetail
      // Создатель — владелец: иначе он не сможет ни настроить проект, ни позвать участников.
      expect(detail.role).toBe('owner')
      expect(db.projects.isProjectOwner(name, detail.id)).toBe(true)
      // И проект виден ему в списке, а чужому — нет.
      expect(((await inj(token, { method: 'GET', url: '/api/projects' })).json() as ProjectSummary[]).map((x) => x.id)).toContain(detail.id)
      expect(((await inj(bobTok, { method: 'GET', url: '/api/projects' })).json() as ProjectSummary[]).map((x) => x.id).includes(detail.id)).toBe(name === 'bob')
    }
  })

  it('ограничивает число собственных проектов, освобождает слот после удаления и не ограничивает admin', async () => {
    const config = await inj(adminTok, { method: 'PUT', url: '/api/admin/signup', payload: { ownedProjectLimit: 2 } })
    expect(config.statusCode).toBe(200)
    expect(config.json().ownedProjectLimit).toBe(2)

    const first = await inj(bobTok, { method: 'POST', url: '/api/projects', payload: { name: 'Первый' } })
    const second = await inj(bobTok, { method: 'POST', url: '/api/projects', payload: { name: 'Второй' } })
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect((await inj(bobTok, { method: 'GET', url: '/api/projects/quota' })).json()).toEqual({ owned: 2, limit: 2, unlimited: false })

    const blocked = await inj(bobTok, { method: 'POST', url: '/api/projects', payload: { name: 'Лишний' } })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toMatch(/Достигнут лимит собственных проектов: 2/)

    expect((await inj(bobTok, { method: 'DELETE', url: `/api/projects/${first.json().id}` })).statusCode).toBe(200)
    expect((await inj(bobTok, { method: 'POST', url: '/api/projects', payload: { name: 'После удаления' } })).statusCode).toBe(200)

    for (let i = 0; i < 3; i += 1) {
      expect((await inj(adminTok, { method: 'POST', url: '/api/projects', payload: { name: `Админ ${i}` } })).statusCode).toBe(200)
    }
    expect((await inj(adminTok, { method: 'GET', url: '/api/projects/quota' })).json()).toEqual({ owned: 3, limit: 2, unlimited: true })
  })

  it('/api/projects/ со слешем в конце — 404 до авторизации, а не путь в обход матрицы прав', async () => {
    // projectPermissionForRequest такой URL не классифицирует; безопасно это лишь потому,
    // что Fastify поднят без ignoreTrailingSlash и роут не совпадает вовсе.
    expect((await inj(bobTok, { method: 'POST', url: '/api/projects/', payload: { name: 'X' } })).statusCode).toBe(404)
  })

  it('владелец-неадмин настраивает свой проект и зовёт участников, но в чужой не лезет', async () => {
    const carolTok = signToken({ name: 'carol', role: 'developer' }, SECRET)
    const mine = (await inj(bobTok, { method: 'POST', url: '/api/projects', payload: { name: 'Проект Боба' } })).json() as ProjectDetail
    expect((await inj(bobTok, { method: 'PATCH', url: `/api/projects/${mine.id}`, payload: { description: 'моё' } })).statusCode).toBe(200)
    expect((await inj(bobTok, { method: 'POST', url: `/api/projects/${mine.id}/members`, payload: { username: 'carol' } })).statusCode).toBe(200)
    // Участник (не владелец) настройки не меняет, хотя тоже developer.
    expect((await inj(carolTok, { method: 'PATCH', url: `/api/projects/${mine.id}`, payload: { description: 'чужое' } })).statusCode).toBe(403)
    // Админский проект бобу не подчиняется.
    const foreign = await createProject('Админский')
    expect((await inj(bobTok, { method: 'PATCH', url: `/api/projects/${foreign.id}`, payload: { description: 'чужое' } })).statusCode).toBe(403)
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

  it('production bootstrap: owner-guard 403, и валидация машины/gitUrl до дорогих шагов', async () => {
    const p = await createProject('Prod bootstrap')
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'bob' } })
    // member (не owner) → 403
    expect((await inj(bobTok, { method: 'POST', url: `/api/projects/${p.id}/production/bootstrap`, payload: { agentId: 'a1' } })).statusCode).toBe(403)
    // owner без agentId → 400
    const noAgent = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/production/bootstrap`, payload: {} })
    expect(noAgent.statusCode).toBe(400)
    expect(noAgent.json().error).toMatch(/машин/i)
    // owner с agentId, но у проекта нет gitUrl → 400 с понятной причиной
    const noGit = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/production/bootstrap`, payload: { agentId: 'a1' } })
    expect(noGit.statusCode).toBe(400)
    expect(noGit.json().error).toMatch(/gitUrl/i)
  })

  it('release branches объясняет неполную конфигурацию машины вместо ложного 404', async () => {
    const p = await createProject('Release target')
    const response = await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/releases/branches` })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: 'В настройках проекта не выбрана машина по умолчанию'
    })
  })

  it('список релизов возвращает только лёгкие строки, а шаги и логи — в detail', async () => {
    const p = await createProject('Release summaries')
    const release = db.releases.createProjectRelease('admin', p.id, { branch: 'release/1.2.3', version: '1.2.3', sha: 'abc', status: 'preparing' })
    db.releases.setProjectReleaseStep(release.id, 'regression', 'running', 'x'.repeat(100_000), 'admin')

    const listResponse = await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/releases` })
    expect(listResponse.statusCode).toBe(200)
    const [summary] = listResponse.json() as Array<Record<string, unknown>>
    expect(summary).toEqual(expect.objectContaining({ id: release.id, branch: 'release/1.2.3', sha: 'abc', status: 'preparing', previousReleaseId: null }))
    expect(summary).not.toHaveProperty('steps')
    expect(summary).not.toHaveProperty('triggeredBy')
    expect(listResponse.body.length).toBeLessThan(1_000)

    const detail = await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/releases/${release.id}` })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().steps.find((step: { kind: string }) => step.kind === 'regression').log).toHaveLength(100_000)
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
    expect((await inj(bobTok, { method: 'GET', url: `/api/projects/${p.id}/board/statuses` })).statusCode).toBe(404)
  })

  it('доска приезжает двумя фазами: скелет карточек и состояние процессов', async () => {
    const p = await createProject()
    const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    const created = (await inj(adminTok, {
      method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: board.columns[0].id, title: 'Фазы' }
    })).json() as Task

    const skeleton = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    const card = skeleton.tasks.find((t) => t.id === created.id)!
    expect(card.title).toBe('Фазы')
    expect(card.columnId).toBe(board.columns[0].id)
    // Первая фаза не ходит в раны и чаты — состояния в ней нет вовсе.
    expect(card.latestRunResult).toBeUndefined()
    expect(card.chatId).toBeUndefined()
    expect(skeleton.ciRuns).toBeUndefined()

    const statuses = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board/statuses` })).json() as BoardStatuses
    expect(statuses.tasks.map((t) => t.taskId)).toEqual(skeleton.tasks.map((t) => t.id))
    const status = statuses.tasks.find((t) => t.taskId === created.id)!
    expect(status.latestRunResult).toBeNull()
    expect(status.mergePermitted).toBe(true)
    expect(statuses.ciRuns).toEqual([])
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

  it('назначает нескольких владельцев, защищает последнего и не повышает глобального admin', async () => {
    const p = await createProject()
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'bob' } })

    const promoted = await inj(adminTok, {
      method: 'PATCH', url: `/api/projects/${p.id}/members/bob`, payload: { role: 'owner' }
    })
    expect(promoted.statusCode).toBe(200)
    expect((promoted.json() as ProjectDetail).members.filter((m) => m.role === 'owner')).toHaveLength(2)
    expect((await inj(bobTok, {
      method: 'PATCH', url: `/api/projects/${p.id}`, payload: { description: 'второй владелец' }
    })).statusCode).toBe(200)
    const bobMachine = db.machines.createAgent('bob', 'Bob Mac')
    expect((await inj(bobTok, {
      method: 'POST', url: `/api/projects/${p.id}/machines`, payload: { agentId: bobMachine.id }
    })).statusCode).toBe(200)

    const changedByBob = await inj(bobTok, {
      method: 'PATCH', url: `/api/projects/${p.id}/members/admin`, payload: { role: 'member' }
    })
    expect(changedByBob.statusCode).toBe(200)
    const lastOwner = await inj(bobTok, {
      method: 'DELETE', url: `/api/projects/${p.id}/members/bob`
    })
    expect(lastOwner.statusCode).toBe(400)
    expect(lastOwner.json().error).toContain('Сначала назначьте другого владельца')

    const foreign = db.projects.createProject('carol', { name: 'Чужой проект' })
    expect((await inj(adminTok, {
      method: 'PATCH', url: `/api/projects/${foreign.id}`, payload: { name: 'admin не владелец' }
    })).statusCode).toBe(403)
  })

  it('не назначает владельцем пользователя до добавления в проект', async () => {
    const p = await createProject()
    const response = await inj(adminTok, {
      method: 'PATCH', url: `/api/projects/${p.id}/members/bob`, payload: { role: 'owner' }
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('Сначала добавьте')
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
    const conversation = db.chat.createConversation('admin', 'Inherited preview')
    db.chat.setConversationProject('admin', conversation.id, p.id)
    expect(db.chat.getConversation('admin', conversation.id)?.projectPreviewUrl).toBe('https://example.com/app')
    expect((await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { previewUrl: 'javascript:alert(1)' } })).statusCode).toBe(400)
    expect((await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { previewUrl: null } })).json().previewUrl).toBeNull()
  })
})

describe('projects REST: тип проекта и гейт возможностей', () => {
  it('каталог типов отдаёт встроенное дерево', async () => {
    const res = await inj(bobTok, { method: 'GET', url: '/api/project-types' })
    expect(res.statusCode).toBe(200)
    const types = res.json() as Array<{ id: string; name: string; builtin: boolean }>
    expect(types.map((t) => t.id).sort()).toEqual(Object.values(BUILTIN_PROJECT_TYPE_IDS).sort())
  })

  it('проект создаётся с подтипом, тип виден в ответе', async () => {
    const res = await inj(bobTok, { method: 'POST', url: '/api/projects', payload: { name: 'Веб', typeId: BUILTIN_PROJECT_TYPE_IDS.web } })
    expect(res.statusCode).toBe(200)
    const detail = res.json() as ProjectDetail
    expect(detail.typeId).toBe(BUILTIN_PROJECT_TYPE_IDS.web)
    expect(detail.typeChain.label).toBe('Разработка ПО / Веб-приложение')
  })

  it('несуществующий и чужой личный тип отклоняются', async () => {
    expect((await inj(bobTok, { method: 'POST', url: '/api/projects', payload: { name: 'X', typeId: 'нет-такого' } })).statusCode).toBe(400)
    // Личный узел Кэрол Бобу недоступен, хотя id известен.
    const carolTok = signToken({ name: 'carol', role: 'developer' }, SECRET)
    const own = (await inj(carolTok, { method: 'POST', url: '/api/project-types', payload: { name: 'Личный Кэрол' } })).json() as { id: string }
    expect((await inj(bobTok, { method: 'POST', url: '/api/projects', payload: { name: 'X', typeId: own.id } })).statusCode).toBe(400)
  })

  it('в «Общем проекте» выключенные подсистемы отвечают 409, а доска работает', async () => {
    const p = (await inj(bobTok, { method: 'POST', url: '/api/projects', payload: { name: 'Общий', typeId: BUILTIN_PROJECT_TYPE_IDS.general } })).json() as ProjectDetail
    const blocked: Array<[('GET' | 'POST'), string]> = [
      ['GET', `/api/projects/${p.id}/releases`],
      ['POST', `/api/projects/${p.id}/releases/branches`],
      ['GET', `/api/projects/${p.id}/machines/available`],
      ['GET', `/api/projects/${p.id}/ci`]
    ]
    for (const [method, url] of blocked) {
      const res = await inj(bobTok, { method, url, payload: method === 'POST' ? {} : undefined })
      expect(res.statusCode, `${method} ${url}`).toBe(409)
      expect(res.json()).toMatchObject({ error: 'feature_unavailable' })
    }
    // Доска и задачи к возможностям не привязаны и обязаны работать.
    const board = (await inj(bobTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(board.columns.map((c) => c.semanticType)).toEqual(['backlog', 'development', 'done', 'cancelled', 'decision_required'])
    expect((await inj(bobTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: board.columns[0].id, title: 'Задача' } })).statusCode).toBe(200)
  })

  it('в проекте «Разработка ПО» те же адреса не блокируются гейтом возможностей', async () => {
    const p = await createProject('Полный')
    // 409 быть не должно: важен именно код гейта, остальные ответы зависят от машин.
    for (const url of [`/api/projects/${p.id}/releases`, `/api/projects/${p.id}/ci`, `/api/projects/${p.id}/machines/available`]) {
      expect((await inj(adminTok, { method: 'GET', url })).statusCode, url).not.toBe(409)
    }
  })

  it('смена типа немедленно закрывает подсистему у существующего проекта', async () => {
    const p = await createProject('Был разработкой')
    expect((await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/releases` })).statusCode).not.toBe(409)
    const patched = await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}`, payload: { typeId: BUILTIN_PROJECT_TYPE_IDS.general } })
    expect(patched.statusCode).toBe(200)
    expect((patched.json() as ProjectDetail).typeChain.features.releases).toBe(false)
    expect((await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/releases` })).statusCode).toBe(409)
  })
})

describe('projects REST: доска', () => {
  it('колонки: reorder не перехватывается :columnId; hidden; delete', async () => {
    const p = await createProject()
    let board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(board.columns.map((c) => c.name)).toEqual(['Бэклог', 'Подготовка к разработке', 'Ready for Development', 'Development', 'Component QA', 'Создание интеграционных автотестов', 'Automated QA', 'Ручное QA', 'Ожидает мержа', 'Мерж', 'Готово', 'Отменено', 'Требуется решение'])

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
    expect(a).toMatchObject({ createdBy: 'admin', createdByName: 'admin', assignee: 'admin' })

    const forged = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: todo.id, title: 'Forged', createdBy: 'bob' } })
    expect(forged.statusCode).toBe(400)
    expect(((await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board).tasks.some((task) => task.title === 'Forged')).toBe(false)

    const idemOptions = { method: 'POST' as const, url: `/api/projects/${p.id}/tasks`, headers: { 'idempotency-key': 'same-request' }, payload: { columnId: todo.id, title: 'Once' } }
    const idemFirst = (await inj(adminTok, idemOptions)).json() as Task
    const idemSecond = (await inj(adminTok, idemOptions)).json() as Task
    expect(idemSecond.id).toBe(idemFirst.id)

    // assignee не участник → 400; активный участник ok; блокированный участник → 400
    expect((await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: todo.id, title: 'C', assignee: 'bob' } })).statusCode).toBe(400)
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'bob' } })
    const assigned = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: todo.id, title: 'C', assignee: 'bob' } })
    expect(assigned.statusCode).toBe(200)
    expect((assigned.json() as Task).assignee).toBe('bob')
    const automatic = await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: todo.id, title: 'D', assignee: null } })
    expect(automatic.statusCode).toBe(200)
    expect((automatic.json() as Task).assignee).toBe('admin')
    db.identity.setUserBlocked('bob', true)
    expect((await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: todo.id, title: 'E', assignee: 'bob' } })).statusCode).toBe(400)
    db.identity.setUserBlocked('bob', false)

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

describe('активность карточки: комментарии, ворклог, история', () => {
  it('полный цикл: комментарий добавляется, правится, удаляется; история пишется', async () => {
    const project = await createProject('Активность')
    const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/board` })).json() as Board
    const task = (await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: { columnId: board.columns[0]!.id, title: 'С активностью' } })).json() as Task

    const added = (await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/comments`, payload: { text: 'Первый комментарий' } })).json()
    expect(added.author).toBe('admin')

    await inj(adminTok, { method: 'PATCH', url: `/api/projects/${project.id}/tasks/${task.id}/comments/${added.id}`, payload: { text: 'Поправленный' } })
    await inj(adminTok, { method: 'PATCH', url: `/api/projects/${project.id}/tasks/${task.id}`, payload: { title: 'Переименована' } })
    await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/worklog`, payload: { minutes: 90, comment: 'вёрстка' } })

    const activity = (await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/tasks/${task.id}/activity` })).json()
    expect(activity.comments[0]).toMatchObject({ text: 'Поправленный' })
    expect(activity.comments[0].updatedAt).not.toBeNull()
    expect(activity.history.some((event: { field: string; to: string }) => event.field === 'title' && event.to === 'Переименована')).toBe(true)
    expect(activity.totalMinutes).toBe(90)

    const del = await inj(adminTok, { method: 'DELETE', url: `/api/projects/${project.id}/tasks/${task.id}/comments/${added.id}` })
    expect(del.json()).toEqual({ ok: true })
  })

  it('чужой комментарий участнику не правится — 403 словами', async () => {
    const project = await createProject('Права активности')
    await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/members`, payload: { username: 'bob' } })
    const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/board` })).json() as Board
    const task = (await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: { columnId: board.columns[0]!.id, title: 'Чужая' } })).json() as Task
    const comment = (await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/comments`, payload: { text: 'От владельца' } })).json()

    const blocked = await inj(bobTok, { method: 'PATCH', url: `/api/projects/${project.id}/tasks/${task.id}/comments/${comment.id}`, payload: { text: 'взлом' } })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error).toContain('автор, владелец')
  })
})

describe('автосвязь задачи с Make-проектом источника', () => {
  // Ошибка, с которой начался фикс: задача создавалась из Make-чата без связи
  // task_designs, подготовка не получала файлы макета и блокировалась вопросом
  // «критичный источник истины недоступен» про опубликованный URL.
  it('задача из Make-чата получает whole_project-связь, из обычного чата — нет', async () => {
    const project = await createProject('Автосвязь')
    const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/board` })).json() as Board
    const column = board.columns[0]!
    const makeChat = db.chat.createConversation('admin', 'Проект 14', 'make', project.id)!
    const plainChat = db.chat.createConversation('admin', 'Обычный', null, project.id)!

    const linked = (await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: {
      columnId: column.id, title: 'Карточка из Make', sourceConversationId: makeChat.id
    } })).json() as Task
    expect(linked.designs?.map((design) => [design.conversationId, design.mode])).toEqual([[makeChat.id, 'whole_project']])

    // Обычный чат — источник без макета: задача создаётся без связи и без ошибки.
    const plain = (await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: {
      columnId: column.id, title: 'Карточка из чата', sourceConversationId: plainChat.id
    } })).json() as Task
    expect(plain.designs ?? []).toEqual([])

    // Make-чат чужого проекта тоже не даёт связи: линк проверяет принадлежность.
    const other = await createProject('Чужой')
    const foreignMake = db.chat.createConversation('admin', 'Чужой Make', 'make', other.id)!
    const foreign = (await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: {
      columnId: column.id, title: 'Карточка с чужим Make', sourceConversationId: foreignMake.id
    } })).json() as Task
    expect(foreign.designs ?? []).toEqual([])
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
    const agent = db.machines.createAgent('admin', 'M1')
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

  it('владелец настраивает собственную машину без предоставления проекту', async () => {
    const p = await createProject()
    const agent = db.machines.createAgent('admin', 'Private Mac')

    expect((await inj(adminTok, {
      method: 'PATCH', url: `/api/projects/${p.id}/machines/${agent.id}`, payload: { path: '/private/project' }
    })).statusCode).toBe(200)
    expect((await inj(adminTok, {
      method: 'PATCH', url: `/api/projects/${p.id}/machines/${agent.id}`, payload: { reposRoot: '/private/repos' }
    })).statusCode).toBe(200)
    const configured = await inj(adminTok, {
      method: 'PATCH', url: `/api/projects/${p.id}/machines/${agent.id}`,
      payload: { sshHost: 'private-mac.local', sshUser: 'runner' }
    })
    expect(configured.statusCode).toBe(200)
    expect((configured.json() as ProjectDetail).machines.find((machine) => machine.agentId === agent.id)).toMatchObject({
      path: '/private/project', reposRoot: '/private/repos', sshHost: 'private-mac.local', sshUser: 'runner', sharedWithProject: false
    })
    expect(db.machines.isMachineSharedWithProject(p.id, agent.id)).toBe(false)
  })

  it('список доступен участнику, повторная привязка конфликтует, а управление запрещено', async () => {
    const p = await createProject()
    const agent = db.machines.createAgent('admin', 'Shared Mac')
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

  it('создание разговора атомарно сохраняет доступный projectId и отвергает чужой', async () => {
    const p = await createProject('Conversation project')
    const created = await inj(adminTok, { method: 'POST', url: '/api/conversations', payload: { title: 'Проектный', projectId: p.id } })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ title: 'Проектный', projectId: p.id })
    expect(db.chat.getConversation('admin', created.json().id)?.projectId).toBe(p.id)

    const before = db.chat.listConversations('bob').length
    const denied = await inj(bobTok, { method: 'POST', url: '/api/conversations', payload: { title: 'Чужой', projectId: p.id } })
    expect(denied.statusCode).toBe(404)
    expect(db.chat.listConversations('bob')).toHaveLength(before)

    const plain = await inj(bobTok, { method: 'POST', url: '/api/conversations', payload: { title: 'Без проекта' } })
    expect(plain.statusCode).toBe(200)
    expect(plain.json().projectId).toBeNull()
  })

  it('привязка чата к проекту сохраняет наследование машины и навыки; не-участник → 404', async () => {
    const create = await inj(adminTok, { method: 'POST', url: '/api/projects', payload: { name: 'P', skills: ['ts'] } })
    const p = create.json() as ProjectDetail
    const agent = db.machines.createAgent('admin', 'M1')
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/machines`, payload: { agentId: agent.id } })
    await inj(adminTok, { method: 'PATCH', url: `/api/projects/${p.id}/machines/${agent.id}`, payload: { path: '/srv/p' } })
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/default-machine`, payload: { agentId: agent.id } })
    const conv = db.chat.createConversation('admin', 'Chat')
    const linked = await inj(adminTok, { method: 'POST', url: `/api/conversations/${conv.id}/project`, payload: { projectId: p.id } })
    expect(linked.statusCode).toBe(200)
    const c = linked.json() as { execTarget: string | null; workdir: string | null; skillNames: string[]; projectId?: string | null }
    expect(c.projectId).toBe(p.id)
    expect(c.execTarget).toBeNull()
    expect(c.workdir).toBeNull()
    expect(c.skillNames).toEqual(['ts'])
    // не-участник bob не может привязать свой чат к чужому проекту
    const convBob = db.chat.createConversation('bob', 'Chat bob')
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
    const agent = db.machines.createAgent('admin', 'Merge machine')
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
    const workspace = db.ci.createCiWorkspace({ projectId: p.id, taskId: task.id, agentId: agent.id, path: '/work/task' })
    db.ci.recordCiWorkspaceRevision(workspace.id, 'feature/task', 'abc123')
    await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks/${task.id}/move`, payload: { columnId: awaiting.id } })
    const blocked = await inj(bobTok, { method: 'POST', url, payload: {} })
    expect(blocked.statusCode).toBe(400)
    expect(blocked.json().error).toMatch(/не в сети/)
    const refreshed = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    expect(refreshed.tasks.find((item) => item.id === task.id)?.columnId).toBe(awaiting.id)
    expect(refreshed.tasks.find((item) => item.id === task.id)?.columnId).not.toBe(merge.id)
  })
})

describe('widget tool gateway', () => {
  it('предпочитает UI, делает API-fallback и применяет подтверждённый action идемпотентно', async () => {
    const p = await createProject('Widgets')
    const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${p.id}/board` })).json() as Board
    const task = (await inj(adminTok, { method: 'POST', url: `/api/projects/${p.id}/tasks`, payload: { columnId: board.columns[0].id, title: 'API card' } })).json() as Task
    const conversation = db.chat.ensureKanbanAssistantConversation('admin', p.id)!
    const userTurn = db.chat.addMessage('admin', conversation.id, 'u0', 'Найди UI', '12:00')
    const proposalTurn = db.chat.addMessage('admin', conversation.id, 'ai', 'proposal', '12:01')
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

describe('вид доски (личная настройка участника)', () => {
  it('пустой по умолчанию, патч мержится, мусор отбрасывается', async () => {
    const project = (await inj(adminTok, { method: 'POST', url: '/api/projects', payload: { name: 'Вид' } })).json()

    expect((await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/board/view` })).json())
      .toMatchObject({ swimlane: 'none', showHidden: false, onlyMine: false, assignees: [] })

    await inj(adminTok, { method: 'PUT', url: `/api/projects/${project.id}/board/view`, payload: { swimlane: 'assignee', onlyMine: true } })
    const patched = (await inj(adminTok, { method: 'PUT', url: `/api/projects/${project.id}/board/view`, payload: { showHidden: true, swimlane: 'мусор', hack: 1 } })).json()

    // Патч не сбрасывает соседние поля, а значение не из набора не сохраняется.
    expect(patched).toMatchObject({ swimlane: 'assignee', onlyMine: true, showHidden: true })
    expect(patched).not.toHaveProperty('hack')
  })

  it('вид у каждого свой и чужому проекту не отдаётся', async () => {
    const project = (await inj(adminTok, { method: 'POST', url: '/api/projects', payload: { name: 'Чужой вид' } })).json()
    await inj(adminTok, { method: 'PUT', url: `/api/projects/${project.id}/board/view`, payload: { onlyMine: true } })
    db.identity.createUser('outsider', 'password-outsider', 'developer')
    const outsiderTok = signToken({ name: 'outsider', role: 'developer' }, SECRET)

    const foreign = await inj(outsiderTok, { method: 'GET', url: `/api/projects/${project.id}/board/view` })

    expect(foreign.statusCode).toBe(404)
    expect((await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/board/view` })).json().onlyMine).toBe(true)
  })
})

describe('дизайны карточки: REST', () => {
  /** Проект с задачей и Make-чатом, привязанным к тому же проекту. */
  async function designScene(): Promise<{ project: ProjectDetail; taskId: string; makeId: string }> {
    const project = await createProject('Design')
    const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/board` })).json() as Board
    const task = (await inj(adminTok, {
      method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: { columnId: board.columns[0].id, title: 'Экран оплаты' }
    })).json() as Task
    const make = db.chat.createConversation('admin', 'Проект 1', 'make')
    db.chat.setConversationProject('admin', make.id, project.id)
    return { project, taskId: task.id, makeId: make.id }
  }

  it('связывает карточку со страницей, отдаёт её в списке источников и снимает связь', async () => {
    const { project, taskId, makeId } = await designScene()

    const sources = await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/design-sources` })
    expect(sources.json()).toMatchObject([{ conversationId: makeId, title: 'Проект 1', own: true }])

    const linked = await inj(adminTok, {
      method: 'POST', url: `/api/projects/${project.id}/tasks/${taskId}/designs`,
      payload: { conversationId: makeId, path: 'pay.html', label: 'Оплата' }
    })
    expect(linked.statusCode).toBe(200)
    const links = linked.json() as Array<{ id: string; path: string }>
    expect(links).toHaveLength(1)
    expect(links[0].path).toBe('pay.html')

    const listed = await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/tasks/${taskId}/designs` })
    expect(listed.json()).toHaveLength(1)

    const removed = await inj(adminTok, { method: 'DELETE', url: `/api/projects/${project.id}/tasks/${taskId}/designs/${links[0].id}` })
    expect(removed.json()).toEqual([])
  })

  it('изолирует источники по владельцу сессии и запрещает прямую связь с чужим Make-проектом', async () => {
    const { project, taskId, makeId } = await designScene()
    db.projects.addMember('admin', project.id, 'bob')
    const bobFirst = db.chat.createConversation('bob', 'Bob 1', 'make')
    db.chat.setConversationProject('bob', bobFirst.id, project.id)
    const bobSecond = db.chat.createConversation('bob', 'Bob 2', 'make')
    db.chat.setConversationProject('bob', bobSecond.id, project.id)

    const adminSources = await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/design-sources?userId=bob&owner=bob` })
    expect(adminSources.json()).toMatchObject([{ conversationId: makeId, own: true }])
    const bobSources = await inj(bobTok, { method: 'GET', url: `/api/projects/${project.id}/design-sources?userId=admin` })
    expect(bobSources.json()).toMatchObject([
      { conversationId: bobSecond.id, own: true },
      { conversationId: bobFirst.id, own: true }
    ])

    const rejected = await inj(bobTok, {
      method: 'POST',
      url: `/api/projects/${project.id}/tasks/${taskId}/designs`,
      payload: { conversationId: makeId }
    })
    expect(rejected.statusCode).toBe(400)
    expect(String((rejected.json() as { error: string }).error)).toContain('только свой')
    expect(db.tasks.listTaskDesigns('bob', project.id, taskId)).toEqual([])
  })

  it('чужой Make-проект и не-Make чат отклоняются с объяснением, посторонний получает 404', async () => {
    const { project, taskId } = await designScene()
    const foreign = db.chat.createConversation('admin', 'Чужой макет', 'make')
    const rejected = await inj(adminTok, {
      method: 'POST', url: `/api/projects/${project.id}/tasks/${taskId}/designs`, payload: { conversationId: foreign.id }
    })
    expect(rejected.statusCode).toBe(400)
    expect(String((rejected.json() as { error: string }).error)).toContain('не привязан')

    const alien = await inj(bobTok, { method: 'GET', url: `/api/projects/${project.id}/tasks/${taskId}/designs` })
    expect(alien.statusCode).toBe(404)
  })

  it('панель Make видит связанные карточки и связывает новую со своей страницей', async () => {
    const { project, taskId, makeId } = await designScene()
    const created = await inj(adminTok, {
      method: 'POST', url: `/api/make/${makeId}/task-links`, payload: { taskId, path: 'pay.html' }
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject([{ taskId, path: 'pay.html', taskKey: 'DESI-1' }])

    const filtered = await inj(adminTok, { method: 'GET', url: `/api/make/${makeId}/task-links?path=index.html` })
    expect(filtered.json()).toEqual([])

    const tasks = await inj(adminTok, { method: 'GET', url: `/api/make/${makeId}/task-links/tasks` })
    expect(tasks.json()).toMatchObject([{ taskId, title: 'Экран оплаты' }])

    // Посторонний не должен даже узнать о существовании Make-проекта.
    const alien = await inj(bobTok, { method: 'GET', url: `/api/make/${makeId}/task-links` })
    expect(alien.statusCode).toBe(404)
    void project
  })
})

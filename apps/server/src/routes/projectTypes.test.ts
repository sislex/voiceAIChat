import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'
import { BUILTIN_PROJECT_TYPE_IDS, type ProjectTypeNode } from '@voicechat/shared'

const SECRET = 'test-secret'
let app: FastifyInstance
let db: VoiceChatDb
let adminTok: string
let bobTok: string
let carolTok: string

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
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-ptypes-${Date.now()}-${id}`) }),
    db,
    sessionSecret: SECRET
  })
  adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
  bobTok = signToken({ name: 'bob', role: 'developer' }, SECRET)
  carolTok = signToken({ name: 'carol', role: 'developer' }, SECRET)
})
afterEach(async () => {
  await app.close()
  db.close()
})

const create = async (token: string, payload: object): Promise<ProjectTypeNode> => {
  const res = await inj(token, { method: 'POST', url: '/api/project-types', payload })
  expect(res.statusCode).toBe(200)
  return res.json() as ProjectTypeNode
}

describe('каталог типов: чтение и создание', () => {
  it('любой вошедший видит встроенное дерево и заводит свой узел', async () => {
    const own = await create(bobTok, { name: 'Мой подтип', parentId: BUILTIN_PROJECT_TYPE_IDS.software })
    expect(own.status).toBe('private')
    expect(own.ownerId).toBe('bob')
    expect((await inj(bobTok, { method: 'GET', url: '/api/project-types' })).json().map((t: ProjectTypeNode) => t.id)).toContain(own.id)
    // Чужой личный узел не виден ни в каталоге, ни поштучно.
    expect((await inj(carolTok, { method: 'GET', url: '/api/project-types' })).json().map((t: ProjectTypeNode) => t.id)).not.toContain(own.id)
    expect((await inj(carolTok, { method: 'GET', url: `/api/project-types/${own.id}` })).statusCode).toBe(404)
  })

  it('пустое имя и невидимый родитель отклоняются', async () => {
    expect((await inj(bobTok, { method: 'POST', url: '/api/project-types', payload: { name: '  ' } })).statusCode).toBe(400)
    const carolOwn = await create(carolTok, { name: 'Кэрол' })
    expect((await inj(bobTok, { method: 'POST', url: '/api/project-types', payload: { name: 'X', parentId: carolOwn.id } })).statusCode).toBe(400)
  })

  it('переопределение возможностей чистится от мусора', async () => {
    const own = await create(bobTok, { name: 'Без релизов', features: { releases: false, wat: true, ci: 'yes' } })
    expect(own.features).toEqual({ releases: false })
  })
})

describe('каталог типов: правка и удаление', () => {
  it('чужой узел не правится и не удаляется', async () => {
    const own = await create(bobTok, { name: 'Мой' })
    expect((await inj(carolTok, { method: 'PATCH', url: `/api/project-types/${own.id}`, payload: { name: 'Чужое' } })).statusCode).toBe(404)
    expect((await inj(carolTok, { method: 'DELETE', url: `/api/project-types/${own.id}` })).statusCode).toBe(404)
  })

  it('встроенный узел не правится даже админом', async () => {
    const res = await inj(adminTok, { method: 'PATCH', url: `/api/project-types/${BUILTIN_PROJECT_TYPE_IDS.general}`, payload: { name: 'Другое' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/встроенн/i)
  })

  it('удаление узла с проектами — 409 с понятной причиной', async () => {
    const own = await create(bobTok, { name: 'Используемый' })
    await inj(bobTok, { method: 'POST', url: '/api/projects', payload: { name: 'P', typeId: own.id } })
    const res = await inj(bobTok, { method: 'DELETE', url: `/api/project-types/${own.id}` })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/используют проекты/i)
  })

  it('цикл в дереве отклоняется', async () => {
    const parent = await create(bobTok, { name: 'Родитель' })
    const child = await create(bobTok, { name: 'Ребёнок', parentId: parent.id })
    const res = await inj(bobTok, { method: 'PATCH', url: `/api/project-types/${parent.id}`, payload: { parentId: child.id } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/потомком самого себя/i)
  })
})

describe('публикация типа', () => {
  it('автор отправляет на утверждение, админ утверждает, узел становится общим', async () => {
    const own = await create(bobTok, { name: 'Общий кандидат' })
    expect((await inj(bobTok, { method: 'POST', url: `/api/project-types/${own.id}/publish` })).json().status).toBe('pending')

    // Очередь видна только админу.
    expect((await inj(bobTok, { method: 'GET', url: '/api/admin/project-types' })).statusCode).toBe(403)
    const queue = (await inj(adminTok, { method: 'GET', url: '/api/admin/project-types' })).json() as ProjectTypeNode[]
    expect(queue.map((t) => t.id)).toEqual([own.id])

    const approved = await inj(adminTok, { method: 'POST', url: `/api/admin/project-types/${own.id}/review`, payload: { decision: 'approve' } })
    expect(approved.json().status).toBe('published')
    expect((await inj(carolTok, { method: 'GET', url: '/api/project-types' })).json().map((t: ProjectTypeNode) => t.id)).toContain(own.id)
  })

  it('отказ сохраняет причину, автор может поправить и отправить снова', async () => {
    const own = await create(bobTok, { name: 'Кандидат' })
    await inj(bobTok, { method: 'POST', url: `/api/project-types/${own.id}/publish` })
    const rejected = await inj(adminTok, { method: 'POST', url: `/api/admin/project-types/${own.id}/review`, payload: { decision: 'reject', note: 'слишком узкий' } })
    expect(rejected.json()).toMatchObject({ status: 'rejected', reviewNote: 'слишком узкий' })
    expect((await inj(bobTok, { method: 'PATCH', url: `/api/project-types/${own.id}`, payload: { name: 'Кандидат 2' } })).statusCode).toBe(200)
    expect((await inj(bobTok, { method: 'POST', url: `/api/project-types/${own.id}/publish` })).json().status).toBe('pending')
  })

  it('опубликованный узел автор больше не правит, но может создать под ним ребёнка', async () => {
    const own = await create(bobTok, { name: 'Опубликованный' })
    await inj(bobTok, { method: 'POST', url: `/api/project-types/${own.id}/publish` })
    await inj(adminTok, { method: 'POST', url: `/api/admin/project-types/${own.id}/review`, payload: { decision: 'approve' } })

    expect((await inj(bobTok, { method: 'PATCH', url: `/api/project-types/${own.id}`, payload: { name: 'Правка' } })).statusCode).toBe(404)
    expect((await inj(adminTok, { method: 'PATCH', url: `/api/project-types/${own.id}`, payload: { name: 'Правка админом' } })).statusCode).toBe(200)
    expect((await inj(bobTok, { method: 'POST', url: '/api/project-types', payload: { name: 'Ребёнок', parentId: own.id } })).statusCode).toBe(200)
  })

  it('нельзя вынести на публикацию узел с приватным предком', async () => {
    const parent = await create(bobTok, { name: 'Личный родитель' })
    const child = await create(bobTok, { name: 'Ребёнок', parentId: parent.id })
    const res = await inj(bobTok, { method: 'POST', url: `/api/project-types/${child.id}/publish` })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/родительск/i)
  })

  it('решение принимает только admin и только валидное', async () => {
    const own = await create(bobTok, { name: 'X' })
    await inj(bobTok, { method: 'POST', url: `/api/project-types/${own.id}/publish` })
    expect((await inj(carolTok, { method: 'POST', url: `/api/admin/project-types/${own.id}/review`, payload: { decision: 'approve' } })).statusCode).toBe(403)
    expect((await inj(adminTok, { method: 'POST', url: `/api/admin/project-types/${own.id}/review`, payload: { decision: 'может быть' } })).statusCode).toBe(400)
  })
})

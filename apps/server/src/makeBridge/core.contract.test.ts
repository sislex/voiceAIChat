// Контракт порта MakeCore: один набор проверок для двух реализаций — LocalMakeCore над db.* в
// процессе ядра и HttpMakeCore, который ходит к тому же LocalMakeCore через `/internal/make/core`.
// Если реализации расходятся, отдельный процесс Make видит не те данные, что встроенный.
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpMakeCore, MakeHub, INTERNAL_MAKE_EVENTS_PATH, INTERNAL_WHOAMI_PATH, type MakeCore } from '@voicechat/make'
import { VoiceChatDb } from '../db/database.js'
import { registerInternalRoutes } from '../routes/internal.js'
import { LocalMakeCore } from './localCore.js'

const headersOf = (init: RequestInit['headers']): Record<string, string> => { const out: Record<string, string> = {}; new Headers(init).forEach((v, k) => { out[k] = v }); return out }

const TOKEN = 'internal-token'
type Mode = 'local' | 'http'

async function seed(db: VoiceChatDb) {
  for (const [name, role] of [['ann', 'developer'], ['bob', 'developer'], ['eve', 'developer']] as const) await db.identity.createUser(name, '', role)
  const project = await db.projects.createProject('ann', { name: 'Проект' })
  await db.projects.addMember('ann', project.id, 'bob')
  const conv = (await db.chat.createConversation('ann', 'Витрина', 'make', project.id))!
  const personal = (await db.chat.createConversation('ann', 'Личный', 'make', null))!
  const board = (await db.tasks.getBoard('ann', project.id))!
  const task = (await db.tasks.createTask('ann', project.id, { columnId: board.columns[0]!.id, title: 'Задача с макетом' }))!
  return { project, conv, personal, task }
}

async function setup(mode: Mode) {
  const db = new VoiceChatDb(':memory:')
  const seeded = await seed(db)
  const boardChanged = vi.fn()
  const machineFs = {
    list: async (agentId: string, path: string) => ({ root: '/r', cwd: path, entries: [{ name: agentId, kind: 'file' as const, size: 1, mtime: 0 }] }),
    read: async () => ({ root: '/r', cwd: '/r/a', dataBase64: 'YQ==' }),
    isOnline: (agentId: string) => agentId === 'online'
  }
  const local = new LocalMakeCore({ db, machineFs, boardChanged })
  const hub = new MakeHub()
  const app = Fastify()
  registerInternalRoutes(app, { token: TOKEN, makeCore: local, makeHub: hub, authenticate: async (req) => req.headers.authorization === 'Bearer good' ? { ok: true, user: { name: 'ann', role: 'developer' } } : { ok: false, status: 401, error: 'unauthorized' } })
  await app.ready()
  const fetchImpl: typeof fetch = async (input, init) => {
    const res = await app.inject({ method: 'POST', url: new URL(String(input)).pathname, headers: headersOf(init?.headers), payload: String(init?.body) })
    return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } })
  }
  const core: MakeCore = mode === 'local' ? local : new HttpMakeCore({ coreUrl: 'http://core.test', token: TOKEN, fetchImpl })
  return { db, app, core, hub, boardChanged, ...seeded }
}

const closers: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })
const keep = (s: { app: FastifyInstance; db: VoiceChatDb }) => closers.push(async () => { await s.app.close(); s.db.close() })

describe.each<Mode>(['local', 'http'])('MakeCore (%s)', (mode) => {
  it('разговор, владелец, проект и членство', async () => {
    const s = await setup(mode); keep(s)
    expect(await s.core.conversation('ann', s.conv.id)).toMatchObject({ id: s.conv.id, assistantKind: 'make', projectId: s.project.id })
    expect(await s.core.conversation('eve', s.conv.id)).toBeNull()
    expect(await s.core.conversationOwner(s.conv.id)).toBe('ann')
    expect(await s.core.conversationOwner('missing')).toBeNull()
    expect(await s.core.conversationProject(s.conv.id)).toBe(s.project.id)
    expect(await s.core.conversationProject(s.personal.id)).toBeNull()
    expect(await s.core.isProjectViewer('bob', s.conv.id)).toBe(true)
    expect(await s.core.isProjectViewer('eve', s.conv.id)).toBe(false)
    expect((await s.core.makeConversationIdsOf('ann')).sort()).toEqual([s.conv.id, s.personal.id].sort())
    expect(await s.core.makeConversationIdsOf('eve')).toEqual([])
    expect((await s.core.project('ann', s.project.id))?.name).toBe('Проект')
    expect(await s.core.project('eve', s.project.id)).toBeNull()
    expect(await s.core.userExists('bob')).toBe(true)
    expect(await s.core.userExists('nobody')).toBe(false)
  })

  it('связи дизайна с карточкой: link → taskLinks/taskDesigns → unlink, доска оживает', async () => {
    const s = await setup(mode); keep(s)
    expect((await s.core.linkableTasks('ann', s.conv.id)).map((t) => t.taskId)).toEqual([s.task.id])
    expect(await s.core.taskLinks(s.conv.id)).toEqual([])
    await s.core.linkTaskDesign('ann', s.project.id, s.task.id, { conversationId: s.conv.id, path: 'index.html', label: 'Главная' })
    const links = await s.core.taskLinks(s.conv.id)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ taskId: s.task.id })
    expect(await s.core.taskLinks(s.conv.id, 'other.html')).toEqual([])
    expect((await s.core.taskDesigns('ann', s.project.id, s.task.id))?.map((d) => d.conversationId)).toEqual([s.conv.id])
    expect(await s.core.taskDesigns('ann', s.project.id, 'missing')).toBeNull()
    await expect(s.core.linkTaskDesign('ann', s.project.id, 'missing', { conversationId: s.conv.id })).rejects.toThrow()
    await s.core.unlinkTaskDesign('ann', s.project.id, s.task.id, links[0]!.id)
    expect(await s.core.taskLinks(s.conv.id)).toEqual([])
    s.core.boardChanged(s.project.id)
    await vi.waitFor(() => expect(s.boardChanged).toHaveBeenCalledWith(s.project.id))
  })

  it('файловый мост машины: чтение и статус', async () => {
    const s = await setup(mode); keep(s)
    expect(s.core.machineFs).not.toBeNull()
    expect((await s.core.machineFs!.list('a1', '/r')).entries?.[0]?.name).toBe('a1')
    expect((await s.core.machineFs!.read('a1', '/r/a')).dataBase64).toBe('YQ==')
    expect(await s.core.machineFs!.isOnline('online')).toBe(true)
    expect(await s.core.machineFs!.isOnline('offline')).toBe(false)
  })
})

describe('внутренний API ядра', () => {
  it('без Bearer — 401; события Make воспроизводятся на шине ядра; whoami отдаёт вердикт аутентификации', async () => {
    const s = await setup('local'); keep(s)
    expect((await s.app.inject({ method: 'POST', url: INTERNAL_MAKE_EVENTS_PATH, payload: { events: [] } })).statusCode).toBe(401)
    const frames: unknown[] = []
    s.hub.subscribe('ann', (m) => frames.push(m))
    const res = await s.app.inject({
      method: 'POST', url: INTERNAL_MAKE_EVENTS_PATH, headers: { authorization: `Bearer ${TOKEN}` },
      payload: { events: [{ kind: 'changed', userId: 'ann', conversationId: 'c1', rev: 2, paths: ['a.css'] }, { kind: 'turnSnapshot', turn: 't1', snapshotId: 's1' }] }
    })
    expect(res.statusCode).toBe(200)
    expect(frames).toEqual([{ t: 'make.changed', conversationId: 'c1', rev: 2, paths: ['a.css'] }])
    expect(s.hub.turnSnapshot('t1')).toBe('s1')
    const who = await s.app.inject({ method: 'POST', url: INTERNAL_WHOAMI_PATH, headers: { authorization: `Bearer ${TOKEN}` }, payload: { method: 'GET', url: '/api/make/x', headers: { authorization: 'Bearer good' } } })
    expect(who.json()).toEqual({ ok: true, user: { name: 'ann', role: 'developer' } })
    const bad = await s.app.inject({ method: 'POST', url: INTERNAL_WHOAMI_PATH, headers: { authorization: `Bearer ${TOKEN}` }, payload: { method: 'GET', url: '/api/make/x', headers: {} } })
    expect(bad.json()).toEqual({ ok: false, status: 401, error: 'unauthorized' })
  })
})

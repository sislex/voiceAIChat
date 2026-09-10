// Core RPC tests connect HttpMakeCore to createCoreRpcDispatcher over a fake MakeCore. A
// substituted fetch uses app.inject() to check argument serialization, null results, core errors,
// and the method allowlist without opening a network port.
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MakeCore } from './core.js'
import { INTERNAL_MAKE_CORE_PATH, RpcError, createCoreRpcDispatcher, type RpcRequest } from './internal.js'
import { HttpMakeCore } from './httpCore.js'

const headersOf = (init: RequestInit['headers']): Record<string, string> => { const out: Record<string, string> = {}; new Headers(init).forEach((v, k) => { out[k] = v }); return out }

const TOKEN = 'internal-token'
const calls: Array<[string, unknown[]]> = []
const fakeCore: MakeCore = {
  conversation: async (userId, id) => (calls.push(['conversation', [userId, id]]), id === 'c1' ? ({ id, title: 'Проект', assistantKind: 'make' } as never) : null),
  conversationOwner: async (id) => (id === 'c1' ? 'ann' : null),
  conversationProject: async () => 'p1',
  isProjectViewer: async (userId) => userId === 'bob',
  makeConversationIdsOf: async () => ['c1', 'c2'],
  taskLinks: async (conversationId, path) => (calls.push(['taskLinks', [conversationId, path]]), []),
  linkableTasks: async () => [{ taskId: 't1' } as never],
  linkTaskDesign: async (...args) => { calls.push(['linkTaskDesign', args]); if (args[2] === 'boom') throw new Error('нет такой задачи') },
  unlinkTaskDesign: async (...args) => { calls.push(['unlinkTaskDesign', args]) },
  taskDesigns: async (_u, _p, taskId) => (taskId === 't1' ? [{ id: 'd1', conversationId: 'c1', mode: 'whole_project', paths: [] } as never] : null),
  project: async () => null,
  userExists: async (name) => name === 'ann',
  boardChanged: (projectId) => { calls.push(['boardChanged', [projectId]]) },
  machineFs: {
    list: async (agentId, path) => ({ root: '/r', cwd: path, entries: [{ name: agentId, kind: 'file', size: 1, mtime: 0 }] } as never),
    read: async () => ({ root: '/r', cwd: '/r/a', dataBase64: 'YQ==' } as never),
    isOnline: async (agentId) => agentId === 'online'
  }
}

async function setup(core: MakeCore = fakeCore) {
  const app = Fastify()
  const dispatch = createCoreRpcDispatcher(core)
  app.post<{ Body: RpcRequest }>(INTERNAL_MAKE_CORE_PATH, async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply.code(401).send({ error: 'unauthorized' })
    try { return { result: await dispatch(req.body) } } catch (error) {
      return reply.code(error instanceof RpcError ? error.status : 500).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })
  await app.ready()
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const res = await app.inject({ method: 'POST', url: url.pathname, headers: headersOf(init?.headers), payload: String(init?.body) })
    return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } })
  }
  const errors: unknown[] = []
  const client = new HttpMakeCore({ coreUrl: 'http://core.test', token: TOKEN, fetchImpl, onError: (e) => errors.push(e) })
  return { app, client, errors, fetchImpl }
}

let app: { close(): Promise<void> } | null = null
afterEach(async () => { await app?.close(); app = null; calls.length = 0 })

describe('HttpMakeCore ↔ RPC ядра', () => {
  it('методы порта проходят через RPC с теми же аргументами и результатами, null сохраняется', async () => {
    const s = await setup(); app = s.app
    expect(await s.client.conversation('ann', 'c1')).toMatchObject({ id: 'c1', assistantKind: 'make' })
    expect(await s.client.conversation('ann', 'nope')).toBeNull()
    expect(await s.client.conversationOwner('c1')).toBe('ann')
    expect(await s.client.conversationOwner('x')).toBeNull()
    expect(await s.client.isProjectViewer('bob', 'c1')).toBe(true)
    expect(await s.client.makeConversationIdsOf('ann')).toEqual(['c1', 'c2'])
    expect(await s.client.linkableTasks('ann', 'c1')).toEqual([{ taskId: 't1' }])
    expect(await s.client.taskDesigns('ann', 'p1', 't1')).toHaveLength(1)
    expect(await s.client.taskDesigns('ann', 'p1', 'none')).toBeNull()
    expect(await s.client.project('ann', 'p1')).toBeNull()
    expect(await s.client.userExists('ann')).toBe(true)
    // An omitted optional path must not become null on the wire.
    await s.client.taskLinks('c1')
    await s.client.taskLinks('c1', 'index.html')
    expect(calls.filter(([m]) => m === 'taskLinks').map(([, a]) => a)).toEqual([['c1', undefined], ['c1', 'index.html']])
    await s.client.linkTaskDesign('ann', 'p1', 't1', { conversationId: 'c1', path: 'a.css', label: 'x' })
    expect(calls.find(([m]) => m === 'linkTaskDesign')?.[1]).toEqual(['ann', 'p1', 't1', { conversationId: 'c1', path: 'a.css', label: 'x' }])
  })

  it('ошибка ядра приходит исключением с его текстом; чужой токен и неизвестный метод — тоже', async () => {
    const s = await setup(); app = s.app
    await expect(s.client.linkTaskDesign('ann', 'p1', 'boom', { conversationId: 'c1' })).rejects.toThrow('нет такой задачи')
    const stranger = new HttpMakeCore({ coreUrl: 'http://core.test', token: 'wrong', fetchImpl: s.fetchImpl })
    await expect(stranger.userExists('ann')).rejects.toThrow(/unauthorized/)
    const res = await s.app.inject({ method: 'POST', url: INTERNAL_MAKE_CORE_PATH, headers: { authorization: `Bearer ${TOKEN}` }, payload: { method: 'constructor', args: [] } })
    expect(res.statusCode).toBe(400)
  })

  it('machineFs: list/read/isOnline по RPC; без моста у ядра — 409 словами', async () => {
    const s = await setup(); app = s.app
    expect((await s.client.machineFs.list('a1', '/r')).entries?.[0]?.name).toBe('a1')
    expect((await s.client.machineFs.read('a1', '/r/a')).dataBase64).toBe('YQ==')
    expect(await s.client.machineFs.isOnline('online')).toBe(true)
    expect(await s.client.machineFs.isOnline('offline')).toBe(false)
    await s.app.close()
    const noFs = await setup({ ...fakeCore, machineFs: null }); app = noFs.app
    await expect(noFs.client.machineFs.list('a1', '/r')).rejects.toThrow('файловый мост машин недоступен')
    expect(await noFs.client.machineFs.isOnline('a1')).toBe(false)
  })

  it('boardChanged уходит в фон и не ждёт ответа; ошибка — в onError', async () => {
    const s = await setup(); app = s.app
    s.client.boardChanged('p1')
    await vi.waitFor(() => expect(calls.some(([m, a]) => m === 'boardChanged' && a[0] === 'p1')).toBe(true))
    const broken = new HttpMakeCore({ coreUrl: 'http://core.test', token: TOKEN, fetchImpl: async () => { throw new Error('сеть') }, onError: (e) => s.errors.push(e) })
    broken.boardChanged('p1')
    await vi.waitFor(() => expect(s.errors).toHaveLength(1))
  })
})

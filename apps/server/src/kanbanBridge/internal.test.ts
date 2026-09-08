// RPC-диспетчер порта у ядра: только перечисленные методы, `undefined` → null, обратные вызовы тоннеля
// уходят в канбан по RPC; снимок машин — из реестра.
import { describe, expect, it, vi } from 'vitest'
import { RpcError } from '@voicechat/shared'
import type { KanbanCore } from '../kanban/core.js'
import { createKanbanCoreRpcDispatcher, machinesSnapshot } from './internal.js'

function fakeCore(): KanbanCore & { tunnelArgs: unknown[] } {
  const core = {
    tunnelArgs: [] as unknown[],
    machines: {
      isOnline: () => true, nameOf: () => 'm', platformOf: () => 'linux', policyOf: () => undefined, telemetryOf: () => undefined,
      exec: vi.fn(), execStream: vi.fn(),
      fsRead: vi.fn(async (agentId: string, path: string) => ({ ok: true, agentId, path })),
      fsWrite: vi.fn(), fsMkdir: vi.fn(), fsDelete: vi.fn(), fsRename: vi.fn(), gitAccess: vi.fn(),
      createTunnel: vi.fn(async (...args: unknown[]) => { core.tunnelArgs = args; return 4242 }),
      closeTunnel: vi.fn(() => true),
      closeTunnelsForTarget: vi.fn()
    },
    kb: { status: vi.fn(async () => ({ ok: true })), topics: vi.fn(async () => []), document: vi.fn(async () => null), search: vi.fn(async () => []), context: vi.fn(async () => ({ text: '' })) },
    uploads: { get: vi.fn(() => undefined) },
    widgets: { contexts: { surface: vi.fn(() => null), updateSurface: vi.fn() }, ui: { request: vi.fn(async () => ({ ok: true })) } },
    ensureProjectMainCurrent: vi.fn(async () => ({ baseSha: 'abc' }))
  }
  return core as unknown as KanbanCore & { tunnelArgs: unknown[] }
}

describe('createKanbanCoreRpcDispatcher', () => {
  it('неизвестный метод и не-массив args — RpcError 400', async () => {
    const dispatch = createKanbanCoreRpcDispatcher({ core: fakeCore(), machinesSnapshot: () => [], tunnels: { authorize: async () => true, closed: async () => {} } })
    await expect(dispatch({ method: 'machines.ptyStart', args: [] })).rejects.toBeInstanceOf(RpcError)
    await expect(dispatch({ method: 'kb.status', args: 'x' as never })).rejects.toMatchObject({ status: 400 })
  })

  it('прокидывает аргументы, отсутствующее значение отдаёт как null', async () => {
    const core = fakeCore()
    const dispatch = createKanbanCoreRpcDispatcher({ core, machinesSnapshot: () => [{ id: 'm1' }], tunnels: { authorize: async () => true, closed: async () => {} } })
    expect(await dispatch({ method: 'machines.fsRead', args: ['m1', '/x'] })).toEqual({ ok: true, agentId: 'm1', path: '/x' })
    expect(await dispatch({ method: 'uploads.get', args: ['u1'] })).toBeNull()
    expect(await dispatch({ method: 'widgets.surface', args: ['c1'] })).toBeNull()
    expect(await dispatch({ method: 'machines.snapshot', args: [] })).toEqual([{ id: 'm1' }])
    expect(await dispatch({ method: 'machines.closeTunnelsForTarget', args: ['m1'] })).toBeNull()
    expect(core.machines.closeTunnelsForTarget).toHaveBeenCalledWith('m1')
    expect(await dispatch({ method: 'ensureProjectMainCurrent', args: [{ projectId: 'p' }] })).toEqual({ baseSha: 'abc' })
  })

  it('createTunnel: авторизация и закрытие тоннеля спрашиваются у канбана по id', async () => {
    const core = fakeCore()
    const authorize = vi.fn(async (id: string) => id === 't1')
    const closed = vi.fn(async () => {})
    const dispatch = createKanbanCoreRpcDispatcher({ core, machinesSnapshot: () => [], tunnels: { authorize, closed } })
    expect(await dispatch({ method: 'machines.createTunnel', args: ['t1', 'src', 'dst', 3000] })).toBe(4242)
    const [id, src, dst, port, auth, onClose] = core.tunnelArgs as [string, string, string, number, () => Promise<boolean>, () => Promise<void>]
    expect([id, src, dst, port]).toEqual(['t1', 'src', 'dst', 3000])
    expect(await auth()).toBe(true)
    expect(authorize).toHaveBeenCalledWith('t1')
    await onClose()
    expect(closed).toHaveBeenCalledWith('t1')
  })
})

describe('machinesSnapshot', () => {
  it('собирает онлайн-машины реестра без undefined-полей', () => {
    const registry = {
      onlineIds: () => new Set(['a', 'b']),
      nameOf: (id: string) => (id === 'a' ? 'Mac' : undefined),
      platformOf: () => undefined,
      policyOf: (id: string) => (id === 'a' ? ({ allowedDirs: [] } as never) : undefined),
      telemetryOf: () => undefined
    }
    expect(machinesSnapshot(registry)).toEqual([{ id: 'a', name: 'Mac', policy: { allowedDirs: [] } }, { id: 'b' }])
  })
})

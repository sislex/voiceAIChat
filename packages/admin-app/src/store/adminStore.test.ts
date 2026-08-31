import { describe, expect, it, vi } from 'vitest'
import type { AdminClient } from '../contracts'
import { createAdminStore } from './adminStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('adminStore', () => {
  it('ignores a stale selected-user response and clears on dispose', async () => {
    const alice = deferred<any>()
    const client = {
      userUsage: vi.fn(({ name }: { name: string }) => name === 'alice' ? alice.promise : Promise.resolve({ unit: 'day', totals: {}, byBucket: [], byModel: [], byConversation: [] })),
      userConversations: vi.fn(async () => []),
      getUserLlmAccess: vi.fn(async () => []),
      listUsers: vi.fn(async () => []),
      usageSummary: vi.fn(async () => []),
      listLlmEngines: vi.fn(async () => []),
      listModelPrices: vi.fn(async () => [])
    } as unknown as AdminClient
    const store = createAdminStore({
      client,
      session: { currentUser: () => ({ name: 'root', role: 'admin' }), refreshSession: async () => ({ name: 'root', role: 'admin' }), refreshOwnLlmAccess: async () => {} }
    })
    const first = store.actions.selectAdminUser('alice')
    await store.actions.selectAdminUser('bob')
    alice.resolve({ unit: 'day', totals: { messages: 99 }, byBucket: [], byModel: [], byConversation: [] })
    await first
    expect(store.getState().adminSelected).toBe('bob')
    expect(store.getState().adminUsage?.totals.messages).not.toBe(99)
    store.dispose()
    expect(store.getState().adminUsers).toEqual([])
  })

  it('открытие раздела грузит только список людей, служебные страницы — по заходу', async () => {
    const listUsers = vi.fn(async () => [])
    const usageSummary = vi.fn(async (_range?: { from?: number; to?: number }) => [])
    const listLlmEngines = vi.fn(async () => [])
    const listModelPrices = vi.fn(async () => [])
    const makeStats = vi.fn(async () => ({ projects: 0, bytes: 0, filesBytes: 0, snapshotsBytes: 0, shotsBytes: 0, published: 0, shared: 0, views: 0, limitBytes: 0, userLimitBytes: 0, byUser: [], top: [] }))
    const client = {
      listUsers, usageSummary, listLlmEngines, listModelPrices, makeStats,
      machineStats: vi.fn(async () => ({ generatedAt: 1, machines: [], totals: { machines: 0, online: 0, commands24h: 0, errors24h: 0 } })),
      userUsage: vi.fn(async () => ({ unit: 'day', totals: {}, byBucket: [], byModel: [], byConversation: [] })),
      userConversations: vi.fn(async () => []),
      getUserLlmAccess: vi.fn(async () => [])
    } as unknown as AdminClient
    const store = createAdminStore({
      client,
      session: { currentUser: () => ({ name: 'root', role: 'admin' }), refreshSession: async () => ({ name: 'root', role: 'admin' }), refreshOwnLlmAccess: async () => {} }
    })

    await store.actions.openUsers()
    expect(listUsers).toHaveBeenCalledTimes(1)
    // Реестр, цены и обход диска ради метрик Make на этом экране не нужны.
    expect(listLlmEngines).not.toHaveBeenCalled()
    expect(listModelPrices).not.toHaveBeenCalled()
    expect(makeStats).not.toHaveBeenCalled()
    // Сводка расхода — за текущий месяц, а не за всё время: та же цифра стоит в карточке.
    const range = usageSummary.mock.calls[0]?.[0]
    expect(range?.from).toBeLessThanOrEqual(Date.now())
    expect(range?.from).toBeGreaterThan(Date.now() - 32 * 86_400_000)

    await store.actions.openAdminPage('engines')
    expect(listLlmEngines).toHaveBeenCalledTimes(1)
    await store.actions.openAdminPage('system')
    expect(makeStats).toHaveBeenCalledTimes(1)
    store.dispose()
  })
})

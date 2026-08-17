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
})

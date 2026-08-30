import { describe, expect, it } from 'vitest'
import { InMemorySessionStore } from './memoryStore'
import { createContractClock, sessionStoreContract } from './testing'

// Эталон контракта: если референс-реализация его не проходит, значит сам
// контракт описан неверно — чинить надо до того, как его прогонят на SQLite.
describe('InMemorySessionStore: контракт хранилища', () => {
  for (const item of sessionStoreContract) {
    it(item.name, async () => {
      const clock = createContractClock()
      await item.run({ store: new InMemorySessionStore(clock.now), clock })
    })
  }
})

describe('InMemorySessionStore: особенности реализации', () => {
  it('снимок all() показывает и отозванные строки — для отладки и тестов', () => {
    const store = new InMemorySessionStore(() => 1000)
    store.create({ sid: 'a', user: 'u', ip: '', userAgent: '', ttlMs: 60_000 })
    store.revoke('a')
    expect(store.list('u')).toEqual([])
    expect(store.all().map((s) => s.sid)).toEqual(['a'])
  })

  it('считает запросы сессии — грубая мера активности', () => {
    const clock = createContractClock(0)
    const store = new InMemorySessionStore(clock.now)
    store.create({ sid: 'a', user: 'u', ip: '', userAgent: '', ttlMs: 60 * 60_000 })
    clock.advance(5 * 60_000)
    store.touch('a', { ttlMs: 60 * 60_000, path: '/api/conversations' })
    clock.advance(5 * 60_000)
    store.touch('a', { ttlMs: 60 * 60_000 })
    expect(store.get('a')).toMatchObject({ requests: 2, lastPath: '/api/conversations' })
  })
})

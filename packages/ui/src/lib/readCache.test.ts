import { describe, expect, it, vi } from 'vitest'
import { ReadCache, RESOURCE_TTL, resourceKey } from './readCache'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
describe('shared read cache', () => {
  // @testCase TC2
  it.each(Object.entries(RESOURCE_TTL))('deduplicates and expires %s at its explicit TTL', async (family, ttl) => {
    let now = 100
    const cache = new ReadCache(() => now)
    let version = 0
    const load = vi.fn(async () => ({ version: ++version }))
    const resource = family as keyof typeof RESOURCE_TTL
    const first = cache.read(resource, { b: 2, a: 1 }, load)
    const second = cache.read(resource, { a: 1, b: 2 }, load)
    expect(first).toBe(second)
    await first
    now += ttl - 1
    await cache.read(resource, { a: 1, b: 2 }, load)
    expect(load).toHaveBeenCalledTimes(1)
    now++
    await cache.read(resource, { a: 1, b: 2 }, load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  // @testCase TC2
  it('normalizes object order, preserves array order and separates projects and sessions', async () => {
    expect(resourceKey({ a: 1, absent: undefined, nested: { z: 2, a: 3 } }))
      .toBe(resourceKey({ nested: { a: 3, z: 2 }, a: 1 }))
    expect(resourceKey([1, 2])).not.toBe(resourceKey([2, 1]))
    const cache = new ReadCache()
    await cache.read('board', { id: 'one' }, async () => 'first')
    await cache.read('board', { id: 'two' }, async () => 'second')
    cache.invalidate('board', params => (params as { id: string }).id === 'one')
    expect(cache.peek('board', { id: 'two' })).toBe('second')
    cache.clear()
    expect(cache.peek('board', { id: 'two' })).toBeUndefined()
  })

  // @testCase TC3
  it('leaving one consumer neither cancels nor delivers to it while the other stays subscribed', async () => {
    const cache = new ReadCache()
    const pending = deferred<string>()
    const load = vi.fn(() => pending.promise)
    const left = vi.fn(), active = vi.fn(), fail = vi.fn()
    const unsubscribe = cache.subscribe('profile', {}, load, left, fail)
    cache.subscribe('profile', {}, load, active, fail)
    unsubscribe()
    pending.resolve('ready')
    await vi.waitFor(() => expect(active).toHaveBeenCalledWith('ready'))
    expect(load).toHaveBeenCalledTimes(1)
    expect(left).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
  })

  // @testCase TC3
  it.each(['invalidate', 'logout'] as const)('fences a late completion after %s and preserves the new cache entry', async operation => {
    const cache = new ReadCache()
    const old = deferred<string>()
    const received = vi.fn(), fail = vi.fn()
    cache.subscribe('profile', {}, () => old.promise, received, fail)
    if (operation === 'logout') cache.clear()
    else cache.invalidate('profile')
    await cache.read('profile', {}, async () => 'new')
    old.resolve('old')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(cache.peek('profile', {})).toBe('new')
    expect(received).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
  })

  // @testCase TC3
  it('offline refresh preserves previous data and retry only repeats the failed resource', async () => {
    let now = 0
    const cache = new ReadCache(() => now)
    const profile = vi.fn(async () => 'profile')
    const usage = vi.fn(async () => 'usage')
    await cache.read('profile', {}, profile)
    await cache.read('usage', {}, usage)
    now = RESOURCE_TTL.usage
    const offline = vi.fn(async () => { throw new Error('offline') })
    await expect(cache.read('usage', {}, offline)).rejects.toThrow('offline')
    expect(cache.peek('usage', {})).toBe('usage')
    await cache.read('usage', {}, usage)
    await cache.read('profile', {}, profile)
    expect(usage).toHaveBeenCalledTimes(2)
    expect(profile).toHaveBeenCalledTimes(1)
  })

  // @testCase TC3
  it('an authoritative realtime snapshot fences an older HTTP response and remains fresh', async () => {
    const cache = new ReadCache()
    const old = deferred<string>()
    const pending = cache.read('machines', {}, () => old.promise)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    cache.seed('machines', {}, 'realtime')
    old.resolve('old')
    await rejected
    const fetch = vi.fn(async () => 'http')
    expect(await cache.read('machines', {}, fetch)).toBe('realtime')
    expect(fetch).not.toHaveBeenCalled()
  })

  // @testCase TC5
  it('diagnostics expose only an allowlisted resource family and hit/miss', async () => {
    const diagnostic = vi.fn()
    const cache = new ReadCache(Date.now, diagnostic)
    const params = { user: 'private-user', token: 'secret', project: 'private-project' }
    await cache.read('profile', params, async () => ({ email: 'private@example.test' }))
    await cache.read('profile', params, async () => null)
    expect(diagnostic.mock.calls).toEqual([
      [{ resource: 'profile', outcome: 'miss' }],
      [{ resource: 'profile', outcome: 'hit' }]
    ])
  })
})

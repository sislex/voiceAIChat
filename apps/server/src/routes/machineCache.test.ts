// Кэш ответов машины: правила «что кэшируем» и вытеснение. Логика чистая —
// проверяется без сети и без агента.
import { describe, expect, it } from 'vitest'
import { MachineResponseCache, isCacheableMachineResponse } from './machineCache.js'

const entry = (body: string) => ({ status: 200, headers: { 'content-type': 'text/javascript' }, body: Buffer.from(body), etag: `W/"${body}"` })

describe('isCacheableMachineResponse', () => {
  it('кэширует статику dev-сервера', () => {
    expect(isCacheableMachineResponse('GET', 200, 'text/javascript', 1000)).toBe(true)
    expect(isCacheableMachineResponse('GET', 200, 'text/css', 1000)).toBe(true)
    expect(isCacheableMachineResponse('GET', 200, 'application/json; charset=utf-8', 1000)).toBe(true)
    expect(isCacheableMachineResponse('GET', 200, 'image/svg+xml', 1000)).toBe(true)
  })

  it('не кэширует HTML: туда инъецируются шимы и он зависит от сессии', () => {
    expect(isCacheableMachineResponse('GET', 200, 'text/html; charset=utf-8', 1000)).toBe(false)
  })

  it('не кэширует мутации, ошибки и слишком большие тела', () => {
    expect(isCacheableMachineResponse('POST', 200, 'text/javascript', 10)).toBe(false)
    expect(isCacheableMachineResponse('GET', 404, 'text/javascript', 10)).toBe(false)
    expect(isCacheableMachineResponse('GET', 200, 'text/javascript', 5 * 1024 * 1024)).toBe(false)
  })
})

describe('MachineResponseCache', () => {
  it('отдаёт запись до истечения TTL и забывает после', () => {
    let now = 1000
    const cache = new MachineResponseCache(() => now, 100)
    cache.put('a1', '/m.js', entry('one'))
    expect(cache.get('a1', '/m.js')?.body.toString()).toBe('one')
    now += 101
    expect(cache.get('a1', '/m.js')).toBeNull()
    expect(cache.size).toBe(0)
  })

  it('не смешивает машины и адреса', () => {
    const cache = new MachineResponseCache(() => 0, 1000)
    cache.put('a1', '/m.js', entry('first'))
    cache.put('a2', '/m.js', entry('second'))
    expect(cache.get('a1', '/m.js')?.body.toString()).toBe('first')
    expect(cache.get('a2', '/m.js')?.body.toString()).toBe('second')
    expect(cache.get('a1', '/other.js')).toBeNull()
  })

  it('перезапуск dev-сервера сбрасывается по машине', () => {
    const cache = new MachineResponseCache(() => 0, 1000)
    cache.put('a1', '/m.js', entry('old'))
    cache.put('a2', '/m.js', entry('keep'))
    cache.dropAgent('a1')
    expect(cache.get('a1', '/m.js')).toBeNull()
    expect(cache.get('a2', '/m.js')?.body.toString()).toBe('keep')
  })
})

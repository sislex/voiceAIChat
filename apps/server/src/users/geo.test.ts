import { describe, expect, it, vi } from 'vitest'
import { createGeoResolver, parseGeoPayload } from './geo.js'

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('parseGeoPayload', () => {
  it('понимает разные имена полей и собирает подпись', () => {
    expect(parseGeoPayload({ country_code: 'RU', city: 'Москва' })).toEqual({ country: 'RU', city: 'Москва', label: 'Москва, RU' })
    expect(parseGeoPayload({ countryCode: 'DE' })).toEqual({ country: 'DE', label: 'DE' })
    expect(parseGeoPayload({ city: 'Прага' })).toEqual({ city: 'Прага', label: 'Прага' })
  })

  it('пустое и мусорное — не место', () => {
    for (const payload of [null, undefined, 'строка', {}, { country_code: '  ' }]) expect(parseGeoPayload(payload)).toBeNull()
  })
})

describe('createGeoResolver', () => {
  it('приватный адрес определяется офлайн и наружу не уходит', async () => {
    const fetchImpl = vi.fn()
    const geo = createGeoResolver({ url: 'https://example.test/{ip}', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await geo.resolve('192.168.1.10')).toMatchObject({ local: true, label: 'локальная сеть' })
    expect(await geo.resolve('::1')).toMatchObject({ local: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('без VC_GEOIP_URL публичный адрес остаётся без места', async () => {
    const geo = createGeoResolver({})
    expect(await geo.resolve('203.0.113.7')).toBeNull()
  })

  it('спрашивает провайдера один раз на подсеть', async () => {
    const fetchImpl = vi.fn(async () => ok({ country_code: 'RU', city: 'Москва' }))
    const geo = createGeoResolver({ url: 'https://example.test/{ip}', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await geo.resolve('203.0.113.7')).toMatchObject({ label: 'Москва, RU' })
    expect(await geo.resolve('203.0.113.250')).toMatchObject({ label: 'Москва, RU' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://example.test/203.0.113.7')
    // Другая сеть — новый запрос.
    await geo.resolve('198.51.100.1')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('ошибка и таймаут провайдера не ломают вход и не повторяются подряд', async () => {
    const onError = vi.fn()
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    const geo = createGeoResolver({ url: 'https://example.test/{ip}', fetchImpl: fetchImpl as unknown as typeof fetch, onError })
    expect(await geo.resolve('203.0.113.7')).toBeNull()
    expect(await geo.resolve('203.0.113.8')).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('ECONNREFUSED')
  })

  it('прерывает запрос по таймауту', async () => {
    const fetchImpl = vi.fn((_: unknown, init?: { signal?: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const geo = createGeoResolver({ url: 'https://example.test/{ip}', timeoutMs: 10, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await geo.resolve('203.0.113.7')).toBeNull()
  })

  it('ответ с ошибкой HTTP — без места, но с записью в кеш', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }))
    const geo = createGeoResolver({ url: 'https://example.test/{ip}', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await geo.resolve('203.0.113.7')).toBeNull()
    expect(await geo.resolve('203.0.113.7')).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

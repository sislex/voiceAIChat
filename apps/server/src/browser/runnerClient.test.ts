// HTTP-клиент browser-runner: токен, маппинг статусов в BrowserRunnerError,
// бинарный ответ screenshot. fetch подменён фейком — сети нет.

import { describe, expect, it, vi } from 'vitest'
import { BrowserRunnerError, createBrowserRunnerClient } from './runnerClient.js'

const meta = { id: 's1', conversationId: 'c1', incarnation: 'inc', state: 'ready', activeTabId: 't', tabs: [], viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, currentUrl: null, title: null }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('createBrowserRunnerClient', () => {
  it('start шлёт Bearer-токен и тело сессии, возвращает метаданные', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return jsonResponse(200, meta) }) as unknown as typeof fetch
    const client = createBrowserRunnerClient({ baseUrl: 'http://runner:8791/', token: 'secret', fetchImpl })
    const result = await client.start({ sessionId: 'c1', userKey: 'admin', conversationKey: 'c1' })
    expect(result.incarnation).toBe('inc')
    expect(calls[0].url).toBe('http://runner:8791/v1/sessions')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer secret')
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ sessionId: 'c1', userKey: 'admin', conversationKey: 'c1' })
  })

  it('screenshot возвращает бинарь и mime из content-type', async () => {
    const png = Buffer.from([1, 2, 3, 4])
    const fetchImpl = vi.fn(async () => new Response(png, { status: 200, headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch
    const client = createBrowserRunnerClient({ baseUrl: 'http://runner:8791', token: 't', fetchImpl })
    const shot = await client.screenshot('c1', { requestId: 'r', incarnation: 'inc', actor: 'user', command: { type: 'screenshot' } })
    expect(shot.mimeType).toBe('image/jpeg')
    expect(shot.buffer.equals(png)).toBe(true)
  })

  it('маппит статусы: 404 → 404, stale (409) → 409, 503 → 503, ошибка команды (422) → 422, прочее → 502', async () => {
    // 422 — раннер не принял саму команду (адрес не открылся): раньше уходило
    // 502 «плохой шлюз», и по нему шли искать беду в инфраструктуре.
    const make = (status: number): typeof fetch => (vi.fn(async () => jsonResponse(status, { error: 'x', message: 'boom' })) as unknown as typeof fetch)
    for (const [status, expected] of [[404, 404], [409, 409], [503, 503], [422, 422], [500, 502]] as const) {
      const client = createBrowserRunnerClient({ baseUrl: 'http://r', token: 't', fetchImpl: make(status) })
      await expect(client.command('c1', { requestId: 'r', incarnation: 'i', actor: 'user', command: { type: 'reload' } }))
        .rejects.toMatchObject({ status: expected })
    }
  })

  it('сетевой сбой → BrowserRunnerError 502', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const client = createBrowserRunnerClient({ baseUrl: 'http://r', token: 't', fetchImpl })
    await expect(client.stop('c1')).rejects.toBeInstanceOf(BrowserRunnerError)
  })
})

describe('отмена и таймаут (круг 29)', () => {
  it('отмена вызывающего не выдаётся за таймаут раннера', async () => {
    const controller = new AbortController()
    const client = createBrowserRunnerClient({
      baseUrl: 'http://runner', token: 't',
      fetchImpl: (async (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })) as unknown as typeof fetch
    })
    const call = client.command('s', { requestId: 'r', incarnation: 'i', actor: 'assistant', command: { type: 'reload' } }, controller.signal)
    controller.abort()
    // «Не ответил вовремя» отправляло человека искать беду в инфраструктуре,
    // которой нет: запрос оборвал он сам.
    await expect(call).rejects.toMatchObject({ status: 499, message: 'Запрос к Browser Runner отменён' })
  })

  it('снимок тоже слушает сигнал: он был единственным методом без него', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const client = createBrowserRunnerClient({
      baseUrl: 'http://runner', token: 't',
      fetchImpl: (async (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        seen = init.signal ?? undefined
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })) as unknown as typeof fetch
    })
    const call = client.screenshot('s', { requestId: 'r', incarnation: 'i', actor: 'assistant', command: { type: 'screenshot', format: 'png' } }, controller.signal)
    controller.abort()
    await expect(call).rejects.toMatchObject({ status: 499 })
    expect(seen?.aborted).toBe(true)
  })

  it('код раннера переводится словами и сохраняется отдельно: «not_found» панель печатала буквально', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { error: 'not_found' })) as unknown as typeof fetch
    const client = createBrowserRunnerClient({ baseUrl: 'http://r', token: 't', fetchImpl })
    const error = await client.command('c1', { requestId: 'r', incarnation: 'i', actor: 'user', command: { type: 'reload' } }).catch((e: BrowserRunnerError) => e)
    expect(error).toBeInstanceOf(BrowserRunnerError)
    expect((error as BrowserRunnerError).code).toBe('not_found')
    expect((error as BrowserRunnerError).message).toMatch(/Сессия Chromium закрыта/)
  })

  it('текст ошибки команды (не код) остаётся текстом и кода не получает', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(422, { error: 'Страница не открылась: имя сайта не разрешается' })) as unknown as typeof fetch
    const client = createBrowserRunnerClient({ baseUrl: 'http://r', token: 't', fetchImpl })
    const error = await client.command('c1', { requestId: 'r', incarnation: 'i', actor: 'user', command: { type: 'reload' } }).catch((e: BrowserRunnerError) => e)
    expect((error as BrowserRunnerError).code).toBeUndefined()
    expect((error as BrowserRunnerError).message).toBe('Страница не открылась: имя сайта не разрешается')
  })
})

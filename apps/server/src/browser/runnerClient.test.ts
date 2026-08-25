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

  it('маппит статусы: 404 → 404, stale (409) → 409, 503 → 503', async () => {
    const make = (status: number): typeof fetch => (vi.fn(async () => jsonResponse(status, { error: 'x', message: 'boom' })) as unknown as typeof fetch)
    for (const [status, expected] of [[404, 404], [409, 409], [503, 503], [422, 502]] as const) {
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

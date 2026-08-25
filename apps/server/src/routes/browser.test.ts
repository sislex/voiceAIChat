// REST-оркестрация Playwright Reader: владение разговором, тип разговора,
// маппинг ошибок раннера и отсутствие раннера (501). db и runner — фейки.

import { describe, expect, it, vi } from 'vitest'
import fastify from 'fastify'
import type { Conversation } from '@voicechat/shared'
import { registerBrowserRoutes } from './browser.js'
import { BrowserRunnerError, type BrowserRunnerClient } from '../browser/runnerClient.js'

const meta = { id: 'c1', conversationId: 'c1', incarnation: 'inc', state: 'ready' as const, activeTabId: 't', tabs: [], viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, currentUrl: 'https://a.b', title: null }

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return { id: 'c1', title: 'Playwright Reader 1', assistantKind: 'playwright-reader', createdAt: 0, updatedAt: 0, ...overrides } as Conversation
}

function makeRunner(overrides: Partial<BrowserRunnerClient> = {}): BrowserRunnerClient {
  return {
    start: vi.fn(async () => meta),
    command: vi.fn(async () => meta),
    screenshot: vi.fn(async () => ({ buffer: Buffer.from([1, 2, 3]), mimeType: 'image/jpeg' })),
    stop: vi.fn(async () => true),
    ...overrides
  }
}

async function makeApp(opts: { conv?: Conversation | null; runner?: BrowserRunnerClient | undefined } = {}) {
  const app = fastify()
  app.addHook('onRequest', async (req) => { (req as unknown as { user: { name: string; role: string } }).user = { name: 'admin', role: 'admin' } })
  const db = { getConversation: vi.fn(() => (opts.conv === undefined ? conversation() : opts.conv)) } as never
  registerBrowserRoutes(app, { db, ...(opts.runner !== undefined ? { runner: opts.runner } : {}) })
  await app.ready()
  return app
}

describe('registerBrowserRoutes', () => {
  it('start поднимает сессию с ключами uid и conversationId', async () => {
    const runner = makeRunner()
    const app = await makeApp({ runner })
    const res = await app.inject({ method: 'POST', url: '/api/browser/c1/start', payload: { viewport: { width: 1000, height: 700, deviceScaleFactor: 1 } } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ incarnation: 'inc' })
    expect(runner.start).toHaveBeenCalledWith({ sessionId: 'c1', userKey: 'admin', conversationKey: 'c1', viewport: { width: 1000, height: 700, deviceScaleFactor: 1 } })
    await app.close()
  })

  it('command проксирует команду с incarnation, actor=user и сгенерированным requestId', async () => {
    const runner = makeRunner()
    const app = await makeApp({ runner })
    const res = await app.inject({ method: 'POST', url: '/api/browser/c1/command', payload: { incarnation: 'inc', command: { type: 'navigate', url: 'https://x.y' } } })
    expect(res.statusCode).toBe(200)
    const arg = (runner.command as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(arg).toMatchObject({ incarnation: 'inc', actor: 'user', command: { type: 'navigate', url: 'https://x.y' } })
    expect(typeof arg.requestId).toBe('string')
    await app.close()
  })

  it('command со screenshot отклоняется (для него отдельный роут) — 400', async () => {
    const runner = makeRunner()
    const app = await makeApp({ runner })
    const res = await app.inject({ method: 'POST', url: '/api/browser/c1/command', payload: { incarnation: 'inc', command: { type: 'screenshot' } } })
    expect(res.statusCode).toBe(400)
    expect(runner.command).not.toHaveBeenCalled()
    await app.close()
  })

  it('screenshot собирает data-URL из бинаря раннера', async () => {
    const app = await makeApp({ runner: makeRunner() })
    const res = await app.inject({ method: 'POST', url: '/api/browser/c1/screenshot', payload: { incarnation: 'inc' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().dataUrl).toBe('data:image/jpeg;base64,' + Buffer.from([1, 2, 3]).toString('base64'))
    await app.close()
  })

  it('чужой/несуществующий разговор — 404, не Playwright Reader — 403', async () => {
    const missing = await makeApp({ conv: null, runner: makeRunner() })
    expect((await missing.inject({ method: 'POST', url: '/api/browser/c1/start', payload: {} })).statusCode).toBe(404)
    await missing.close()
    const wrongKind = await makeApp({ conv: conversation({ assistantKind: 'web-recorder' }), runner: makeRunner() })
    expect((await wrongKind.inject({ method: 'POST', url: '/api/browser/c1/start', payload: {} })).statusCode).toBe(403)
    await wrongKind.close()
  })

  it('без сконфигурированного раннера — 501 на любой роут', async () => {
    const app = await makeApp({ runner: undefined })
    expect((await app.inject({ method: 'POST', url: '/api/browser/c1/start', payload: {} })).statusCode).toBe(501)
    await app.close()
  })

  it('ошибка раннера пробрасывается со своим статусом (stale_incarnation → 409)', async () => {
    const runner = makeRunner({ command: vi.fn(async () => { throw new BrowserRunnerError(409, 'stale_incarnation') }) })
    const app = await makeApp({ runner })
    const res = await app.inject({ method: 'POST', url: '/api/browser/c1/command', payload: { incarnation: 'old', command: { type: 'reload' } } })
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toBe('stale_incarnation')
    await app.close()
  })

  it('stop закрывает сессию', async () => {
    const runner = makeRunner()
    const app = await makeApp({ runner })
    const res = await app.inject({ method: 'DELETE', url: '/api/browser/c1' })
    expect(res.json()).toEqual({ stopped: true })
    expect(runner.stop).toHaveBeenCalledWith('c1')
    await app.close()
  })
})

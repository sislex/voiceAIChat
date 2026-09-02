// Тип снимка. Роут команд отдавал любой бинарь как `image/png`, хотя панель
// просит jpeg ради лёгкого кадра: data-URL на стороне сервера собирался с
// чужим MIME и врал о содержимом.
//
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { buildBrowserRunner, screenshotMimeType, type BrowserProbe } from './server.js'
import type { BrowserSessionManager } from './sessionManager.js'

const TOKEN = 't'
const probe: BrowserProbe = { ok: true, browser: { present: true, version: 'x' }, launch: { ok: true } }

describe('screenshotMimeType', () => {
  it('jpeg и webp — свои типы, остальное png', () => {
    expect(screenshotMimeType({ type: 'screenshot', format: 'jpeg' })).toBe('image/jpeg')
    expect(screenshotMimeType({ type: 'screenshot', format: 'webp' })).toBe('image/webp')
    expect(screenshotMimeType({ type: 'screenshot' })).toBe('image/png')
    expect(screenshotMimeType({ type: 'reload' })).toBe('image/png')
  })
})

describe('POST /v1/sessions/:id/commands со снимком', () => {
  it('content-type соответствует запрошенному формату', async () => {
    const sessions = { command: vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff])), count: () => 0, close: async () => undefined, sweepIdle: async () => [] } as unknown as BrowserSessionManager
    const app = await buildBrowserRunner({ token: TOKEN, profilesRoot: '/tmp/vc-browser-test', probe: async () => probe, sessions, idleMs: 0 })
    const res = await app.inject({
      method: 'POST', url: '/v1/sessions/s1/commands', headers: { authorization: `Bearer ${TOKEN}` },
      payload: { requestId: 'r', incarnation: 'i', actor: 'user', command: { type: 'screenshot', format: 'jpeg', quality: 82 } }
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
  })
})

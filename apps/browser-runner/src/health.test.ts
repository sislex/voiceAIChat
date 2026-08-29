// Health браузерного раннера. До этого он отвечал литералами
// `{present: true, launch: {ok: true}}` и не проверял ничего: контейнер с
// неработающим Chromium считался здоровым, а падала только первая сессия.
//
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildBrowserRunner, type BrowserProbe } from './server.js'

const TOKEN = 'test-token'
const ok: BrowserProbe = { ok: true, browser: { present: true, version: '1.62.1' }, launch: { ok: true } }
const broken: BrowserProbe = {
  ok: false,
  browser: { present: false, version: '1.62.1', error: 'Исполняемый файл браузера не найден: /ms-playwright/chromium_headless_shell-1234/…' },
  launch: { ok: false }
}

async function health(probe: BrowserProbe): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = await buildBrowserRunner({ token: TOKEN, profilesRoot: '/tmp/vc-browser-test', probe: async () => probe })
  const res = await app.inject({ method: 'GET', url: '/v1/health', headers: { authorization: `Bearer ${TOKEN}` } })
  await app.close()
  return { status: res.statusCode, body: res.json() as Record<string, unknown> }
}

describe('/v1/health', () => {
  it('исправный браузер — 200 и версия пакета', async () => {
    const result = await health(ok)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, browser: { present: true, version: '1.62.1' }, sessions: 0 })
  })

  it('браузера нет — 503 с причиной, а не «ок»', async () => {
    // Именно этот случай прожил бы незамеченным: compose считал бы контейнер
    // здоровым и слал бы в него команды.
    const result = await health(broken)
    expect(result.status).toBe(503)
    expect(result.body.ok).toBe(false)
    expect(String((result.body.browser as { error: string }).error)).toContain('не найден')
  })

  it('health закрыт токеном, как и остальные /v1/*', async () => {
    const app = await buildBrowserRunner({ token: TOKEN, profilesRoot: '/tmp/vc-browser-test', probe: async () => ok })
    const res = await app.inject({ method: 'GET', url: '/v1/health' })
    await app.close()
    expect(res.statusCode).toBe(401)
  })
})

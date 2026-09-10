// Проверяем настоящий HTTP-origin: localhost считается secure context и не ловит этот сбой.
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { buildServer } from '../apps/server/src/server.js'
import { loadConfig } from '../apps/server/src/config.js'
import { createPreviewTurnTokens } from '@voicechat/web-reader-contracts'

let app: FastifyInstance, browser: Browser, base: string, data: string, token: string
const secret = 'reader-http-fixture-secret'
const registrationKey = 'voicechat:web-reader-active-registration:v1'
const waitForReader = async (page: Page, previous: string | null = null) => {
  await page.getByTitle('Web Reader', { exact: true }).waitFor()
  // Наличие iframe ещё не означает завершённый handshake host-а и открытый WS.
  await page.waitForFunction(({ key, previous }) => {
    const current = localStorage.getItem(key)
    return current && current !== previous && (window as Window & { realtime?: { connected(): boolean } }).realtime?.connected()
  }, { key: registrationKey, previous })
}
const api = async (path: string, method = 'GET', body?: unknown) => {
  const response = await fetch(base + path, {
    method,
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const result = await response.json()
  expect(response.ok, JSON.stringify(result)).toBe(true)
  return result
}
const mcp = async (conversationId: string, name: string, args: Record<string, unknown> = {}) => {
  const turn = createPreviewTurnTokens(secret).issue({ userId: 'admin', conversationId })
  const response = await fetch(base + '/mcp/preview?k=' + secret + '&turn=' + turn, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  })
  const result = (await response.json()).result
  expect(response.ok).toBe(true)
  expect(result.isError, JSON.stringify(result)).not.toBe(true)
  return JSON.parse(result.content.find((item: { type: string }) => item.type === 'text').text)
}

describe('Web Reader: история действий модели без secure context', () => {
  beforeAll(async () => {
    data = await mkdtemp(join(tmpdir(), 'vc-reader-http-'))
    app = await buildServer({ config: loadConfig({
      ...process.env, HOST: '127.0.0.1', PORT: '0', VC_DATA_DIR: data,
      VC_ADMIN_PASSWORD: secret, VC_MCP_SECRET: secret,
      VC_WEB_DIR: resolve('apps/web/dist'), VC_WEB_RECORDER_DIR: resolve('apps/web-recorder/dist')
    }) })
    base = await app.listen({ host: '127.0.0.1', port: 0 })
    const login = await api('/api/session/login', 'POST', { name: 'admin', password: secret })
    token = login.token
    await api('/api/settings', 'PUT', { onboarded: true })
    browser = await chromium.launch({ args: ['--host-resolver-rules=MAP reader-http.test 127.0.0.1', '--no-proxy-server'] })
  })
  afterAll(async () => {
    await browser?.close()
    await app?.close()
    if (data) await rm(data, { recursive: true, force: true })
  })

  it.each([false, true])('open/read и reload сохраняют работающий Reader, secure context: %s', async (secure) => {
    const origin = secure ? base : base.replace('127.0.0.1', 'reader-http.test')
    const created = await api('/api/conversations', 'POST', { title: 'Reader HTTP QA', assistantKind: 'web-recorder' })
    const id = created.id ?? created.conversation.id
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(12_000)
    try {
      // Входим через форму на тестовом origin: обычные cookie, CSRF и WebSocket.
      await page.goto(origin + '/')
      await page.getByLabel('Пользователь', { exact: true }).fill('admin')
      await page.getByLabel('Пароль', { exact: true }).fill(secret)
      await page.getByTestId('login-submit').click()
      await page.getByTestId('login-form').waitFor({ state: 'hidden' })
      await page.goto(origin + '/#/web-reader/' + id)
      await waitForReader(page)
      expect(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID, rng: typeof crypto.getRandomValues })))
        .toEqual({ secure, uuid: secure ? 'function' : 'undefined', rng: 'function' })

      await mcp(id, 'open', { url: origin + '/api/preview/diagnostics' })
      const history = page.getByRole('region', { name: 'Действия ассистента' })
      await history.getByText(/^Открыл /).waitFor()
      const result = await mcp(id, 'read')
      expect(result.text.length).toBeGreaterThan(0)
      await history.getByText('Прочитал страницу', { exact: true }).waitFor()
      expect(await history.getByRole('listitem').count()).toBe(2)

      const registration = await page.evaluate(key => localStorage.getItem(key), registrationKey)
      await page.reload()
      await waitForReader(page, registration)
      expect((await mcp(id, 'read')).text).toBe(result.text)
      await history.getByText('Прочитал страницу', { exact: true }).waitFor()
      expect(errors).toEqual([])
      if (process.env.VC_VISUAL_ARTIFACTS) {
        await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true })
        await page.screenshot({ path: join(process.env.VC_VISUAL_ARTIFACTS, secure ? 'reader-localhost.png' : 'reader-http.png') })
      }
    } finally { await page.close() }
  })
})

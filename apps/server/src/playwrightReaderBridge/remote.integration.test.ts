// Реальные HTTP-границы: ядро, приложение Playwright Reader и, в одном из режимов, Web Reader.
// Фейком остаётся только Chromium: проверяем именно доставку, авторизацию и сохранность результатов.
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildPlaywrightReaderServer } from '@voicechat/playwright-reader/standalone'
import type { BrowserRunnerClient } from '@voicechat/browser-runner/client'
import { INTERNAL_PLAYWRIGHT_READER_CORE_PATH, INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH } from '@voicechat/shared'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { buildServer } from '../server.js'
import { signToken } from '../users/accounts.js'
import { createPreviewTurnTokens } from '../reader/turnToken.js'
import { buildReaderServer } from '../reader/standalone/server.js'

const SECRET = 'session-secret'
const INTERNAL = 'internal-token'
const MCP = 'mcp-secret'
const auth = { authorization: `Bearer ${signToken({ name: 'ann', role: 'developer' }, SECRET)}` }
const json = { 'content-type': 'application/json' }

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      server.close(() => resolve(port))
    })
  })
}

describe.each([
  { playwrightMode: 'remote', webMode: 'embedded' },
  { playwrightMode: 'remote', webMode: 'remote' },
  { playwrightMode: 'embedded', webMode: 'remote' }
] as const)('Playwright $playwrightMode, Web Reader $webMode', ({ playwrightMode, webMode }) => {
  let dataDir: string
  let db: VoiceChatDb
  let core: FastifyInstance
  let playwright: FastifyInstance | undefined
  let webReader: FastifyInstance | undefined
  let coreUrl: string
  let readerUrl: string
  let browserUrl: string
  let conversationId: string
  let foreignId: string
  let ordinaryId: string
  const runner: BrowserRunnerClient = {
    start: vi.fn(async (input) => ({ id: input.sessionId, conversationId: input.conversationKey, incarnation: 'inc', state: 'ready' as const, activeTabId: 'tab', tabs: [], viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, currentUrl: 'https://example.com', title: 'Chromium' })),
    command: vi.fn(async () => ({ ok: true, text: 'Текст страницы из отдельного приложения' })),
    screenshot: vi.fn(async () => ({ buffer: Buffer.from('png-bytes'), mimeType: 'image/png' })),
    stop: vi.fn(async () => true)
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'vc-playwright-app-'))
    const corePort = await freePort(), playwrightPort = await freePort(), readerPort = await freePort()
    coreUrl = `http://127.0.0.1:${corePort}`
    browserUrl = playwrightMode === 'remote' ? `http://127.0.0.1:${playwrightPort}` : coreUrl
    readerUrl = webMode === 'remote' ? `http://127.0.0.1:${readerPort}` : coreUrl
    db = new VoiceChatDb(':memory:')
    await db.ready
    await db.identity.createUser('ann', 'password-1', 'developer')
    await db.identity.createUser('bob', 'password-2', 'developer')
    conversationId = (await db.chat.createConversation('ann', 'Reader', 'playwright-reader')).id
    foreignId = (await db.chat.createConversation('bob', 'Чужой', 'playwright-reader')).id
    ordinaryId = (await db.chat.createConversation('ann', 'Чат')).id
    core = await buildServer({
      config: loadConfig({ PORT: String(corePort), VC_DATA_DIR: dataDir, VC_MODELS_DIR: join(dataDir, 'models'), VC_PIPER_VOICES_DIR: join(dataDir, 'voices'),
        VC_PLAYWRIGHT_READER_MODE: playwrightMode, VC_PLAYWRIGHT_READER_URL: browserUrl,
        VC_READER_MODE: webMode, VC_READER_URL: readerUrl, VC_INTERNAL_TOKEN: INTERNAL, VC_MCP_SECRET: MCP }),
      db, sessionSecret: SECRET, ...(playwrightMode === 'embedded' ? { browserRunner: runner } : {})
    })
    await core.listen({ host: '127.0.0.1', port: corePort })
    if (playwrightMode === 'remote') {
      playwright = (await buildPlaywrightReaderServer({
        config: { host: '127.0.0.1', port: playwrightPort, coreUrl, internalToken: INTERNAL, runnerFacingBase: coreUrl, version: 'test' }, runner
      })).app
      await playwright.listen({ host: '127.0.0.1', port: playwrightPort })
    }
    if (webMode === 'remote') {
      webReader = (await buildReaderServer({
        config: loadConfig({ PORT: String(readerPort), VC_DATA_DIR: dataDir, VC_INTERNAL_TOKEN: INTERNAL, VC_MCP_SECRET: MCP,
          VC_PLAYWRIGHT_READER_MODE: playwrightMode, VC_PLAYWRIGHT_READER_URL: browserUrl }),
        db, coreUrl, machines: { isOnline: () => false, http: async () => { throw new Error('машины не используются') } }
      })).app
      await webReader.listen({ host: '127.0.0.1', port: readerPort })
    }
  }, 60_000)

  afterAll(async () => {
    await webReader?.close()
    await playwright?.close()
    await core?.close()
    await db?.close()
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  })

  async function post(base: string, path: string, body: unknown, headers: Record<string, string> = auth): Promise<Response> {
    return fetch(`${base}${path}`, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify(body) })
  }

  it('пользовательский REST работает напрямую и через ядро, изоляция разговоров сохраняется', async () => {
    for (const base of new Set([coreUrl, browserUrl])) {
      const path = `/api/browser/${conversationId}/start`
      expect((await post(base, path, {})).status).toBe(200)
      expect((await post(base, path, {}, {})).status).toBe(401)
      expect((await post(base, `/api/browser/${foreignId}/start`, {})).status).toBe(404)
      expect((await post(base, `/api/browser/${ordinaryId}/start`, {})).status).toBe(403)
      const shot = await post(base, `/api/browser/${conversationId}/screenshot`, { incarnation: 'inc' })
      expect(shot.status).toBe(200)
      expect(await shot.json()).toEqual({ dataUrl: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}` })
      // DELETE без тела не должен ломаться на JSON-парсере прокси.
      const stop = await fetch(`${base}/api/browser/${conversationId}`, { method: 'DELETE', headers: { ...auth, ...json } })
      expect(stop.status).toBe(200)
      expect(await stop.json()).toEqual({ stopped: true })
    }
    expect(runner.start).toHaveBeenCalledWith(expect.objectContaining({ sessionId: conversationId, userKey: 'ann', conversationKey: conversationId }))
  })

  it('cookie ядра действует в приложении, а мутация требует CSRF при каждом вызове', async () => {
    const login = await post(coreUrl, '/api/session/login', { name: 'ann', password: 'password-1' }, {})
    expect(login.status).toBe(200)
    const cookies = login.headers.getSetCookie().map((c) => c.split(';')[0]!)
    const cookie = cookies.join('; ')
    const csrf = cookies.find((c) => c.startsWith('vc_csrf='))!.slice('vc_csrf='.length)
    const path = `/api/browser/${conversationId}/start`
    expect((await post(browserUrl, path, {}, { cookie, 'x-vc-csrf': csrf })).status).toBe(200)
    const denied = await post(browserUrl, path, {}, { cookie })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ error: 'csrf' })
  })

  it('внутренние порты требуют сервисный токен и отвергают неизвестные методы', async () => {
    for (const [base, path] of [[coreUrl, INTERNAL_PLAYWRIGHT_READER_CORE_PATH], [browserUrl, INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH]]) {
      expect((await post(base!, path!, { method: 'execute', args: [] }, {})).status).toBe(401)
      expect((await post(base!, path!, { method: 'constructor', args: [] }, { authorization: `Bearer ${INTERNAL}` })).status).toBe(400)
    }
  })

  it('MCP передаёт модели текст и PNG из приложения, не теряя результат на RPC', async () => {
    const turn = createPreviewTurnTokens(MCP).issue({ userId: 'ann', conversationId })
    const call = async (name: string) => {
      const res = await post(coreUrl, `/mcp/preview?k=${MCP}&turn=${encodeURIComponent(turn)}`, {
        jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} }
      }, { accept: 'application/json, text/event-stream' })
      expect(res.status).toBe(200)
      return (await res.json()) as { result: { isError?: boolean; content: Array<{ type: string; text?: string; data?: string }> } }
    }
    const read = await call('read')
    expect(read.result.isError).not.toBe(true)
    expect(read.result.content[0]?.text).toContain('Текст страницы из отдельного приложения')
    expect(runner.command).toHaveBeenLastCalledWith(conversationId, expect.objectContaining({ actor: 'assistant', incarnation: 'inc' }))
    const shot = await call('screenshot')
    expect(shot.result.isError).not.toBe(true)
    expect(shot.result.content).toContainEqual(expect.objectContaining({ type: 'image', data: Buffer.from('png-bytes').toString('base64') }))
  })
})

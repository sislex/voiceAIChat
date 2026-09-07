// Ядро в режиме `remote` и отдельный процесс Make на соседних портах — как в compose. Проверяем
// границу целиком: авторизация Make пересылается ядру (Bearer, cookie + CSRF), данные разговора
// Make берёт у ядра по RPC, превью отдаётся с той же сессией, а сам процесс ядра роутов Make не
// держит. Внутренние пути без общего токена закрыты.
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildMakeServer } from '@voicechat/make/standalone'
import { INTERNAL_WHOAMI_PATH, MAKE_HEALTH_PATH } from '@voicechat/make'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { buildServer } from '../server.js'
import { signToken } from '../users/accounts.js'

const SECRET = 'session-secret'
const INTERNAL = 'internal-token'
const MCP = 'mcp-secret'

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => { const port = (srv.address() as { port: number }).port; srv.close(() => resolve(port)) })
  })
}

let dataDir: string
let db: VoiceChatDb
let core: FastifyInstance
let make: FastifyInstance
let coreUrl: string
let makeUrl: string
let convId: string
const token = signToken({ name: 'ann', role: 'developer' }, SECRET)
const auth = { authorization: `Bearer ${token}` }

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'vc-make-remote-'))
  const [corePort, makePort] = [await freePort(), await freePort()]
  coreUrl = `http://127.0.0.1:${corePort}`
  makeUrl = `http://127.0.0.1:${makePort}`
  db = new VoiceChatDb(':memory:')
  await db.identity.createUser('ann', 'password-1', 'developer')
  convId = (await db.chat.createConversation('ann', 'Витрина', 'make', null))!.id
  core = await buildServer({
    config: loadConfig({
      PORT: String(corePort), VC_DATA_DIR: dataDir, VC_MODELS_DIR: join(dataDir, 'models'), VC_PIPER_VOICES_DIR: join(dataDir, 'voices'),
      VC_MAKE_MODE: 'remote', VC_MAKE_URL: makeUrl, VC_INTERNAL_TOKEN: INTERNAL, VC_MCP_SECRET: MCP
    }),
    db, sessionSecret: SECRET
  })
  await core.listen({ host: '127.0.0.1', port: corePort })
  make = (await buildMakeServer({ config: { host: '127.0.0.1', port: makePort, dataDir, coreUrl, internalToken: INTERNAL, mcpSecret: MCP, version: 'test' } })).app
  await make.listen({ host: '127.0.0.1', port: makePort })
}, 60_000)

afterAll(async () => {
  await make?.close()
  await core?.close()
  db?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('ядро (remote) + отдельный процесс Make', () => {
  it('ядро переправляет пути Make в его процесс (стенд доступен и без Caddy); здоровье и внутренние пути закрыты токеном', async () => {
    // Через ядро — тот же ответ, что напрямую у Make: авторизация ядра, потом whoami у Make.
    const viaCore = await fetch(`${coreUrl}/api/make/${convId}`, { headers: auth })
    expect(viaCore.status).toBe(200)
    expect(((await viaCore.json()) as { conversationId: string }).conversationId).toBe(convId)
    expect((await fetch(`${coreUrl}/api/make/${convId}`)).status).toBe(401)
    expect((await fetch(`${coreUrl}/api/make/unknown`, { headers: auth })).status).toBe(404)
    expect(await (await fetch(`${makeUrl}${MAKE_HEALTH_PATH}`)).json()).toEqual({ ok: true, service: 'make', version: 'test' })
    expect((await fetch(`${coreUrl}${INTERNAL_WHOAMI_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401)
    expect((await fetch(`${makeUrl}/internal/service`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401)
  })

  it('Bearer пользователя работает у Make через ядро: состояние проекта, превью, запись; без токена — 401', async () => {
    expect((await fetch(`${makeUrl}/api/make/${convId}`)).status).toBe(401)
    const state = await (await fetch(`${makeUrl}/api/make/${convId}`, { headers: auth })).json() as { conversationId: string; files: Array<{ path: string }> }
    expect(state.conversationId).toBe(convId)
    expect(state.files.map((f) => f.path)).toContain('index.html')
    // Чужой или несуществующий разговор — 404 от данных ядра.
    expect((await fetch(`${makeUrl}/api/make/missing`, { headers: auth })).status).toBe(404)
    const put = await fetch(`${makeUrl}/api/make/${convId}/file`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ path: 'smoke.txt', content: 'remote' }) })
    expect(put.status).toBe(200)
    const preview = await fetch(`${makeUrl}/api/preview/make/${convId}/smoke.txt`, { headers: auth })
    expect(preview.status).toBe(200)
    expect(await preview.text()).toBe('remote')
    // Связи с карточками — данные канбана из ядра: у личного проекта их нет.
    expect(await (await fetch(`${makeUrl}/api/make/${convId}/task-links/tasks`, { headers: auth })).json()).toEqual([])
  })

  it('cookie-сессия ядра действует у Make, мутация без CSRF-заголовка — 403 csrf', async () => {
    const login = await fetch(`${coreUrl}/api/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ann', password: 'password-1' }) })
    expect(login.status).toBe(200)
    const cookies = login.headers.getSetCookie().map((c) => c.split(';')[0]!)
    const cookie = cookies.join('; ')
    const csrf = cookies.find((c) => c.startsWith('vc_csrf='))!.slice('vc_csrf='.length)
    expect((await fetch(`${makeUrl}/api/make/${convId}`, { headers: { cookie } })).status).toBe(200)
    const noCsrf = await fetch(`${makeUrl}/api/make/${convId}/file`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ path: 'c.txt', content: 'x' }) })
    expect(noCsrf.status).toBe(403)
    expect(await noCsrf.json()).toEqual({ error: 'csrf' })
    const withCsrf = await fetch(`${makeUrl}/api/make/${convId}/file`, { method: 'PUT', headers: { cookie, 'x-vc-csrf': csrf, 'content-type': 'application/json' }, body: JSON.stringify({ path: 'c.txt', content: 'x' }) })
    expect(withCsrf.status).toBe(200)
  })

  it('MCP Make слушает процесс Make и принимает секрет ядра', async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    expect((await fetch(`${makeUrl}/mcp/make?k=wrong&conv=${convId}`, { method: 'POST', headers, body: JSON.stringify(init) })).status).toBe(403)
    expect((await fetch(`${makeUrl}/mcp/make?k=${MCP}&conv=${convId}&turn=t1`, { method: 'POST', headers, body: JSON.stringify(init) })).status).toBe(200)
  })
})

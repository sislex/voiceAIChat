// Ядро в режиме `VC_READER_MODE=remote` и отдельный процесс Web Reader на общей базе. Проверяем: пути
// превью идут через прокси ядра с его авторизацией и перепроверкой whoami у ридера; dev-сервер машины
// открывается через мост машин ридера; MCP «browser» принимает подписанный токен хода из любого процесса;
// действие в панель уходит по RPC в relay ядра и доезжает до WS-сессии ядра; внутренние пути без токена закрыты.
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHttpRequest, ServerMessage } from '@voicechat/shared'
import type { LlmClient } from '../../claude/types.js'
import { loadConfig } from '../../config.js'
import { VoiceChatDb } from '../../db/database.js'
import { buildServer } from '../../server.js'
import { signToken } from '../../users/accounts.js'
import { AgentRegistry } from '../../agents/registry.js'
import { PREVIEW_MCP_PATH } from '../../mcp/previewMcp.js'
import { createPreviewTurnTokens } from '../turnToken.js'
import { INTERNAL_READER_CORE_PATH, READER_HEALTH_PATH } from '../internal.js'
import { buildReaderServer, type ReaderServer } from './server.js'

const SECRET = 'session-secret'
const INTERNAL = 'internal-token'
const MCP = 'mcp-secret'
const fakeLlm: LlmClient = { send: (_req, handlers) => { queueMicrotask(() => { void handlers.onDone('ок') }); return { cancel: () => {} } } }
const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

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
let reader: ReaderServer
let coreUrl: string
let readerUrl: string
let agentId: string
let conversationId: string
const machineRequests: AgentHttpRequest[] = []
const annToken = signToken({ name: 'ann', role: 'developer' }, SECRET)
const annAuth = { authorization: `Bearer ${annToken}` }
const json = { 'content-type': 'application/json' }

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'vc-reader-remote-'))
  const [corePort, readerPort] = [await freePort(), await freePort()]
  coreUrl = `http://127.0.0.1:${corePort}`
  readerUrl = `http://127.0.0.1:${readerPort}`
  db = new VoiceChatDb(':memory:')
  await db.ready
  await db.identity.createUser('ann', 'password-1', 'developer')
  agentId = (await db.machines.createAgent('ann', 'Dev machine')).id
  conversationId = (await db.chat.createConversation('ann', 'Reader')).id
  core = await buildServer({
    config: loadConfig({
      PORT: String(corePort), VC_DATA_DIR: dataDir, VC_MODELS_DIR: join(dataDir, 'models'), VC_PIPER_VOICES_DIR: join(dataDir, 'voices'),
      VC_READER_MODE: 'remote', VC_READER_URL: readerUrl, VC_INTERNAL_TOKEN: INTERNAL, VC_MCP_SECRET: MCP
    }),
    db, sessionSecret: SECRET, claude: fakeLlm, codex: fakeLlm, agentRegistry: new AgentRegistry({ offlineGraceMs: 0 })
  })
  await core.listen({ host: '127.0.0.1', port: corePort })
  reader = await buildReaderServer({
    config: loadConfig({ PORT: String(readerPort), VC_DATA_DIR: dataDir, VC_INTERNAL_TOKEN: INTERNAL, VC_MCP_SECRET: MCP, VC_MCP_PUBLIC_BASE: coreUrl }),
    coreUrl, db, version: 'test',
    // Мост машин: «dev-сервер» отвечает страницей без сети — проверяем доставку через ридер, а не агента.
    machines: {
      isOnline: (id) => id === agentId,
      http: async (_id, request) => {
        machineRequests.push(request)
        return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, bodyBase64: Buffer.from('<h1>Dev server via reader</h1>').toString('base64') }
      }
    }
  })
  await reader.app.listen({ host: '127.0.0.1', port: readerPort })
}, 60_000)

afterAll(async () => {
  await reader?.app.close()
  await core?.close()
  await db?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

function connect(url: string, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`${url.replace('http', 'ws')}/ws?token=${token}`)
  return new Promise((res, rej) => { ws.on('open', () => res(ws)); ws.on('error', rej) })
}

async function callTool(base: string, turn: string, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError?: boolean }> {
  const res = await fetch(`${base}${PREVIEW_MCP_PATH}?k=${MCP}&turn=${encodeURIComponent(turn)}`, {
    method: 'POST', headers: MCP_HEADERS,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { result: { content: Array<{ type: string; text?: string }>; isError?: boolean } }
  return { text: body.result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), ...(body.result.isError ? { isError: true } : {}) }
}

describe('ядро (reader remote) + отдельный процесс Web Reader', () => {
  it('app.internal возвращает ресурсы ядра через RPC, сохраняя отдельную авторизацию страницы', async () => {
    const preview = (path: string) => fetch(`${coreUrl}/api/preview?url=${encodeURIComponent('https://app.internal' + path)}`, { headers: annAuth })
    const health = await preview('/api/health')
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true })
    expect((await preview('/api/conversations')).status).toBe(401)
    expect((await preview('/internal/reader/core')).status).toBe(403)
    expect((await preview('/api/preview?url=https://app.internal/')).status).toBe(403)
  })

  it('здоровье; внутренний RPC ядра без токена закрыт; превью без сессии — 401 у ядра и у ридера', async () => {
    expect(await (await fetch(`${readerUrl}${READER_HEALTH_PATH}`)).json()).toEqual({ ok: true, service: 'reader', version: 'test', engine: db.engine })
    expect((await fetch(`${coreUrl}${INTERNAL_READER_CORE_PATH}`, { method: 'POST', headers: json, body: '{}' })).status).toBe(401)
    expect((await fetch(`${coreUrl}/api/preview?url=https%3A%2F%2Fexample.com%2F`)).status).toBe(401)
    expect((await fetch(`${readerUrl}/api/preview?url=https%3A%2F%2Fexample.com%2F`)).status).toBe(401)
  })

  it('dev-сервер машины открывается через прокси ядра: whoami у ридера, доступ к машине по базе, доставка мостом машин', async () => {
    const res = await fetch(`${coreUrl}/api/preview?url=${encodeURIComponent(`http://${agentId}.machine.internal:5173/`)}`, { headers: annAuth })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('Dev server via reader')
    expect(machineRequests.at(-1)).toMatchObject({ method: 'GET', port: 5173, path: '/' })
    // Чужая машина — 403 у ридера (гейт по общей базе), даже при действительной сессии.
    const other = (await db.machines.createAgent('admin', 'Not mine')).id
    expect((await fetch(`${coreUrl}/api/preview?url=${encodeURIComponent(`http://${other}.machine.internal:5173/`)}`, { headers: annAuth })).status).toBe(403)
    // Сброс cookie-контейнера — тоже у ридера.
    expect((await fetch(`${coreUrl}/api/preview/reset-cookies`, { method: 'POST', headers: { ...annAuth, ...json }, body: '{}' })).status).toBe(200)
  })

  it('MCP «browser»: подписанный токен из другого процесса принят; действие в панель уходит по RPC в relay ядра и доезжает до WS-сессии', async () => {
    // Токен выдан «в процессе канбана» — другой экземпляр с тем же секретом.
    const turn = createPreviewTurnTokens(MCP).issue({ userId: 'ann', conversationId })
    // Без подключённого клиента relay ядра отвечает отказом — ответ пришёл из ядра по RPC.
    const offline = await callTool(readerUrl, turn, 'read')
    expect(offline.isError).toBe(true)
    expect(offline.text).toContain('не подключён')
    // Клиент ядра онлайн: отвечает на preview.action — результат возвращается модели через ридер.
    const ws = await connect(coreUrl, annToken)
    try {
      ws.on('message', (data: Buffer) => {
        const m = JSON.parse(data.toString()) as ServerMessage
        if (m.t === 'preview.action') ws.send(JSON.stringify({ t: 'preview.result', conversationId: m.conversationId, requestId: m.requestId, ok: true, result: { url: 'https://a.b/', title: 'Панель' } }))
      })
      await new Promise((r) => setTimeout(r, 100))
      const viaCore = await callTool(coreUrl, turn, 'read')
      expect(viaCore.isError).toBeUndefined()
      expect(viaCore.text).toContain('https://a.b/')
    } finally { ws.close() }
    // Токен под чужим секретом — контекста хода нет.
    const forged = await callTool(readerUrl, createPreviewTurnTokens('other').issue({ userId: 'ann', conversationId }), 'read')
    expect(forged.isError).toBe(true)
    expect(forged.text).toContain('Контекст хода недоступен')
  })
})

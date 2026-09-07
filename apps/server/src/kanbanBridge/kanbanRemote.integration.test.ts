// Ядро в режиме `VC_KANBAN_MODE=remote` и отдельный процесс канбана на соседних портах — как в compose,
// на общей базе (один экземпляр `:memory:` в одном процессе теста). Проверяем границу целиком: пути
// канбана идут через прокси ядра с его авторизацией и перепроверкой whoami у канбана, данные — общие,
// события доски из процесса канбана доезжают до WS-сессии ядра, состояние машин канбан берёт у ядра по
// внутреннему API, а внутренние пути без общего токена закрыты.
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Board, ProjectDetail, ServerMessage } from '@voicechat/shared'
import { AgentRegistry } from '../agents/registry.js'
import type { LlmClient } from '../claude/types.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { INTERNAL_KANBAN_CORE_PATH, KANBAN_HEALTH_PATH, KANBAN_INTERNAL_SERVICE_PATH } from '../kanban/internal.js'
import { HttpKanbanCore } from '../kanban/standalone/httpCore.js'
import { buildKanbanServer, type KanbanServer } from '../kanban/standalone/server.js'
import { buildServer } from '../server.js'
import { signToken } from '../users/accounts.js'

const SECRET = 'session-secret'
const INTERNAL = 'internal-token'
const MCP = 'mcp-secret'
const fakeLlm: LlmClient = { send: (_req, handlers) => { queueMicrotask(() => { void handlers.onDone('ок') }); return { cancel: () => {} } } }

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
let kanban: KanbanServer
let coreUrl: string
let kanbanUrl: string
const adminAuth = { authorization: `Bearer ${signToken({ name: 'admin', role: 'admin' }, SECRET)}` }
const annAuth = { authorization: `Bearer ${signToken({ name: 'ann', role: 'developer' }, SECRET)}` }
const json = { 'content-type': 'application/json' }

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'vc-kanban-remote-'))
  const [corePort, kanbanPort] = [await freePort(), await freePort()]
  coreUrl = `http://127.0.0.1:${corePort}`
  kanbanUrl = `http://127.0.0.1:${kanbanPort}`
  db = new VoiceChatDb(':memory:')
  await db.ready
  await db.identity.createUser('ann', 'password-1', 'developer')
  core = await buildServer({
    config: loadConfig({
      PORT: String(corePort), VC_DATA_DIR: dataDir, VC_MODELS_DIR: join(dataDir, 'models'), VC_PIPER_VOICES_DIR: join(dataDir, 'voices'),
      VC_KANBAN_MODE: 'remote', VC_KANBAN_URL: kanbanUrl, VC_INTERNAL_TOKEN: INTERNAL, VC_MCP_SECRET: MCP
    }),
    db, sessionSecret: SECRET, claude: fakeLlm, codex: fakeLlm, agentRegistry: new AgentRegistry({ offlineGraceMs: 0 })
  })
  await core.listen({ host: '127.0.0.1', port: corePort })
  kanban = await buildKanbanServer({
    config: loadConfig({ PORT: String(kanbanPort), VC_DATA_DIR: dataDir, VC_INTERNAL_TOKEN: INTERNAL, VC_MCP_SECRET: MCP, VC_MCP_PUBLIC_BASE: coreUrl }),
    coreUrl, db, claude: fakeLlm, codex: fakeLlm, version: 'test'
  })
  await kanban.app.listen({ host: '127.0.0.1', port: kanbanPort })
}, 60_000)

afterAll(async () => {
  await kanban?.app.close()
  await core?.close()
  await db?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

function connect(url: string, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`${url.replace('http', 'ws')}/ws?token=${token}`)
  return new Promise((res, rej) => { ws.on('open', () => res(ws)); ws.on('error', rej) })
}

function waitFrame(ws: WebSocket, match: (m: ServerMessage) => boolean, ms = 3000): Promise<ServerMessage | null> {
  return new Promise((resolve) => {
    const onMsg = (d: Buffer): void => {
      const m = JSON.parse(d.toString()) as ServerMessage
      if (match(m)) { ws.off('message', onMsg); resolve(m) }
    }
    ws.on('message', onMsg)
    setTimeout(() => { ws.off('message', onMsg); resolve(null) }, ms)
  })
}

describe('ядро (remote) + отдельный процесс канбана', () => {
  it('здоровье канбана; внутренние пути обеих сторон без общего токена закрыты', async () => {
    expect(await (await fetch(`${kanbanUrl}${KANBAN_HEALTH_PATH}`)).json()).toEqual({ ok: true, service: 'kanban', version: 'test', engine: 'sqlite', machines: 0 })
    expect((await fetch(`${coreUrl}${INTERNAL_KANBAN_CORE_PATH}`, { method: 'POST', headers: json, body: '{}' })).status).toBe(401)
    expect((await fetch(`${kanbanUrl}${KANBAN_INTERNAL_SERVICE_PATH}`, { method: 'POST', headers: json, body: '{}' })).status).toBe(401)
    const snapshot = await fetch(`${coreUrl}${INTERNAL_KANBAN_CORE_PATH}`, { method: 'POST', headers: { ...json, authorization: `Bearer ${INTERNAL}` }, body: JSON.stringify({ method: 'machines.snapshot', args: [] }) })
    expect(await snapshot.json()).toEqual({ result: [] })
  })

  it('пути канбана идут через ядро: авторизация ядра, потом whoami у канбана; без токена — 401 на обоих', async () => {
    expect((await fetch(`${coreUrl}/api/projects`)).status).toBe(401)
    expect((await fetch(`${kanbanUrl}/api/projects`)).status).toBe(401)
    const viaCore = await fetch(`${coreUrl}/api/projects`, { headers: annAuth })
    expect(viaCore.status).toBe(200)
    expect(await viaCore.json()).toEqual([])
    const direct = await fetch(`${kanbanUrl}/api/projects`, { headers: annAuth })
    expect(direct.status).toBe(200)
    // Роут ядра под тем же префиксом остаётся у ядра (git-панель), а не уходит в прокси.
    expect((await fetch(`${coreUrl}/api/projects/nope/git/workspaces`, { headers: adminAuth })).status).not.toBe(503)
  })

  it('мутация через ядро пишет в общую базу, а событие доски из процесса канбана доезжает до WS-сессии ядра', async () => {
    const created = await fetch(`${coreUrl}/api/projects`, { method: 'POST', headers: { ...adminAuth, ...json }, body: JSON.stringify({ name: 'Remote P1' }) })
    expect(created.status).toBe(200)
    const project = (await created.json()) as ProjectDetail
    expect(await db.projects.getProject('admin', project.id)).not.toBeNull()
    const ws = await connect(coreUrl, adminAuth.authorization.slice('Bearer '.length))
    try {
      ws.send(JSON.stringify({ t: 'board.subscribe', projectId: project.id }))
      await new Promise((r) => setTimeout(r, 100))
      const board = (await (await fetch(`${coreUrl}/api/projects/${project.id}/board`, { headers: adminAuth })).json()) as Board
      const changed = waitFrame(ws, (m) => m.t === 'board.changed' && (m as { projectId: string }).projectId === project.id)
      const task = await fetch(`${coreUrl}/api/projects/${project.id}/tasks`, { method: 'POST', headers: { ...adminAuth, ...json }, body: JSON.stringify({ columnId: board.columns[0]!.id, title: 'Через прокси' }) })
      expect(task.status).toBe(200)
      expect(await changed).not.toBeNull()
    } finally { ws.close() }
  })

  it('MCP канбана слушает процесс канбана и доступен через ядро с тем же секретом', async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }
    const headers = { ...json, accept: 'application/json, text/event-stream' }
    expect((await fetch(`${coreUrl}/mcp/kanban?k=wrong&conv=c1`, { method: 'POST', headers, body: JSON.stringify(init) })).status).toBe(403)
    expect((await fetch(`${kanbanUrl}/mcp/kanban?k=wrong&conv=c1`, { method: 'POST', headers, body: JSON.stringify(init) })).status).toBe(403)
  })

  it('состояние машин канбан берёт у ядра: команда для незнакомой машины падает как offline, зеркало пусто', async () => {
    const httpCore = kanban.core as HttpKanbanCore
    expect(httpCore).toBeInstanceOf(HttpKanbanCore)
    expect(httpCore.mirror.size()).toBe(0)
    expect(httpCore.machines.isOnline('nope')).toBe(false)
    await expect(httpCore.machines.exec('nope', 'echo hi', 1000)).rejects.toThrow()
    await expect(httpCore.machines.fsRead('nope', '/tmp')).rejects.toThrow()
  })
})

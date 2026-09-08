// Ядро в режиме `VC_MACHINES_MODE=remote` и отдельный процесс машин на соседних портах, общая база и
// фейковый компаньон-агент, который подключается к ядру (`/agent`) и через прокси попадает в процесс
// машин. Проверяем цепочку целиком: регистрация агента через WebSocket-прокси, список машин через прокси
// REST, команда через REST с журналом и кадром `machine.command` до WS-сессии ядра, PTY из сессии ядра —
// RPC в процесс машин, вывод обратно по шине событий; внутренние пути без токена закрыты.
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AGENT_VERSION, type AgentInfo, type AgentToServer, type ServerMessage, type ServerToAgent } from '@voicechat/shared'
import type { LlmClient } from '../claude/types.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { MACHINES_HEALTH_PATH, MACHINES_INTERNAL_RPC_PATH } from '../machines/internal.js'
import { buildMachinesServer, type MachinesServer } from '../machines/standalone/server.js'
import { buildServer } from '../server.js'
import { signToken } from '../users/accounts.js'

const SECRET = 'session-secret'
const INTERNAL = 'internal-token'
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
let machines: MachinesServer
let coreUrl: string
let machinesUrl: string
let agentId: string
let agent: WebSocket
const annToken = signToken({ name: 'ann', role: 'developer' }, SECRET)
const annAuth = { authorization: `Bearer ${annToken}` }
const json = { 'content-type': 'application/json' }

/** Фейковый агент: регистрируется, отвечает на exec и PTY как настоящий компаньон. */
function connectFakeAgent(url: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${url.replace('http', 'ws')}/agent`)
    const send = (m: AgentToServer): void => socket.send(JSON.stringify(m))
    socket.on('error', reject)
    socket.on('open', () => send({ t: 'agent.register', token, version: AGENT_VERSION }))
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerToAgent
      if (msg.t === 'agent.registered') resolve(socket)
      else if (msg.t === 'agent.denied') reject(new Error(msg.reason))
      else if (msg.t === 'exec.start') { send({ t: 'exec.chunk', execId: msg.execId, stream: 'stdout', data: `ran: ${msg.command}\n` }); send({ t: 'exec.done', execId: msg.execId, exitCode: 0 }) }
      else if (msg.t === 'pty.start') send({ t: 'pty.output', ptyId: msg.ptyId, data: '$ ' })
      else if (msg.t === 'pty.input') send({ t: 'pty.output', ptyId: msg.ptyId, data: `echo:${msg.data}` })
    })
  })
}

async function waitFor<T>(probe: () => Promise<T | null | false | undefined>, ms = 5000): Promise<T> {
  const until = Date.now() + ms
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() > until) throw new Error('waitFor: timeout')
    await new Promise((r) => setTimeout(r, 50))
  }
}

function connectSession(url: string, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`${url.replace('http', 'ws')}/ws?token=${token}`)
  return new Promise((res, rej) => { ws.on('open', () => res(ws)); ws.on('error', rej) })
}

function collect(ws: WebSocket): ServerMessage[] {
  const frames: ServerMessage[] = []
  ws.on('message', (d) => frames.push(JSON.parse(d.toString()) as ServerMessage))
  return frames
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'vc-machines-remote-'))
  const [corePort, machinesPort] = [await freePort(), await freePort()]
  coreUrl = `http://127.0.0.1:${corePort}`
  machinesUrl = `http://127.0.0.1:${machinesPort}`
  db = new VoiceChatDb(':memory:')
  await db.ready
  await db.identity.createUser('ann', 'password-1', 'developer')
  const created = await db.machines.createAgent('ann', 'Fake machine')
  agentId = created.id
  machines = await buildMachinesServer({
    config: loadConfig({ PORT: String(machinesPort), VC_DATA_DIR: dataDir, VC_INTERNAL_TOKEN: INTERNAL, VC_LONG_COMMAND_MS: '0', VC_AGENT_OFFLINE_GRACE_MS: '0' }),
    coreUrl, db, version: 'test'
  })
  await machines.app.listen({ host: '127.0.0.1', port: machinesPort })
  core = await buildServer({
    config: loadConfig({
      PORT: String(corePort), VC_DATA_DIR: dataDir, VC_MODELS_DIR: join(dataDir, 'models'), VC_PIPER_VOICES_DIR: join(dataDir, 'voices'),
      VC_MACHINES_MODE: 'remote', VC_MACHINES_URL: machinesUrl, VC_INTERNAL_TOKEN: INTERNAL
    }),
    db, sessionSecret: SECRET, claude: fakeLlm, codex: fakeLlm
  })
  await core.listen({ host: '127.0.0.1', port: corePort })
  // Агент идёт в ядро — как через Caddy на публичный хост; ядро переправляет WebSocket в процесс машин.
  agent = await connectFakeAgent(coreUrl, created.token)
}, 60_000)

afterAll(async () => {
  agent?.close()
  await core?.close()
  await machines?.app.close()
  await db?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('ядро (remote) + отдельный процесс машин', () => {
  it('агент через WebSocket-прокси ядра зарегистрирован в процессе машин; ядро подключено к шине; внутренние пути без токена закрыты', async () => {
    expect(machines.registry.isOnline(agentId)).toBe(true)
    const health = await waitFor(async () => { const h = await (await fetch(`${machinesUrl}${MACHINES_HEALTH_PATH}`)).json() as { cores: number; online: number }; return h.cores === 1 ? h : null })
    expect(health).toMatchObject({ ok: true, service: 'machines', version: 'test', engine: db.engine, online: 1, cores: 1 })
    expect((await fetch(`${machinesUrl}${MACHINES_INTERNAL_RPC_PATH}`, { method: 'POST', headers: json, body: '{}' })).status).toBe(401)
  })

  it('REST машин идёт через прокси ядра с его авторизацией: список показывает машину онлайн, команда выполняется агентом', async () => {
    expect((await fetch(`${coreUrl}/api/agents`)).status).toBe(401)
    const list = (await (await fetch(`${coreUrl}/api/agents`, { headers: annAuth })).json()) as AgentInfo[]
    expect(list.map((a) => ({ id: a.id, online: a.online, version: a.version }))).toEqual([{ id: agentId, online: true, version: AGENT_VERSION }])
    const session = await connectSession(coreUrl, annToken)
    const frames = collect(session)
    try {
      const exec = await fetch(`${coreUrl}/api/agents/${agentId}/exec`, { method: 'POST', headers: { ...annAuth, ...json }, body: JSON.stringify({ command: 'echo hi' }) })
      expect(exec.status).toBe(200)
      expect(((await exec.json()) as { output: string }).output).toBe('ran: echo hi\n')
      // Журнал команд пишет процесс машин; тост владельцу доезжает до WS-сессии ядра по шине событий.
      const toast = await waitFor(async () => frames.find((f) => f.t === 'machine.command') ?? null)
      expect((toast as { event: { command: string; machineId: string } }).event).toMatchObject({ command: 'echo hi', machineId: agentId })
      expect((await db.machines.listMachineCommands(agentId, { limit: 10 })).map((c) => c.command)).toContain('echo hi')
    } finally { session.close() }
  })

  it('PTY из WS-сессии ядра: старт и ввод — RPC в процесс машин, вывод — по шине событий обратно в сессию', async () => {
    const session = await connectSession(coreUrl, annToken)
    const frames = collect(session)
    try {
      session.send(JSON.stringify({ t: 'pty.start', agentId, ptyId: 'pty-1', cols: 80, rows: 24 }))
      await waitFor(async () => frames.find((f) => f.t === 'pty.output' && (f as { data: string }).data === '$ ') ?? null)
      session.send(JSON.stringify({ t: 'pty.input', ptyId: 'pty-1', data: 'ls\r' }))
      await waitFor(async () => frames.find((f) => f.t === 'pty.output' && (f as { data: string }).data === 'echo:ls\r') ?? null)
      expect(machines.registry.ptyLive('pty-1')).toBe(true)
      session.send(JSON.stringify({ t: 'pty.kill', ptyId: 'pty-1' }))
      await waitFor(async () => (machines.registry.ptyLive('pty-1') ? null : true))
    } finally { session.close() }
  })
})

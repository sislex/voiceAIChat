// Ядро в режиме `VC_ADMIN_MODE=remote` (машины встроены, внутренний API машин у ядра) и отдельный процесс
// админки на общей базе. Проверяем: `/api/admin/*` идёт через прокси ядра с его проверкой роли, машины
// админка берёт у ядра тем же клиентом `HttpMachines`, деплой уходит в ядро по RPC, типы проектов остаются
// у канбана (не в админке), внутренние пути без токена закрыты.
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LlmClient } from '../../claude/types.js'
import { loadConfig } from '../../config.js'
import { VoiceChatDb } from '../../db/database.js'
import { buildServer } from '../../server.js'
import { signToken } from '../../users/accounts.js'
import { ADMIN_HEALTH_PATH, INTERNAL_ADMIN_RPC_PATH } from '../internal.js'
import { buildAdminServer, type AdminServer } from './server.js'

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
let admin: AdminServer
let coreUrl: string
let adminUrl: string
const deploy = vi.fn(async () => ({ status: 'accepted' as const, message: 'deployment started' }))
const adminAuth = { authorization: `Bearer ${signToken({ name: 'admin', role: 'admin' }, SECRET)}` }
const annAuth = { authorization: `Bearer ${signToken({ name: 'ann', role: 'developer' }, SECRET)}` }
const json = { 'content-type': 'application/json' }

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'vc-admin-remote-'))
  const [corePort, adminPort] = [await freePort(), await freePort()]
  coreUrl = `http://127.0.0.1:${corePort}`
  adminUrl = `http://127.0.0.1:${adminPort}`
  db = new VoiceChatDb(':memory:')
  await db.ready
  await db.identity.createUser('ann', 'password-1', 'developer')
  await db.machines.createAgent('ann', 'Offline machine')
  core = await buildServer({
    config: loadConfig({
      PORT: String(corePort), VC_DATA_DIR: dataDir, VC_MODELS_DIR: join(dataDir, 'models'), VC_PIPER_VOICES_DIR: join(dataDir, 'voices'),
      VC_ADMIN_MODE: 'remote', VC_ADMIN_URL: adminUrl, VC_INTERNAL_TOKEN: INTERNAL, VC_MCP_SECRET: MCP
    }),
    db, sessionSecret: SECRET, claude: fakeLlm, codex: fakeLlm, deployTrigger: { trigger: deploy }
  })
  await core.listen({ host: '127.0.0.1', port: corePort })
  admin = await buildAdminServer({
    config: loadConfig({ PORT: String(adminPort), VC_DATA_DIR: dataDir, VC_INTERNAL_TOKEN: INTERNAL, VC_MCP_SECRET: MCP }),
    coreUrl, db, version: 'test'
  })
  await admin.app.listen({ host: '127.0.0.1', port: adminPort })
}, 60_000)

afterAll(async () => {
  await admin?.app.close()
  await core?.close()
  await db?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('ядро (admin remote) + отдельный процесс админки', () => {
  it('здоровье; внутренний RPC ядра без токена закрыт; чужая роль — 403 у ядра до прокси', async () => {
    expect(await (await fetch(`${adminUrl}${ADMIN_HEALTH_PATH}`)).json()).toEqual({ ok: true, service: 'admin', version: 'test', engine: 'sqlite' })
    expect((await fetch(`${coreUrl}${INTERNAL_ADMIN_RPC_PATH}`, { method: 'POST', headers: json, body: '{}' })).status).toBe(401)
    expect((await fetch(`${coreUrl}/api/admin/users`)).status).toBe(401)
    expect((await fetch(`${coreUrl}/api/admin/users`, { headers: annAuth })).status).toBe(403)
  })

  it('пользователи и статистика машин — через прокси ядра; машины админка видит клиентом HttpMachines к ядру', async () => {
    const users = await fetch(`${coreUrl}/api/admin/users`, { headers: adminAuth })
    expect(users.status).toBe(200)
    expect(((await users.json()) as Array<{ name: string }>).map((u) => u.name).sort()).toEqual(['admin', 'ann'])
    const stats = await fetch(`${coreUrl}/api/admin/machines/stats`, { headers: adminAuth })
    expect(stats.status).toBe(200)
    expect(await stats.json()).toHaveProperty('generatedAt')
    // Типы проектов — канбан, не админка: во встроенном канбане роут остаётся у ядра.
    expect((await fetch(`${coreUrl}/api/admin/project-types`, { headers: adminAuth })).status).toBe(200)
  })

  it('деплой из админки уходит в ядро по RPC (сокет host-side API живёт у ядра)', async () => {
    const res = await fetch(`${coreUrl}/api/admin/deploy`, { method: 'POST', headers: { ...adminAuth, ...json }, body: '{}' })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'accepted', message: 'deployment started' })
    expect(deploy).toHaveBeenCalledTimes(1)
  })
})

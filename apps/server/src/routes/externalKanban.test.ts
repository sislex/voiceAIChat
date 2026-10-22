import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { parseApplications } from '@voicechat/shared'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import type { LlmClient } from '../claude/types.js'
import { ApplicationTickets } from './applicationTickets.js'
import { INTERNAL_KANBAN_CORE_PATH } from '../kanban/internal.js'

const PROJECTS = 'projects-application-token'
const SERVICE = 'projects-service-token'
const APPLICATIONS = 'chat,projects=https://kanban.example.org'

let app: FastifyInstance
let db: VoiceChatDb
let dataDir: string
const calls: Array<{ url: string; authorization: string | null; core: string | null }> = []
const send: LlmClient['send'] = (_request, handlers) => { queueMicrotask(() => { void handlers.onDone('ok') }); return { cancel: () => {} } }

beforeEach(async () => {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({ url: String(input), authorization: headers.get('authorization'), core: headers.get('x-sislexa-core-id') })
    return Response.json({ result: null, ok: true })
  }))
  dataDir = mkdtempSync(join(tmpdir(), 'vc-external-kanban-'))
  db = new VoiceChatDb(':memory:')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_CORE_ID: 'core-a', VC_APPLICATIONS: APPLICATIONS, VC_DATA_DIR: dataDir,
      VC_MODELS_DIR: join(dataDir, 'models'), VC_PIPER_VOICES_DIR: join(dataDir, 'voices') }),
    db, sessionSecret: 'external-kanban-secret', claude: { send }, codex: { send },
    applicationTickets: { tickets: new ApplicationTickets(), manifest: { coreId: 'core-a', applications: parseApplications(APPLICATIONS) },
      credentials: { projects: PROJECTS }, serviceTokens: { projects: SERVICE } }
  })
})
afterEach(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); vi.unstubAllGlobals() })

it('serves the Kanban Core RPC to the external host with the projects application token only', async () => {
  const rpc = { method: 'machines.snapshot', args: [] }
  expect((await app.inject({ method: 'POST', url: INTERNAL_KANBAN_CORE_PATH, payload: rpc })).statusCode).toBe(401)
  expect((await app.inject({ method: 'POST', url: INTERNAL_KANBAN_CORE_PATH, payload: rpc, headers: { authorization: `Bearer ${SERVICE}` } })).statusCode).toBe(401)
  const ok = await app.inject({ method: 'POST', url: INTERNAL_KANBAN_CORE_PATH, payload: rpc, headers: { authorization: `Bearer ${PROJECTS}` } })
  expect(ok.statusCode).toBe(200)
  expect(ok.json()).toEqual({ result: [] })
})

it('calls the external host as this core with its service credential and does not proxy the board UI', async () => {
  await app.inject({ method: 'GET', url: '/api/projects' })
  expect(calls.some(call => call.url.startsWith('https://kanban.example.org/api/'))).toBe(false)
  // Machine changes are pushed to the shared host, identified by core id and service credential.
  const pushed = calls.filter(call => call.url.startsWith('https://kanban.example.org/'))
  for (const call of pushed) expect(call).toMatchObject({ authorization: `Bearer ${SERVICE}`, core: 'core-a' })
})

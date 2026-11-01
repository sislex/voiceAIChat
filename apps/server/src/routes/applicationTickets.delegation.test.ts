import { storageBytes } from '../../../../packages/file-storage/src/client.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { parseApplications } from '@voicechat/shared'
import { signToken } from '@sislexa/identity/server/users/accounts'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import type { LlmClient } from '../claude/types.js'
import { ApplicationTickets } from './applicationTickets.js'
import { SHARED_SESSION_TTL_MS } from '../auth/ticketDelegation.js'

const SECRET = 'ticket-delegation-secret'
const MAKE = 'make-service-credential'
const READER = 'reader-service-credential'
const APPLICATIONS = 'chat,make=https://make.example.org,web-reader=https://reader.example.org'

let app: FastifyInstance
let db: VoiceChatDb
let dataDir: string
let now: number
let tickets: ApplicationTickets
const send = vi.fn<LlmClient['send']>((_request, handlers) => { queueMicrotask(() => { void handlers.onDone('ok') }); return { cancel: () => {} } })

beforeEach(async () => {
  now = Date.now()
  send.mockClear()
  dataDir = mkdtempSync(join(tmpdir(), 'vc-ticket-delegation-'))
  db = new VoiceChatDb(':memory:')
  tickets = new ApplicationTickets(() => now)
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_CORE_ID: 'core-a', VC_APPLICATIONS: APPLICATIONS, VC_DATA_DIR: dataDir, VC_MODELS_DIR: join(dataDir, 'models'), VC_PIPER_VOICES_DIR: join(dataDir, 'voices') }),
    db, sessionSecret: SECRET, claude: { send }, codex: { send },
    applicationTickets: { tickets, manifest: { coreId: 'core-a', applications: parseApplications(APPLICATIONS) },
      credentials: { make: MAKE, 'web-reader': READER } }
  })
})
afterEach(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }) })

async function enterMake() {
  const user = signToken({ name: 'admin', role: 'admin' }, SECRET)
  const entered = await app.inject({ method: 'POST', url: '/api/applications/make/enter', headers: { authorization: `Bearer ${user}` } })
  expect(entered.statusCode).toBe(200)
  const ticket = new URL(entered.json().url).searchParams.get('ticket')
  const redeemed = await app.inject({ method: 'POST', url: '/internal/v1/tickets/redeem', headers: { authorization: `Bearer ${MAKE}` }, payload: { ticket, application: 'make' } })
  expect(redeemed.statusCode).toBe(200)
  return redeemed.json<{ expiresAt: number; delegation: { token: string; expiresAt: number } }>()
}
const chatSession = (token: string, conversationId: string, credential: string | undefined = MAKE) => app.inject({
  method: 'POST', url: `/api/chat/session?conversationId=${conversationId}`,
  headers: { 'x-sislexa-delegation': token, ...(credential ? { authorization: `Bearer ${credential}` } : {}) } })

describe('Core-issued ticket delegation', () => {
  it('authenticates Make storage, resolves whoami and delegates a browser cookie through the shared proxy', async () => {
    await app.close()
    const blobs = new Map<string, Uint8Array>()
    const originalFetch = globalThis.fetch
    let proxyHeaders = new Headers()
    vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
      if (new URL(String(input)).hostname !== 'make.test') return originalFetch(input, init)
      proxyHeaders = new Headers(init?.headers)
      return Response.json({ ok: true })
    })
    try {
      app = await buildServer({
        config: loadConfig({ PORT: '0', VC_CORE_ID: 'core-a', VC_APPLICATIONS: 'chat,make',
          VC_INTERNAL_TOKEN: 'legacy', VC_MCP_SECRET: 'mcp', VC_DATA_DIR: dataDir, VC_MODELS_DIR: join(dataDir, 'models'), VC_PIPER_VOICES_DIR: join(dataDir, 'voices'),
          VC_MAKE_MODE: 'remote', VC_MAKE_URL: 'http://make.test', VC_FILE_STORAGE_MODE: 'embedded' }),
        db, sessionSecret: SECRET, claude: { send }, codex: { send },
        storageNodes: [0, 1].map(i => ({ id: 'node-' + i,
          health: async () => ({ nodeId: 'node-' + i, capacityBytes: 1e9, usedBytes: 0, freeBytes: 1e9 }),
          put: async (id, bytes) => { blobs.set(id, await storageBytes(bytes)) }, get: async id => blobs.get(id)!,
          delete: async id => { blobs.delete(id) },
        })),
        applicationTickets: { tickets, manifest: { coreId: 'core-a', applications: parseApplications(APPLICATIONS) },
          credentials: { make: MAKE, 'web-reader': READER }, serviceTokens: { make: 'core-to-make' } },
      })
      const user = signToken({ name: 'admin', role: 'admin' }, SECRET)
      const browser = await app.inject({ url: '/api/make/project', headers: { cookie: 'vc_session=' + user,
        'x-sislexa-core-id': 'forged', 'x-sislexa-mcp-token': 'forged' } })
      expect(browser.statusCode, browser.body).toBe(200)
      expect(proxyHeaders.get('authorization')).toBe('Bearer core-to-make')
      expect(proxyHeaders.get('x-sislexa-core-id')).toBe('core-a')
      expect(proxyHeaders.has('cookie')).toBe(false)
      expect(proxyHeaders.has('x-sislexa-mcp-token')).toBe(false)
      const token = proxyHeaders.get('x-sislexa-delegation')!
      expect(tickets.delegations.lookup(token)).toMatchObject({ userId: 'admin', applicationId: 'make', coreId: 'core-a' })
      const headers = { authorization: 'Bearer ' + MAKE, 'x-sislexa-delegation': token }
      const who = await app.inject({ method: 'POST', url: '/internal/whoami', headers,
        payload: { method: 'GET', url: '/api/make/project', headers: { authorization: 'Bearer forged' } } })
      expect(who.statusCode, who.body).toBe(200)
      expect(who.json()).toMatchObject({ ok: true, user: { name: 'admin' } })
      const created = await app.inject({ method: 'POST', url: '/api/storage/spaces', headers,
        payload: { kind: 'make-project', title: 'Project', ref: 'project' } })
      expect(created.statusCode, created.body).toBe(200)
      const file = '/api/storage/spaces/' + created.json().id + '/file?path=index.html'
      expect((await app.inject({ method: 'PUT', url: file, headers: { ...headers, 'content-type': 'text/plain' }, payload: 'shared file' })).statusCode).toBe(200)
      const visible = await app.inject({ url: '/api/storage/spaces', headers: { cookie: 'vc_session=' + user } })
      expect(visible.json()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'make-project', ref: 'project' })]))
      expect((await app.inject({ url: file, headers })).body).toBe('shared file')
      await db.identity.createUser('bob', '', 'developer')
      const foreign = tickets.delegations.issue({ applicationId: 'make', coreId: 'core-a', userId: 'bob',
        tenantId: 'personal:bob', sid: null, expiresAt: Date.now() + 60000 }).token
      expect((await app.inject({ url: file, headers: { ...headers, 'x-sislexa-delegation': foreign } })).statusCode).toBe(403)
      for (const bad of [
        { ...headers, authorization: 'Bearer ' + READER },
        { ...headers, cookie: 'vc_session=' + user },
        { authorization: headers.authorization },
        { ...headers, 'x-sislexa-delegation': 'sxd_' + 'x'.repeat(43) },
      ]) expect((await app.inject({ url: file, headers: bad })).statusCode).toBeGreaterThanOrEqual(400)
      tickets.delegations.revoke({ applicationId: 'make' })
      expect((await app.inject({ url: file, headers })).statusCode).toBe(403)
    } finally { vi.unstubAllGlobals() }
  })

  it('issues a delegation bound to the session lifetime when a ticket is redeemed', async () => {
    const session = await enterMake()
    expect(session.delegation.token).toMatch(/^sxd_[A-Za-z0-9_-]{43}$/)
    expect(session.expiresAt).toBe(now + SHARED_SESSION_TTL_MS)
    expect(session.delegation.expiresAt).toBe(session.expiresAt)
  })

  it('accepts the delegation only with the issuing service credential and for the user own conversations', async () => {
    const { delegation } = await enterMake()
    const own = await db.chat.createConversation('admin', 'Own')
    await db.identity.createUser('bob', '', 'developer')
    const foreign = await db.chat.createConversation('bob', 'Foreign')
    const accepted = await chatSession(delegation.token, own.id)
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().socketUrl).toMatch(/^\/ws\?session=/)
    expect((await chatSession(delegation.token, own.id, READER)).statusCode).toBe(403)
    expect((await chatSession(delegation.token, own.id, '')).statusCode).toBe(403)
    expect((await chatSession(delegation.token, foreign.id)).statusCode).toBe(403)
    expect((await chatSession('sxd_' + 'x'.repeat(43), own.id)).statusCode).toBe(403)
  })

  it('rejects the delegation after it expires or after its application is revoked', async () => {
    const own = await db.chat.createConversation('admin', 'Own')
    const expired = await enterMake()
    now = expired.delegation.expiresAt
    expect((await chatSession(expired.delegation.token, own.id)).statusCode).toBe(403)
    now = Date.now()
    const revoked = await enterMake()
    tickets.delegations.revoke({ applicationId: 'make' })
    expect((await chatSession(revoked.delegation.token, own.id)).statusCode).toBe(403)
  })

  it('runs a delegated turn through the exchanged socket', async () => {
    const { delegation } = await enterMake()
    const own = await db.chat.createConversation('admin', 'Own')
    const exchange = (await chatSession(delegation.token, own.id)).json<{ socketUrl: string }>()
    await app.ready()
    const socket = await app.injectWS(exchange.socketUrl)
    try {
      socket.send(JSON.stringify({ t: 'chat.connect', v: 1, conversationId: own.id }))
      socket.send(JSON.stringify({ t: 'claude.send', conversationId: own.id, segments: [{ kind: 'text', text: 'hello from make' }] }))
      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce(), { timeout: 5000 })
      // The Codex runner rejects tool-free runs, and the service's MCP tools must stay available:
      // a ticket delegation only removes shell execution.
      const request = send.mock.calls[0]![0]
      expect(request).toMatchObject({ executionDisabled: true, application: { originApplicationId: 'make' } })
      expect(request.textOnly).toBeUndefined()
      expect(request.remote).toBeUndefined()
      const messages = await db.chat.listMessages('admin', own.id)
      expect(messages.some(m => m.text === 'hello from make')).toBe(true)
    } finally { socket.terminate() }
  })
})

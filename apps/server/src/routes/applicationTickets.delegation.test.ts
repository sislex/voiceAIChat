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
      const messages = await db.chat.listMessages('admin', own.id)
      expect(messages.some(m => m.text === 'hello from make')).toBe(true)
    } finally { socket.terminate() }
  })
})

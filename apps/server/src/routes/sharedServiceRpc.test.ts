import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { parseApplications } from '@voicechat/shared'
import { TrustedCoreRegistry, authenticateCoreRequest, signCoreMcpToken, verifyCoreMcpToken } from '@sislexa/component-runtime'
import { signToken } from '@sislexa/identity/server/users/accounts'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import type { LlmClient } from '../claude/types.js'
import { ApplicationTickets } from './applicationTickets.js'
import { TicketDelegations } from '../auth/ticketDelegation.js'
import { externalMcpUrls, externalServiceFetch, externalTaskMakeSources } from '../sharedServices/externalService.js'

const SECRET = 'shared-rpc-secret'
const INTERNAL = 'build-wide-internal-token'
const MAKE = 'make-application-token'
const READER = 'reader-application-token'
const APPLICATIONS = 'chat,make=https://make.example.org,web-reader=https://reader.example.org'

let app: FastifyInstance
let db: VoiceChatDb
let dataDir: string
let now: number
const send = vi.fn<LlmClient['send']>((_request, handlers) => { queueMicrotask(() => { void handlers.onDone('ok') }); return { cancel: () => {} } })

beforeEach(async () => {
  now = Date.now()
  dataDir = mkdtempSync(join(tmpdir(), 'vc-shared-rpc-'))
  db = new VoiceChatDb(':memory:')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_CORE_ID: 'core-a', VC_APPLICATIONS: APPLICATIONS, VC_INTERNAL_TOKEN: INTERNAL, VC_DATA_DIR: dataDir,
      VC_MODELS_DIR: join(dataDir, 'models'), VC_PIPER_VOICES_DIR: join(dataDir, 'voices') }),
    db, sessionSecret: SECRET, claude: { send }, codex: { send },
    applicationTickets: { tickets: new ApplicationTickets(() => now), manifest: { coreId: 'core-a', applications: parseApplications(APPLICATIONS) },
      credentials: { make: MAKE, 'web-reader': READER }, serviceTokens: { make: 'make-service-token' }, mcpSecrets: { make: 'make-mcp-secret', 'web-reader': 'reader-mcp-secret' } }
  })
})
afterEach(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }) })

async function enter(application: 'make' | 'web-reader', credential: string) {
  const user = signToken({ name: 'admin', role: 'admin' }, SECRET)
  const entered = await app.inject({ method: 'POST', url: `/api/applications/${application}/enter`, headers: { authorization: `Bearer ${user}` } })
  const ticket = new URL(entered.json().url).searchParams.get('ticket')
  const redeemed = await app.inject({ method: 'POST', url: '/internal/v1/tickets/redeem', headers: { authorization: `Bearer ${credential}` }, payload: { ticket, application } })
  expect(redeemed.statusCode).toBe(200)
  return redeemed.json<{ delegation: { token: string; expiresAt: number } }>().delegation.token
}
const makeRpc = (headers: Record<string, string>, method: string, args: unknown[]) =>
  app.inject({ method: 'POST', url: '/internal/make/core', headers, payload: { method, args } })

describe('service→core RPC with an application token', () => {
  it('fills the delegated user and refuses a foreign one', async () => {
    const token = await enter('make', MAKE)
    const own = await db.chat.createConversation('admin', 'Own')
    await db.identity.createUser('bob', '', 'developer')
    const foreign = await db.chat.createConversation('bob', 'Foreign')
    const headers = { authorization: `Bearer ${MAKE}`, 'x-sislexa-delegation': token }
    const filled = await makeRpc(headers, 'conversation', ['', own.id])
    expect(filled.statusCode).toBe(200)
    expect(filled.json().result.id).toBe(own.id)
    expect((await makeRpc(headers, 'conversation', ['bob', foreign.id])).json()).toEqual({ error: 'delegation_denied' })
    expect((await makeRpc(headers, 'conversation', ['', foreign.id])).json().result).toBeNull()
    expect((await makeRpc(headers, 'machineFs.read', ['agent', '/etc/passwd'])).statusCode).toBe(403)
  })
  it('requires a live delegation of the same application for user methods', async () => {
    const own = await db.chat.createConversation('admin', 'Own')
    expect((await makeRpc({ authorization: `Bearer ${MAKE}` }, 'conversation', ['admin', own.id])).json()).toEqual({ error: 'delegation_required' })
    const reader = await enter('web-reader', READER)
    expect((await makeRpc({ authorization: `Bearer ${MAKE}`, 'x-sislexa-delegation': reader }, 'conversation', ['', own.id])).statusCode).toBe(401)
    const make = await enter('make', MAKE)
    expect((await makeRpc({ authorization: `Bearer ${READER}`, 'x-sislexa-delegation': make }, 'conversation', ['', own.id])).statusCode).toBe(401)
    now += 9 * 60 * 60_000
    expect((await makeRpc({ authorization: `Bearer ${MAKE}`, 'x-sislexa-delegation': make }, 'conversation', ['', own.id])).json()).toEqual({ error: 'delegation_denied' })
  })
  it('keeps build-level methods on the application token and the internal token path unchanged', async () => {
    expect((await makeRpc({ authorization: `Bearer ${MAKE}` }, 'userExists', ['admin'])).json()).toEqual({ result: true })
    const own = await db.chat.createConversation('admin', 'Own')
    expect((await makeRpc({ authorization: `Bearer ${INTERNAL}` }, 'conversation', ['admin', own.id])).json().result.id).toBe(own.id)
    expect((await makeRpc({ authorization: `Bearer ${INTERNAL}` }, 'machineFs.available', [])).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/internal/admin/rpc', headers: { authorization: `Bearer ${MAKE}` }, payload: { method: 'deploy', args: [] } })).statusCode).toBe(401)
  })
  it('accepts external Make events only with a delegation', async () => {
    const events = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/internal/make/events', headers, payload: { events: [] } })
    expect((await events({ authorization: `Bearer ${MAKE}` })).statusCode).toBe(401)
    expect((await events({ authorization: `Bearer ${MAKE}`, 'x-sislexa-delegation': await enter('make', MAKE) })).json()).toEqual({ ok: true })
  })
  it('lets a delegated application create only a conversation of its own kind', async () => {
    const token = await enter('make', MAKE)
    const create = (payload: object, credential = MAKE) => app.inject({ method: 'POST', url: '/api/conversations',
      headers: { authorization: `Bearer ${credential}`, 'x-sislexa-delegation': token }, payload })
    const created = await create({ assistantKind: 'make', title: 'From Make' })
    expect(created.statusCode).toBe(200)
    expect((await db.chat.getConversation('admin', created.json().id))?.assistantKind).toBe('make')
    expect((await create({ assistantKind: 'images' })).statusCode).toBe(403)
    expect((await create({ title: 'plain' })).statusCode).toBe(403)
    expect((await create({ assistantKind: 'make' }, READER)).statusCode).toBe(403)
  })
})

describe('service→core RPC with a core MCP token of the turn', () => {
  const mcp = (over: Partial<Parameters<typeof signCoreMcpToken>[1]> = {}, secret = 'make-mcp-secret') => signCoreMcpToken(secret,
    { v: 1, coreId: 'core-a', application: 'make', userId: 'admin', conversationId: 'c1', expiresAt: now + 60_000, ...over })
  it('acts for the token user on the application path', async () => {
    const own = await db.chat.createConversation('admin', 'Own')
    await db.identity.createUser('bob', '', 'developer')
    const foreign = await db.chat.createConversation('bob', 'Foreign')
    const headers = { authorization: `Bearer ${MAKE}`, 'x-sislexa-mcp-token': mcp() }
    expect((await makeRpc(headers, 'conversation', [null, own.id])).json().result.id).toBe(own.id)
    expect((await makeRpc(headers, 'conversation', ['bob', foreign.id])).json()).toEqual({ error: 'delegation_denied' })
    const events = await app.inject({ method: 'POST', url: '/internal/make/events', headers, payload: { events: [] } })
    expect(events.json()).toEqual({ ok: true })
  })
  it('refuses tokens of another secret, core, application, an expired token and a token next to a delegation', async () => {
    const own = await db.chat.createConversation('admin', 'Own')
    const call = (token: string, extra: Record<string, string> = {}) => makeRpc({ authorization: `Bearer ${MAKE}`, 'x-sislexa-mcp-token': token, ...extra }, 'conversation', [null, own.id])
    for (const token of [mcp({}, 'other-secret'), mcp({ coreId: 'core-b' }), mcp({ application: 'web-reader' }), mcp({ expiresAt: now - 1 }), 'sxm1.garbage'])
      expect((await call(token)).json()).toEqual({ error: 'delegation_denied' })
    expect((await call(mcp(), { 'x-sislexa-delegation': await enter('make', MAKE) })).json()).toEqual({ error: 'delegation_denied' })
    // The token alone (without the application credential) is no authority at all.
    expect((await makeRpc({ 'x-sislexa-mcp-token': mcp() }, 'conversation', [null, own.id])).statusCode).toBe(401)
    // Web Reader's credential with a Make token is refused on the reader path.
    const reader = await app.inject({ method: 'POST', url: '/internal/reader/core', headers: { authorization: `Bearer ${READER}`, 'x-sislexa-mcp-token': mcp() },
      payload: { method: 'issuePreviewRunKey', args: [null] } })
    expect(reader.json()).toEqual({ error: 'delegation_denied' })
  })
  it('keeps a task-scoped token read-only', async () => {
    const own = await db.chat.createConversation('admin', 'Own')
    const scoped = { authorization: `Bearer ${MAKE}`, 'x-sislexa-mcp-token': mcp({ scope: { taskId: 't1', projectId: 'p1', mode: 'whole_project', paths: [] } }) }
    expect((await makeRpc(scoped, 'conversation', [null, own.id])).statusCode).toBe(200)
    expect((await makeRpc(scoped, 'projectNotesUpdate', [null, 'p1', 'x'])).json()).toEqual({ error: 'method_denied' })
    expect((await app.inject({ method: 'POST', url: '/internal/make/events', headers: scoped, payload: { events: [] } })).json()).toEqual({ error: 'method_denied' })
  })
  it('authorises Web Reader object-argument methods from its delegation', async () => {
    const token = await enter('web-reader', READER)
    const reader = (args: unknown[], method = 'context') => app.inject({ method: 'POST', url: '/internal/reader/core',
      headers: { authorization: `Bearer ${READER}`, 'x-sislexa-delegation': token }, payload: { method, args } })
    const own = await db.chat.createConversation('admin', 'Own')
    expect((await reader([{ userId: null, conversationId: own.id }])).statusCode).toBe(200)
    expect((await reader([{ userId: 'bob', conversationId: own.id }])).json()).toEqual({ error: 'delegation_denied' })
    expect((await reader([], 'listPreviews')).json()).toEqual({ error: 'method_denied' })
  })
})

describe('core→service calls and MCP tokens', () => {
  it('sends the core id, the service credential and a delegation only for user methods', async () => {
    const delegations = new TicketDelegations()
    const seen: Headers[] = []
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => { seen.push(new Headers(init?.headers)); return new Response('{"result":null}') })
    const call = externalServiceFetch({ application: 'make', coreId: 'core-a', serviceToken: 'svc', delegations, fetchImpl,
      userOf: async (method, args) => method === 'promptContext' ? { userId: 'alice', tenantId: 't1' } : (void args, undefined) })
    await call('https://make.example.org/internal/service', { method: 'POST', body: JSON.stringify({ method: 'promptContext', args: ['c1'] }),
      headers: { authorization: 'Bearer build-wide', 'x-sislexa-delegation': 'sxd_forged' } })
    await call('https://make.example.org/internal/service', { method: 'POST', body: JSON.stringify({ method: 'adminStats', args: [] }) })
    expect(seen[0]!.get('authorization')).toBe('Bearer svc')
    expect(seen[0]!.get('x-sislexa-core-id')).toBe('core-a')
    expect(delegations.lookup(seen[0]!.get('x-sislexa-delegation')!)).toMatchObject({ userId: 'alice', applicationId: 'make', coreId: 'core-a' })
    expect(seen[1]!.get('x-sislexa-delegation')).toBeNull()
    const registry = new TrustedCoreRegistry(ref => ({ call: 'x', svc: 'svc' } as Record<string, string>)[ref]!)
    registry.add({ coreId: 'core-a', url: 'https://core-a.example.org', credentialRef: 'call', serviceCredentialRef: 'svc' })
    expect(authenticateCoreRequest(registry, { headers: Object.fromEntries(seen[0]!.entries()) }).coreId).toBe('core-a')
  })
  it('issues per-turn MCP URLs the service verifies for its core', () => {
    const urls = externalMcpUrls({ coreId: 'core-a', url: id => id === 'make' ? 'https://make.example.org' : undefined, secrets: { make: 'mcp-secret' } })
    const url = new URL(urls('make', { userId: 'alice', conversationId: 'c1', turnId: 't1' })!)
    expect(url.origin + url.pathname).toBe('https://make.example.org/mcp/make')
    const registry = new TrustedCoreRegistry(ref => ({ call: 'x', mcp: 'mcp-secret' } as Record<string, string>)[ref]!)
    registry.add({ coreId: 'core-a', url: 'https://core-a.example.org', credentialRef: 'call', mcpSecretRef: 'mcp' })
    expect(verifyCoreMcpToken(registry, url.searchParams.get('k')!)).toMatchObject({ coreId: 'core-a', userId: 'alice', conversationId: 'c1', turnId: 't1' })
    expect(urls('image-studio', { userId: 'alice', conversationId: 'c1' })).toBeUndefined()
  })
  it('issues one read-only MCP token per task source conversation of an external Make', () => {
    const urls = externalMcpUrls({ coreId: 'core-a', url: id => id === 'make' ? 'https://make.example.org' : undefined, secrets: { make: 'mcp-secret' } })
    const design = (conversationId: string, mode: 'whole_project' | 'files', paths: string[]) => ({ id: conversationId, taskId: 'task-1', conversationId,
      conversationTitle: conversationId, conversationOwner: 'alice', label: '', mode, paths, createdAt: '', createdBy: 'alice' })
    const sources = externalTaskMakeSources(urls, { userId: 'alice', projectId: 'p1', taskId: 'task-1',
      designs: [design('d2', 'files', ['b.ts', 'a.ts']), design('d1', 'whole_project', [])] as never })
    expect(sources.map(s => s.conversationId)).toEqual(['d1', 'd2'])
    const registry = new TrustedCoreRegistry(ref => ({ call: 'x', mcp: 'mcp-secret' } as Record<string, string>)[ref]!)
    registry.add({ coreId: 'core-a', url: 'https://core-a.example.org', credentialRef: 'call', mcpSecretRef: 'mcp' })
    for (const source of sources) {
      const url = new URL(source.mcpUrl)
      expect(url.searchParams.get('conv')).toBe(source.conversationId)
      expect(url.searchParams.get('scope')).toBeNull()
      expect(verifyCoreMcpToken(registry, url.searchParams.get('k')!)).toMatchObject({ conversationId: source.conversationId, userId: 'alice',
        scope: { taskId: 'task-1', projectId: 'p1', mode: source.mode, paths: source.paths } })
    }
    expect(sources[1]!.paths).toEqual(['a.ts', 'b.ts'])
    expect(externalTaskMakeSources(externalMcpUrls({ coreId: 'core-a', url: () => undefined, secrets: {} }), { userId: 'alice', projectId: 'p1', taskId: 't', designs: [design('d1', 'whole_project', [])] as never })).toEqual([])
  })
})

import { createServer } from 'node:net'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createComponentRuntime, type ComponentRuntime } from '@sislexa/component-runtime'
import { buildMakeServer } from '@voicechat/make/standalone'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { buildServer } from '../server.js'
import { signToken } from '../users/accounts.js'
const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const secret = 'managed-integration-session', mcp = 'managed-integration-mcp'
let root: string, core: FastifyInstance, make: FastifyInstance, db: VoiceChatDb
let coreIssuer: ComponentRuntime, makeIssuer: ComponentRuntime
let coreUrl: string, makeUrl: string, conversation: string, coreTokenId: string, coreTokenFile: string
const scopes = ['identity.verify', 'make.core', 'make.events']
async function port(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const value = (server.address() as { port: number }).port; server.close(() => resolve(value)) })
  })
}
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'sislexa-managed-make-'))
  const corePort = await port(), makePort = await port()
  coreUrl = `http://127.0.0.1:${corePort}`; makeUrl = `http://127.0.0.1:${makePort}`
  const files: Record<string, string> = {}
  for (const id of ['core', 'make']) {
    mkdirSync(join(root, id), { mode: 0o700 })
    const config = JSON.parse(readFileSync(join(repository, 'deploy/components', id + '.example.json'), 'utf8'))
    config.environmentId = 'integration'; config.registryDirectory = join(root, id, 'registry')
    config.dependencies = [{ applicationId: id === 'core' ? 'make' : 'core', url: id === 'core' ? makeUrl : coreUrl, tokenFile: join(root, id, 'outgoing.token') }]
    files[id] = join(root, id, 'config.json'); writeFileSync(files[id], JSON.stringify(config))
  }
  coreIssuer = await createComponentRuntime({ configFile: files.core, contractFile: join(repository, 'apps/server/component-contract.json'), metadata: { applicationId: 'core', version: null, apiVersion: null, dataVersion: null, commit: null } })
  makeIssuer = await createComponentRuntime({ configFile: files.make, contractFile: require.resolve('@sislexa/make/component-contract'), metadata: { applicationId: 'make', version: null, apiVersion: null, dataVersion: null, commit: null } })
  const coreToken = coreIssuer.registry!.issue('make', scopes, 3600); coreTokenId = coreToken.principal.tokenId
  coreTokenFile = join(root, 'make/outgoing.token'); writeFileSync(coreTokenFile, coreToken.token, { mode: 0o600 })
  writeFileSync(join(root, 'core/outgoing.token'), makeIssuer.registry!.issue('core', ['make.service'], 3600).token, { mode: 0o600 })
  db = new VoiceChatDb(':memory:')
  await db.identity.createUser('ann', 'password-1', 'developer'); await db.identity.createUser('bob', 'password-1', 'developer')
  conversation = (await db.chat.createConversation('ann', 'Managed', 'make', null))!.id
  vi.stubEnv('VC_APPLICATION_VERSION', '0.1.312'); vi.stubEnv('VC_APPLICATION_API_VERSION', '1.1.0'); vi.stubEnv('VC_APPLICATION_COMMIT', 'a'.repeat(40))
  core = await buildServer({ config: loadConfig({ PORT: String(corePort), VC_DATA_DIR: root, VC_MODELS_DIR: join(root, 'models'), VC_PIPER_VOICES_DIR: join(root, 'voices'), SISLEXA_COMPONENT_CONFIG: files.core, VC_INTERNAL_TOKEN: 'legacy', VC_MCP_SECRET: mcp }), db, sessionSecret: secret })
  await core.listen({ host: '127.0.0.1', port: corePort })
  vi.stubEnv('VC_APPLICATION_VERSION', '1.1.0'); vi.stubEnv('VC_APPLICATION_COMMIT', 'b'.repeat(40))
  make = (await buildMakeServer({ config: { componentConfigPath: files.make, host: '127.0.0.1', port: makePort, dataDir: root, coreUrl: 'http://unused.invalid', internalToken: '', mcpSecret: mcp, version: '1.1.0' } })).app
  await make.listen({ host: '127.0.0.1', port: makePort })
}, 60000)
afterAll(async () => {
  await make?.close(); await core?.close(); coreIssuer?.close(); makeIssuer?.close(); await db?.close()
  vi.unstubAllEnvs(); if (root) rmSync(root, { recursive: true, force: true })
})
describe('managed Core and standalone Make', () => {
  it('starts without dependency-order cycles and preserves user ownership through the public proxy', async () => {
    expect((await fetch(coreUrl + '/v1/ready')).status).toBe(200)
    expect((await fetch(makeUrl + '/v1/ready')).status).toBe(200)
    const token = signToken({ name: 'ann', role: 'developer' }, secret)
    const result = await fetch(coreUrl + '/api/make/' + conversation, { headers: { authorization: 'Bearer ' + token } })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ conversationId: conversation })
    const bob = signToken({ name: 'bob', role: 'developer' }, secret)
    expect((await fetch(makeUrl + '/api/make/' + conversation, { headers: { authorization: 'Bearer ' + bob } })).status).toBe(404)
    const serviceToken = readFileSync(coreTokenFile, 'utf8').trim()
    expect((await fetch(makeUrl + '/api/make/' + conversation, { headers: { authorization: 'Bearer ' + serviceToken } })).status).toBe(401)
  })
  it('observes provider revocation immediately and resumes after private-file rotation', async () => {
    const token = signToken({ name: 'ann', role: 'developer' }, secret), headers = { authorization: 'Bearer ' + token }
    expect((await fetch(makeUrl + '/api/make/' + conversation, { headers })).status).toBe(200)
    coreIssuer.registry!.revoke(coreTokenId)
    expect((await fetch(makeUrl + '/api/make/' + conversation, { headers })).status).toBe(503)
    writeFileSync(coreTokenFile, coreIssuer.registry!.issue('make', scopes, 3600).token)
    expect((await fetch(makeUrl + '/api/make/' + conversation, { headers })).status).toBe(200)
    expect((await fetch(coreUrl + '/internal/make/core', { method: 'POST', headers: { authorization: 'Bearer legacy', 'content-type': 'application/json' }, body: JSON.stringify({ method: 'conversation', args: ['ann', conversation] }) })).status).toBe(401)
  })
})

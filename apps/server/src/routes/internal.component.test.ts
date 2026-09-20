import { afterEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createComponentRuntime } from '@sislexa/component-runtime'
import type { MakeCore } from '@voicechat/make-contracts'
import { registerInternalRoutes } from './internal.js'
const cleanups: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
describe('Core component route permissions', () => {
  it('limits managed scopes, rejects legacy access to migrated routes and preserves user authentication', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sislexa-core-grants-')); cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const configFile = join(root, 'config.json')
    writeFileSync(configFile, JSON.stringify({ schemaVersion: 1, environmentId: 'test', registryDirectory: join(root, 'registry'), grants: [{ consumerId: 'make', scopes: ['identity.verify', 'make.core'], maxTtlSeconds: 3600 }], legacyScopes: ['identity.verify'], dependencies: [] }))
    const component = await createComponentRuntime({ contractFile: fileURLToPath(new URL('../../component-contract.json', import.meta.url)), configFile, metadata: { applicationId: 'core', version: '0.1.312', apiVersion: '1.1.0', dataVersion: '1.0.0', commit: 'a'.repeat(40) } })
    const app = Fastify(); component.register(app); cleanups.push(() => app.close())
    let calls = 0
    registerInternalRoutes(app, { token: 'legacy', component, makeCore: { conversation: async () => { calls++; return null } } as unknown as MakeCore,
      authenticate: async () => ({ ok: false, status: 401, error: 'unauthorized' }) })
    const token = component.registry!.issue('make', ['make.core', 'identity.verify'], 60).token
    const onlyIdentity = component.registry!.issue('make', ['identity.verify'], 60).token
    const rpc = { method: 'POST' as const, url: '/internal/make/core', payload: { method: 'conversation', args: ['ann', 'missing'] } }
    expect((await app.inject({ ...rpc, headers: { authorization: 'Bearer legacy' } })).statusCode).toBe(401)
    expect((await app.inject({ ...rpc, headers: { authorization: 'Bearer ' + onlyIdentity } })).statusCode).toBe(403)
    expect(calls).toBe(0)
    expect((await app.inject({ ...rpc, headers: { authorization: 'Bearer ' + token } })).statusCode).toBe(200)
    expect(calls).toBe(1)
    const identity = { method: 'POST' as const, url: '/internal/whoami', payload: { method: 'GET', url: '/api/me', headers: { authorization: 'Bearer ' + token } } }
    const user = await app.inject({ ...identity, headers: { authorization: 'Bearer ' + token } })
    expect(user.json()).toEqual({ ok: false, status: 401, error: 'unauthorized' })
    expect((await app.inject({ ...identity, headers: { authorization: 'Bearer legacy' } })).statusCode).toBe(200)
    const unknown = await app.inject({ method: 'POST', url: '/internal/unregistered', headers: { authorization: 'Bearer ' + token }, payload: {} })
    expect(unknown.statusCode).not.toBe(200)
  })
})

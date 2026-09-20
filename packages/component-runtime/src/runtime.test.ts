import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, symlinkSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { parseComponentConfig, parseComponentContract } from '@voicechat/shared'
import { ComponentTokenRegistry } from './registry.js'
import { ComponentRuntime, createComponentRuntime } from './index.js'
import { readSecret } from './files.js'
import { runTokenCommand } from './cli.js'
const roots: string[] = []
const closers: (() => void | Promise<unknown>)[] = []
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sislexa-components-')); roots.push(root)
  const contract = parseComponentContract({ schemaVersion: 1, applicationId: 'core', provides: ['identity.verify', 'make.core'], legacyScopes: [], dependencies: [] })
  const config = parseComponentConfig({ schemaVersion: 1, environmentId: 'test', registryDirectory: join(root, 'registry'), grants: [{ consumerId: 'make', scopes: ['identity.verify', 'make.core'], maxTtlSeconds: 3600 }], legacyScopes: [], dependencies: [] }, contract)
  let time = Date.now()
  const registry = new ComponentTokenRegistry(contract, config, () => time); closers.push(() => registry.close())
  return { root, contract, config, registry, advance: (ms: number) => { time += ms } }
}
describe('provider-owned token registry', () => {
  it('stores only a digest and enforces scopes, expiration and live revocation', () => {
    const f = fixture(), issued = f.registry.issue('make', ['identity.verify'], 60)
    const header = 'Bearer ' + issued.token
    expect(f.registry.authorize(header, ['identity.verify'])).toMatchObject({ ok: true, principal: { consumerId: 'make', providerId: 'core', environmentId: 'test' } })
    expect(f.registry.authorize(header, ['make.core'])).toEqual({ ok: false, status: 403 })
    const second = new ComponentTokenRegistry(f.contract, f.config); closers.push(() => second.close())
    expect(second.revoke(issued.principal.tokenId)).toBe(true)
    expect(f.registry.authorize(header, [])).toEqual({ ok: false, status: 401 })
    const expiring = f.registry.issue('make', ['identity.verify'], 1)
    f.advance(1000)
    expect(f.registry.authorize('Bearer ' + expiring.token, [])).toEqual({ ok: false, status: 401 })
    for (const suffix of ['', '-wal']) expect(readFileSync(join(f.config.registryDirectory!, 'tokens.sqlite' + suffix)).includes(Buffer.from(issued.token))).toBe(false)
  })
  it('rejects unknown consumers, overbroad grants, copied registries and altered tokens', () => {
    const f = fixture()
    for (const args of [['unknown', ['identity.verify'], 60], ['make', ['admin.all'], 60], ['make', ['identity.verify'], 3601]] as const) expect(() => f.registry.issue(args[0], [...args[1]], args[2])).toThrow()
    expect(() => new ComponentTokenRegistry({ ...f.contract, applicationId: 'other' }, f.config)).toThrow('another provider')
    expect(() => new ComponentTokenRegistry(f.contract, { ...f.config, environmentId: 'other' })).toThrow('another provider')
    const token = f.registry.issue('make', ['identity.verify'], 60).token
    expect(f.registry.authorize('Bearer ' + token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), [])).toEqual({ ok: false, status: 401 })
    expect(f.registry.authorize('Bearer legacy-token', [])).toEqual({ ok: false, status: 401 })
  })
  it('checks reduced consumer policy against previously issued credentials', () => {
    const f = fixture(), token = f.registry.issue('make', ['identity.verify', 'make.core'], 60).token
    const reduced = new ComponentTokenRegistry(f.contract, { ...f.config, grants: [{ ...f.config.grants[0], scopes: ['identity.verify'] }] }); closers.push(() => reduced.close())
    expect(reduced.authorize('Bearer ' + token, ['identity.verify'])).toEqual({ ok: false, status: 403 })
  })
  it('CLI writes a new private file, never returns its secret, and revokes without restart', () => {
    const f = fixture(), contract = join(f.root, 'contract.json'), config = join(f.root, 'config.json'), output = join(f.root, 'token')
    writeFileSync(contract, JSON.stringify(f.contract)); writeFileSync(config, JSON.stringify(f.config))
    const flags = ['--contract', contract, '--config', config]
    const result = runTokenCommand(['issue', ...flags, '--consumer', 'make', '--scopes', 'identity.verify', '--ttl', '60', '--out', output]) as { tokenId: string }
    const token = readSecret(output)
    expect(statSync(output).mode & 0o777).toBe(0o600)
    expect(JSON.stringify(result)).not.toContain(token)
    expect(() => runTokenCommand(['issue', ...flags, '--consumer', 'make', '--scopes', 'identity.verify', '--ttl', '60', '--out', output])).toThrow()
    expect(f.registry.authorize('Bearer ' + token, [])).toMatchObject({ ok: true })
    runTokenCommand(['revoke', ...flags, '--id', result.tokenId])
    expect(f.registry.authorize('Bearer ' + token, [])).toMatchObject({ ok: false })
  })
  it('rejects public or symlinked credential storage', () => {
    const f = fixture(), file = join(f.root, 'secret'), link = join(f.root, 'link')
    writeFileSync(file, f.registry.issue('make', ['identity.verify'], 60).token, { mode: 0o600 })
    symlinkSync(file, link)
    expect(() => readSecret(link)).toThrow()
    chmodSync(file, 0o644); expect(() => readSecret(file)).toThrow()
    chmodSync(f.config.registryDirectory!, 0o755)
    expect(() => new ComponentTokenRegistry(f.contract, f.config)).toThrow('private')
  })
})
async function networkFixture() {
  const f = fixture()
  // A second registry is owned by the HTTP runtime; the fixture retains a CLI connection.
  const registry = new ComponentTokenRegistry(f.contract, f.config)
  const metadata = { applicationId: 'core', version: '0.1.312', apiVersion: '1.1.0', dataVersion: '1.0.0', commit: 'a'.repeat(40) }
  const provider = new ComponentRuntime(f.contract, f.config, metadata, registry, fetch, Date.now)
  const app = Fastify(); provider.register(app)
  let calls = 0
  app.get('/rpc', async (req, reply) => { const auth = provider.authorize(req.headers.authorization, 'make.core'); if (!auth.ok) return reply.code(auth.status).send({ error: 'denied' }); calls++; return { ok: true } })
  app.get('/public', async req => ({ authorization: req.headers.authorization ?? null }))
  app.get('/redirect', async (_req, reply) => reply.redirect('http://127.0.0.1:1/leak'))
  const url = await app.listen({ host: '127.0.0.1', port: 0 }); closers.push(() => app.close())
  const tokenFile = join(f.root, 'core.token')
  const issued = f.registry.issue('make', ['make.core', 'identity.verify'], 3600)
  writeFileSync(tokenFile, issued.token, { mode: 0o600 })
  const contract = parseComponentContract({ schemaVersion: 1, applicationId: 'make', provides: [], legacyScopes: [], dependencies: [{ applicationId: 'core', minVersion: '0.1.312', maxVersionExclusive: '1.0.0', minApiVersion: '1.1.0', maxApiVersionExclusive: '2.0.0', scopes: ['identity.verify', 'make.core'] }] })
  const config = parseComponentConfig({ schemaVersion: 1, environmentId: 'test', grants: [], legacyScopes: [], dependencies: [{ applicationId: 'core', url, tokenFile }] }, contract)
  const consumer = new ComponentRuntime(contract, config, { ...metadata, applicationId: 'make' }, undefined, fetch, Date.now)
  return { ...f, app, metadata, url, tokenFile, issued, contract, config, consumer, calls: () => calls }
}
describe('dependency transport and real provider routes', () => {
  it('verifies versions and grants before RPC, rotates files, and observes immediate revocation', async () => {
    const f = await networkFixture(), transport = f.consumer.dependency('core').fetchImpl
    expect((await f.consumer.readiness()).ok).toBe(true)
    expect((await transport(f.url + '/rpc')).status).toBe(200)
    f.registry.revoke(f.issued.principal.tokenId)
    expect((await transport(f.url + '/rpc')).status).toBe(401)
    writeFileSync(f.tokenFile, f.registry.issue('make', ['make.core', 'identity.verify'], 60).token)
    expect((await transport(f.url + '/rpc')).status).toBe(200)
    expect(f.calls()).toBe(2)
    expect((await f.app.inject({ url: '/rpc' })).statusCode).toBe(401)
  })
  it('rejects redirects and credential forwarding to a different origin', async () => {
    const f = await networkFixture(), transport = f.consumer.dependency('core').fetchImpl
    await expect(transport('http://127.0.0.1:1/rpc')).rejects.toThrow('dependency unavailable')
    await expect(transport(f.url + '/redirect')).rejects.toThrow('dependency unavailable')
    expect(f.calls()).toBe(0)
  })
  it.each(['version', 'apiVersion', 'commit', 'applicationId', 'environment', 'scopes', 'consumer'])('fails closed for incompatible %s without invoking RPC', async kind => {
    const f = await networkFixture()
    if (kind === 'version') f.metadata.version = '0.1.311'
    if (kind === 'apiVersion') f.metadata.apiVersion = '2.0.0'
    if (kind === 'commit') f.metadata.commit = ''
    if (kind === 'applicationId') f.metadata.applicationId = 'other'
    if (kind === 'environment') f.config.environmentId = 'other'
    if (kind === 'consumer') f.contract.applicationId = 'other'
    if (kind === 'scopes') writeFileSync(f.tokenFile, f.registry.issue('make', ['identity.verify'], 60).token)
    await expect(f.consumer.dependency('core').fetchImpl(f.url + '/rpc')).rejects.toThrow('dependency unavailable')
    expect(f.calls()).toBe(0)
    expect(await f.consumer.readiness()).toEqual({ ok: false, dependencies: [{ applicationId: 'core', ok: false }] })
  })
  it('public proxies preserve user credentials and return redirects without sending a service credential', async () => {
    const f = await networkFixture(), transport = f.consumer.dependency('core').publicFetchImpl
    expect(await (await transport(f.url + '/public', { headers: { authorization: 'Bearer user-session' } })).json()).toEqual({ authorization: 'Bearer user-session' })
    expect(await (await transport(f.url + '/public')).json()).toEqual({ authorization: null })
    expect((await transport(f.url + '/redirect')).status).toBe(302)
  })
  it('reports an unavailable provider without allowing an RPC', async () => {
    const f = await networkFixture()
    await f.app.close()
    expect((await f.consumer.readiness()).ok).toBe(false)
    await expect(f.consumer.dependency('core').fetchImpl(f.url + '/rpc')).rejects.toThrow('dependency unavailable')
  })
  it('keeps readiness failures free of secrets, paths and upstream details', async () => {
    const f = await networkFixture(); rmSync(f.tokenFile)
    const result = JSON.stringify(await f.consumer.readiness())
    expect(result).not.toContain(f.root); expect(result).not.toContain(f.issued.token)
    expect(result).toContain('false')
  })
  it('loads and validates actual configuration files', async () => {
    const f = await networkFixture(), contractFile = join(f.root, 'contract.json'), configFile = join(f.root, 'config.json')
    writeFileSync(contractFile, JSON.stringify(f.contract)); writeFileSync(configFile, JSON.stringify(f.config))
    const runtime = await createComponentRuntime({ contractFile, configFile, metadata: { ...f.metadata, applicationId: 'make' } })
    expect((await runtime.readiness()).ok).toBe(true)
    runtime.close()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorageNodeServer } from './server.js'
import { createComponentRuntime } from '@sislexa/component-runtime'
import { STORAGE_NODE_SCOPE } from '@voicechat/shared/fileStorage'

const fault = vi.hoisted(() => ({ rename: false }))
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, rename: async (...args: Parameters<typeof fs.rename>) => {
    if (fault.rename) throw Object.assign(new Error('full'), { code: 'ENOSPC' })
    return fs.rename(...args)
  } }
})
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { fault.rename = false; for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture(capacityBytes = 10) {
  const root = await mkdtemp(join(tmpdir(), 'file-storage-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const tokenFile = join(root, 'token')
  await writeFile(tokenFile, 'secret-token\n')
  const options = { nodeId: 'node-a', directory: join(root, 'blobs'), capacityBytes, tokenFile }
  const app = await createStorageNodeServer(options)
  cleanup.push(() => app.close())
  const headers = { authorization: 'Bearer secret-token', 'content-type': 'application/octet-stream' }
  const put = (id: string, data: string | Buffer) => app.inject({ method: 'PUT', url: '/v1/blobs/' + id, headers, payload: data })
  const get = (id: string) => app.inject({ url: '/v1/blobs/' + id, headers })
  const health = async () => (await app.inject({ url: '/v1/health', headers })).json()
  return { app, root, options, headers, put, get, health }
}
describe('storage node', () => {
  it('copies locally into a new blob, accounts capacity and preserves the source', async () => {
    const f = await fixture(6)
    await f.put('source00', 'abc')
    const copy = (targetId: string) => f.app.inject({ method: 'POST', url: '/v1/blobs/source00/copy', headers: f.headers, payload: JSON.stringify({ targetId }) })
    expect((await copy('target00')).statusCode).toBe(204)
    expect((await f.get('target00')).body).toBe('abc')
    expect((await f.health()).usedBytes).toBe(6)
    expect((await copy('target00')).statusCode).toBe(409)
    expect((await copy('target01')).statusCode).toBe(507)
    expect((await copy('../escape')).statusCode).toBe(400)
    await f.app.inject({ method: 'DELETE', url: '/v1/blobs/target00', headers: f.headers })
    fault.rename = true
    expect((await copy('target02')).statusCode).toBe(507)
    expect((await f.health()).usedBytes).toBe(3)
    expect((await f.get('source00')).body).toBe('abc')
    expect((await readdir(f.options.directory)).sort()).toEqual(['source00'])
  })
  it('authenticates health and every blob operation, including token rotation', async () => {
    const f = await fixture()
    for (const method of ['GET', 'PUT', 'DELETE'] as const)
      expect((await f.app.inject({ method, url: '/v1/blobs/abcdefgh' })).statusCode).toBe(401)
    expect((await f.app.inject('/v1/health')).statusCode).toBe(401)
    expect((await f.app.inject({ url: '/v1/health', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401)
    await writeFile(f.options.tokenFile, 'new-token')
    expect((await f.app.inject({ url: '/v1/health', headers: f.headers })).statusCode).toBe(401)
    expect((await f.app.inject({ url: '/v1/health', headers: { authorization: 'Bearer new-token' } })).statusCode).toBe(200)
  })
  it('fails closed without configured authentication and delegates the exact managed scope', async () => {
    const f = await fixture()
    const app = await createStorageNodeServer({ ...f.options, tokenFile: undefined })
    cleanup.push(() => app.close())
    expect((await app.inject({ url: '/v1/health', headers: f.headers })).statusCode).toBe(401)
    const authorize = vi.fn(() => ({ ok: false as const, status: 403 as const }))
    const managed = await createStorageNodeServer({ ...f.options, runtime: { authorize, register() {} } })
    cleanup.push(() => managed.close())
    expect((await managed.inject({ url: '/v1/health', headers: f.headers })).statusCode).toBe(403)
    expect(authorize).toHaveBeenCalledWith('Bearer secret-token', STORAGE_NODE_SCOPE)
  })
  it('uses the managed registry for scope, expiry and immediate revocation', async () => {
    const f = await fixture()
    const contractFile = join(f.root, 'contract.json'), configFile = join(f.root, 'config.json')
    await writeFile(contractFile, JSON.stringify({ schemaVersion: 1, applicationId: 'file-storage',
      provides: [STORAGE_NODE_SCOPE, 'other.scope'], legacyScopes: [], dependencies: [] }))
    await writeFile(configFile, JSON.stringify({ schemaVersion: 1, environmentId: 'test',
      registryDirectory: join(f.root, 'registry'), grants: [{ consumerId: 'core',
        scopes: [STORAGE_NODE_SCOPE, 'other.scope'], maxTtlSeconds: 3600 }], legacyScopes: [], dependencies: [] }))
    let now = Date.now()
    const runtime = await createComponentRuntime({ contractFile, configFile, now: () => now,
      metadata: { applicationId: 'file-storage', version: '0.1.0', apiVersion: '1.0.0', dataVersion: '1.0.0', commit: 'a'.repeat(40) } })
    const app = await createStorageNodeServer({ ...f.options, runtime })
    cleanup.push(() => app.close())
    const probe = (token: string) => app.inject({ url: '/v1/health', headers: { authorization: 'Bearer ' + token } })
    const granted = runtime.registry!.issue('core', [STORAGE_NODE_SCOPE], 60)
    expect((await probe(granted.token)).statusCode).toBe(200)
    expect((await probe('secret-token')).statusCode).toBe(401)
    const wrong = runtime.registry!.issue('core', ['other.scope'], 60)
    expect((await probe(wrong.token)).statusCode).toBe(403)
    runtime.registry!.revoke(granted.principal.tokenId)
    expect((await probe(granted.token)).statusCode).toBe(401)
    const expired = runtime.registry!.issue('core', [STORAGE_NODE_SCOPE], 1)
    now += 1001
    expect((await probe(expired.token)).statusCode).toBe(401)
  })
  it('stores opaque bytes, counts overwrite deltas, deletes idempotently and recovers usage at startup', async () => {
    const f = await fixture()
    const bytes = Buffer.from([0, 255, 10, 13])
    expect((await f.put('abcdefgh', bytes)).statusCode).toBe(204)
    expect((await f.get('abcdefgh')).rawPayload).toEqual(bytes)
    expect(await f.health()).toEqual({ nodeId: 'node-a', capacityBytes: 10, usedBytes: 4, freeBytes: 6 })
    await f.put('abcdefgh', 'xx')
    expect((await f.health()).usedBytes).toBe(2)
    await f.app.close()
    const restarted = await createStorageNodeServer(f.options)
    cleanup.push(() => restarted.close())
    expect((await restarted.inject({ url: '/v1/health', headers: f.headers })).json().usedBytes).toBe(2)
    for (let i = 0; i < 2; i++)
      expect((await restarted.inject({ method: 'DELETE', url: '/v1/blobs/abcdefgh', headers: f.headers })).statusCode).toBe(204)
    expect((await restarted.inject({ url: '/v1/health', headers: f.headers })).json().usedBytes).toBe(0)
  })
  it('reserves capacity under concurrent PUTs and retains old data on rejected replacement', async () => {
    const f = await fixture()
    const results = await Promise.all([f.put('aaaaaaaa', '123456'), f.put('bbbbbbbb', '123456')])
    expect(results.map(r => r.statusCode).sort()).toEqual([204, 507])
    expect((await f.health()).usedBytes).toBe(6)
    const id = results[0].statusCode === 204 ? 'aaaaaaaa' : 'bbbbbbbb'
    expect((await f.put(id, '12345678901')).json().error).toBe('storage_full')
    expect((await f.get(id)).body).toBe('123456')
  })
  it('publishes complete replacements atomically and cleans up after a failed rename', async () => {
    const f = await fixture(100000)
    await f.put('abcdefgh', 'old')
    fault.rename = true
    expect((await f.put('abcdefgh', 'replacement')).statusCode).toBe(507)
    fault.rename = false
    expect((await f.get('abcdefgh')).body).toBe('old')
    expect((await f.health()).usedBytes).toBe(3)
    expect(await readdir(f.options.directory)).toEqual(['abcdefgh'])
    const next = 'n'.repeat(50000)
    const [, ...reads] = await Promise.all([f.put('abcdefgh', next), ...Array.from({ length: 8 }, () => f.get('abcdefgh'))])
    for (const read of reads) expect(['old', next]).toContain(read.body)
    expect((await f.get('abcdefgh')).body).toBe(next)
  })
  it('rejects invalid blob IDs before filesystem access', async () => {
    const f = await fixture()
    for (const id of ['short', 'a'.repeat(129), 'abcdefgh%2Fescape', '..%2Fabcdefgh', 'abcdefgh%00'])
      for (const method of ['GET', 'PUT', 'DELETE'] as const)
        expect((await f.app.inject({ method, url: '/v1/blobs/' + id, headers: f.headers,
          ...(method === 'PUT' ? { payload: Buffer.from('x') } : {}) })).statusCode).toBe(400)
    expect(await readdir(f.options.directory)).toEqual([])
    expect((await f.put('a'.repeat(128), 'ok')).statusCode).toBe(204)
    expect((await f.get('abcdefgh')).statusCode).toBe(404)
  })
})

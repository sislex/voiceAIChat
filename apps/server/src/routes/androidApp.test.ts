import Fastify from 'fastify'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { REST } from '@voicechat/shared'
import { registerAndroidAppRoutes } from './androidApp.js'
import { registerMachinesProxy } from '../machinesBridge/proxy.js'
import { registerForwardedAuth } from '../internal/forwardedAuth.js'

let dir: string
const bytes = Buffer.from('signed APK fixture')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const manifest = { schemaVersion: 1, android: {
  url: 'https://github.com/sislex/agent/releases/download/android-v0.1.1/app.apk',
  filename: 'app.apk', sha256, size: bytes.length, commit: 'a'.repeat(40),
  minSdk: 26, abis: ['arm64-v8a'], versionName: '0.1.1', versionCode: 2
} }
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'android-app-'))
  await writeFile(join(dir, 'android-release.json'), JSON.stringify(manifest))
  await writeFile(join(dir, 'app.apk'), bytes)
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })
function server(manifestPath: string | undefined = join(dir, 'android-release.json')) {
  const app = Fastify()
  app.addHook('preHandler', async (_req, reply) => { await reply.code(401).send() })
  registerAndroidAppRoutes(app, { manifestPath })
  return app
}
it('serves public projected manifest and verified APK with ETag/304 without credentials', async () => {
  const app = server()
  try {
    const info = await app.inject(REST.androidApp)
    expect(info.statusCode).toBe(200)
    expect(info.json()).toEqual({ ...manifest, android: { ...manifest.android, url: REST.androidApk } })
    expect(info.body).not.toContain('github')
    const apk = await app.inject(REST.androidApk)
    expect(apk.statusCode).toBe(200)
    expect(apk.rawPayload).toEqual(bytes)
    expect(apk.headers['content-type']).toBe('application/vnd.android.package-archive')
    expect(apk.headers['content-disposition']).toBe('attachment; filename="app.apk"')
    for (const [url, result] of [[REST.androidApp, info], [REST.androidApk, apk]] as const) {
      const cached = await app.inject({ url, headers: { 'if-none-match': 'W/' + result.headers.etag } })
      expect(cached.statusCode).toBe(304)
      expect(cached.body).toBe('')
    }
    expect((await app.inject({ url: REST.androidApk, headers: { 'if-none-match': '"other"' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'HEAD', url: REST.androidApk })).body).toBe('')
  } finally { await app.close() }
})
it('returns 404 when no artifact is pinned', async () => {
  const app = server(join(dir, 'missing.json'))
  try { for (const url of [REST.androidApp, REST.androidApk]) expect((await app.inject(url)).statusCode).toBe(404) }
  finally { await app.close() }
})
it('fails closed for a hash mismatch even with a matching ETag', async () => {
  await writeFile(join(dir, 'app.apk'), Buffer.alloc(bytes.length))
  const app = server()
  try {
    const result = await app.inject({ url: REST.androidApk, headers: { 'if-none-match': '"' + sha256 + '"' } })
    expect(result.statusCode).toBe(503)
    expect(result.body).not.toContain('fixture')
  } finally { await app.close() }
})
it('rejects malformed pins and never emits untrusted response headers', async () => {
  await writeFile(join(dir, 'android-release.json'), JSON.stringify({ ...manifest, android: { ...manifest.android, filename: '../bad.apk' } }))
  const app = server()
  try { expect((await app.inject(REST.androidApp)).statusCode).toBe(503) }
  finally { await app.close() }
})
it('downloads a private owner asset server-side and verifies bytes', async () => {
  await rm(join(dir, 'app.apk'))
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(Response.json({ assets: [{ id: 123, name: 'app.apk' }] }))
    .mockResolvedValueOnce(new Response(bytes))
  const app = Fastify()
  registerAndroidAppRoutes(app, { manifestPath: join(dir, 'android-release.json'), fetchImpl, githubToken: 'private-test-token' })
  try {
    expect((await app.inject(REST.androidApk)).rawPayload).toEqual(bytes)
    expect(fetchImpl.mock.calls[1]![0]).toBe('https://api.github.com/repos/sislex/agent/releases/assets/123')
    expect((await app.inject(REST.androidApp)).body).not.toContain('private-test-token')
    await app.inject(REST.androidApk)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  } finally { await app.close() }
})
it('does not retain a corrupt downloaded artifact', async () => {
  await rm(join(dir, 'app.apk'))
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('corrupt')).mockResolvedValueOnce(new Response(bytes))
  const app = Fastify()
  registerAndroidAppRoutes(app, { manifestPath: join(dir, 'android-release.json'), fetchImpl })
  try {
    expect((await app.inject(REST.androidApk)).statusCode).toBe(503)
    expect((await app.inject(REST.androidApk)).rawPayload).toEqual(bytes)
  } finally { await app.close() }
})
it('keeps public downloads and validators working through the Machines proxy', async () => {
  const upstream = Fastify()
  const whoami = vi.fn()
  registerForwardedAuth(upstream, { name: 'machines', coreUrl: 'http://core', token: 'internal', fetchImpl: whoami })
  registerAndroidAppRoutes(upstream, { manifestPath: join(dir, 'android-release.json') })
  const app = Fastify()
  app.addHook('preHandler', async (_req, reply) => { await reply.code(401).send() })
  registerMachinesProxy(app, { machinesUrl: 'http://machines', fetchImpl: async (input, init) => {
    const result = await upstream.inject({ url: new URL(String(input)).pathname, headers: Object.fromEntries(new Headers(init?.headers)) })
    return new Response(result.statusCode === 304 ? null : result.rawPayload, {
      status: result.statusCode, headers: result.headers as Record<string, string>
    })
  } })
  try {
    expect((await app.inject(REST.androidApp)).statusCode).toBe(200)
    const apk = await app.inject(REST.androidApk)
    expect(apk.rawPayload).toEqual(bytes)
    expect((await app.inject({ url: REST.androidApk, headers: { 'if-none-match': apk.headers.etag! } })).statusCode).toBe(304)
    expect((await app.inject('/api/app/android/private')).statusCode).toBe(401)
    expect(whoami).not.toHaveBeenCalled()
  } finally { await app.close(); await upstream.close() }
})

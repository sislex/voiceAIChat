import { afterEach, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registerApplicationFrontends } from './applicationFrontends.js'
vi.mock('@voicechat/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@voicechat/shared')>()
  return {
    ...actual,
    APPLICATION_CATALOG: [
      ...actual.APPLICATION_CATALOG,
      { ...actual.APPLICATION_CATALOG.find(item => item.id === 'web-reader-ui')!, id: 'unpublished-ui', external: undefined }
    ]
  }
})
const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})
it('раздаёт отдельный dist и не подменяет отсутствующее приложение оболочкой', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vc-frontend-'))
  roots.push(root)
  const packageRoot = join(root, 'node_modules/@sislexa/make')
  const directory = join(packageRoot, 'frontend')
  await mkdir(directory, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@sislexa/make', exports: { './frontend/*': './frontend/*' }
  }))
  await writeFile(join(directory, 'panel-abc.js'), 'window.panel=true')
  const app = Fastify()
  registerApplicationFrontends(app, {}, root)
  try {
    const response = await app.inject('/applications/make-ui/panel-abc.js')
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('window.panel=true')
    expect(response.headers['cache-control']).toContain('immutable')
    expect(
      (await app.inject('/applications/make-ui/manifest.json')).statusCode
    ).toBe(503)
    expect((await app.inject('/applications/core/panel.js')).statusCode).toBe(
      404
    )
    expect(
      (await app.inject('/applications/make-ui/package.json')).statusCode
    ).toBe(503)
  } finally {
    await app.close()
  }
})
it.each([
  { id: 'unpublished-ui', status: 200, calls: 2 },
  { id: 'web-reader-ui', status: 503, calls: 0 },
])('production keeps overrides only without a pinned owner: $id', async ({ id, status, calls }) => {
  const root = await mkdtemp(join(tmpdir(), 'vc-frontend-'))
  roots.push(root)
  const fetchSource = vi.fn(async () => new Response('window.override=true'))
  vi.stubGlobal('fetch', fetchSource)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const app = Fastify()
  registerApplicationFrontends(app, { [id]: 'http://frontend:8080' }, root, undefined, false)
  try {
    const response = await app.inject(`/applications/${id}/panel.js`)
    expect(response.statusCode).toBe(status)
    expect(fetchSource).toHaveBeenCalledTimes(calls)
    if (status === 200) expect(response.body).toBe('window.override=true')
  } finally {
    await app.close()
  }
})
it('площадка не может назначить путь несуществующему приложению', () => {
  const app = Fastify()
  expect(() =>
    registerApplicationFrontends(app, { fake: 'http://localhost:8080' }, undefined, { coreId: 'test', applications: [] })
  ).toThrow('Неизвестный frontend')
})

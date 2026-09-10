import { afterEach, expect, it } from 'vitest'
import Fastify from 'fastify'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registerApplicationFrontends } from './applicationFrontends.js'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})
it('раздаёт отдельный dist и не подменяет отсутствующее приложение оболочкой', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vc-frontend-'))
  roots.push(root)
  const directory = join(root, 'packages/make-app/dist')
  await mkdir(directory, { recursive: true })
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
it('площадка не может назначить путь несуществующему приложению', () => {
  const app = Fastify()
  expect(() =>
    registerApplicationFrontends(app, { fake: 'http://localhost:8080' })
  ).toThrow('Неизвестный frontend')
})

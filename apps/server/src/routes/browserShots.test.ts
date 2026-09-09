import { describe, expect, it } from 'vitest'
import fastify from 'fastify'
import { registerBrowserShotRoutes } from './browserShots.js'
import { saveBrowserShot } from '../browser/checkShots.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function makeApp(opts: { shotsRoot?: string; run?: unknown } = {}) {
  const app = fastify()
  app.addHook('onRequest', async (req) => { (req as unknown as { user: { name: string } }).user = { name: 'admin' } })
  registerBrowserShotRoutes(app, { db: { ci: { getCiRun: async () => opts.run ?? null } } as never, shotsRoot: opts.shotsRoot })
  await app.ready()
  return app
}

// Кадры браузерной проверки: доступ решает ран (в нём — членство в проекте), а
// имя файла обязано быть номером — иначе в путь можно было бы вписать что угодно.
describe('кадры браузерной проверки рана', () => {
  it('отдаёт сохранённый кадр участнику проекта', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vc-shots-route-'))
    saveBrowserShot(root, 'run-1', Buffer.from('кадр'))
    const app = await makeApp({ shotsRoot: root, run: { run: { id: 'run-1' }, steps: [] } })
    const res = await app.inject({ method: 'GET', url: '/api/ci/runs/run-1/browser-shots/1.png' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.rawPayload.toString()).toBe('кадр')
    await app.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('чужой ран — 404, кривое имя — 404, без каталога роута нет', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vc-shots-route-'))
    saveBrowserShot(root, 'run-1', Buffer.from('кадр'))

    const foreign = await makeApp({ shotsRoot: root, run: null })
    expect((await foreign.inject({ method: 'GET', url: '/api/ci/runs/run-1/browser-shots/1.png' })).statusCode).toBe(404)
    await foreign.close()

    const own = await makeApp({ shotsRoot: root, run: { run: { id: 'run-1' }, steps: [] } })
    expect((await own.inject({ method: 'GET', url: '/api/ci/runs/run-1/browser-shots/секрет.png' })).statusCode).toBe(404)
    await own.close()

    const noRoot = await makeApp({ run: { run: { id: 'run-1' }, steps: [] } })
    expect((await noRoot.inject({ method: 'GET', url: '/api/ci/runs/run-1/browser-shots/1.png' })).statusCode).toBe(404)
    await noRoot.close()
    rmSync(root, { recursive: true, force: true })
  })
})

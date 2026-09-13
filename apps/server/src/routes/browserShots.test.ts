import { describe, expect, it, vi } from 'vitest'
import { createLocalReaderCore } from '../readerBridge/localCore.js'
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
describe('browser observation authorization', () => {
  it('requires the signed conversation, actor and current model-work step', async () => {
    const addCiEvent = vi.fn()
    const detail = { run: { id: 'r1', projectId: 'p1', conversationId: 'c1', triggeredBy: 'alice' }, steps: [{ id: 's1', kind: 'model_work', status: 'running' }] }
    const core = createLocalReaderCore({
      db: { ci: { getCiRun: async (user: string) => user === 'alice' ? detail : null, addCiEvent } } as never,
      app: {} as never, machines: {} as never, relay: {} as never, runKeys: {} as never, previews: async () => [], shotsRoot: '', publish: () => {}
    })
    const entry = { userId: 'alice', conversationId: 'c1', ciCheck: { runId: 'r1', stepId: 's1', url: 'http://agent.machine.internal:5173/' } }
    const event = { action: 'read' as const, ok: true, target: true, width: 320 }
    await core.logBrowserEvidence!(entry, { ...event, secret: 'never persist' } as typeof event)
    expect(addCiEvent).toHaveBeenCalledOnce()
    expect(JSON.stringify(addCiEvent.mock.calls)).not.toContain('never persist')
    await expect(core.logBrowserEvidence!({ ...entry, userId: 'other' }, event)).rejects.toThrow()
    await expect(core.logBrowserEvidence!({ ...entry, conversationId: 'other' }, event)).rejects.toThrow()
    await expect(core.logBrowserEvidence!({ ...entry, ciCheck: { ...entry.ciCheck, stepId: 'old' } }, event)).rejects.toThrow()
    detail.steps[0].status = 'success'
    await expect(core.logBrowserEvidence!(entry, event)).rejects.toThrow()
    expect(addCiEvent).toHaveBeenCalledOnce()
  })
})

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

import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { PREVIEW_RUN_COOKIE } from '@voicechat/shared'
import { registerBrowserRoutes } from './routes.js'
const meta = { id: 'c', conversationId: 'c', incarnation: 'inc', state: 'ready', activeTabId: 't', tabs: [], viewport: { width: 800, height: 600, deviceScaleFactor: 1 }, currentUrl: 'https://example.com/', title: 'Page' }
const apps: FastifyInstance[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })
const setup = async (engine = 'chromium', missing = false) => {
  const app = Fastify(); apps.push(app)
  app.addHook('onRequest', async request => { Object.assign(request, { user: { name: 'alice' } }) })
  const runner = { start: vi.fn(async () => meta), command: vi.fn(async () => meta), stop: vi.fn(async () => true), screenshot: vi.fn(async () => ({ buffer: Buffer.from('image'), mimeType: 'image/png' })) }
  registerBrowserRoutes(app, { core: { conversation: async () => missing ? null : { assistantKind: 'web-recorder', previewEngine: engine }, issuePreviewRunKey: async () => 'fixture-key' } as never, runner: runner as never, runnerFacingBase: 'http://core:8799' })
  await app.ready(); return { app, runner }
}
describe('Chromium внутри Web Reader', () => {
  it('выбранный движок получает собственную сессию и cookie прокси', async () => {
    const { app, runner } = await setup(); expect((await app.inject({ method: 'POST', url: '/api/browser/c/start', payload: {} })).statusCode).toBe(200)
    expect(runner.start).toHaveBeenCalledWith({ sessionId: 'c', userKey: 'alice', conversationKey: 'c', profileMode: 'persistent', cookies: [{ name: PREVIEW_RUN_COOKIE, value: 'fixture-key', url: 'http://core:8799/api/preview' }] })
  })
  it('быстрый режим не получает команды Chromium', async () => {
    const { app, runner } = await setup('proxy'); expect((await app.inject({ method: 'POST', url: '/api/browser/c/start', payload: {} })).statusCode).toBe(403); expect(runner.start).not.toHaveBeenCalled()
  })
  it('чужой разговор не запускает браузер', async () => {
    const { app, runner } = await setup('chromium', true); expect((await app.inject({ method: 'POST', url: '/api/browser/c/start', payload: {} })).statusCode).toBe(404); expect(runner.start).not.toHaveBeenCalled()
  })
  it('после смены движка разрешена очистка старого Chromium', async () => {
    const { app, runner } = await setup('proxy'); expect((await app.inject({ method: 'DELETE', url: '/api/browser/c' })).json()).toEqual({ stopped: true }); expect(runner.stop).toHaveBeenCalledWith('c')
  })
  it('пользовательский app.internal проходит через origin своего ядра', async () => {
    const { app, runner } = await setup(); expect((await app.inject({ method: 'POST', url: '/api/browser/c/command', payload: { incarnation: 'inc', command: { type: 'navigate', url: 'https://app.internal/#/machines' } } })).statusCode).toBe(200)
    expect(runner.command).toHaveBeenCalledWith('c', expect.objectContaining({ command: { type: 'navigate', url: 'http://core:8799/api/preview?url=https%3A%2F%2Fapp.internal%2F%23%2Fmachines' } }))
  })
  it('кадр содержит логический адрес метаданных, а не внутренний location', async () => {
    const { app, runner } = await setup(); expect((await app.inject({ method: 'POST', url: '/api/browser/c/screenshot', payload: { incarnation: 'inc' } })).json()).toMatchObject({ page: { url: 'https://example.com/', title: 'Page' } })
    expect(runner.command).toHaveBeenCalledWith('c', expect.objectContaining({ command: { type: 'status' } }))
  })
})

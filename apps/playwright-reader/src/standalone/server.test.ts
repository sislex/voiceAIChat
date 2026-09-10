import { describe, expect, it } from 'vitest'
import { buildPlaywrightReaderServer } from './server.js'
import { loadPlaywrightReaderConfig } from './config.js'
import { INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH } from '@voicechat/shared'

describe('отдельный процесс Playwright Reader', () => {
  it('не запускается без внутреннего токена или с неполной конфигурацией раннера', async () => {
    await expect(buildPlaywrightReaderServer({ config: loadPlaywrightReaderConfig({}) })).rejects.toThrow('VC_INTERNAL_TOKEN')
    await expect(buildPlaywrightReaderServer({ config: loadPlaywrightReaderConfig({ VC_INTERNAL_TOKEN: 't', VC_BROWSER_RUNNER_URL: 'http://runner' }) })).rejects.toThrow('задаются вместе')
  })

  it('не требует БД или MCP-секрета, показывает отсутствие раннера и закрывает внутренний API', async () => {
    const { app } = await buildPlaywrightReaderServer({ config: loadPlaywrightReaderConfig({ VC_INTERNAL_TOKEN: 't' }) })
    try {
      expect((await app.inject('/v1/health')).json()).toMatchObject({ ok: true, service: 'playwright-reader', version: null, runnerConfigured: false, application: { applicationId: 'playwright-reader', version: null } })
      expect((await app.inject({ method: 'POST', url: INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH, payload: {} })).statusCode).toBe(401)
      const invalid = await app.inject({ method: 'POST', url: INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH, headers: { authorization: 'Bearer t' }, payload: { method: 'constructor', args: [] } })
      expect(invalid.statusCode).toBe(400)
    } finally { await app.close() }
  })

  it('при недоступном whoami закрывает доступ, не запускает сессию под сервисным токеном', async () => {
    const { app } = await buildPlaywrightReaderServer({ config: loadPlaywrightReaderConfig({ VC_INTERNAL_TOKEN: 't' }), fetchImpl: async () => { throw new Error('offline') } })
    try {
      const res = await app.inject({ method: 'POST', url: '/api/browser/c/start', headers: { authorization: 'Bearer t' }, payload: {} })
      expect(res.statusCode).toBe(503)
      expect(res.json()).toEqual({ error: 'core_unavailable' })
    } finally { await app.close() }
  })
})

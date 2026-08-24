// @vitest-environment node
import { describe, expect, it } from 'vitest'
import config from '../vite.config'

// Dev-контур Web Reader: браузер видит Reader как same-origin путь /web-recorder/,
// который Vite основного клиента проксирует на отдельный Reader dev server (HMR
// внутри iframe), а /api и WS уходят на Fastify. Production от прокси не зависит:
// там сервер сам раздаёт сборку Reader (см. apps/server/src/server.test.ts).
describe('dev proxy основного клиента', () => {
  const proxy = (config as { server?: { proxy?: Record<string, { target?: string; ws?: boolean }> } }).server?.proxy ?? {}

  it('проксирует /web-recorder/ на Reader dev server', () => {
    expect(proxy['/web-recorder/']?.target).toBe('http://127.0.0.1:5274')
  })

  it('оставляет /api и WS на Fastify backend', () => {
    expect(proxy['/api']?.target).toBe('http://127.0.0.1:8787')
    expect(proxy['/ws']?.target).toBe('ws://127.0.0.1:8787')
    expect(proxy['/ws']?.ws).toBe(true)
  })
})

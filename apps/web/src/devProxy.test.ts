// @vitest-environment node
import { describe, expect, it } from 'vitest'
import config from '../vite.config'

// Core serves the immutable recorder artifact, or forwards to the configured Reader.
describe('dev proxy основного клиента', () => {
  const proxy = (config as { server?: { proxy?: Record<string, { target?: string; ws?: boolean }> } }).server?.proxy ?? {}

  it('forwards the recorder path to the Core artifact/remote bridge', () => {
    expect(proxy['/web-recorder/']?.target).toBe('http://127.0.0.1:8787')
  })

  it('оставляет /api и WS на Fastify backend', () => {
    expect(proxy['/api']?.target).toBe('http://127.0.0.1:8787')
    expect(proxy['/ws']?.target).toBe('ws://127.0.0.1:8787')
    expect(proxy['/ws']?.ws).toBe(true)
  })
})

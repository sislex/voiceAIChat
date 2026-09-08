import type { FastifyInstance } from 'fastify'
import { registerServiceProxy } from '../makeBridge/proxy.js'

/** Тот же origin и cookie/CSRF, даже если пользователь заходит портом ядра без Caddy. */
export function registerPlaywrightReaderProxy(app: FastifyInstance, opts: { baseUrl: string; fetchImpl?: typeof fetch }): void {
  registerServiceProxy(app, { name: 'playwright_reader', prefixes: ['/api/browser'], ...opts })
}

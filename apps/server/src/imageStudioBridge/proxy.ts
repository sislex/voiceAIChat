import type { FastifyInstance } from 'fastify'
import { IMAGE_STUDIO_API_BODY_LIMIT, IMAGE_STUDIO_GENERATION_TIMEOUT_MS, IMAGE_STUDIO_PROXY_PREFIXES } from '@voicechat/shared'
import { registerServiceProxy } from '../makeBridge/proxy.js'

export function registerImageStudioProxy(app: FastifyInstance, opts: { studioUrl: string; fetchImpl?: typeof fetch }): void {
  registerServiceProxy(app, { name: 'image_studio', baseUrl: opts.studioUrl, fetchImpl: opts.fetchImpl,
    prefixes: IMAGE_STUDIO_PROXY_PREFIXES, bodyLimit: IMAGE_STUDIO_API_BODY_LIMIT,
    timeoutMs: IMAGE_STUDIO_GENERATION_TIMEOUT_MS })
}

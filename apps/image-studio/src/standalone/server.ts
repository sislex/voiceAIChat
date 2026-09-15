import { applicationRuntimeMetadata } from '@voicechat/shared'
import Fastify from 'fastify'
import {
  createRpcDispatcher, RpcError, INTERNAL_IMAGE_STUDIO_SERVICE_PATH, IMAGE_STUDIO_SERVICE_METHODS,
  IMAGE_STUDIO_HEALTH_PATH, type RpcRequest
} from '@voicechat/shared'
import type { ImageStudioCore } from '../core.js'
import { createImageStudioModule } from '../module.js'
import type { ImageStudioStandaloneConfig } from './config.js'
import { HttpImageStudioCore } from './httpCore.js'
import { registerForwardedAuth } from './auth.js'

export async function buildImageStudioServer(opts: {
  config: ImageStudioStandaloneConfig
  core?: ImageStudioCore
  fetchImpl?: typeof fetch
  logger?: boolean
}) {
  const { config } = opts
  if (!config.internalToken) throw new Error('Image Studio standalone requires VC_INTERNAL_TOKEN')
  if (!config.mcpSecret) throw new Error('Image Studio standalone requires VC_MCP_SECRET')
  const app = Fastify({ logger: opts.logger ?? false })
  const core = opts.core ?? new HttpImageStudioCore({ coreUrl: config.coreUrl, token: config.internalToken, fetchImpl: opts.fetchImpl })
  registerForwardedAuth(app, { coreUrl: config.coreUrl, token: config.internalToken, fetchImpl: opts.fetchImpl })
  const studio = createImageStudioModule({ dataDir: config.dataDir, core, mcpSecret: config.mcpSecret })
  studio.register(app)
  const dispatch = createRpcDispatcher(studio.service, IMAGE_STUDIO_SERVICE_METHODS)
  // Секрет проверяется до разбора тела: пользовательский Bearer здесь не подходит.
  app.register(async (internal) => {
    internal.addHook('onRequest', async (req, reply) => {
      if (req.headers.authorization !== `Bearer ${config.internalToken}`) return reply.code(401).send({ error: 'unauthorized' })
    })
    internal.post<{ Body: RpcRequest }>(INTERNAL_IMAGE_STUDIO_SERVICE_PATH, async (req, reply) => {
      try { return { result: await dispatch(req.body ?? { method: '', args: [] }) } } catch (error) {
        return reply.code(error instanceof RpcError ? error.status : 500).send({ error: error instanceof Error ? error.message : String(error) })
      }
    })
  })
  app.get(IMAGE_STUDIO_HEALTH_PATH, async () => ({ application: applicationRuntimeMetadata('image-studio', process.env), ok: true, service: 'image-studio', version: config.version }))
  return { app, studio }
}

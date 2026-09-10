import { applicationRuntimeMetadata } from '@voicechat/shared'
import Fastify from 'fastify'
import { createRpcDispatcher, INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH, PLAYWRIGHT_READER_RPC_BODY_LIMIT, PLAYWRIGHT_READER_SERVICE_METHODS, RpcError, type RpcRequest } from '@voicechat/shared'
import { createBrowserRunnerClient, type BrowserRunnerClient } from '@voicechat/browser-runner/client'
import type { PlaywrightReaderCore } from '../core.js'
import { createPlaywrightReaderModule } from '../module.js'
import { registerForwardedAuth } from './auth.js'
import type { PlaywrightReaderConfig } from './config.js'
import { createHttpPlaywrightReaderCore } from './httpCore.js'

export async function buildPlaywrightReaderServer(opts: {
  config: PlaywrightReaderConfig
  core?: PlaywrightReaderCore
  runner?: BrowserRunnerClient
  fetchImpl?: typeof fetch
  logger?: boolean
}) {
  const { config } = opts
  if (!config.internalToken) throw new Error('Playwright Reader требует VC_INTERNAL_TOKEN (тот же, что у ядра)')
  if (Boolean(config.runnerUrl) !== Boolean(config.runnerToken)) throw new Error('VC_BROWSER_RUNNER_URL и VC_BROWSER_RUNNER_TOKEN задаются вместе')
  const app = Fastify({ logger: opts.logger ?? false })
  // У ядра DELETE с JSON Content-Type и пустым телом допустим; прямой путь через Caddy должен вести себя так же.
  const parseJson = app.getDefaultJsonParser('error', 'error')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (typeof body === 'string' && !body.trim()) return done(null, undefined)
    parseJson(req, body as string, done)
  })
  const core = opts.core ?? createHttpPlaywrightReaderCore({ coreUrl: config.coreUrl, token: config.internalToken, fetchImpl: opts.fetchImpl })
  const runner = opts.runner ?? (config.runnerUrl && config.runnerToken
    ? createBrowserRunnerClient({ baseUrl: config.runnerUrl, token: config.runnerToken, fetchImpl: opts.fetchImpl }) : undefined)
  registerForwardedAuth(app, { coreUrl: config.coreUrl, token: config.internalToken, fetchImpl: opts.fetchImpl })
  const reader = createPlaywrightReaderModule({ core, runner, runnerFacingBase: config.runnerFacingBase })
  reader.register(app)
  const dispatch = createRpcDispatcher(reader.service, PLAYWRIGHT_READER_SERVICE_METHODS)
  app.post<{ Body: RpcRequest }>(INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH, {
    bodyLimit: PLAYWRIGHT_READER_RPC_BODY_LIMIT,
    onRequest: async (req, reply) => {
      if (req.headers.authorization !== `Bearer ${config.internalToken}`) return reply.code(401).send({ error: 'unauthorized' })
    }
  }, async (req, reply) => {
    try { return { result: await dispatch(req.body ?? { method: '', args: [] }) } } catch (error) {
      return reply.code(error instanceof RpcError ? error.status : 500).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })
  app.get('/v1/health', async () => ({ application: applicationRuntimeMetadata('playwright-reader', process.env), ok: true, service: 'playwright-reader', version: config.version, runnerConfigured: Boolean(runner) }))
  return { app, reader }
}

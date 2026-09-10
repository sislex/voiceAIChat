// У Reader нет подключения к БД: авторизацию, права и машины проверяет владелец данных — ядро.
import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { applicationRuntimeMetadata } from '@voicechat/shared'
import { HttpReaderCore, READER_HEALTH_PATH, type ReaderCore } from '@voicechat/web-reader-contracts'
import { createRemotePlaywrightReader, type PlaywrightReaderService } from '@voicechat/playwright-reader-contracts'
import { createReaderModule } from '../module.js'
import { registerForwardedAuth } from './auth.js'
import type { WebReaderConfig } from './config.js'

export interface BuildReaderServerOptions {
  config: WebReaderConfig
  core?: ReaderCore
  browser?: PlaywrightReaderService
  fetchImpl?: typeof fetch
  logger?: boolean
}
export type ReaderServer = Awaited<ReturnType<typeof buildReaderServer>>
export async function buildReaderServer(opts: BuildReaderServerOptions) {
  const { config } = opts
  if (!config.internalToken) throw new Error('Web Reader требует VC_INTERNAL_TOKEN (тот же, что у ядра)')
  if (!config.mcpSecret) throw new Error('Web Reader требует VC_MCP_SECRET (тот же, что у ядра)')
  const app = Fastify({ logger: opts.logger ?? false })
  const core = opts.core ?? new HttpReaderCore({ coreUrl: config.coreUrl, token: config.internalToken, fetchImpl: opts.fetchImpl })
  const browser = opts.browser ?? createRemotePlaywrightReader({ baseUrl: config.playwrightReaderUrl, token: config.internalToken, fetchImpl: opts.fetchImpl })
  registerForwardedAuth(app, { coreUrl: config.coreUrl, token: config.internalToken, fetchImpl: opts.fetchImpl })
  createReaderModule({ app, core, browser, mcpSecret: config.mcpSecret })
  // Прокси ядра сохраняет origin postMessage и cookie. Артефакт рекордера обновляется с Web Reader.
  if (existsSync(config.webRecorderDir)) await app.register(fastifyStatic, { root: config.webRecorderDir, prefix: '/web-recorder/', decorateReply: false, cacheControl: false })
  app.get(READER_HEALTH_PATH, async () => ({ ok: true, service: 'web-reader', version: config.version, application: applicationRuntimeMetadata('web-reader', process.env) }))
  return { app, core }
}

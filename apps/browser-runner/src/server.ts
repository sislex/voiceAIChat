import Fastify, { type FastifyInstance } from 'fastify'
import type { BrowserCommandRequest } from '@voicechat/shared'
import { registerRunnerAuth } from './security.js'
import { BrowserSessionManager, type StartSessionRequest } from './sessionManager.js'

export interface BuildBrowserRunnerOptions {
  token: string
  profilesRoot: string
  sessions?: BrowserSessionManager
}

export async function buildBrowserRunner(options: BuildBrowserRunnerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const sessions = options.sessions ?? new BrowserSessionManager(options.profilesRoot)
  registerRunnerAuth(app, options.token)

  app.get('/v1/health', async () => ({
    ok: true,
    browser: { present: true, version: null },
    launch: { ok: true },
    sessions: sessions.count()
  }))
  app.post<{ Body: StartSessionRequest }>('/v1/sessions', async (request, reply) => {
    try { return await sessions.start(request.body) }
    catch (error) { return reply.code(503).send({ error: 'start_failed', message: error instanceof Error ? error.message : 'unknown error' }) }
  })
  app.post<{ Params: { id: string }; Body: BrowserCommandRequest }>('/v1/sessions/:id/commands', async (request, reply) => {
    try {
      const result = await sessions.command(request.params.id, request.body)
      if (Buffer.isBuffer(result)) return reply.type('image/png').send(result)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'internal'
      const status = message === 'not_found' ? 404 : message.startsWith('stale_') ? 409 : 422
      return reply.code(status).send({ error: message })
    }
  })
  app.delete<{ Params: { id: string } }>('/v1/sessions/:id', async (request) => ({ stopped: await sessions.stop(request.params.id) }))
  app.addHook('onClose', async () => sessions.close())
  return app
}

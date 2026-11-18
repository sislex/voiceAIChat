// HTTP and WebSocket endpoints of the provider side of the tool transit (toolTransit.ts).

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { MODEL_TOOL_TRANSIT, isModelToolTransitSlot } from '@voicechat/shared'
import type { ModelToken } from '../auth/modelTokens.js'
import type { ToolTransitHub } from './toolTransit.js'

interface Options {
  hub: ToolTransitHub
  /** Authenticates the upgrade request and returns its model token, or undefined to refuse. */
  authorize(req: FastifyRequest): Promise<ModelToken | undefined>
  requestBytes: number
}

export function registerToolTransit(app: FastifyInstance, opts: Options): void {
  void app.register(async (scoped) => {
    scoped.get(MODEL_TOOL_TRANSIT.socket, { websocket: true }, async (socket, request) => {
      const token = await opts.authorize(request).catch(() => undefined)
      if (!token) { socket.close(4003, 'token_scope_denied'); return }
      opts.hub.attach(socket as never, token.sid)
    })
  })
  // The runner calls this address without credentials of its own: the run token in the path is the
  // secret, exactly like `k`/`turn` of Core's own MCP endpoints. The body is relayed untouched.
  void app.register(async (scoped) => {
    scoped.removeAllContentTypeParsers()
    scoped.addContentTypeParser('*', (_req, _payload, done) => { done(null, undefined) })
    scoped.route<{ Params: { token: string; slot: string } }>({
      method: ['GET', 'POST', 'DELETE'],
      url: `${MODEL_TOOL_TRANSIT.http}/:token/:slot`,
      handler: async (req, reply) => {
        const { token, slot } = req.params
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token) || !isModelToolTransitSlot(slot)) return reply.code(404).send({ error: 'unknown_endpoint' })
        const chunks: Buffer[] = []
        let size = 0
        try {
          for await (const chunk of req.raw) {
            size += (chunk as Buffer).length
            if (size > opts.requestBytes) return reply.code(413).send({ error: 'request_too_large' })
            chunks.push(chunk as Buffer)
          }
        } catch { return reply.code(400).send({ error: 'invalid_request' }) }
        reply.hijack()
        const res = reply.raw
        let started = false
        const call = opts.hub.relay(token, slot, { method: req.method, headers: req.headers, ...(size ? { body: Buffer.concat(chunks) } : {}) }, {
          head(status, headers) { started = true; res.writeHead(status, headers) },
          chunk(data) { res.write(data) },
          end() { res.end() },
          fail(status, message) {
            // After the head a failure can only cut the stream: the client sees a broken response.
            if (started) { res.destroy(); return }
            res.writeHead(status, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: message }))
          }
        })
        res.on('close', () => { if (!res.writableFinished) call.abort() })
      }
    })
  })
}

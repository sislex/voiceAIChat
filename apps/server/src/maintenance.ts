import type { FastifyInstance } from 'fastify'

/** Process-local migration gate; new Core instances always start writable. */
export class Maintenance {
  private state = { readOnly: false, reason: '' }
  snapshot(): { readOnly: boolean; reason: string } { return { ...this.state } }
  set(readOnly: boolean, reason: string): void { this.state = { readOnly, reason: readOnly ? reason : '' } }
  rejection(): { error: 'read_only'; reason: string } | undefined {
    return this.state.readOnly ? { error: 'read_only', reason: this.state.reason } : undefined
  }
  register(app: FastifyInstance): void {
    app.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0]
      if ((path === '/api' || path.startsWith('/api/')) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        const error = this.rejection()
        if (error) return reply.code(503).send(error)
      }
    })
  }
}

// Unknown commands fail closed. These only manage read subscriptions.
export const READ_ONLY_WS_COMMANDS = new Set([
  'chat.connect', 'cc.tail.start', 'cc.tail.stop', 'cx.tail.start', 'cx.tail.stop',
  'board.subscribe', 'board.unsubscribe', 'ci.subscribe', 'ci.unsubscribe'
])

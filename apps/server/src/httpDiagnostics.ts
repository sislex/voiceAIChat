import type { FastifyInstance } from 'fastify'

/** Keep intermittent API failures observable without logging user data or credentials. */
export function registerHttpDiagnostics(app: FastifyInstance, options: {
  now?: () => number
  log?: (event: { event: string; method: string; route: string; status: number; durationMs: number }) => void
} = {}): void {
  const now = options.now ?? (() => performance.now())
  const log = options.log ?? (event => console.warn(JSON.stringify(event)))
  const started = new WeakMap<object, number>()
  app.addHook('onRequest', async req => { started.set(req, now()) })
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url
    if (!route || !/^\/(api|internal)(?:\/|$)/.test(route)) return
    const durationMs = Math.round(now() - (started.get(req) ?? now()))
    if (reply.statusCode < 500 && durationMs < 2000) return
    // Route templates exclude query strings and actual user/resource identifiers.
    log({ event: 'api_request_problem', method: req.method, route, status: reply.statusCode, durationMs })
  })
}

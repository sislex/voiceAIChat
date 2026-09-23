import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'

export const REQUEST_ID_HEADER = 'x-request-id'
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const WINDOW_MS = 5 * 60_000

export function requestIdOf(value: unknown): string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value : randomUUID()
}

export interface HttpOperationsSnapshot {
  inFlight: number
  requests: number
  failures: number
  slow: number
  windowMs: number
  recentFailures: number
  recentSlow: number
  alerts: Array<'http_5xx_rate' | 'http_slow_rate' | 'http_in_flight'>
}

interface RouteMetric {
  requests: number
  failures: number
  slow: number
  durationMs: number
}

export interface HttpDiagnostics {
  snapshot(): HttpOperationsSnapshot
  prometheus(): string
}

function label(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/** Keep intermittent API failures observable without logging user data or credentials. */
export function registerHttpDiagnostics(app: FastifyInstance, options: {
  now?: () => number
  log?: (event: { event: string; requestId: string; method: string; route: string; status: number; durationMs: number }) => void
} = {}): HttpDiagnostics {
  const now = options.now ?? (() => performance.now())
  const log = options.log ?? (event => console.warn(JSON.stringify(event)))
  const started = new WeakMap<object, number>()
  const routes = new Map<string, RouteMetric>()
  const problems: Array<{ at: number; failure: boolean; slow: boolean }> = []
  let inFlight = 0
  let requests = 0
  let failures = 0
  let slow = 0
  const trim = (at: number) => {
    while (problems[0] && at - problems[0].at > WINDOW_MS) problems.shift()
  }
  app.addHook('onRequest', async (req, reply) => {
    started.set(req, now())
    inFlight++
    reply.header(REQUEST_ID_HEADER, req.id)
  })
  app.addHook('onResponse', async (req, reply) => {
    inFlight = Math.max(0, inFlight - 1)
    const route = req.routeOptions.url
    if (!route || !/^\/(api|internal)(?:\/|$)/.test(route)) return
    const at = now()
    const durationMs = Math.max(0, Math.round(at - (started.get(req) ?? at)))
    const failed = reply.statusCode >= 500
    const slowRequest = durationMs >= 2000
    requests++
    if (failed) failures++
    if (slowRequest) slow++
    const key = `${req.method}\u0000${route}`
    const metric = routes.get(key) ?? { requests: 0, failures: 0, slow: 0, durationMs: 0 }
    metric.requests++
    metric.durationMs += durationMs
    if (failed) metric.failures++
    if (slowRequest) metric.slow++
    routes.set(key, metric)
    if (failed || slowRequest) problems.push({ at, failure: failed, slow: slowRequest })
    trim(at)
    if (!failed && !slowRequest) return
    // Route templates exclude query strings and actual user/resource identifiers.
    log({ event: 'api_request_problem', requestId: req.id, method: req.method, route, status: reply.statusCode, durationMs })
  })
  return {
    snapshot: () => {
      trim(now())
      const recentFailures = problems.filter(item => item.failure).length
      const recentSlow = problems.filter(item => item.slow).length
      const alerts: HttpOperationsSnapshot['alerts'] = []
      if (recentFailures >= 5) alerts.push('http_5xx_rate')
      if (recentSlow >= 10) alerts.push('http_slow_rate')
      if (inFlight >= 100) alerts.push('http_in_flight')
      return { inFlight, requests, failures, slow, windowMs: WINDOW_MS, recentFailures, recentSlow, alerts }
    },
    prometheus: () => {
      trim(now())
      const recentFailures = problems.filter(item => item.failure).length
      const recentSlow = problems.filter(item => item.slow).length
      const lines = [
        '# TYPE sislexa_core_http_in_flight gauge',
        `sislexa_core_http_in_flight ${inFlight}`,
        '# TYPE sislexa_core_http_recent_failures gauge',
        `sislexa_core_http_recent_failures ${recentFailures}`,
        '# TYPE sislexa_core_http_recent_slow_requests gauge',
        `sislexa_core_http_recent_slow_requests ${recentSlow}`,
        '# TYPE sislexa_core_http_requests_total counter',
        '# TYPE sislexa_core_http_failures_total counter',
        '# TYPE sislexa_core_http_slow_requests_total counter',
        '# TYPE sislexa_core_http_request_duration_ms_total counter'
      ]
      for (const [key, metric] of [...routes].sort(([a], [b]) => a.localeCompare(b))) {
        const [method, route] = key.split('\u0000') as [string, string]
        const labels = `method="${label(method)}",route="${label(route)}"`
        lines.push(
          `sislexa_core_http_requests_total{${labels}} ${metric.requests}`,
          `sislexa_core_http_failures_total{${labels}} ${metric.failures}`,
          `sislexa_core_http_slow_requests_total{${labels}} ${metric.slow}`,
          `sislexa_core_http_request_duration_ms_total{${labels}} ${metric.durationMs}`
        )
      }
      return lines.join('\n') + '\n'
    }
  }
}

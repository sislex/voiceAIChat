import type { FastifyInstance } from 'fastify'
import { REST, UI_PERFORMANCE_POLICY as P, validUiPerformanceBatch, validUiPerformanceQuery, uiPerformanceStats,
  type UiPerformanceBatch, type UiPerformanceSample, type UiPerformanceQuery, type UiPerformanceReport } from '@voicechat/shared'
import { requireAdmin } from "@sislexa/identity/server/users/auth"

/** Process-local bounded distribution. Restart clears it; server receipt defines periods. */
export class UiPerformanceStore {
  private rows: Array<{ at: number; sample: UiPerformanceSample }> = []
  private batches = new Map<string, number>()
  constructor(private now: () => number = Date.now) {}
  accept(batch: UiPerformanceBatch): boolean {
    const at = this.now()
    this.prune(at)
    if (this.batches.has(batch.batchId)) return true
    if (new Set([...this.rows.map(row => row.sample.version), ...batch.samples.map(sample => sample.version)]).size > 64) return false
    this.batches.set(batch.batchId, at)
    for (const sample of batch.samples) this.rows.push({ at, sample: { ...sample } })
    this.rows = this.rows.slice(-P.maxSamples)
    while (this.batches.size > P.maxSamples) this.batches.delete(this.batches.keys().next().value!)
    return true
  }
  private prune(at: number): void {
    this.rows = this.rows.filter(row => row.at >= at - P.retentionMs)
    for (const [id, seen] of this.batches) if (seen < at - P.retentionMs) this.batches.delete(id)
  }
  report(q: UiPerformanceQuery): UiPerformanceReport {
    this.prune(this.now())
    const rows = this.rows.filter(({ at, sample }) => at >= q.from && at < q.to &&
      (['metric','platform','lifecycle','route','version'] as const).every(key => q[key] === undefined || q[key] === sample[key]))
    const metrics = (from: number, to: number) => P.metrics.filter(metric => !q.metric || q.metric === metric).map(metric => ({
      metric, ...uiPerformanceStats(rows.filter(row => row.at >= from && row.at < to && row.sample.metric === metric).map(row => row.sample.duration))
    }))
    const width = (q.to - q.from) / q.buckets
    return { from: q.from, to: q.to, minSamples: P.minSamples, metrics: metrics(q.from,q.to),
      trend: Array.from({ length: q.buckets }, (_,i) => {
        const from = q.from + i * width, to = q.from + (i+1) * width
        return { from, to, metrics: metrics(from,to) }
      }) }
  }
}
export function registerUiPerformanceRoutes(app: FastifyInstance, store = new UiPerformanceStore()): void {
  // Authentication is supplied by the existing /api hook; a global cap retains no identity.
  let windowStart = 0, requests = 0
  app.post(REST.uiPerformance, { bodyLimit: 16_384, logLevel: 'silent' }, async (req, reply) => {
    const now = Date.now()
    if (now - windowStart >= 60_000) { windowStart = now; requests = 0 }
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    if (++requests > 600) return reply.code(429).send({ error: 'telemetry_rate_limit' })
    if (!validUiPerformanceBatch(req.body)) return reply.code(400).send({ error: 'invalid_telemetry' })
    if (!store.accept(req.body)) return reply.code(429).send({ error: 'telemetry_cardinality_limit' })
    return reply.code(204).send()
  })
  app.post(REST.uiPerformanceReport, { preHandler: requireAdmin, bodyLimit: 2048, logLevel: 'silent' }, async (req, reply) => {
    if (!validUiPerformanceQuery(req.body)) return reply.code(400).send({ error: 'invalid_telemetry_query' })
    return store.report(req.body)
  })
}

/** Versioned technical-only policy. No user, conversation, URL or message fields. */
export const UI_PERFORMANCE_POLICY = {
  maxBatch: 32, maxDurationMs: 300_000, maxAgeMs: 300_000,
  retentionMs: 7 * 86_400_000, maxSamples: 100_000, minSamples: 20,
  routes: ['shell', 'chat', 'account', 'board'],
  platforms: ['web', 'desktop', 'mobile'],
  lifecycles: ['cold', 'warm'],
  metrics: ['shell_interactive', 'chat_ready', 'account_ready', 'board_ready', 'message_first_token', 'message_first_audio']
} as const
export type UiMetric = typeof UI_PERFORMANCE_POLICY.metrics[number]
export type UiRoute = typeof UI_PERFORMANCE_POLICY.routes[number]
export interface UiPerformanceSample {
  metric: UiMetric; duration: number
  platform: typeof UI_PERFORMANCE_POLICY.platforms[number]
  lifecycle: 'cold' | 'warm'; route: UiRoute; version: string; age: number
}
export interface UiPerformanceBatch { schemaVersion: 1; batchId: string; samples: UiPerformanceSample[] }
export interface UiPerformanceQuery {
  from: number; to: number; buckets: number
  metric?: UiMetric; platform?: UiPerformanceSample['platform']; lifecycle?: 'cold' | 'warm'
  route?: UiRoute; version?: string
}
export interface UiPerformanceStats { p50: number | null; p95: number | null; count: number; state: 'empty' | 'insufficient' | 'ready' }
export interface UiPerformanceReport {
  from: number; to: number; minSamples: number
  metrics: Array<UiPerformanceStats & { metric: UiMetric }>
  trend: Array<{ from: number; to: number; metrics: Array<UiPerformanceStats & { metric: UiMetric }> }>
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k))
const member = (values: readonly string[], v: unknown) => typeof v === 'string' && values.includes(v)
const finite = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
const version = (v: unknown) => typeof v === 'string' && /^(unknown|[0-9]+\.[0-9]+\.[0-9]+|[a-f0-9]{7,40})$/.test(v)
export function validUiPerformanceBatch(v: unknown): v is UiPerformanceBatch {
  const p = UI_PERFORMANCE_POLICY
  return object(v) && exact(v, ['schemaVersion','batchId','samples']) && v.schemaVersion === 1 &&
    typeof v.batchId === 'string' && /^[a-f0-9]{32}$/.test(v.batchId) &&
    Array.isArray(v.samples) && v.samples.length > 0 && v.samples.length <= p.maxBatch &&
    v.samples.every(s => object(s) && exact(s, ['metric','duration','platform','lifecycle','route','version','age']) &&
      member(p.metrics,s.metric) && finite(s.duration,p.maxDurationMs) && finite(s.age,p.maxAgeMs) &&
      member(p.platforms,s.platform) && member(p.lifecycles,s.lifecycle) && member(p.routes,s.route) && version(s.version) &&
      s.route === (s.metric === 'shell_interactive' ? 'shell' : s.metric === 'account_ready' ? 'account' : s.metric === 'board_ready' ? 'board' : 'chat'))
}
export function validUiPerformanceQuery(v: unknown): v is UiPerformanceQuery {
  const p = UI_PERFORMANCE_POLICY
  return object(v) && exact(v, ['from','to','buckets','metric','platform','lifecycle','route','version']) &&
    finite(v.from,Number.MAX_SAFE_INTEGER) && finite(v.to,Number.MAX_SAFE_INTEGER) &&
    (v.to as number) > (v.from as number) && (v.to as number) - (v.from as number) <= p.retentionMs &&
    Number.isInteger(v.buckets) && (v.buckets as number) >= 1 && (v.buckets as number) <= 168 &&
    (v.metric === undefined || member(p.metrics,v.metric)) && (v.platform === undefined || member(p.platforms,v.platform)) &&
    (v.lifecycle === undefined || member(p.lifecycles,v.lifecycle)) && (v.route === undefined || member(p.routes,v.route)) &&
    (v.version === undefined || version(v.version))
}
/** Nearest rank on raw observations, never an average of percentiles. */
export function uiPerformanceStats(values: number[]): UiPerformanceStats {
  const sorted = values.filter(v => finite(v, UI_PERFORMANCE_POLICY.maxDurationMs)).sort((a,b) => a-b)
  const count = sorted.length
  return { count, p50: count ? sorted[Math.ceil(count * .5)-1]! : null,
    p95: count ? sorted[Math.ceil(count * .95)-1]! : null,
    state: count === 0 ? 'empty' : count < UI_PERFORMANCE_POLICY.minSamples ? 'insufficient' : 'ready' }
}

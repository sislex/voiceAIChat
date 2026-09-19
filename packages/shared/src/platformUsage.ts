import { assertPlatformIdentifier, parsePlatformOperationContext, type PlatformOperationContext } from './platformOperation'

/** Disjoint counts: inputTokens excludes cache reads/writes; output includes
 * provider-reported reasoning tokens. Provider adapters own this normalization. */
export interface PlatformTokenCounts {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** One finalized leaf consumption, never a cumulative snapshot or parent rollup.
 * The authoritative producer must persist the event ID across delivery retries. */
export interface PlatformUsageEvent {
  readonly version: 1
  readonly eventId: string
  readonly context: PlatformOperationContext
  readonly executorModuleId: string
  readonly occurredAt: number
  readonly tokens: PlatformTokenCounts
}

export interface PlatformUsageFilter {
  readonly userId: string
  readonly identityIssuer: string
  readonly environmentId: string
  readonly from: number
  readonly to: number
  readonly projectId?: string | null
  readonly billingAccountId?: string
}

export interface PlatformModuleUsage extends PlatformTokenCounts {
  readonly moduleId: string
  readonly events: number
  readonly totalTokens: number
  /** Null means there is no consumption in the selected period. */
  readonly tokenSharePercent: number | null
}

export interface PlatformUsageSummary extends PlatformTokenCounts {
  readonly events: number
  readonly totalTokens: number
  readonly modules: readonly PlatformModuleUsage[]
}

const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const

function count(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid platform usage count: ${field}`)
  }
}

function add(a: number, b: number): number {
  const result = a + b
  if (!Number.isSafeInteger(result)) throw new Error('Platform usage exceeds safe integer range')
  return result
}

function normalizeEvent(event: PlatformUsageEvent): PlatformUsageEvent {
  if (!event || event.version !== 1) throw new Error('Unsupported platform usage event')
  assertPlatformIdentifier(event.eventId, 'eventId')
  assertPlatformIdentifier(event.executorModuleId, 'executorModuleId')
  count(event.occurredAt, 'occurredAt')
  const context = parsePlatformOperationContext(event.context)
  if (!event.tokens || typeof event.tokens !== 'object') throw new Error('Invalid platform token counts')
  for (const key of TOKEN_FIELDS) count(event.tokens[key], key)
  return {
    version: 1, eventId: event.eventId, context, executorModuleId: event.executorModuleId,
    occurredAt: event.occurredAt,
    tokens: {
      inputTokens: event.tokens.inputTokens, outputTokens: event.tokens.outputTokens,
      cacheReadTokens: event.tokens.cacheReadTokens, cacheWriteTokens: event.tokens.cacheWriteTokens,
    },
  }
}

/** Pure reporting over trusted finalized events. It neither authorizes access nor
 * substitutes for the durable ledger's uniqueness constraints and reservations.
 * Periods are half-open [from, to); callers supply boundaries in epoch milliseconds. */
export function summarizePlatformUsage(
  events: readonly PlatformUsageEvent[], filter: PlatformUsageFilter,
): PlatformUsageSummary {
  for (const key of ['userId', 'identityIssuer', 'environmentId'] as const) {
    assertPlatformIdentifier(filter[key], key)
  }
  if (filter.projectId !== undefined && filter.projectId !== null) assertPlatformIdentifier(filter.projectId, 'projectId')
  if (filter.billingAccountId !== undefined) assertPlatformIdentifier(filter.billingAccountId, 'billingAccountId')
  count(filter.from, 'from')
  count(filter.to, 'to')
  if (filter.to <= filter.from) throw new Error('Invalid platform usage period')

  type Totals = { -readonly [K in keyof PlatformTokenCounts]: PlatformTokenCounts[K] } & {
    events: number; totalTokens: number
  }
  const empty = (): Totals => ({
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    events: 0, totalTokens: 0,
  })
  const totals = empty()
  const modules = new Map<string, Totals>()
  const seen = new Map<string, string>()
  for (const input of events) {
    const event = normalizeEvent(input)
    const context = event.context
    if (context.userId !== filter.userId || context.identityIssuer !== filter.identityIssuer
      || context.environmentId !== filter.environmentId) continue

    // Detect conflicting retries before period/project filtering so a changed
    // timestamp or attribution cannot make a reused ID appear to be a new event.
    const fingerprint = JSON.stringify(event)
    const previous = seen.get(event.eventId)
    if (previous !== undefined) {
      if (previous !== fingerprint) throw new Error('Conflicting platform usage event')
      continue
    }
    seen.set(event.eventId, fingerprint)
    if (event.occurredAt < filter.from || event.occurredAt >= filter.to
      || (filter.projectId !== undefined && context.projectId !== filter.projectId)
      || (filter.billingAccountId !== undefined && context.billingAccountId !== filter.billingAccountId)) continue

    const module = modules.get(context.originModuleId) ?? empty()
    for (const key of TOKEN_FIELDS) {
      module[key] = add(module[key], event.tokens[key])
      totals[key] = add(totals[key], event.tokens[key])
      module.totalTokens = add(module.totalTokens, event.tokens[key])
      totals.totalTokens = add(totals.totalTokens, event.tokens[key])
    }
    module.events += 1
    totals.events += 1
    modules.set(context.originModuleId, module)
  }
  return {
    ...totals,
    modules: [...modules].map(([moduleId, module]) => ({
      moduleId, ...module,
      tokenSharePercent: totals.totalTokens === 0 ? null : module.totalTokens / totals.totalTokens * 100,
    })).sort((a, b) => b.totalTokens - a.totalTokens || (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0)),
  }
}

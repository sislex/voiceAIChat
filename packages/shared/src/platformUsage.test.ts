import { describe, expect, it } from 'vitest'
import { createChildPlatformOperationContext, createPlatformOperationContext, type PlatformOperationContext } from './platformOperation'
import { summarizePlatformUsage, type PlatformUsageEvent, type PlatformUsageFilter } from './platformUsage'

const context = (originModuleId = 'make', patch: Partial<PlatformOperationContext> = {}) => ({
  ...createPlatformOperationContext({
    userId: 'usr_123', identityIssuer: 'https://identity.example', actorClientId: 'make-local',
    billingAccountId: 'account_123', environmentId: 'development', originModuleId,
    projectId: 'project_123', operationId: 'op_1',
  }), ...patch,
})
const event = (eventId: string, tokens: number, origin = context()): PlatformUsageEvent => ({
  version: 1, eventId, context: origin, executorModuleId: 'ai-runtime', occurredAt: 100,
  tokens: { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
})
const filter: PlatformUsageFilter = {
  userId: 'usr_123', identityIssuer: 'https://identity.example', environmentId: 'development', from: 100, to: 200,
}

describe('platform module usage reporting', () => {
  it('attributes nested calls to the initiating product and counts a delivery replay once', () => {
    const child = createChildPlatformOperationContext(context(), 'op_2', 'runtime-local')
    const make = event('usage_make', 60, child)
    const result = summarizePlatformUsage([
      make, event('usage_chat', 25, context('chat')), event('usage_reader', 15, context('web-reader')),
      JSON.parse(JSON.stringify(make)),
    ], filter)
    expect(result).toMatchObject({ events: 3, totalTokens: 100, inputTokens: 100 })
    expect(result.modules.map(({ moduleId, totalTokens, tokenSharePercent }) => ({ moduleId, totalTokens, tokenSharePercent })))
      .toEqual([
        { moduleId: 'make', totalTokens: 60, tokenSharePercent: 60 },
        { moduleId: 'chat', totalTokens: 25, tokenSharePercent: 25 },
        { moduleId: 'web-reader', totalTokens: 15, tokenSharePercent: 15 },
      ])
  })

  it('isolates users, identity issuers, and environments even when event IDs match', () => {
    const items = [
      event('same-id', 999, context('make', { userId: 'another-user' })),
      event('same-id', 999, context('make', { identityIssuer: 'https://other.example' })),
      event('same-id', 999, context('make', { environmentId: 'production' })),
      event('same-id', 10),
    ]
    expect(summarizePlatformUsage(items, filter)).toMatchObject({ events: 1, totalTokens: 10 })
  })

  it('uses the same half-open period and project/payer filters for shares and totals', () => {
    const items = [
      { ...event('before', 900), occurredAt: 99 },
      event('start', 10),
      { ...event('end', 900), occurredAt: 200 },
      event('other-project', 900, context('chat', { projectId: 'other' })),
      event('other-payer', 900, context('chat', { billingAccountId: 'other' })),
      event('no-project', 5, context('chat', { projectId: null })),
    ]
    const result = summarizePlatformUsage(items, { ...filter, projectId: 'project_123', billingAccountId: 'account_123' })
    expect(result).toMatchObject({ events: 1, totalTokens: 10 })
    expect(result.modules[0].tokenSharePercent).toBe(100)
    expect(summarizePlatformUsage(items, { ...filter, projectId: null }).totalTokens).toBe(5)
  })

  it('sums disjoint input, output, and cache measurements without losing the breakdown', () => {
    const item = {
      ...event('usage', 0),
      tokens: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 },
    }
    expect(summarizePlatformUsage([item], filter)).toMatchObject({
      events: 1, totalTokens: 100, ...item.tokens,
      modules: [{ moduleId: 'make', totalTokens: 100, ...item.tokens }],
    })
  })

  it('recognizes a replay regardless of property insertion order', () => {
    const original = event('usage', 10)
    const reordered = JSON.parse(JSON.stringify(original), (_key, value) => {
      return value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse()) : value
    })
    expect(summarizePlatformUsage([original, reordered], filter).events).toBe(1)
  })

  it.each(['tokens', 'period', 'module', 'payer', 'executor'] as const)('rejects a conflicting replay that changes %s', (field) => {
    const original = event('same-id', 10)
    const changed = {
      tokens: { ...original, tokens: { ...original.tokens, inputTokens: 20 } },
      period: { ...original, occurredAt: 250 },
      module: { ...original, context: context('chat') },
      payer: { ...original, context: context('make', { billingAccountId: 'other' }) },
      executor: { ...original, executorModuleId: 'other' },
    }[field]
    expect(() => summarizePlatformUsage([original, changed], filter)).toThrow(/Conflicting/)
  })

  it('has no misleading percentage when there is no consumption', () => {
    expect(summarizePlatformUsage([], filter)).toMatchObject({ totalTokens: 0, modules: [] })
    expect(summarizePlatformUsage([event('zero', 0)], filter).modules[0].tokenSharePercent).toBeNull()
  })

  it('orders ties deterministically and keeps unknown legacy attribution in the denominator', () => {
    const items = [event('b', 5, context('unknown')), event('a', 5, context('chat'))]
    const a = summarizePlatformUsage(items, filter)
    const b = summarizePlatformUsage([...items].reverse(), filter)
    expect(a).toEqual(b)
    expect(a.modules.map((module) => [module.moduleId, module.tokenSharePercent])).toEqual([['chat', 50], ['unknown', 50]])
  })

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects malformed measurement %s', (value) => {
    expect(() => summarizePlatformUsage([event('invalid', value)], filter)).toThrow(/count/)
  })

  it('rejects overflow instead of silently rounding large balances', () => {
    expect(() => summarizePlatformUsage([
      event('large', Number.MAX_SAFE_INTEGER), event('overflow', 1),
    ], filter)).toThrow(/safe integer/)
  })

  it.each([{ from: 200, to: 200 }, { from: 201 }, { to: NaN }, { from: -1 }, { userId: '' }])(
    'rejects invalid report filters: %j', (patch) => {
      expect(() => summarizePlatformUsage([], { ...filter, ...patch })).toThrow()
    },
  )

  it('does not mutate the input events or contexts', () => {
    const input = event('usage', 10)
    const before = JSON.stringify(input)
    summarizePlatformUsage([input], filter)
    expect(JSON.stringify(input)).toBe(before)
  })
})

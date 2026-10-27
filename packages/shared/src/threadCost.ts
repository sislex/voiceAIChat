import type { Conversation, ConversationSummary, LlmProvider } from './types'

export type ThreadResetMode = 'off' | 'hint' | 'auto'
export const THREAD_COST_THRESHOLDS = { considerTokens: 300_000, resetTokens: 1_000_000 } as const
export interface ThreadTurnCost {
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  durationMs: number
}
export interface ConversationThreadCost {
  provider: LlmProvider
  sessionActive: boolean
  turnsInThread: number
  last: ThreadTurnCost | null
  /** Input includes cache reads; averages the first up to three measured turns. */
  baseline: { inputTokens: number; durationMs: number; source: 'thread-start' | 'estimate' } | null
  extra: { tokensPerTurn: number; percentTokens: number; msPerTurn: number; percentTime: number } | null
  recommendation: 'ok' | 'consider' | 'reset'
  thresholds: { considerTokens: number; resetTokens: number }
}
export interface ConversationThreadResetResult { ok: true; summary: ConversationSummary }
export const THREAD_COST_REST = {
  cost: (id: string) => `/api/conversations/${encodeURIComponent(id)}/thread-cost`,
  reset: (id: string) => `/api/conversations/${encodeURIComponent(id)}/thread-reset`
}
export interface ConversationThreadResetRequest { summarize?: boolean }
export interface ConversationThreadResetResponse { ok: true; summary: Conversation['summary'] | null }

/** Rows are chronological and scoped to the active provider session. */
export function calculateThreadCost(
  provider: LlmProvider, sessionActive: boolean, turns: readonly ThreadTurnCost[],
  estimate: { inputTokens: number; durationMs: number },
  thresholds: ConversationThreadCost['thresholds'] = THREAD_COST_THRESHOLDS
): ConversationThreadCost {
  const clean = (n: number) => Number.isFinite(n) ? Math.max(0, n) : 0
  const rows = sessionActive ? turns.map(row => ({
    inputTokens: clean(row.inputTokens), cacheReadTokens: clean(row.cacheReadTokens),
    outputTokens: clean(row.outputTokens), durationMs: clean(row.durationMs)
  })) : []
  const last = rows.at(-1) ?? null
  const first = rows.slice(0, 3)
  const baseline: ConversationThreadCost['baseline'] = !sessionActive ? null : first.length ? {
    inputTokens: first.reduce((sum, row) => sum + row.inputTokens + row.cacheReadTokens, 0) / first.length,
    durationMs: first.reduce((sum, row) => sum + row.durationMs, 0) / first.length,
    source: 'thread-start'
  } : { inputTokens: clean(estimate.inputTokens), durationMs: clean(estimate.durationMs), source: 'estimate' }
  const tokens = last ? last.inputTokens + last.cacheReadTokens : 0
  const delta = last && baseline ? {
    tokensPerTurn: tokens - baseline.inputTokens, msPerTurn: last.durationMs - baseline.durationMs
  } : null
  return {
    provider, sessionActive, turnsInThread: rows.length, last, baseline,
    extra: delta && baseline ? { ...delta,
      percentTokens: baseline.inputTokens ? delta.tokensPerTurn / baseline.inputTokens * 100 : 0,
      percentTime: baseline.durationMs ? delta.msPerTurn / baseline.durationMs * 100 : 0
    } : null,
    recommendation: !last ? 'ok' : tokens >= thresholds.resetTokens ? 'reset' : tokens >= thresholds.considerTokens ? 'consider' : 'ok',
    thresholds: { ...thresholds }
  }
}

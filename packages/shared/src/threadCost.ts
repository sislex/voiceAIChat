import type { LlmProvider, ConversationSummary } from './types'

export type ThreadResetMode = 'off' | 'hint' | 'auto'
export interface ConversationThreadCost {
  provider: LlmProvider
  sessionActive: boolean
  turnsInThread: number
  last: { inputTokens: number; cacheReadTokens: number; outputTokens: number; durationMs: number } | null
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

// Per-turn usage of a Codex thread.
//
// `codex exec --json` reports `usage` in `turn.completed` from
// `ThreadTokenUsage.total`, i.e. the cumulative counters of the WHOLE thread —
// including every earlier turn that was replayed via `codex exec resume`. The
// numbers therefore only grow from message to message, and pricing them as the
// spend of a single turn inflates the cost quadratically. This module keeps the
// raw thread totals next to the message (`TurnMeta.codexThreadUsage`) and derives
// the turn's own spend as the difference from the previous turn of the same
// thread. Pure functions — the server and the data migration share them.

import type { TurnUsage } from './types'

/** Cumulative thread counters exactly as Codex reported them in `turn.completed`. */
export interface CodexThreadUsage {
  /** Thread id (`thread.started` / resumed session id); absent for legacy rows. */
  sessionId?: string
  /** Input tokens INCLUDING the cached part — Codex semantics. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** Thread totals from any usage-shaped object (raw `TurnUsage` of legacy messages included). */
export function codexThreadUsageOf(usage: TurnUsage, sessionId?: string): CodexThreadUsage {
  return {
    ...(sessionId ? { sessionId } : {}),
    inputTokens: num(usage.inputTokens),
    outputTokens: num(usage.outputTokens),
    cacheReadTokens: num(usage.cacheReadTokens),
    cacheCreationTokens: num(usage.cacheCreationTokens)
  }
}

/**
 * Whether `current` continues the thread whose last totals are `previous`.
 * A different thread id is a fresh thread. Without ids (legacy rows) the
 * only evidence is monotonicity: totals never shrink inside one thread, so a
 * drop in any counter means Codex started counting from zero again.
 */
export function continuesCodexThread(current: CodexThreadUsage, previous: CodexThreadUsage | null | undefined): boolean {
  if (!previous) return false
  if (current.sessionId && previous.sessionId && current.sessionId !== previous.sessionId) return false
  return (
    current.inputTokens >= previous.inputTokens &&
    current.outputTokens >= previous.outputTokens &&
    current.cacheReadTokens >= previous.cacheReadTokens &&
    current.cacheCreationTokens >= previous.cacheCreationTokens
  )
}

/**
 * Spend of one turn in the unified `TurnUsage` semantics: `inputTokens` is the
 * input WITHOUT the cached part (the same convention Claude reports and
 * `estimateCostUsd` expects), cache counters are separate. `previous` — totals
 * of the last turn of the same thread, or null for the first turn.
 */
export function codexTurnUsage(current: CodexThreadUsage, previous: CodexThreadUsage | null | undefined): TurnUsage {
  const base = continuesCodexThread(current, previous) ? previous! : null
  const inputIncludingCache = current.inputTokens - (base?.inputTokens ?? 0)
  const cacheReadTokens = current.cacheReadTokens - (base?.cacheReadTokens ?? 0)
  return {
    inputTokens: Math.max(0, inputIncludingCache - cacheReadTokens),
    outputTokens: current.outputTokens - (base?.outputTokens ?? 0),
    cacheReadTokens,
    cacheCreationTokens: current.cacheCreationTokens - (base?.cacheCreationTokens ?? 0)
  }
}

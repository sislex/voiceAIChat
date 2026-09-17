import { describe, it, expect } from 'vitest'
import { codexThreadUsageOf, codexTurnUsage, continuesCodexThread } from './codexUsage'

// Numbers below are the real thread totals of a production chat where every
// reply looked more expensive than the previous one: turn.completed reports the
// whole thread, not the turn.
const turn1 = { sessionId: 't1', inputTokens: 172_400, outputTokens: 1_100, cacheReadTokens: 142_700, cacheCreationTokens: 0 }
const turn2 = { sessionId: 't1', inputTokens: 294_200, outputTokens: 2_100, cacheReadTokens: 251_300, cacheCreationTokens: 0 }

describe('codexTurnUsage', () => {
  it('first turn of a thread: input without the cached part, cache separate', () => {
    expect(codexTurnUsage(turn1, null)).toEqual({
      inputTokens: 29_700,
      outputTokens: 1_100,
      cacheReadTokens: 142_700,
      cacheCreationTokens: 0
    })
  })

  it('next turn of the same thread is the difference of the totals', () => {
    expect(codexTurnUsage(turn2, turn1)).toEqual({
      inputTokens: 121_800 - 108_600,
      outputTokens: 1_000,
      cacheReadTokens: 108_600,
      cacheCreationTokens: 0
    })
  })

  it('a different thread id starts counting from its own totals', () => {
    const fresh = { ...turn2, sessionId: 't2' }
    expect(codexTurnUsage(fresh, turn1)).toEqual(codexTurnUsage(fresh, null))
    expect(continuesCodexThread(fresh, turn1)).toBe(false)
  })

  it('without ids a shrinking counter means a fresh thread', () => {
    const legacyPrev = { inputTokens: 500, outputTokens: 50, cacheReadTokens: 400, cacheCreationTokens: 0 }
    const smaller = { inputTokens: 300, outputTokens: 60, cacheReadTokens: 200, cacheCreationTokens: 0 }
    expect(continuesCodexThread(smaller, legacyPrev)).toBe(false)
    expect(codexTurnUsage(smaller, legacyPrev)).toEqual({ inputTokens: 100, outputTokens: 60, cacheReadTokens: 200, cacheCreationTokens: 0 })
    const larger = { inputTokens: 700, outputTokens: 70, cacheReadTokens: 550, cacheCreationTokens: 0 }
    expect(codexTurnUsage(larger, legacyPrev)).toEqual({ inputTokens: 50, outputTokens: 20, cacheReadTokens: 150, cacheCreationTokens: 0 })
  })

  it('codexThreadUsageOf tolerates missing counters and keeps the thread id', () => {
    expect(codexThreadUsageOf({ inputTokens: 10 }, 'abc')).toEqual({ sessionId: 'abc', inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })
    expect(codexThreadUsageOf({})).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })
  })
})

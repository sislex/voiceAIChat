import { describe, expect, it } from 'vitest'
import { calculateThreadCost, THREAD_COST_THRESHOLDS, type ThreadTurnCost } from './threadCost'
import { applyChatSettingsPatch, createChatSettingsSnapshot } from './chatContract'

const turn = (tokens: number, durationMs = 100): ThreadTurnCost => ({
  inputTokens: tokens / 10, cacheReadTokens: tokens * 0.9, outputTokens: 20, durationMs
})
const estimate = { inputTokens: 1000, durationMs: 0 }

describe('thread cost', () => {
  it('averages only the first three turns, including cache reads, and computes signed deltas', () => {
    const result = calculateThreadCost('codex', true, [turn(100, 100), turn(200, 200), turn(300, 300), turn(1000, 500)], estimate)
    expect(result.baseline).toEqual({ inputTokens: 200, durationMs: 200, source: 'thread-start' })
    expect(result.extra).toEqual({ tokensPerTurn: 800, percentTokens: 400, msPerTurn: 300, percentTime: 150 })
    expect(calculateThreadCost('claude', true, [turn(200), turn(100)], estimate).extra?.tokensPerTurn).toBe(-50)
  })
  it.each([[299999, 'ok'], [300000, 'consider'], [999999, 'consider'], [1000000, 'reset']] as const)(
    'recommends %s => %s using absolute input per turn', (tokens, recommendation) => {
      expect(calculateThreadCost('codex', true, [turn(tokens)], estimate).recommendation).toBe(recommendation)
    })
  it('handles missing usage, inactive sessions, zero denominators and configured thresholds', () => {
    expect(calculateThreadCost('claude', true, [], estimate)).toMatchObject({
      baseline: { ...estimate, source: 'estimate' }, last: null, extra: null, recommendation: 'ok'
    })
    expect(calculateThreadCost('codex', false, [turn(2e6)], estimate)).toMatchObject({
      turnsInThread: 0, baseline: null, last: null, extra: null, recommendation: 'ok', thresholds: THREAD_COST_THRESHOLDS
    })
    expect(calculateThreadCost('claude', true, [turn(0, 0)], estimate).extra).toEqual({
      tokensPerTurn: 0, msPerTurn: 0, percentTokens: 0, percentTime: 0
    })
    expect(calculateThreadCost('claude', true, [turn(10)], estimate, { considerTokens: 5, resetTokens: 10 }).recommendation).toBe('reset')
  })
  it('defaults settings to hint and validates all modes', () => {
    const current = createChatSettingsSnapshot({ version: 1, revision: 0, account: {}, conversation: {}, device: {} })
    expect(current.conversation.threadReset).toBe('hint')
    for (const mode of ['off', 'hint', 'auto'] as const) {
      expect(applyChatSettingsPatch(current, { version: 1, expectedRevision: 0, owner: 'conversation', values: { threadReset: mode } }))
        .toMatchObject({ conversation: { threadReset: mode } })
    }
    expect(() => applyChatSettingsPatch(current, { version: 1, expectedRevision: 0, owner: 'conversation', values: { threadReset: true } } as never)).toThrow('threadReset')
  })
})

import { expect, it } from 'vitest'
import type { LlmExecutionReceipt } from '@voicechat/shared'
import { decimalUsdToMicroUsd, estimatePrices, receiptSettlement } from './usage.js'

const receipt = (): LlmExecutionReceipt => ({ version: 1, runId: 'op', kind: 'codex', state: 'finished',
  context: { operationId: 'op', reservationId: 'reservation', userId: 'subject', tenantId: 'tenant', environmentId: 'test', originModuleId: 'chat' },
  createdAt: 1, updatedAt: 2, model: 'gpt-5.6-sol', finalUsage: true,
  usage: { inputTokens: 300, outputTokens: 30, cacheReadTokens: 180, cacheCreationTokens: 0 },
  baseline: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 80, cacheCreationTokens: 0 } })

it('normalizes resumed Codex tokens as disjoint per-turn deltas using the admission quote', () => {
  const result = receiptSettlement(receipt(), 'gpt-5.6-sol', estimatePrices('gpt-5.6-sol'))!
  expect(result.usage.tokens).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 0 })
  expect(result).toMatchObject({ actualMicroUsd: 840, usage: { costSource: 'estimate' } })
  for (const change of [{ baseline: undefined }, { finalUsage: false }, { state: 'uncertain' as const },
    { model: 'different-model' }, { baseline: { ...receipt().baseline, inputTokens: 400 } }]) {
    expect(receiptSettlement({ ...receipt(), ...change }, 'gpt-5.6-sol', estimatePrices('gpt-5.6-sol'))).toBeUndefined()
  }
  expect(estimatePrices('unknown-model')).toBeUndefined()
  expect(receiptSettlement(receipt(), 'gpt-5.6-sol')).toBeUndefined()
})

it('uses provider cost separately and rounds decimal USD once with integer arithmetic', () => {
  expect(decimalUsdToMicroUsd('0.0000001')).toBe(1)
  expect(decimalUsdToMicroUsd('0.000001')).toBe(1)
  expect(decimalUsdToMicroUsd('1.0000000001')).toBe(1_000_001)
  expect(decimalUsdToMicroUsd('7e-7')).toBe(1)
  for (const value of ['-1', 'NaN', 'Infinity', '1e999', '1000001']) expect(() => decimalUsdToMicroUsd(value)).toThrow()
  const result = receiptSettlement({ ...receipt(), kind: 'claude', model: 'claude-actual', providerCostUsd: '0.000007' }, 'sonnet')!
  expect(result).toMatchObject({ actualMicroUsd: 7, usage: { model: 'claude-actual', costSource: 'provider', tokens: { inputTokens: 300 } } })
})

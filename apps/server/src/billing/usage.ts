import { estimateCostUsd, type LlmExecutionReceipt, type TurnUsage } from '@voicechat/shared'
import { priceUsageMicroUsd, parseBillingUsageEvidence, type BillingTokenPrices, type BillingUsageEvidence } from '@voicechat/platform-sdk'

/** Convert a decimal amount once with integer arithmetic; preserve provider precision. */
export function decimalUsdToMicroUsd(value: string): number {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value)
  if (!match) throw Error('invalid_decimal_cost')
  const fraction = match[2] ?? '', exponent = Number(match[3] ?? 0) + 6 - fraction.length
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw Error('invalid_decimal_cost')
  let amount = BigInt(match[1]+fraction)
  if (exponent >= 0) amount *= 10n ** BigInt(exponent)
  else { const divisor = 10n ** BigInt(-exponent); amount = (amount + divisor - 1n) / divisor }
  if (amount > 1_000_000_000_000n) throw Error('cost_out_of_range')
  return Number(amount)
}

/** Capture the existing product estimate catalog, without introducing a new price authority. */
export function estimatePrices(model: string): BillingTokenPrices | undefined {
  const keys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'] as const
  const rates = keys.map(key => estimateCostUsd(model, { [key]: 1_000_000 }))
  if (rates.some(rate => rate === undefined)) return undefined
  return { inputTokens: decimalUsdToMicroUsd(String(rates[0])), outputTokens: decimalUsdToMicroUsd(String(rates[1])),
    cacheReadTokens: decimalUsdToMicroUsd(String(rates[2])), cacheWriteTokens: decimalUsdToMicroUsd(String(rates[3])) }
}

function counters(usage: TurnUsage | undefined): number[] | undefined {
  if (!usage) return undefined
  const values = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheCreationTokens]
  return values.every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ? values as number[] : undefined
}

export function receiptSettlement(receipt: LlmExecutionReceipt, model: string, prices?: BillingTokenPrices): { actualMicroUsd: number; usage: BillingUsageEvidence } | undefined {
  if (receipt.state !== 'finished' || !receipt.finalUsage) return undefined
  const raw = counters(receipt.usage)
  if (!raw) return undefined
  let [inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens] = raw
  if (receipt.kind === 'codex') {
    const baseline = counters(receipt.baseline)
    if (!baseline || raw.some((value, index) => value < baseline[index])) return undefined
    ;[inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens] = raw.map((value, index) => value - baseline[index])
    inputTokens -= cacheReadTokens
    if (inputTokens < 0) return undefined
  }
  const tokens = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
  const actualModel = receipt.model || model
  if (!actualModel) return undefined
  if (receipt.providerCostUsd !== undefined && receipt.kind === 'claude') {
    return { actualMicroUsd: decimalUsdToMicroUsd(receipt.providerCostUsd),
      usage: parseBillingUsageEvidence({ model: actualModel, tokens, costSource: 'provider' }) }
  }
  // A changed/unknown model cannot use a different model's admission-time quote.
  if (!prices || actualModel !== model) return undefined
  const usage = parseBillingUsageEvidence({ model, tokens, costSource: 'estimate', prices })
  return { actualMicroUsd: priceUsageMicroUsd(tokens, prices), usage }
}

// Оценка стоимости хода/сессии по счётчикам токенов. Файлы сессий CLI (Claude
// Code / Codex) НЕ содержат реальной стоимости — её сообщает только live-ход
// (total_cost_usd). Поэтому здесь — оценка по прайс-таблице, а в UI она всегда
// помечается «≈». Настоящую цену от CLI оценка не подменяет: где та есть, берут
// её. Чистая функция — тестируется на числах, и не на выдуманных: тест сверяет
// расчёт с фактической ценой, которую CLI назвал на реальных ходах CI-ранов.

import type { TurnUsage } from './types'

/** Цена модели, USD за 1 млн токенов, по видам токенов. */
interface ModelPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/**
 * Claude сохраняет проверенное сопоставление по алиасам: его CLI сообщает
 * фактическую стоимость. OpenAI/Codex ниже устроен иначе: только точные реальные
 * modelId из официального справочника, чтобы неизвестная строка оставалась
 * unpriced. Базовая категория без метаданных — Standard / short context.
 */
const CLAUDE_PRICES: { match: RegExp; price: ModelPrice }[] = [
  { match: /fable/i, price: { input: 10, output: 50, cacheRead: 1, cacheWrite: 20 } },
  { match: /opus/i, price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 } },
  { match: /sonnet/i, price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { match: /haiku/i, price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } }
]

/** Официальные OpenAI цены Standard; ключ — точный реальный modelId. */
const OPENAI_PRICES: Record<string, { short: ModelPrice; long: ModelPrice }> = {
  'gpt-6-astra': {
    short: { input: 10, cacheRead: 1, cacheWrite: 12.5, output: 50 },
    long: { input: 20, cacheRead: 2, cacheWrite: 25, output: 75 }
  },
  'gpt-5.6-sol': {
    short: { input: 4, cacheRead: 0.4, cacheWrite: 5, output: 20 },
    long: { input: 8, cacheRead: 0.8, cacheWrite: 10, output: 30 }
  },
  'gpt-5.6-terra': {
    short: { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 12 },
    long: { input: 4, cacheRead: 0.4, cacheWrite: 5, output: 18 }
  },
  'gpt-5.6-luna': {
    short: { input: 0.2, cacheRead: 0.02, cacheWrite: 0.25, output: 1.2 },
    long: { input: 0.4, cacheRead: 0.04, cacheWrite: 0.5, output: 1.8 }
  },
  'gpt-5.5': { short: { input: 5, cacheRead: 0.5, cacheWrite: 0, output: 30 }, long: { input: 5, cacheRead: 0.5, cacheWrite: 0, output: 30 } },
  'gpt-5.4': { short: { input: 2.5, cacheRead: 0.25, cacheWrite: 0, output: 15 }, long: { input: 2.5, cacheRead: 0.25, cacheWrite: 0, output: 15 } },
  'gpt-5.4-mini': { short: { input: 0.75, cacheRead: 0.075, cacheWrite: 0, output: 4.5 }, long: { input: 0.75, cacheRead: 0.075, cacheWrite: 0, output: 4.5 } },
  'gpt-5.3-codex-spark': { short: { input: 1.75, cacheRead: 0.175, cacheWrite: 0, output: 14 }, long: { input: 1.75, cacheRead: 0.175, cacheWrite: 0, output: 14 } }
}

/**
 * Модель хода осталась неизвестной: CLI её не назвал, и в настройке рана её тоже
 * нет (у codex пустая модель — штатное состояние, он берёт её из своего
 * `config.toml`). Пишется в расход вместо пустой строки, чтобы «неизвестно» было
 * видно, а прайса для неё нет намеренно: итог помечается заниженным, а не
 * досчитывается вымышленной ценой.
 */
export const UNKNOWN_MODEL = 'unknown'

/**
 * Оценка стоимости в USD по токенам. `undefined`, если модель неизвестна или
 * прайс не найден — тогда UI показывает «—» вместо суммы.
 */
export function estimateCostUsd(model: string | undefined, usage: TurnUsage): number | undefined {
  if (!model || model === UNKNOWN_MODEL) return undefined
  const openAi = OPENAI_PRICES[model]
  // Специальный тариф допустим только при явных метаданных. Пока справочник
  // публикует здесь Standard; неизвестный режим не подменяем Standard.
  if (openAi && usage.pricingMode && usage.pricingMode !== 'standard') return undefined
  const p = openAi?.[usage.contextTier ?? 'short'] ?? CLAUDE_PRICES.find((entry) => entry.match.test(model))?.price
  if (!p) return undefined
  const cacheRead = usage.cacheReadTokens ?? 0
  // Здесь inputTokens уже обычный input: источники с inclusive-семантикой
  // нормализуют его до вызова (ciUsageInputTokens / серверный usage report).
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const cacheWrite = usage.cacheCreationTokens ?? 0
  return (
    (input * p.input + output * p.output + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) /
    1_000_000
  )
}

/** Суммарные токены сводки (вход + выход + кэш) — для компактного «N токенов». */
export function totalTokens(usage: TurnUsage): number {
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0)
  )
}

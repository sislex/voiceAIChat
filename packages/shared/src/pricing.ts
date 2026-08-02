// Оценка стоимости хода/сессии по счётчикам токенов. Файлы сессий CLI (Claude
// Code / Codex) НЕ содержат реальной стоимости — её сообщает только live-ход
// (total_cost_usd). Поэтому здесь — приблизительная оценка по публичным ценам,
// а в UI она всегда помечается «≈». Чистая функция — тестируется на числах.

import type { TurnUsage } from './types'

/** Цена модели, USD за 1 млн токенов, по видам токенов. */
interface ModelPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/**
 * Прайс по подстроке в id/алиасе модели (первое совпадение). Значения — публичные
 * ориентиры (USD / 1M токенов); при изменении цен правится только эта таблица.
 */
const PRICES: { match: RegExp; price: ModelPrice }[] = [
  { match: /opus/i, price: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  { match: /sonnet/i, price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { match: /haiku/i, price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
  // Codex/GPT — ориентиры семейства GPT-5; отдельного прайса на sol-варианты нет.
  { match: /gpt|codex|o[0-9]/i, price: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 } }
]

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
  const row = PRICES.find((p) => p.match.test(model))
  if (!row) return undefined
  const p = row.price
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const cacheRead = usage.cacheReadTokens ?? 0
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

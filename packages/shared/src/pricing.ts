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
 *
 * Prices follow https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-17).
 * The first matching row wins, so a version row stands before its family row. A bare alias
 * (`fable`, `sonnet`, `haiku`, `opus`) is priced as the model the runner CLI resolves it to
 * (Claude Code 2.1.326: Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5) — move the alias to the new
 * version row together with the CLI pin of the runner.
 * `cacheWrite` is the 1-hour rate: Claude Code writes its prompt cache with the 1-hour TTL.
 */
const CLAUDE_PRICES: { match: RegExp; price: ModelPrice; long?: ModelPrice }[] = [
  // The bare `default` alias resolves to Fable 5.2 in the current runner CLI.
  { match: /(fable|mythos)-5-2|^fable$|^default$/i, price: { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 16 } },
  { match: /(fable|mythos)-5-1/i, price: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 20 } },
  { match: /fable|mythos/i, price: { input: 10, output: 50, cacheRead: 1, cacheWrite: 20 } },
  { match: /opus-5-5|^opus(\[1m\])?$/i, price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 } },
  { match: /opus-4(-1)?(-\d{8})?$/i, price: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 30 } },
  { match: /opus/i, price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 } },
  { match: /sonnet-5-5|^sonnet(\[1m\])?$/i, price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 4 } },
  { match: /sonnet-5/i, price: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 4 } },
  { match: /sonnet/i, price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6 } },
  // Haiku 5.5 is the only Claude model with a length premium: prompts over 100K tokens.
  {
    match: /haiku-5-5|^haiku$/i,
    price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.2 },
    long: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 1 }
  },
  { match: /haiku/i, price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2 } }
]

/** Официальные OpenAI цены Standard; ключ — точный реальный modelId. */
const OPENAI_PRICES: Record<string, { short: ModelPrice; long: ModelPrice }> = {
  'gpt-6.1-sol': {
    short: { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
    long: { input: 4, cacheRead: 0.2, cacheWrite: 5.0, output: 15.0 }
  },
  'gpt-6-sol': {
    short: { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
    long: { input: 4, cacheRead: 0.4, cacheWrite: 5.0, output: 15.0 }
  },
  'gpt-6-luna': {
    short: { input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5 },
    long: { input: 0.2, cacheRead: 0.02, cacheWrite: 0.25, output: 0.75 }
  },
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
  'gpt-5.5': { short: { input: 5, cacheRead: 0.5, cacheWrite: 0, output: 30 }, long: { input: 10, cacheRead: 1, cacheWrite: 0, output: 45 } },
  'gpt-5.4': { short: { input: 2.5, cacheRead: 0.25, cacheWrite: 0, output: 15 }, long: { input: 5, cacheRead: 0.5, cacheWrite: 0, output: 22.5 } },
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
  const claude = openAi ? undefined : CLAUDE_PRICES.find((entry) => entry.match.test(model))
  const p = openAi?.[usage.contextTier ?? 'short'] ?? (usage.contextTier === 'long' ? claude?.long ?? claude?.price : claude?.price)
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

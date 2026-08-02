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
 * Прайс по подстроке в id/алиасе модели (первое совпадение), USD / 1M токенов;
 * при изменении цен правится только эта таблица.
 *
 * ПРОВЕРЕНО — цифры подобраны под фактическую цену, которую сообщил CLI
 * (`total_cost_usd`), по строкам `ci_run_usage` с непустой `cost_usd`. Сходимость
 * на 02.08.2026: opus — 26 ходов, сумма $88.71 против оценки $88.55 (0.2%),
 * худший отдельный ход 2.1% (это ход на $0.69, в абсолюте цент); fable — 3 хода,
 * $7.02 против $7.01, худший ход 0.6%. Одной таблицы для всех видов токенов
 * достаточно: подгонка по методу наименьших квадратов на тех же ходах даёт
 * выход 25.09, чтение кэша 0.4987, запись кэша 10.01 — то есть ровно строку ниже.
 *
 * Вход отдельным фактом не подтверждается: его в ходе CI-рана сотни токенов
 * против миллионов кэша, на цену он не влияет и из данных не восстанавливается.
 * Взят по тем же пропорциям, что подтвердились: чтение кэша = 1/10 входа,
 * запись = 2× вход.
 *
 * НЕПРОВЕРЕНО — sonnet, haiku и семейство GPT: ходов с настоящей ценой от CLI по
 * ним в `ci_run_usage` нет (codex своей цены не сообщает вовсе), подобрать не на
 * чем. Оставлены публичные ориентиры как были. Важно: у них запись кэша взята по
 * ПЯТИМИНУТНОМУ TTL (1.25× вход), тогда как у проверенных моделей фактом оказался
 * ЧАСОВОЙ (2× вход) — так что эти строки, скорее всего, занижают запись кэша
 * почти вдвое. Появятся ходы с ценой — пересчитать тем же способом.
 */
const PRICES: { match: RegExp; price: ModelPrice }[] = [
  // Fable 5 — проверено; ровно вдвое дороже opus по всем видам токенов.
  { match: /fable/i, price: { input: 10, output: 50, cacheRead: 1, cacheWrite: 20 } },
  // Opus 5 — проверено. Запись кэша 10 = 2× вход, тариф ЧАСОВОГО TTL: развести
  // TTL по счётчикам нельзя (CLI отдаёт один `cache_creation_input_tokens`, без
  // разбивки `ephemeral_5m`/`ephemeral_1h`), а пятиминутный тариф (6.25) с фактом
  // не сходится — на ходах, где запись кэша заметна, он занижает цену в полтора
  // раза. Так что берётся часовой: он подтверждён фактом.
  { match: /opus/i, price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 } },
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

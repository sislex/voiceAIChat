// Мелкие форматтеры и семантика статусов CI, общие для карточки, ленты и консоли.
import { CI_USAGE_KIND_LABELS, type CiClarifyLevel, type CiExecutionLlmSnapshot, type CiRunMode, type CiStatus, type CiUsageKind } from '@shared/ci'

/** Подписи режима запуска и глубины уточнений (карточка, проект, шапка чата). */
export const RUN_MODE_LABEL: Record<CiRunMode, string> = {
  plan: 'План',
  development: 'Разработка'
}

export const CLARIFY_LEVEL_LABEL: Record<CiClarifyLevel, string> = {
  none: 'Без вопросов',
  few: 'Можно 1–3 вопроса',
  medium: 'Можно 1–6 вопросов',
  detailed: 'Детальное уточнение'
}

/** Семантическая группа для окраски лозенга (через токены статусов). */
export type CiTone = 'neutral' | 'progress' | 'success' | 'removed'

export function ciTone(status: CiStatus): CiTone {
  switch (status) {
    case 'queued':
      return 'neutral'
    case 'running':
    case 'awaiting_input':
      return 'progress'
    case 'success':
      return 'success'
    case 'failed':
    case 'interrupted':
    case 'timeout':
    case 'cancelled':
      return 'removed'
    case 'skipped':
      return 'neutral'
    default:
      return 'neutral'
  }
}

const STATUS_LABEL: Record<CiStatus, string> = {
  queued: 'в очереди',
  running: 'выполняется',
  awaiting_input: 'ждёт ответа',
  success: 'успех',
  failed: 'ошибка',
  interrupted: 'прерван перезапуском',
  cancelled: 'отменён',
  timeout: 'таймаут',
  skipped: 'пропущен'
}

export function ciStatusLabel(status: CiStatus): string {
  return STATUS_LABEL[status] ?? status
}

export function ciStageLabel(stage: CiUsageKind | null): string {
  return stage ? CI_USAGE_KIND_LABELS[stage] : 'До запуска этапа'
}

export function ciLlmLabel(snapshot: Pick<CiExecutionLlmSnapshot, 'provider' | 'model'> | null | undefined): string {
  if (!snapshot?.model) return 'Модель не указана'
  const provider = snapshot.provider === 'codex' ? 'Codex' : snapshot.provider === 'claude' ? 'Claude' : null
  return provider ? `${provider} · ${snapshot.model}` : snapshot.model
}

/** Иконка шага/рана (не эмодзи-зависимая семантика — простые глифы). */
export function ciStatusIcon(status: CiStatus): string {
  switch (status) {
    case 'success':
      return '✓'
    case 'failed':
    case 'interrupted':
    case 'timeout':
      return '✕'
    case 'cancelled':
      return '⊘'
    case 'running':
      return '▸'
    case 'awaiting_input':
      return '?'
    case 'skipped':
      return '–'
    default:
      return '○'
  }
}

/** Длительность в человекочитаемый вид (мс → «1м 03с» / «450мс»). */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}мс`
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return m > 0 ? `${m}м ${String(sec).padStart(2, '0')}с` : `${sec}с`
}

/**
 * Деньги отчёта. `estimated` — стоимости от CLI не было и она посчитана по
 * прайсу: такую всегда показываем с «≈», иначе оценка читается как факт.
 * Копеечные суммы не округляем в ноль — «< $0.01» честнее, чем «$0.00».
 */
export function fmtUsd(value: number | null | undefined, estimated = false): string {
  if (value == null) return '—'
  const prefix = estimated ? '≈ ' : ''
  if (value > 0 && value < 0.01) return `${prefix}< $0.01`
  return `${prefix}$${value.toFixed(2)}`
}

/** Токены и прочие счётчики отчёта: разряды через пробел («13 000»). */
export function fmtTokens(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString('ru')
}

/**
 * Объём текста в символах. Крупные числа сокращаем («24k», «1.4M»): точная
 * длина ответа инструмента не решение, а порядок величины — решение.
 */
export function fmtChars(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  return value.toLocaleString('ru')
}

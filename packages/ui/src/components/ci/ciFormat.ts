// Мелкие форматтеры и семантика статусов CI, общие для карточки, ленты и консоли.
import type { CiStatus } from '@shared/ci'

/** Семантическая группа для окраски лозенга (через токены статусов). */
export type CiTone = 'neutral' | 'progress' | 'success' | 'removed'

export function ciTone(status: CiStatus): CiTone {
  switch (status) {
    case 'queued':
      return 'neutral'
    case 'running':
      return 'progress'
    case 'success':
      return 'success'
    case 'failed':
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
  success: 'успех',
  failed: 'ошибка',
  cancelled: 'отменён',
  timeout: 'таймаут',
  skipped: 'пропущен'
}

export function ciStatusLabel(status: CiStatus): string {
  return STATUS_LABEL[status] ?? status
}

/** Иконка шага/рана (не эмодзи-зависимая семантика — простые глифы). */
export function ciStatusIcon(status: CiStatus): string {
  switch (status) {
    case 'success':
      return '✓'
    case 'failed':
    case 'timeout':
      return '✕'
    case 'cancelled':
      return '⊘'
    case 'running':
      return '▸'
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

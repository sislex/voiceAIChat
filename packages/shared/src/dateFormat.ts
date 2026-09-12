// Единый формат дат в интерфейсе.
//
// Раньше в коде жили четыре варианта сразу: `toLocaleDateString()`,
// `toLocaleString()`, `toLocaleDateString('ru')` и `toLocaleDateString('ru-RU')`.
// Без явной локали формат берётся из браузера, и в русском интерфейсе появлялось
// `8/28/2026` — день и месяц в нём не различить.
const DATE = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
})

/** `29.08.2026`. Нечисловой или пустой момент времени даёт «—». */
export function formatDate(value: number | string | Date | null | undefined): string {
  const date = toDate(value)
  return date ? DATE.format(date) : '—'
}

/** `29.08.2026, 01:38`. */
export function formatDateTime(value: number | string | Date | null | undefined): string {
  const date = toDate(value)
  return date ? DATE_TIME.format(date) : '—'
}

/** ISO для атрибута `dateTime` у `<time>`; пусто — если момента нет. */
export function isoDate(value: number | string | Date | null | undefined): string {
  return toDate(value)?.toISOString() ?? ''
}

function toDate(value: number | string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Coarse relative time for lists («5 мин назад», «вчера»): the exact timestamp
 * stays in a tooltip, the row itself answers «how long ago» at a glance.
 */
export function formatRelativeTime(value: number | string, now: number = Date.now()): string {
  const at = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(at)) return ''
  const diff = now - at
  const future = diff < 0
  const seconds = Math.round(Math.abs(diff) / 1000)
  const text = seconds < 45 ? 'только что'
    : seconds < 3600 ? `${Math.max(1, Math.round(seconds / 60))} мин`
    : seconds < 86_400 ? `${Math.round(seconds / 3600)} ч`
    : seconds < 172_800 ? 'вчера'
    : seconds < 30 * 86_400 ? `${Math.round(seconds / 86_400)} дн.`
    : formatDate(at)
  if (text === 'только что' || text === 'вчера' || seconds >= 30 * 86_400) return text
  return future ? `через ${text}` : `${text} назад`
}

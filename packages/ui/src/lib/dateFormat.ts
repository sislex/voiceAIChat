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

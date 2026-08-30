// Форматирование дат и длительностей. Ядро отдаёт величины (durationOf), а
// склонение и локаль — здесь: это единственное место в модуле, которое знает
// про русский язык, и его проще всего заменить при переносе.
import { durationOf, type Duration } from '@voicechat/sessions-core'

/** Русское склонение числительных: 1 минута, 2 минуты, 5 минут. */
export function plural(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  const mod10 = value % 10
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

const UNITS: Record<Exclude<Duration['unit'], 'now'>, [string, string, string]> = {
  minute: ['минуту', 'минуты', 'минут'],
  hour: ['час', 'часа', 'часов'],
  day: ['день', 'дня', 'дней'],
  month: ['месяц', 'месяца', 'месяцев']
}

/** «меньше минуты», «5 минут», «3 дня» — без знака: направление задаёт вызывающий. */
export function formatDuration(ms: number): string {
  const { unit, value } = durationOf(ms)
  if (unit === 'now') return 'меньше минуты'
  const [one, few, many] = UNITS[unit]
  return `${value} ${plural(value, one, few, many)}`
}

/** Короткая отметка «30.08 15:40» — в списке важнее компактность, чем год. */
export function formatMoment(at: number, locale = 'ru-RU'): string {
  return new Date(at).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

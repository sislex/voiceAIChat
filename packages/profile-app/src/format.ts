// Форматирование дат и длительностей карточки.
//
// Локаль задана явно (`ru-RU`), а не берётся из браузера: иначе один и тот же
// журнал у двух администраторов выглядит по-разному, и «08/31/2026» в переписке
// не сходится с «31.08.2026» на экране.

const DATE = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
const DATE_TIME = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

export function formatDate(at: number): string {
  return DATE.format(new Date(at))
}

export function formatDateTime(at: number): string {
  return DATE_TIME.format(new Date(at))
}

export function formatTime(at: number): string {
  return TIME.format(new Date(at))
}

/** «сейчас», «12 минут назад», «вчера», «3 дня назад» — как в ленте активности. */
export function formatAgo(at: number | null | undefined, now: number): string {
  if (at == null) return 'не было'
  const diff = Math.max(0, now - at)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'сейчас'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'вчера'
  if (days < 31) return `${days} дн назад`
  return formatDate(at)
}

/** Короткая метка периода для селекта и подписи графика. */
export const PERIOD_LABEL: Record<string, string> = {
  month: 'Текущий месяц',
  '7d': 'Последние 7 дней',
  '30d': 'Последние 30 дней',
  all: 'Всё время'
}

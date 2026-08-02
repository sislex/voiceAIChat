// Форматирование чисел панели «Использование БЗ» в одном месте: панель, сводка и
// лента обязаны показывать одинаково (иначе «12 500» и «12500» в двух блоках
// читаются как разные величины).

import type { KbUsageQuery, KbUsageSource, KbUsageStatus } from '@shared/kb'

export function num(value: number): string {
  return value.toLocaleString('ru')
}

/** Метка источника: сервер подмешал контекст или модель спросила сама. */
export const SOURCE_LABEL: Record<KbUsageSource, string> = {
  auto: 'авто-контекст',
  tool_search: 'поиск модели',
  tool_document: 'раздел по запросу',
  tool_topics: 'оглавление'
}

export const STATUS_LABEL: Record<KbUsageStatus, string> = {
  pending: 'запрашивает…',
  delivered: 'получено',
  empty: 'ничего не нашлось',
  error: 'ошибка'
}

/** Время события в ленте (HH:MM); 0/пусто — прочерк. */
export function timeOf(at: number | null): string {
  if (!at) return '—'
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Краткое описание обращения для ленты: что именно спросили. */
export function queryLabel(query: KbUsageQuery): string {
  const text = query.query.trim()
  if (!text) return SOURCE_LABEL[query.source]
  return text.length > 90 ? `${text.slice(0, 90)}…` : text
}

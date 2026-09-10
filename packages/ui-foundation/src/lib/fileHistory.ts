// Локальная история правок файла Make (п.7): последние версии каждого сохранённого файла в
// localStorage браузера — «undo между сессиями» без снимков всего проекта. Снимки на сервере
// остаются источником правды; это страховка от случайного автосохранения поверх нужного текста.
export interface FileVersion { at: number; content: string }

const LIMIT = 20
const MAX_CHARS = 200_000
const key = (conversationId: string, path: string): string => `vc.make.history:${conversationId}:${path}`

export interface HistoryStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

function storage(custom?: HistoryStorage): HistoryStorage | null {
  if (custom) return custom
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

export function readHistory(conversationId: string, path: string, store?: HistoryStorage): FileVersion[] {
  const s = storage(store)
  if (!s) return []
  try {
    const raw = s.getItem(key(conversationId, path))
    const list = raw ? (JSON.parse(raw) as FileVersion[]) : []
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

/** Добавить версию; подряд идущие дубли и слишком большие файлы не пишем. Возвращает актуальный список. */
export function pushHistory(conversationId: string, path: string, content: string, store?: HistoryStorage, now = Date.now()): FileVersion[] {
  const s = storage(store)
  const list = readHistory(conversationId, path, store)
  if (!s || content.length > MAX_CHARS) return list
  if (list[0]?.content === content) return list
  const next = [{ at: now, content }, ...list].slice(0, LIMIT)
  try { s.setItem(key(conversationId, path), JSON.stringify(next)) } catch { /* квота — просто без истории */ }
  return next
}

export function clearHistory(conversationId: string, path: string, store?: HistoryStorage): void {
  storage(store)?.removeItem(key(conversationId, path))
}

// Правка текста прямо в превью (roadmap-4 п.17): пользователь редактирует элемент contenteditable,
// панель должна записать новый текст в исходник. Ищем старый текст как уникальную подстроку файла —
// без парсинга разметки; неоднозначность (0 или >1 вхождений) — отказ, чтобы не испортить чужой узел.


/** Новый исходник или `null`, если `before` встречается не ровно один раз. Пробелы/переносы внутри `before` сравниваются гибко. */
export function replaceUniqueText(content: string, before: string, after: string): string | null {
  const needle = before.trim()
  if (!needle) return null
  // В разметке текст может быть разбит переносами и отступами — сравниваем с нормализованными пробелами.
  const pattern = new RegExp(needle.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g')
  const matches = [...content.matchAll(pattern)]
  if (matches.length !== 1) return null
  const m = matches[0]!
  return content.slice(0, m.index) + after + content.slice(m.index! + m[0].length)
}

/** Экранирование для вставки пользовательского текста в HTML/JSX-разметку. */
export function escapeMarkupText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

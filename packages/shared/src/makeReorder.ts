// Перетаскивание секций в превью (roadmap-4 п.18): iframe присылает outerHTML перемещённого узла и соседа,
// панель переносит фрагмент в исходнике. Разметку не парсим — ищем оба фрагмента как уникальные подстроки
// с гибкими пробелами; браузерная нормализация атрибутов может не совпасть с исходником — тогда `null`.

function flexiblePattern(fragment: string): RegExp | null {
  const words = fragment.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  return new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g')
}

function uniqueMatch(content: string, fragment: string): { start: number; end: number } | null {
  const re = flexiblePattern(fragment)
  if (!re) return null
  const all = [...content.matchAll(re)]
  if (all.length !== 1) return null
  const m = all[0]!
  return { start: m.index!, end: m.index! + m[0].length }
}

/** Переносит `moved` перед/после `target` (оба — outerHTML соседей). `null`, если фрагменты не найдены ровно по разу или пересекаются. */
export function reorderMarkup(content: string, moved: string, target: string, position: 'before' | 'after'): string | null {
  const a = uniqueMatch(content, moved), b = uniqueMatch(content, target)
  if (!a || !b || a.start === b.start) return null
  if (a.start < b.end && b.start < a.end) return null
  // Сохраняем отступ перемещаемого блока: берём пробелы/перенос перед ним и вставляем вместе с ним.
  const lead = /[ \t]*$/.exec(content.slice(0, a.start))?.[0] ?? ''
  const movedText = content.slice(a.start, a.end)
  let out = content.slice(0, a.start - lead.length) + content.slice(a.end).replace(/^[ \t]*\r?\n/, '')
  const shift = a.start - lead.length
  const removedLen = content.length - out.length
  const bStart = b.start > a.start ? b.start - removedLen : b.start
  const bEnd = b.end > a.start ? b.end - removedLen : b.end
  void shift
  const targetLead = /[ \t]*$/.exec(out.slice(0, bStart))?.[0] ?? ''
  if (position === 'before') out = out.slice(0, bStart) + movedText + '\n' + targetLead + out.slice(bStart)
  else out = out.slice(0, bEnd) + '\n' + targetLead + movedText + out.slice(bEnd)
  return out
}

/**
 * Разметка критериев приёмки относительно первоначальной постановки.
 *
 * Считаем на клиенте: сервер хранит критерии одной строкой, и заводить ради
 * подсветки структурированное хранение — отдельная миграция. Правило простое:
 * дословное совпадение — «исходный», похожий по словам пункт — «изменён»,
 * всё остальное — «добавлен».
 */
export type CriterionState = 'original' | 'changed' | 'added'

export interface CriterionDiffItem {
  text: string
  state: CriterionState
}

/** Доля общих слов, начиная с которой пункт считаем переписанным, а не новым. */
const SIMILAR_ENOUGH = 0.5

/**
 * Пункты приходят и списком с нумерацией («1. …», «- …»), и просто строками:
 * префикс снимаем, иначе перенумерованный список выглядел бы полностью новым.
 */
export function splitCriteria(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
}

function words(value: string): string[] {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
}

/** Доля слов исходного пункта, оставшихся в текущем (0…1). */
function similarity(left: string, right: string): number {
  const a = words(left)
  const b = new Set(words(right))
  if (!a.length) return 0
  return a.filter((word) => b.has(word)).length / a.length
}

/**
 * Каждый пункт текущей постановки получает состояние относительно исходной.
 * Исходные пункты расходуются по одному — повторяющийся текст не пометит два
 * разных пункта как «исходный» по одной и той же строке.
 */
export function diffCriteria(source: string, current: string): CriterionDiffItem[] {
  const sourceItems = splitCriteria(source)
  const used = new Set<number>()
  const take = (predicate: (item: string, index: number) => boolean): boolean => {
    const index = sourceItems.findIndex((item, position) => !used.has(position) && predicate(item, position))
    if (index < 0) return false
    used.add(index)
    return true
  }
  return splitCriteria(current).map((text) => {
    if (take((item) => item === text)) return { text, state: 'original' as const }
    if (take((item) => similarity(item, text) >= SIMILAR_ENOUGH)) return { text, state: 'changed' as const }
    return { text, state: 'added' as const }
  })
}

export const CRITERION_STATE_LABEL: Record<CriterionState, string> = {
  original: 'Исходный', changed: 'Изменён', added: 'Добавлен'
}

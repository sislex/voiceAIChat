// Типографика в проекте не вынесена в токены: кегли и веса стоят прямо в
// правилах app.css. Поэтому шкалу для витрины не выписываем руками, а собираем
// из подключённых стилей — сториз показывает то, что реально встречается, и
// сама замечает новый 12.5px, который кто-то добавил «на один экран».

import { styleRules } from './tokens'

/** Одно значение шкалы: сколько правил его используют и какие это правила. */
export interface ScaleEntry {
  value: string
  count: number
  /** Примеры селекторов — «что для чего» без ручного описания. */
  selectors: string[]
}

const SELECTOR_SAMPLES = 6

/** Группировка правил по значению свойства: значение → счётчик и примеры селекторов. */
function collect(doc: Document, prop: 'fontSize' | 'fontWeight' | 'fontFamily', keep: (value: string) => boolean): ScaleEntry[] {
  const found = new Map<string, ScaleEntry>()
  for (const rule of styleRules(doc)) {
    const value = rule.style[prop].trim()
    if (!value || !keep(value)) continue
    const entry = found.get(value) ?? { value, count: 0, selectors: [] }
    entry.count += 1
    if (entry.selectors.length < SELECTOR_SAMPLES) entry.selectors.push(rule.selectorText)
    found.set(value, entry)
  }
  return [...found.values()]
}

/** Кегли в пикселях — от крупного к мелкому. */
export function fontSizes(doc: Document = document): ScaleEntry[] {
  return collect(doc, 'fontSize', (v) => v.endsWith('px')).sort((a, b) => Number.parseFloat(b.value) - Number.parseFloat(a.value))
}

/** Числовые веса — от жирного к светлому. */
export function fontWeights(doc: Document = document): ScaleEntry[] {
  return collect(doc, 'fontWeight', (v) => /^\d+$/.test(v)).sort((a, b) => Number.parseFloat(b.value) - Number.parseFloat(a.value))
}

/** Семейства шрифтов: интерфейсное и монофонты кода — по частоте. */
export function fontFamilies(doc: Document = document): ScaleEntry[] {
  return collect(doc, 'fontFamily', (v) => v !== 'inherit').sort((a, b) => b.count - a.count)
}

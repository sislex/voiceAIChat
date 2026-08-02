// Чтение объявлений app.css текстом — для инвариантов раскладки, которые в
// jsdom не проверить: раскладки там нет, у всего нулевая высота, и «сжалась ли
// колонка» измерить нечем. Живьём такие правила проверяются headless-браузером,
// а тест держит те объявления, снятие которых возвращает баг.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf8')

/**
 * Правила верхнего уровня: селектор → объявления. Внутренности @media
 * пропускаем — они переопределяют базовые правила под конкретный экран, а
 * проверяем мы базовую цепочку.
 */
function topLevelRules(): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const selector = css.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim()
    // Конец блока с учётом вложенности (@media внутри себя содержит правила).
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    const body = css.slice(open + 1, j - 1)
    if (!selector.startsWith('@')) out.push({ selector, body })
    i = j
  }
  return out
}

const RULES = topLevelRules()

/** Значение свойства в правиле с точно таким селектором (последнее по каскаду). */
export function decl(selector: string, prop: string): string | null {
  let value: string | null = null
  for (const rule of RULES) {
    if (rule.selector !== selector) continue
    const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, 'g')
    for (const m of rule.body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)) value = m[1].trim()
  }
  return value
}

/** Тело @media-блока с точно таким условием (для мобильных переопределений). */
export function mediaBody(condition: string): string {
  const at = css.indexOf(`@media ${condition}`)
  if (at < 0) return ''
  const open = css.indexOf('{', at)
  let depth = 1
  let j = open + 1
  while (j < css.length && depth > 0) {
    if (css[j] === '{') depth++
    else if (css[j] === '}') depth--
    j++
  }
  return css.slice(open + 1, j - 1)
}

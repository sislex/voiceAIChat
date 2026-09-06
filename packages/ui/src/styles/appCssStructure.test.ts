// Структурный страж app.css.
//
// Мержи трогают этот файл чаще любого другого: правила добавляют в конец, а
// конфликты разрешают руками. Один раз так пропала закрывающая скобка медиазапроса
// — целый блок стилей уехал внутрь `@media (max-width: 720px)` и на десктопе просто
// не применялся. Сборка при этом зелёная: Vite не жалуется, а глазами такое видно
// только на живом экране. Поэтому проверяем структуру текстом.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf8')

/** Селекторы правил верхнего уровня (вне любых at-rule). */
function topLevelSelectors(): string[] {
  const out: string[] = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const selector = css.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim()
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    if (!selector.startsWith('@')) out.push(selector)
    i = j
  }
  return out
}

describe('структура app.css', () => {
  it('скобки сбалансированы', () => {
    let depth = 0
    let min = 0
    for (const ch of css) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
      min = Math.min(min, depth)
    }
    expect(depth, 'незакрытый или лишний блок в app.css').toBe(0)
    expect(min, 'лишняя закрывающая скобка в app.css').toBe(0)
  })

  it('базовые правила экранов лежат на верхнем уровне, а не внутри медиазапроса', () => {
    const selectors = new Set(topLevelSelectors())
    // По одному якорю на крупный блок: если блок «утонет» в @media, якорь пропадёт.
    for (const anchor of ['.mpc', '.mpc-body', '.make-pane', '.chat-split', '.kanban-board']) {
      expect(selectors.has(anchor), `${anchor} обязан быть правилом верхнего уровня`).toBe(true)
    }
  })
})

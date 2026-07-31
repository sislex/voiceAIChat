// Цепочка скролла доски: длинная колонка обязана скроллиться внутри себя, а не
// тянуть по высоте документ.
//
// Проверяем по тексту app.css, а не через getComputedStyle: в jsdom нет
// раскладки — там у всего нулевая высота, и «скроллится ли колонка» измерить
// нечем (живьём проверено в headless-браузере: доска на 40 карточек,
// document.scrollingElement.scrollHeight === clientHeight). Тест держит те
// объявления, снятие любого из которых возвращает баг:
//
//  * `.app { position: relative }` — блок-контейнер для абсолютных потомков.
//    Без него подсказки `.vc-sr-only` на карточках позиционировались от
//    страницы, `overflow: hidden` их не обрезал, и документ растягивался на
//    высоту всего списка карточек (40 карточек — 6087px вместо 900px).
//  * `.jcard { position: relative }` — та же подсказка, но по месту: её
//    блок-контейнер должен быть картой.
//  * `min-height: 0` по всей flex-цепочке — иначе минимум по содержимому не даёт
//    списку сжаться до высоты доски.
//  * `flex: none` у шапок и композера — сжимается только список карточек.

// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
function decl(selector: string, prop: string): string | null {
  let value: string | null = null
  for (const rule of RULES) {
    if (rule.selector !== selector) continue
    const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, 'g')
    for (const m of rule.body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)) value = m[1].trim()
  }
  return value
}

describe('app.css — скролл длинной колонки доски', () => {
  it('корень приложения обрезает содержимое и служит блок-контейнером', () => {
    expect(decl('.app', 'height')).toBe('100vh')
    expect(decl('.app', 'overflow')).toBe('hidden')
    // Без этого абсолютные потомки считаются от страницы и растягивают документ.
    expect(decl('.app', 'position')).toBe('relative')
  })

  it('карточка — блок-контейнер для своей скринридерной подсказки', () => {
    expect(decl('.jcard', 'position')).toBe('relative')
  })

  it('страница-рамка тянется по клетке сетки, а не по 100vh', () => {
    // На телефоне у .app высота в dvh: 100vh у рамки был бы выше её клетки.
    expect(decl('.toolpage', 'height')).toBe('100%')
    expect(decl('.toolpage', 'overflow')).toBe('hidden')
    expect(decl('.toolpage', 'min-height')).toBe('0')
  })

  it('flex-цепочка от рамки до списка карточек не теряет min-height: 0', () => {
    for (const selector of ['.toolpage > .jboard-wrap', '.jboard']) {
      expect(decl(selector, 'flex'), selector).toBe('1')
      expect(decl(selector, 'min-height'), selector).toBe('0')
    }
    expect(decl('.jboard', 'overflow')).toBe('auto')
    expect(decl('.jcol', 'max-height')).toBe('100%')
    expect(decl('.jcol', 'min-height')).toBe('0')
  })

  it('скроллится именно список карточек колонки', () => {
    // Автоскролл при переносе (lib/dnd.ts) тоже ждёт скролл именно здесь.
    expect(decl('.jcol-body', 'overflow-y')).toBe('auto')
    expect(decl('.jcol-body', 'flex')).toBe('1')
  })

  it('шапки и композер не сжимаются вместо списка', () => {
    for (const selector of ['.jboard-filters', '.jcol-head', '.jcompose', '.jcompose-open']) {
      expect(decl(selector, 'flex'), selector).toBe('none')
    }
  })

  it('легаси-правило .kanban-board не навязывает доске минимальную высоту', () => {
    // Класс висит на том же элементе, что .jboard: min-height: 60vh спорил с
    // min-height: 0 и гасился только порядком правил в файле.
    expect(decl('.kanban-board', 'min-height')).toBeNull()
  })
})

// Цепочка скролла доски: рабочая область ограничена viewport, общая поверхность
// прокручивается только горизонтально, а списки карточек — вертикально и независимо.
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
import { describe, expect, it } from 'vitest'
import { decl, mediaBody } from './cssRules'

describe('app.css — скролл длинной колонки доски', () => {
  it('корень приложения ограничивает обе оси доступным viewport', () => {
    expect(decl('.app', 'display')).toBe('grid')
    expect(decl('.app', 'grid-template-columns')).toBe('264px minmax(0, 1fr)')
    expect(decl('.app', 'grid-template-rows')).toBe('minmax(0, 1fr)')
    expect(decl('.app', 'height')).toBe('100vh')
    expect(decl('.app', 'overflow')).toBe('hidden')
    // Без этого абсолютные потомки считаются от страницы и растягивают документ.
    expect(decl('.app', 'position')).toBe('relative')
  })

  it('на мобильной ширине корень использует динамическую высоту viewport', () => {
    const mobile = mediaBody('(max-width: 768px)')
    expect(mobile).toMatch(/\.app,\s*\.app--console\s*\{[^}]*height:\s*100dvh/s)
  })

  it('карточка — блок-контейнер для своей скринридерной подсказки', () => {
    expect(decl('.jcard', 'position')).toBe('relative')
  })

  it('страница-рамка тянется по клетке сетки, а не по 100vh', () => {
    // На телефоне у .app высота в dvh: 100vh у рамки был бы выше её клетки.
    expect(decl('.toolpage', 'height')).toBe('100%')
    expect(decl('.toolpage', 'overflow')).toBe('hidden')
    expect(decl('.toolpage', 'display')).toBe('flex')
    expect(decl('.toolpage', 'flex-direction')).toBe('column')
    expect(decl('.toolpage', 'min-width')).toBe('0')
    expect(decl('.toolpage', 'min-height')).toBe('0')
    expect(decl('.toolpage.projpage', 'height')).toBe('100%')
    expect(decl('.toolpage.projpage', 'overflow')).toBe('hidden')
    expect(decl('.toolpage.projpage > .mdhead', 'flex')).toBe('none')
  })

  it('flex-цепочка от рамки до списков карточек не теряет ограничения размеров', () => {
    for (const selector of ['.toolpage > .jboard-wrap', '.jboard']) {
      expect(decl(selector, 'flex'), selector).toBe('1')
      expect(decl(selector, 'min-height'), selector).toBe('0')
      expect(decl(selector, 'min-width'), selector).toBe('0')
    }
    expect(decl('.toolpage > .jboard-wrap', 'overflow')).toBe('hidden')
    expect(decl('.jboard', 'overflow-x')).toBe('auto')
    expect(decl('.jboard', 'overflow-y')).toBe('hidden')
    expect(decl('.jboard', 'display')).toBe('flex')
    expect(decl('.jboard', 'align-items')).toBe('stretch')
    expect(decl('.jcol', 'display')).toBe('flex')
    expect(decl('.jcol', 'flex-direction')).toBe('column')
    expect(decl('.jcol', 'flex')).toBe('0 0 272px')
    expect(decl('.jcol', 'width')).toBe('272px')
    expect(decl('.jcol', 'min-width')).toBe('0')
    expect(decl('.jcol', 'height')).toBe('100%')
    expect(decl('.jcol', 'max-height')).toBe('100%')
    expect(decl('.jcol', 'min-height')).toBe('0')
    expect(decl('.jcol', 'overflow')).toBe('hidden')
  })

  it('только списки карточек прокручиваются вертикально и независимо', () => {
    expect(decl('.jcol-body', 'display')).toBe('flex')
    expect(decl('.jcol-body', 'flex-direction')).toBe('column')
    expect(decl('.jcol-body', 'min-width')).toBe('0')
    expect(decl('.jcol-body', 'overflow-x')).toBe('hidden')
    expect(decl('.jcol-body', 'overflow-y')).toBe('auto')
    expect(decl('.jcol-body', 'flex')).toBe('1')
    expect(decl('.jcol-body', 'min-height')).toBe('0')
    expect(decl('.jcol-body', 'overscroll-behavior')).toBe('contain')
    expect(decl('.jcol-head', 'flex')).toBe('none')
  })

  it('свимлейны сохраняют общий вертикальный скролл и авто-высоту ячеек', () => {
    expect(decl('.jboard--lanes', 'overflow-y')).toBe('auto')
    expect(decl('.jcol--incell', 'height')).toBe('auto')
    expect(decl('.jcol--incell', 'max-height')).toBe('none')
    expect(decl('.jcol--incell', 'overflow')).toBe('visible')
  })

  it('touch-скролл остаётся у списков, а ручки захвата владеют drag-жестом', () => {
    expect(decl('.jcard', 'touch-action')).toBeNull()
    expect(decl('.jcol-body', 'touch-action')).toBeNull()
    expect(decl('.jcard-grip, .jcol-grip', 'touch-action')).toBe('none')
  })

  it('фильтры остаются вне общей прокрутки, а шапки и композер не сжимаются', () => {
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

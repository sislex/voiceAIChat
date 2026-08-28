// Цепочка скролла доски: рабочая область ограничена viewport, а общая поверхность
// прокручивает все колонки по обеим осям. Списки карточек растут по содержимому и
// не создают независимых вертикальных scroll-контейнеров.
//
// Проверяем по тексту app.css, а не через getComputedStyle: в jsdom нет
// раскладки — там у всего нулевая высота, и реальную геометрию overflow измерить
// нечем. Тест держит объявления, снятие которых возвращает раздельный скролл:
//
//  * `.app { position: relative }` — блок-контейнер для абсолютных потомков.
//    Без него подсказки `.vc-sr-only` на карточках позиционировались от
//    страницы, `overflow: hidden` их не обрезал, и документ растягивался на
//    высоту всего списка карточек (40 карточек — 6087px вместо 900px).
//  * `.jcard { position: relative }` — та же подсказка, но по месту: её
//    блок-контейнер должен быть картой.
//  * `min-height: 0` по flex-цепочке до .jboard — иначе общий viewport не
//    сжимается до доступной высоты.
//  * `min-height: 100%` у колонок — короткие колонки заполняют поверхность,
//    длинные растут по карточкам и задают общий вертикальный overflow.

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { decl, mediaBody } from './cssRules'

describe('app.css — скролл длинной колонки доски', () => {
  it('корень приложения ограничивает обе оси доступным viewport', () => {
    expect(decl('.app', 'display')).toBe('grid')
    expect(decl('.app', 'grid-template-columns')).toBe('var(--sidebar-width, 264px) minmax(0, 1fr)')
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
    expect(decl('.proj-detail', 'min-width')).toBe('0')
    expect(decl('.proj-detail', 'min-height')).toBe('0')
    expect(decl('.toolpage > .proj-detail', 'min-width')).toBe('0')
    expect(decl('.toolpage > .proj-detail', 'min-height')).toBe('0')
  })

  it('рамка ассистента между страницей и доской не теряет ограничения высоты', () => {
    // На странице проекта доска вложена не в .toolpage напрямую, а через
    // WidgetAssistantFrame: .toolpage → .widget-assistant →
    // .widget-assistant-widget → .jboard-wrap. Привязка правила обёртки к
    // родителю (`.toolpage > .jboard-wrap`) уже однажды вернула баг «колонка
    // не скроллится»: рамка появилась, селектор перестал срабатывать.
    expect(decl('.widget-assistant', 'display')).toBe('flex')
    expect(decl('.widget-assistant', 'flex')).toBe('1 1 auto')
    expect(decl('.widget-assistant', 'min-height')).toBe('0')
    expect(decl('.widget-assistant', 'overflow')).toBe('hidden')
    expect(decl('.widget-assistant-widget', 'display')).toBe('flex')
    expect(decl('.widget-assistant-widget', 'flex')).toBe('1 1 auto')
    expect(decl('.widget-assistant-widget', 'min-height')).toBe('0')
  })

  it('flex-цепочка от рамки до списков карточек не теряет ограничения размеров', () => {
    // Правило обёртки — без привязки к родителю, см. тест про рамку ассистента.
    for (const selector of ['.jboard-wrap', '.jboard']) {
      expect(decl(selector, 'flex'), selector).toBe('1')
      expect(decl(selector, 'min-height'), selector).toBe('0')
      expect(decl(selector, 'min-width'), selector).toBe('0')
    }
    expect(decl('.jboard-wrap', 'overflow')).toBe('hidden')
    expect(decl('.jboard', 'overflow-x')).toBe('auto')
    expect(decl('.jboard', 'overflow-y')).toBe('auto')
    expect(decl('.jboard', 'display')).toBe('flex')
    expect(decl('.jboard', 'align-items')).toBe('stretch')
    expect(decl('.jcol', 'display')).toBe('flex')
    expect(decl('.jcol', 'flex-direction')).toBe('column')
    expect(decl('.jcol', 'flex')).toBe('0 0 272px')
    expect(decl('.jcol', 'flex-shrink')).toBe('0')
    expect(decl('.jcol', 'width')).toBe('272px')
    expect(decl('.jcol', 'min-width')).toBe('0')
    expect(decl('.jcol', 'height')).toBeNull()
    expect(decl('.jcol', 'max-height')).toBeNull()
    expect(decl('.jcol', 'min-height')).toBe('100%')
    expect(decl('.jcol', 'overflow')).toBe('visible')
  })

  it('списки карточек растут по содержимому без независимой прокрутки', () => {
    expect(decl('.jcol-body', 'display')).toBe('flex')
    expect(decl('.jcol-body', 'flex-direction')).toBe('column')
    expect(decl('.jcol-body', 'min-width')).toBe('0')
    expect(decl('.jcol-body', 'overflow')).toBe('visible')
    expect(decl('.jcol-body', 'overflow-x')).toBeNull()
    expect(decl('.jcol-body', 'overflow-y')).toBeNull()
    expect(decl('.jcol-body', 'flex')).toBe('1')
    expect(decl('.jcol-body', 'min-height')).toBeNull()
    expect(decl('.jcol-body', 'overscroll-behavior')).toBeNull()
    expect(decl('.jcol-head', 'flex')).toBe('none')
  })

  it('свимлейны используют тот же общий вертикальный скролл и авто-высоту ячеек', () => {
    expect(decl('.jboard--lanes', 'overflow-y')).toBeNull()
    expect(decl('.jcol--incell', 'height')).toBe('auto')
    expect(decl('.jcol--incell', 'min-height')).toBe('0')
    expect(decl('.jcol--incell', 'max-height')).toBe('none')
    expect(decl('.jcol--incell', 'overflow')).toBe('visible')
  })

  it('touch-скролл остаётся нативным на доске, а ручки захвата владеют drag-жестом', () => {
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

describe('app.css — сетка настроек разговора', () => {
  it('разделяет шапку, вкладки, прокручиваемое содержимое и футер', () => {
    expect(decl('.convsettings', 'display')).toBe('grid')
    expect(decl('.convsettings', 'grid-template-rows')).toBe(
      'auto auto minmax(0, 1fr) auto',
    )
    expect(decl('.convsettings-body', 'overflow')).toBe('auto')
  })

  it('сохраняет естественную высоту и перенос вкладок', () => {
    expect(decl('.proj-settings-tabs', 'display')).toBe('flex')
    expect(decl('.proj-settings-tabs', 'flex-wrap')).toBe('wrap')
    expect(decl('.proj-settings-tabs', 'height')).toBeNull()
  })
})

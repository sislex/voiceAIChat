// Сторож стилей открытой карточки задачи.
//
// Тот же класс аварии, что закреплён в `feedStyles.test.ts`: слияние ветки
// однажды молча снесло из `app.css` блоки, которые разметка продолжала
// использовать, — и это не видит ни typecheck, ни jsdom (стилей там нет).
// Карточка особенно уязвима: её раскладка держится на нескольких правилах, без
// которых панель вкладки схлопывается в ширину содержимого, а колонки «Общего»
// перестают быть колонками.
//
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Стили карточки живут в двух файлах: язык панелей рана (`.vc-*`) — в ui-kit
// рядом с примитивами, всё предметное — в app.css. Сторож смотрит на оба, иначе
// переезд класса между ними читался бы как его пропажа.
const css = [
  new URL('./app.css', import.meta.url),
  new URL('../../../ui-kit/src/styles.css', import.meta.url)
]
  .map((url) => readFileSync(fileURLToPath(url), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const styled = (cls: string): boolean => new RegExp(`\\.${cls}(?![\\w-])`).test(css)
/** Тело первого правила с этим селектором — для проверки конкретных свойств. */
function rule(selector: string): string {
  return new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

describe('стили открытой карточки задачи', () => {
  it.each([
    // Общий язык лент: раскрываемая строка, шеврон, точка статуса.
    'vc-feed', 'vc-feed-item', 'vc-feed-caret', 'vc-feed-status', 'vc-feed-dot',
    'vc-feed-dot--progress', 'vc-feed-dot--success', 'vc-feed-dot--danger', 'vc-feed-dot--muted',
    'vc-feed-item__title', 'vc-feed-log',
    // Язык панелей рана: лозенга, шапка, сводка, шаги, прогресс, подразделы, Live.
    'vc-pill', 'vc-pill--success', 'vc-pill--running', 'vc-pill--warning', 'vc-pill--danger', 'vc-pill--neutral',
    'vc-panel-head', 'vc-panel-head__kicker', 'vc-panel-head__title', 'vc-panel-head__desc', 'vc-panel-head__actions',
    'vc-metrics', 'vc-metric', 'vc-metric__label', 'vc-metric__value',
    'vc-steps', 'vc-step', 'vc-step__mark', 'vc-step__title', 'vc-step__detail',
    'vc-step--done', 'vc-step--running', 'vc-step--failed',
    'vc-track', 'vc-track__fill', 'vc-ring', 'vc-ring__caption',
    'vc-subtabs', 'vc-subtab', 'vc-subtab--active', 'vc-subtab__count', 'vc-live', 'vc-live__dot',
    // Полоса вкладок и панели.
    'task-tabs', 'task-tab', 'task-tab--active', 'task-tab-count', 'task-tab-panel', 'task-tab-empty',
    // Шапка: надстрочная строка «ключ · состояние» и крупное название.
    'task-modal-heading', 'task-modal-heading__eyebrow', 'task-modal-heading__key',
    'task-modal-heading__dot', 'task-modal-heading__state', 'task-modal-heading__title',
    // Раскладка карточки.
    'jmodal', 'jmodal-panels', 'jmodal-general', 'jmodal-main', 'jmodal-side', 'jmodal-side-fields',
    'jmodal-child', 'jmodal-desc-view', 'jmodal-desc-empty', 'task-content-block',
    // Колонка свойств: заголовок, строка «подпись | значение», проект, даты.
    'jmodal-side-title', 'jmodal-project', 'jmodal-project-mark', 'jmodal-dates',
    // Строка свойства, заголовок секции и чипы переехали в ui-kit.
    'vc-prop', 'vc-prop--wide', 'vc-prop__label', 'vc-section-head', 'vc-section-head__title',
    'vc-section-head__meta', 'vc-section-head__action', 'vc-chips', 'vc-chip', 'vc-chip__remove',
    // Содержимое вкладок.
    // Секции вкладки «Общее»: описание, подзадачи, активность.
    'task-section', 'task-section-head', 'task-section-meta', 'task-section-action',
    'task-subtask-form', 'task-activity', 'task-activity__item', 'task-activity__time',
    'task-timeline', 'task-timeline-stage', 'task-improvements', 'task-improvement',
    'task-model-work', 'task-settings-stack', 'task-preparation-setup', 'task-preparation-grid',
    'task-preparation-field', 'ci-task-stages', 'ci-task-hint',
    // Лог с ANSI-раскраской.
    'ansi-bold', 'ansi-fg-green', 'ansi-fg-red', 'ansi-fg-yellow',
    // Панели QA и merge: раскладка блоков и общий язык результатов.
    'component-qa-panel', 'qa-stage-panel', 'component-qa-actions', 'qa-stage-actions',
    'vc-score', 'vc-score__value', 'vc-score__bar', 'vc-results', 'vc-results__caption',
    'vc-results__result', 'vc-results__detail', 'vc-gates', 'vc-gate', 'vc-gate__mark',
    'vc-gate__verdict', 'vc-branch-flow', 'vc-branch-flow__branch', 'vc-branch-flow__note',
    'qa-stage-run', 'qa-stage-answer',
    'vc-attempts', 'vc-attempts__title', 'vc-attempts__list', 'vc-attempts__row',
    'vc-attempts__row--current', 'vc-attempts__num', 'vc-attempts__status', 'vc-attempts__at',
    'merge-chip', 'merge-badge',
    // Карточка на доске и шапка колонки.
    'jcard-epic', 'jcard-epic-dot', 'jcard-flag', 'jcard-due', 'jcard-pts',
    'jcard-stage-actions', 'jcol-head', 'jcol-name-text', 'jcol-hidden-mark', 'jcompose-open'
  ])('класс .%s имеет правила', (cls) => {
    expect(styled(cls)).toBe(true)
  })

  it('обёртка панелей не переносит строки — иначе вкладка не скроллится', () => {
    // Панель объявлена `flex: 1 1 100%`. С `flex-wrap: wrap` каждая уходит на
    // свою строку, высота строки считается по содержимому, и `overflow: auto`
    // панели ограничивать нечего: вертикального скролла во вкладке нет, а
    // содержимое обрезает `.jmodal`. Это ловилось только глазами.
    expect(rule('.jmodal-panels')).not.toMatch(/flex-wrap/)
    expect(rule('.jmodal-panels')).toMatch(/min-height:\s*0/)
    expect(rule('.jmodal-panels')).toMatch(/align-items:\s*stretch/)
  })

  it('панель вкладки занимает всю ширину карточки', () => {
    // `.jmodal` — флексбокс: `grid-column` в нём не работал, и панель занимала
    // ширину содержимого, оставляя половину карточки пустой.
    expect(rule('.task-tab-panel')).toMatch(/flex:\s*1 1 100%/)
  })

  it('панель «Общего» скрывается атрибутом hidden', () => {
    // У элемента с `display: flex` атрибут `hidden` сам по себе не действует —
    // без этого правила «Общее» было бы видно на всех вкладках сразу.
    expect(css).toMatch(/\.jmodal-general\[hidden\]\s*\{[^}]*display:\s*none/)
  })

  it('разделитель ручного QA не висит сам по себе', () => {
    // Когда секции превью нет, `.manual-qa` — первая во вкладке, и `border-top`
    // рисовал линию, над которой ничего нет.
    expect(css).toMatch(/\.manual-qa:first-child\s*\{[^}]*border-top:\s*none/)
  })

  it('шапки колонок одной высоты', () => {
    // Без `min-height` шапка с длинным названием («Создание интеграционных
    // автотестов» — три строки) была на 16px выше соседних, и первые карточки
    // в колонках начинались на разной высоте — верх доски выглядел рваным.
    expect(rule('.jcol-head')).toMatch(/min-height:\s*50px/)
    expect(rule('.jcol-name-text')).toMatch(/-webkit-line-clamp:\s*2/)
  })
})

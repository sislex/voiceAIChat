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

const css = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf8')
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
    // Полоса вкладок и панели.
    'task-tabs', 'task-tab', 'task-tab--active', 'task-tab-panel', 'task-tab-empty',
    // Раскладка карточки.
    'jmodal', 'jmodal-general', 'jmodal-main', 'jmodal-side', 'jmodal-side-fields',
    'jmodal-child', 'jmodal-desc-view', 'jmodal-desc-empty', 'task-content-block',
    // Содержимое вкладок.
    'task-timeline', 'task-timeline-stage', 'task-improvements', 'task-improvement',
    'task-model-work', 'task-settings-stack', 'task-preparation-setup', 'task-preparation-grid',
    'task-preparation-field', 'ci-task-stages', 'ci-task-hint',
    // Лог с ANSI-раскраской.
    'ansi-bold', 'ansi-fg-green', 'ansi-fg-red', 'ansi-fg-yellow',
    // Бейджи статусов вкладок QA и Merge.
    'qa-status', 'qa-status--passed', 'qa-status--failed', 'merge-chip', 'merge-badge',
    // Карточка на доске и шапка колонки.
    'jcard-epic', 'jcard-epic-dot', 'jcard-flag', 'jcard-due', 'jcard-pts',
    'jcard-stage-actions', 'jcol-head', 'jcol-name-text', 'jcol-hidden-mark', 'jcompose-open'
  ])('класс .%s имеет правила', (cls) => {
    expect(styled(cls)).toBe(true)
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

// Проверка доступности в dom-тестах и в прогоне сториз: axe-core с одним общим
// конфигом на весь пакет.
//
// Зачем свой хелпер, а не `axe.run(document.body)` в каждом тесте: набор
// отключённых правил обязан быть один и объяснённый. Иначе каждый экран глушит
// «своё» нарушение по месту, и через месяц гейт зелёный, а интерфейс — нет.
// Список исключений — JSDOM_DISABLED_RULES ниже, каждое с причиной.
//
// Что проверяется здесь: разметка (роли, имена, метки полей, порядок
// заголовков, вложенность интерактивного). Чего проверить нельзя: всё, что
// требует настоящей раскладки и цвета — контраст и размер цели. Контраст живёт
// в `styles/contrast.test.ts` (считается по токенам из app.css) и в витрине
// Foundations; клавиатура и скринридер — руками, см. packages/ui/AGENTS.md.

import axe, { type ElementContext, type Result, type RunOptions, type RuleObject } from 'axe-core'

/**
 * Правила, которые в jsdom не работают, — с причиной у каждого. Ничего «просто
 * шумит» здесь быть не должно: нарушение либо чиним, либо оно физически
 * непроверяемо в этой среде и тогда его проверяет кто-то другой.
 */
export const JSDOM_DISABLED_RULES: RuleObject = {
  // Нужны вычисленные цвета и геометрия текста. В vitest стили не подключаются
  // (css: false), поэтому правило видит чёрное на прозрачном и либо молчит, либо
  // врёт. Контраст токенов проверяет styles/contrast.test.ts по самому app.css.
  'color-contrast': { enabled: false },
  // То же в новой инкарнации правила (axe ≥ 4.10 умеет градиенты и картинки).
  'color-contrast-enhanced': { enabled: false },
  // Прокручиваемая область должна быть доступна с клавиатуры, но «прокручиваемая»
  // считается по scrollHeight/clientHeight — в jsdom это всегда 0 и 0.
  'scrollable-region-focusable': { enabled: false },
  // Размер цели нажатия (WCAG 2.2): getBoundingClientRect в jsdom — нули.
  'target-size': { enabled: false },
  // Страничные правила: тест рендерит фрагмент экрана в пустой документ, а не
  // страницу. За <html lang>, <title> и единственный <main> отвечает
  // apps/web/index.html и его проверяет сборка web, а не тест компонента.
  'html-has-lang': { enabled: false },
  'html-lang-valid': { enabled: false },
  'html-xml-lang-mismatch': { enabled: false },
  'document-title': { enabled: false },
  'landmark-one-main': { enabled: false },
  'page-has-heading-one': { enabled: false },
  'bypass': { enabled: false },
  // «Весь контент — внутри ориентира»: у фрагмента экрана ориентиров нет по
  // построению. Для целого приложения правило включается обратно — точечно, в
  // App.dom.test.tsx («сайдбар, чат и композер»): там оно как раз к месту.
  'region': { enabled: false }
}

export interface A11yOptions {
  /**
   * Точечное включение/выключение правил для одного вызова. Каждое выключение —
   * с комментарием, почему нарушение неисправимо именно здесь.
   */
  rules?: RuleObject
  /** Наборы правил. По умолчанию — WCAG 2.1 A/AA плюс лучшие практики axe. */
  tags?: string[]
}

/** WCAG 2.1 A + AA и рекомендации axe: то, за что отвечает разметка. */
export const DEFAULT_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

function runOptions({ rules, tags = DEFAULT_TAGS }: A11yOptions = {}): RunOptions {
  return {
    runOnly: { type: 'tag', values: tags },
    rules: { ...JSDOM_DISABLED_RULES, ...rules },
    // Нужны только нарушения: incomplete в jsdom почти целиком про цвет и
    // геометрию, а passes раздувает отчёт на тысячи узлов.
    resultTypes: ['violations'],
    elementRef: false
  }
}

/** Нарушения axe для узла (по умолчанию — весь документ: окна уходят порталом). */
export async function runAxe(container: ElementContext = document.body, options: A11yOptions = {}): Promise<Result[]> {
  const result = await axe.run(container, runOptions(options))
  return result.violations
}

/** Отчёт для сообщения об ошибке: правило, важность, узлы и как починить. */
export function formatViolations(violations: Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 4)
        .map((n) => `      ${n.html}\n        ${n.failureSummary?.replace(/\n/g, '\n        ') ?? ''}`)
        .join('\n')
      const more = v.nodes.length > 4 ? `\n      …и ещё ${v.nodes.length - 4} узл(ов)` : ''
      return `  [${v.impact ?? 'n/a'}] ${v.id}: ${v.help}\n${nodes}${more}\n      ${v.helpUrl}`
    })
    .join('\n')
}

/** Ни одного нарушения axe. Основной вызов для dom-тестов экранов. */
export async function expectNoViolations(container: ElementContext = document.body, options: A11yOptions = {}): Promise<void> {
  const violations = await runAxe(container, options)
  if (violations.length > 0) {
    throw new Error(`axe нашёл ${violations.length} нарушени(я):\n${formatViolations(violations)}`)
  }
}

/**
 * Только серьёзные нарушения (serious/critical). Порог прогона сториз: витрина
 * показывает и заведомо неполные состояния (одна карточка без списка вокруг),
 * где придирки уровня minor/moderate относятся к обвязке сториз, а не к
 * компоненту. Экраны в dom-тестах проверяются без поблажек — expectNoViolations.
 */
export async function expectNoCriticalViolations(
  container: ElementContext = document.body,
  options: A11yOptions = {}
): Promise<void> {
  const violations = (await runAxe(container, options)).filter(
    (v) => v.impact === 'serious' || v.impact === 'critical'
  )
  if (violations.length > 0) {
    throw new Error(`axe нашёл ${violations.length} серьёзн(ых) нарушени(я):\n${formatViolations(violations)}`)
  }
}

// ---- Правило проекта: кнопка без видимой подписи ⇒ aria-label + title ----

/**
 * Видимый текст кнопки без иконок: слот иконки (`.vc-btn__ico`), `svg` и всё
 * `aria-hidden` не считаются подписью. Так «кнопка-загадка» отличается от
 * обычной: у `IconButton` глиф уезжает в `iconLeft`, то есть в `.vc-btn__ico`.
 */
function visibleLabel(button: HTMLElement): string {
  const clone = button.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.vc-btn__ico, svg, [aria-hidden="true"]').forEach((node) => node.remove())
  const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
  // Текст из одних символов (✕, ⋯, ▸) — тоже иконка, а не подпись: скринридер
  // прочитает её как «галочка» или промолчит.
  return /[\p{L}\p{N}]/u.test(text) ? text : ''
}

export interface IconButtonProblem {
  html: string
  missing: string[]
}

/**
 * Кнопки без видимой подписи, у которых нет `aria-label` **и** `title`.
 * `aria-labelledby` тоже считается именем для скринридера — тогда не хватает
 * только тултипа.
 */
export function iconButtonProblems(root: ParentNode = document.body): IconButtonProblem[] {
  const out: IconButtonProblem[] = []
  for (const button of root.querySelectorAll<HTMLElement>('button')) {
    if (visibleLabel(button) !== '') continue
    const missing: string[] = []
    const named = button.getAttribute('aria-label')?.trim() || button.getAttribute('aria-labelledby')?.trim()
    if (!named) missing.push('aria-label')
    if (!button.getAttribute('title')?.trim()) missing.push('title')
    if (missing.length > 0) out.push({ html: button.outerHTML.slice(0, 200), missing })
  }
  return out
}

/**
 * Правило packages/ui/AGENTS.md исполняемым: у кнопки без видимой подписи есть и
 * `aria-label` (скринридер), и `title` (тултип мышью). Одного мало — браузер
 * `aria-label` не показывает, а `title` не всегда читает скринридер.
 */
export function expectLabelledIconButtons(root: ParentNode = document.body): void {
  const problems = iconButtonProblems(root)
  if (problems.length > 0) {
    const list = problems.map((p) => `  нет ${p.missing.join(' и ')}: ${p.html}`).join('\n')
    throw new Error(`Кнопк(и) без видимой подписи и без обязательных атрибутов:\n${list}`)
  }
}

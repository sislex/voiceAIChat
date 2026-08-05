// Чтение дизайн-токенов прямо из подключённого app.css — витрина Foundations
// не хранит палитру в TS: продублируй её здесь, и через месяц сториз покажет
// цвета, которых в приложении уже нет. Имена берём из правил `:root` и
// `[data-theme='dark']`, значения — с невидимых зондов, поэтому в таблицу
// попадает ровно то, что видит браузер (включая `var()`-ссылки вроде
// `--danger: var(--ci-removed)`).

/** Что за пара: обычный текст (1.4.3), граница/заливка элемента (1.4.11) или декор. */
export type ContrastKind = 'text' | 'ui' | 'decor'

/** Порог AA по виду пары. Декоративное не оценивается — показывается справочно. */
export const AA_THRESHOLD: Record<ContrastKind, number> = { text: 4.5, ui: 3, decor: 0 }

export interface ContrastPair {
  fg: string
  bg: string
  usage: string
  kind?: ContrastKind
}

/**
 * Пары «цвет на цвете», которые реально встречаются в app.css: подпись на
 * кнопке, мета в сайдбаре, лозенг статуса на своей подложке.
 *
 * Список один и тот же для витрины Foundations (считает контраст в браузере) и
 * для `styles/contrast.test.ts` (считает по тексту app.css). Иначе цифра в
 * витрине и зелёный гейт разошлись бы: витрина показывает, тест не пускает.
 */
export const CONTRAST_PAIRS: ContrastPair[] = [
  { fg: '--text', bg: '--bg', usage: 'основной текст на полотне' },
  { fg: '--text', bg: '--surface', usage: 'текст в карточках, модалках, списках' },
  { fg: '--text', bg: '--panel', usage: 'текст в сайдбаре и шапках' },
  { fg: '--text-dim', bg: '--bg', usage: 'подписи и мета на полотне (.fsub)' },
  { fg: '--text-dim', bg: '--surface', usage: 'мета внутри карточки' },
  { fg: '--text-dim', bg: '--panel', usage: 'мета в сайдбаре (.cmeta)' },
  { fg: '--text-dim', bg: '--surface-hover', usage: 'подпись под курсором' },
  { fg: '--text-dim', bg: '--surface-selected', usage: 'мета выбранной беседы (.convo.on .cmeta)' },
  { fg: '--accent', bg: '--bg', usage: 'ссылки и активные подписи' },
  { fg: '--accent', bg: '--surface', usage: 'акцентная подпись в карточке' },
  { fg: '--accent', bg: '--accent-soft', usage: 'акцент на своей подложке (чипы, вкладки)' },
  { fg: '--accent-fg', bg: '--accent', usage: 'подпись на кнопке primary' },
  { fg: '--danger-fg', bg: '--danger', usage: 'подпись на кнопке danger' },
  { fg: '--danger', bg: '--surface', usage: 'тихий danger: крестик «удалить»' },
  { fg: '--text', bg: '--surface-danger', usage: 'предупреждение перед удалением (машина в таблице)' },
  { fg: '--ci-neutral', bg: '--ci-neutral-bg', usage: 'лозенг «в очереди» / «пропущен», 11px' },
  { fg: '--ci-progress', bg: '--ci-progress-bg', usage: 'лозенг «выполняется» / «ждёт ответа»' },
  { fg: '--ci-success', bg: '--ci-success-bg', usage: 'лозенг «успех»' },
  { fg: '--ci-removed', bg: '--ci-removed-bg', usage: 'лозенг «ошибка» / «отменён»' },
  { fg: '--ci-success', bg: '--bg', usage: 'зелёная рамка выполненной карточки', kind: 'ui' },
  { fg: '--border', bg: '--bg', usage: 'рамка панели на полотне', kind: 'ui' },
  { fg: '--border', bg: '--surface', usage: 'рамка поля ввода в карточке', kind: 'ui' },
  { fg: '--border-soft', bg: '--surface', usage: 'разделитель строк в таблицах — декоративный', kind: 'decor' }
]

export type ThemeName = 'light' | 'dark'

/** Токен: имя, значения в обеих темах и признак «тёмная тема переопределяет». */
export interface Token {
  name: string
  light: string
  dark: string
  /** Объявлен ли токен в `[data-theme='dark']` или тёмная тема наследует светлое значение. */
  darkOverride: boolean
  /** Цветовой ли токен (остальные — отступы и радиусы: контраст к ним не применим). */
  isColor: boolean
}

const ROOT_SELECTOR = ':root'
const DARK_SELECTOR = '[data-theme=dark]'

/** Селектор без кавычек и пробелов: браузеры печатают `[data-theme='dark']` по-разному. */
function normalizeSelector(selector: string): string {
  return selector.replace(/['"]/g, '').replace(/\s+/g, '')
}

/** Кастомные свойства правила в порядке объявления. */
function customProps(rule: CSSStyleRule): string[] {
  const names: string[] = []
  for (let i = 0; i < rule.style.length; i++) {
    const prop = rule.style.item(i)
    if (prop.startsWith('--')) names.push(prop)
  }
  return names
}

interface Declared {
  /** Порядок объявления: сначала `:root`, потом добавки тёмной темы. */
  order: string[]
  dark: Set<string>
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return typeof (rule as CSSStyleRule).selectorText === 'string'
}

/**
 * Все обычные правила из подключённых стилей, включая вложенные в @media и
 * @supports. Правило может быть и обычным, и группирующим (в новых движках
 * CSSStyleRule сам умеет вложенные правила), поэтому сначала забираем правило и
 * только потом спускаемся внутрь.
 */
export function styleRules(doc: Document = document): CSSStyleRule[] {
  const out: CSSStyleRule[] = []
  const walk = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (isStyleRule(rule)) out.push(rule)
      const nested = (rule as CSSGroupingRule).cssRules
      if (nested && nested.length > 0) walk(nested)
    }
  }
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules)
    } catch {
      // Стиль с другого источника читать нельзя, а своих правил там нет.
    }
  }
  return out
}

/** Где токен применяется: сколько правил ссылаются на `var(--имя)` и какие. */
export function varUsage(name: string, doc: Document = document): { count: number; selectors: string[] } {
  const needle = `var(${name}`
  const selectors: string[] = []
  let count = 0
  for (const rule of styleRules(doc)) {
    if (!rule.style.cssText.includes(needle)) continue
    count += 1
    if (selectors.length < 6) selectors.push(rule.selectorText)
  }
  return { count, selectors }
}

/** Обход подключённых стилей: какие токены объявлены и где. */
function declaredTokens(doc: Document): Declared {
  const order: string[] = []
  const seen = new Set<string>()
  const dark = new Set<string>()
  const push = (name: string): void => {
    if (seen.has(name)) return
    seen.add(name)
    order.push(name)
  }
  for (const rule of styleRules(doc)) {
    const selector = normalizeSelector(rule.selectorText)
    if (selector === ROOT_SELECTOR) customProps(rule).forEach(push)
    else if (selector === DARK_SELECTOR)
      for (const name of customProps(rule)) {
        dark.add(name)
        push(name)
      }
  }
  return { order, dark }
}

/** Невидимый зонд с нужной темой: с него снимаются вычисленные значения. */
function probe(doc: Document, theme: ThemeName): HTMLElement {
  const el = doc.createElement('div')
  el.dataset.theme = theme
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none'
  doc.body.appendChild(el)
  return el
}

/** Цвет ли это значение — спрашиваем браузер, а не свой список форматов. */
export function isColorValue(value: string): boolean {
  return value.length > 0 && CSS.supports('color', value)
}

/** Все токены обеих тем с вычисленными значениями. Вызывать после монтирования. */
export function readTokens(doc: Document = document): Token[] {
  const { order, dark } = declaredTokens(doc)
  const lightEl = probe(doc, 'light')
  const darkEl = probe(doc, 'dark')
  try {
    const lightStyle = getComputedStyle(lightEl)
    const darkStyle = getComputedStyle(darkEl)
    return order.map((name) => {
      const light = lightStyle.getPropertyValue(name).trim()
      return {
        name,
        light,
        dark: darkStyle.getPropertyValue(name).trim(),
        darkOverride: dark.has(name),
        isColor: isColorValue(light)
      }
    })
  } finally {
    lightEl.remove()
    darkEl.remove()
  }
}

export type Rgb = readonly [number, number, number]

/**
 * Вычисленный цвет из `getComputedStyle` → каналы 0…255. Хром отдаёт
 * `rgb(r, g, b)` / `rgba(…)`, а для широких пространств — `color(srgb 0…1 …)`,
 * поэтому разбираем оба вида.
 */
export function parseCssColor(computed: string): Rgb | null {
  const nums = computed.match(/-?[\d.]+(?:e[+-]?\d+)?%?/gi)
  if (!nums || nums.length < 3) return null
  const srgbUnit = /^color\(\s*srgb/i.test(computed)
  const channel = (raw: string): number => {
    const n = Number.parseFloat(raw)
    if (!Number.isFinite(n)) return 0
    const v = raw.endsWith('%') ? (n / 100) * 255 : srgbUnit ? n * 255 : n
    return Math.min(255, Math.max(0, v))
  }
  return [channel(nums[0]), channel(nums[1]), channel(nums[2])]
}

/**
 * Значение токена → sRGB. Разбирает сам браузер: hex, rgb(), color-mix() — всё
 * равно. Тема нужна на случай, когда значение осталось ссылкой `var(--другой)`:
 * зонд должен стоять в той же теме, иначе тёмный токен посчитается по светлому.
 */
export function resolveColor(value: string, theme: ThemeName = 'light', doc: Document = document): Rgb | null {
  if (!isColorValue(value)) return null
  const el = probe(doc, theme)
  try {
    el.style.color = value
    return parseCssColor(getComputedStyle(el).color)
  } finally {
    el.remove()
  }
}

/** Относительная яркость по WCAG 2.1 (relative luminance). */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Коэффициент контраста двух цветов: от 1 (одинаковые) до 21 (чёрный на белом). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export type WcagLevel = 'AAA' | 'AA' | 'AA Large' | 'fail'

/**
 * Вердикт WCAG 2.1 для пары «текст на фоне». Порог зависит от кегля: крупный
 * текст (≥ 24px, либо ≥ 18.66px полужирным) проходит AA уже на 3:1 — в нашем
 * интерфейсе это заголовки, а мелкие лозенги 11px обязаны брать 4.5:1.
 */
export function wcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'AA Large'
  return 'fail'
}

/** Два знака после запятой, как в отчётах axe: «4.53 : 1». */
export function fmtRatio(ratio: number): string {
  return `${ratio.toFixed(2)} : 1`
}

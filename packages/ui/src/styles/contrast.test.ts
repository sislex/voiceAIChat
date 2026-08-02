// Контраст токенов темы: гейт, а не показания витрины.
//
// Витрина Foundations считает те же пары в браузере и показывает цифру; этот
// тест считает их по тексту app.css и **не пускает** пару ниже AA. Список пар
// общий (`CONTRAST_PAIRS` в stories/foundations/tokens.ts) — иначе в витрине
// висело бы «ниже AA», а гейт был бы зелёным.
//
// Почему по тексту файла, а не через getComputedStyle: в jsdom нет ни движка
// каскада, ни вычисления var() — значения токенов пришлось бы захардкодить в
// тесте, и он проверял бы сам себя. Разбор здесь простой ровно настолько,
// насколько прост наш блок токенов: hex-литералы и ссылки var(--другой).

// @vitest-environment node
// DOM здесь не нужен: считаем по тексту файла. В node-окружении import.meta.url
// — обычный file://-адрес, и app.css читается рядом с этим тестом.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  AA_THRESHOLD,
  contrastRatio,
  CONTRAST_PAIRS,
  fmtRatio,
  type ContrastPair,
  type Rgb,
  type ThemeName
} from '../stories/foundations/tokens'
const css = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf8')

/** Кастомные свойства одного правила: `--имя: значение;` до первой `}`. */
function customProps(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`в app.css нет правила ${selector}`)
  const body = css.slice(start + selector.length + 2, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const m = /^\s*(--[\w-]+)\s*:\s*([^;]+);/.exec(line)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

const LIGHT = customProps(':root')
const DARK = { ...LIGHT, ...customProps("[data-theme='dark']") }
const THEMES: Record<ThemeName, Record<string, string>> = { light: LIGHT, dark: DARK }

/** `var(--другой)` — ссылка внутри той же темы (например `--danger: var(--ci-removed)`). */
function resolve(value: string, theme: Record<string, string>, depth = 0): string {
  const m = /^var\((--[\w-]+)\)$/.exec(value.trim())
  if (!m || depth > 4) return value.trim()
  const next = theme[m[1]]
  if (next === undefined) throw new Error(`токен ${m[1]} не объявлен`)
  return resolve(next, theme, depth + 1)
}

/** `#abc` / `#aabbcc` → каналы. Другие форматы в блоке токенов не используются. */
function hexToRgb(value: string): Rgb {
  const short = /^#([0-9a-f]{3})$/i.exec(value)
  if (short) return [...short[1]].map((c) => Number.parseInt(c + c, 16)) as unknown as Rgb
  const long = /^#([0-9a-f]{6})$/i.exec(value)
  if (!long) throw new Error(`не hex-цвет: ${value}`)
  return [0, 2, 4].map((i) => Number.parseInt(long[1].slice(i, i + 2), 16)) as unknown as Rgb
}

function ratioOf(pair: ContrastPair, name: ThemeName): number {
  const theme = THEMES[name]
  const fg = theme[pair.fg]
  const bg = theme[pair.bg]
  if (fg === undefined) throw new Error(`токен ${pair.fg} не объявлен`)
  if (bg === undefined) throw new Error(`токен ${pair.bg} не объявлен`)
  return contrastRatio(hexToRgb(resolve(fg, theme)), hexToRgb(resolve(bg, theme)))
}

const themes: ThemeName[] = ['light', 'dark']

describe('контраст токенов', () => {
  // Гейтим текстовые пары (WCAG 1.4.3). Пары kind: 'ui' (рамки) и 'decor'
  // (разделители) остаются в витрине справочно: наши хайрлайны --border/
  // --border-soft дают ~1.2:1 и подтянуть их до 3:1 — это смена всего
  // визуального языка, отдельная задача. Границы **элементов управления** мы
  // обозначаем заливкой и подписью, а не толщиной линии, поэтому 1.4.11 на
  // хайрлайнах не завязан.
  const textPairs = CONTRAST_PAIRS.filter((pair) => (pair.kind ?? 'text') === 'text')

  it.each(themes)('в %s теме все текстовые пары проходят AA', (theme) => {
    const failing = textPairs
      .map((pair) => ({ pair, ratio: ratioOf(pair, theme) }))
      .filter(({ ratio }) => ratio < AA_THRESHOLD.text)
      .map(({ pair, ratio }) => `${pair.fg} на ${pair.bg} — ${fmtRatio(ratio)} (${pair.usage})`)
    expect(failing).toEqual([])
  })

  it('приглушённый текст читаем на всех подложках, где он встречается', () => {
    // Отдельно от общего прогона: именно эта пара была ниже AA (2.7:1 на
    // выбранной беседе), и правило «--text-dim обязан брать 4.5:1» должно
    // падать точечно, а не в списке из двадцати пар.
    for (const theme of themes) {
      for (const bg of ['--bg', '--panel', '--surface', '--surface-hover', '--surface-selected']) {
        const ratio = ratioOf({ fg: '--text-dim', bg, usage: '' }, theme)
        expect(ratio, `--text-dim на ${bg} (${theme}) — ${fmtRatio(ratio)}`).toBeGreaterThanOrEqual(AA_THRESHOLD.text)
      }
    }
  })

  it('обе темы объявляют один набор токенов', () => {
    // Тёмная тема наследует :root, но пара «цвет и его подложка» должна
    // переопределяться целиком: иначе светлый фон останется под тёмным текстом.
    const darkOnly = Object.keys(customProps("[data-theme='dark']")).filter((name) => !(name in LIGHT))
    expect(darkOnly).toEqual([])
  })
})

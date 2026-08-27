// Тёмная тема одной кнопкой (roadmap-4 п.27): из светлых цветовых токенов выводим значения для `[data-theme=dark]`.
// Фоны темнеют, текст светлеет, акценты слегка осветляются — простое HSL-преобразование без дизайнерских правок.
import { parseColor } from './wcagContrast'

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  h /= 6
  return [h, s, l]
}

function hslToHex([h, s, l]: [number, number, number]): string {
  const f = (n: number): number => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)) }
  const hex = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}

const BG = /(^|-)(bg|background|surface|card|panel|paper|canvas)(-|$)/i
const FG = /(^|-)(fg|text|foreground|ink|muted)(-|$)/i
const LINE = /(^|-)(border|line|divider|outline)(-|$)/i

/** Тёмное значение для одного токена; `null`, если это не цвет. */
export function darkValueFor(name: string, value: string): string | null {
  const rgb = parseColor(value)
  if (!rgb) return null
  const [h, s, l] = rgbToHsl(rgb)
  const n = name.replace(/^--/, '')
  if (BG.test(n)) return hslToHex([h, Math.min(s, 0.25), l > 0.9 ? 0.08 + (1 - l) * 0.5 : Math.max(0.06, 0.28 - l * 0.2)])
  if (FG.test(n)) return hslToHex([h, Math.min(s, 0.2), l < 0.5 ? 0.92 - l * 0.2 : Math.max(0.6, 1 - l)])
  if (LINE.test(n)) return hslToHex([h, Math.min(s, 0.2), 0.22])
  // Акценты: чуть светлее и менее насыщенно, чтобы не «горели» на тёмном.
  return hslToHex([h, Math.max(0, s - 0.08), Math.min(0.72, l + 0.1)])
}

/** Блок `[data-theme=dark] { … }` для файла токенов; уже существующий блок заменяется. */
export function buildDarkThemeBlock(tokens: Array<{ name: string; value: string }>): string {
  const lines = tokens.map((t) => { const v = darkValueFor(t.name, t.value); return v ? `  ${t.name}: ${v};` : null }).filter(Boolean) as string[]
  return `[data-theme=dark] {\n${lines.join('\n')}\n}`
}

export function applyDarkThemeBlock(css: string, block: string): string {
  const re = /\n?\[data-theme=dark\]\s*\{[^}]*\}\n?/
  const marked = `\n\n/* Тёмная тема — сгенерирована из светлых токенов; правьте значения по вкусу */\n${block}\n`
  if (re.test(css)) return css.replace(re, '\n' + block + '\n')
  return css.replace(/\s*$/, '') + marked
}

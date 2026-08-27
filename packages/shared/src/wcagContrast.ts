// Контраст пар цветовых токенов по WCAG 2.x (roadmap-4 п.25): относительная яркость и коэффициент контраста.
// Разбираем #rgb/#rrggbb/#rrggbbaa и rgb()/rgba(); остальное (var(), hsl, имена) — не считаем.

export interface ContrastPair { fg: string; bg: string; ratio: number; aa: boolean; aaLarge: boolean; aaa: boolean }

export function parseColor(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)
  if (hex) {
    let h = hex[1]!
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('')
    if (h.length === 8) h = h.slice(0, 6)
    if (h.length !== 6) return null
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/.exec(v)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Коэффициент контраста 1..21; `null`, если один из цветов не разобрать. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseColor(a), cb = parseColor(b)
  if (!ca || !cb) return null
  const la = relativeLuminance(ca), lb = relativeLuminance(cb)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

const BG = /(^|-)(bg|background|surface|card|panel|paper|canvas)(-|$)/i
const FG = /(^|-)(fg|text|foreground|ink|accent|primary|link|muted|secondary|danger|success|warning)(-|$)/i

/** Пары «текст/акцент на фоне» из токенов `:root`: имена классифицируются по словам bg/surface/card и fg/text/accent…. */
export function contrastPairs(tokens: Array<{ name: string; value: string }>): ContrastPair[] {
  const colors = tokens.filter((t) => parseColor(t.value))
  const bgs = colors.filter((t) => BG.test(t.name.replace(/^--/, '')))
  const fgs = colors.filter((t) => FG.test(t.name.replace(/^--/, '')) && !BG.test(t.name.replace(/^--/, '')))
  const out: ContrastPair[] = []
  for (const fg of fgs) for (const bg of bgs) {
    const ratio = contrastRatio(fg.value, bg.value)
    if (ratio === null) continue
    out.push({ fg: fg.name, bg: bg.name, ratio, aa: ratio >= 4.5, aaLarge: ratio >= 3, aaa: ratio >= 7 })
  }
  return out.sort((x, y) => x.ratio - y.ratio)
}

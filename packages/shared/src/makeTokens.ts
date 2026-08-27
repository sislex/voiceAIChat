// Дизайн-токены проекта Make (п.23): CSS-переменные из блока `:root { … }`.
// Модуль чистый — парсит и правит текст CSS, не зная ни о файлах, ни о мостах.
// Правим точечно (regex по объявлению), а не пересобираем файл: комментарии,
// порядок и форматирование пользователя остаются как были.

export type MakeTokenKind = 'color' | 'size' | 'font' | 'other'

export interface MakeCssToken {
  name: string
  value: string
  kind: MakeTokenKind
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|color-mix\(|transparent$|currentcolor$|[a-z]+$)/i
const SIZE_RE = /^-?\d*\.?\d+(px|rem|em|%|vh|vw|ch|pt)?$|^clamp\(|^calc\(/i
const FONT_RE = /font|serif|sans|mono|system-ui/i
const NAMED_COLORS = new Set(['white', 'black', 'red', 'blue', 'green', 'gray', 'grey', 'orange', 'yellow', 'purple', 'pink', 'teal', 'navy', 'transparent', 'currentcolor'])

export function classifyToken(name: string, value: string): MakeTokenKind {
  const v = value.trim()
  if (/^#[0-9a-f]{3,8}$/i.test(v) || /^(rgba?|hsla?|oklch|color-mix)\(/i.test(v) || NAMED_COLORS.has(v.toLowerCase())) return 'color'
  if (FONT_RE.test(name) || (FONT_RE.test(v) && !COLOR_RE.test(v))) return 'font'
  if (SIZE_RE.test(v)) return 'size'
  return 'other'
}

/** Все `--имя: значение` внутри блоков `:root { … }` (первое объявление выигрывает, как в CSS — последнее; берём последнее). */
export function parseCssTokens(css: string): MakeCssToken[] {
  const out = new Map<string, MakeCssToken>()
  const rootRe = /:root\s*\{([^}]*)\}/g
  let block: RegExpExecArray | null
  while ((block = rootRe.exec(css))) {
    const body = block[1]!.replace(/\/\*[\s\S]*?\*\//g, '')
    const declRe = /(--[\w-]+)\s*:\s*([^;]+);?/g
    let decl: RegExpExecArray | null
    while ((decl = declRe.exec(body))) {
      const name = decl[1]!
      const value = decl[2]!.trim()
      out.set(name, { name, value, kind: classifyToken(name, value) })
    }
  }
  return [...out.values()]
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Меняет значение токена во всех `:root`-объявлениях; если токена нет — добавляет в первый `:root` (или создаёт блок). */
export function setCssToken(css: string, name: string, value: string): string {
  const re = new RegExp(`(${escapeRe(name)}\\s*:\\s*)[^;}]+`, 'g')
  if (re.test(css)) return css.replace(re, `$1${value.trim()}`)
  const rootIdx = css.search(/:root\s*\{/)
  if (rootIdx < 0) return `:root {\n  ${name}: ${value.trim()};\n}\n${css ? '\n' + css : ''}`
  const open = css.indexOf('{', rootIdx)
  return `${css.slice(0, open + 1)}\n  ${name}: ${value.trim()};${css.slice(open + 1)}`
}

/** Удаляет объявление токена из всех `:root`. */
export function removeCssToken(css: string, name: string): string {
  return css.replace(new RegExp(`\\n?[ \\t]*${escapeRe(name)}\\s*:\\s*[^;}]+;?`, 'g'), '')
}

/** Файл, где живут токены: отдельный tokens.css, иначе styles.css. */
export function pickTokensFile(paths: readonly string[]): string | null {
  if (paths.includes('tokens.css')) return 'tokens.css'
  if (paths.includes('styles.css')) return 'styles.css'
  return paths.find((p) => /\.css$/i.test(p)) ?? null
}

export const MAKE_TOKENS_STARTER = `/* Дизайн-токены проекта: меняй здесь — подхватят все компоненты. */
:root {
  --bg: #f6f7fb;
  --fg: #1a1d23;
  --muted: #6b7280;
  --accent: #4f7cff;
  --accent-fg: #ffffff;
  --card: #ffffff;
  --line: #e5e7eb;
  --radius: 12px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
`

// Импорт токенов из Figma (roadmap-4 п.26): поддерживаем три распространённых формата JSON —
// экспорт Figma Variables (REST `variables` + `modes`), Tokens Studio / W3C design tokens (`{ value, type }`
// с вложенными группами) и плоскую карту `{ "--имя": "значение" }`. Результат — пары для `setCssToken`.

export interface ImportedToken { name: string; value: string }

function toCssName(path: string[]): string {
  const slug = path.join('-').replace(/[\s/._]+/g, '-').replace(/[^A-Za-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return `--${slug}`
}

function figmaColor(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null
  const c = v as { r?: number; g?: number; b?: number; a?: number }
  if (typeof c.r !== 'number' || typeof c.g !== 'number' || typeof c.b !== 'number') return null
  const hex = (n: number): string => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0')
  const a = typeof c.a === 'number' && c.a < 1 ? hex(c.a) : ''
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}${a}`
}

function valueToCss(value: unknown, type?: string): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return /size|spacing|radius|dimension|number|float/i.test(type ?? '') ? `${value}px` : String(value)
  if (typeof value === 'boolean') return null
  return figmaColor(value)
}

/** Разбор JSON; неизвестная структура — пустой список, невалидный JSON — исключение SyntaxError. */
export function parseFigmaTokens(json: string, options: { mode?: string } = {}): ImportedToken[] {
  const data = JSON.parse(json) as unknown
  if (!data || typeof data !== 'object') return []
  const root = data as Record<string, unknown>
  const out = new Map<string, string>()
  // 1. Figma Variables API: { variables: { id: { name, resolvedType, valuesByMode: { modeId: value } } }, modes?: { modeId: name } }
  const vars = (root.variables ?? (root.meta as { variables?: unknown } | undefined)?.variables) as Record<string, { name?: string; resolvedType?: string; valuesByMode?: Record<string, unknown> }> | undefined
  if (vars && typeof vars === 'object') {
    const modes = ((root.modes ?? (root.meta as { variableModes?: unknown } | undefined)?.variableModes) as Record<string, string> | undefined) ?? {}
    const wantedMode = options.mode ? Object.keys(modes).find((id) => modes[id] === options.mode) : undefined
    for (const v of Object.values(vars)) {
      if (!v || typeof v !== 'object' || !v.name || !v.valuesByMode) continue
      const modeIds = Object.keys(v.valuesByMode)
      const modeId = wantedMode && v.valuesByMode[wantedMode] !== undefined ? wantedMode : modeIds[0]
      if (!modeId) continue
      const raw = v.valuesByMode[modeId]
      if (raw && typeof raw === 'object' && 'type' in (raw as object) && (raw as { type?: string }).type === 'VARIABLE_ALIAS') continue
      const css = valueToCss(raw, v.resolvedType)
      if (css) out.set(toCssName(v.name.split('/')), css)
    }
    return [...out].map(([name, value]) => ({ name, value }))
  }
  // 2. Tokens Studio / W3C: вложенные группы, лист — { value | $value, type | $type }
  const walk = (node: unknown, path: string[]): void => {
    if (!node || typeof node !== 'object') return
    const o = node as Record<string, unknown>
    const leafValue = o.$value ?? o.value
    if (leafValue !== undefined && path.length) {
      const type = (o.$type ?? o.type) as string | undefined
      const css = valueToCss(leafValue, type)
      if (css && !/^\{.*\}$/.test(css)) out.set(toCssName(path), css)
      return
    }
    for (const [k, v] of Object.entries(o)) if (!k.startsWith('$')) walk(v, [...path, k])
  }
  const isFlat = Object.values(root).every((v) => typeof v === 'string' || typeof v === 'number')
  if (isFlat) {
    for (const [k, v] of Object.entries(root)) { const css = valueToCss(v); if (css) out.set(k.startsWith('--') ? k : toCssName([k]), css) }
  } else walk(root, [])
  return [...out].map(([name, value]) => ({ name, value }))
}

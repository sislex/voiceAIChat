/** Browser AX evidence has a different source from a DOM-derived ARIA snapshot. */
export interface PreviewAccessibilityOptions { selector: string }

export const ACCESSIBILITY_PROPERTIES = [
  'busy', 'disabled', 'editable', 'focusable', 'focused', 'hidden', 'invalid',
  'keyshortcuts', 'settable', 'roledescription', 'live', 'atomic', 'relevant',
  'autocomplete', 'hasPopup', 'level', 'multiselectable', 'orientation', 'multiline',
  'readonly', 'required', 'valuemin', 'valuemax', 'checked', 'expanded', 'modal',
  'pressed', 'selected', 'activedescendant', 'controls', 'describedby', 'details',
  'errormessage', 'flowto', 'labelledby', 'owns'
] as const
export type AccessibilityPropertyName = typeof ACCESSIBILITY_PROPERTIES[number]
export interface AccessibilityRelatedElement { selector?: string; idref?: string }
export interface AccessibilityProperty {
  name: AccessibilityPropertyName
  value?: string | number | boolean
  related?: AccessibilityRelatedElement[]
}
export interface AccessibilityNameSource {
  type: string
  attribute?: string
  nativeSource?: string
  superseded?: boolean
  invalid?: boolean
  related?: AccessibilityRelatedElement[]
}
export interface PreviewAccessibilityResult {
  page: { url: string; title: string }
  accessibility: {
    version: 1
    surface: 'chromium'
    source: 'chromium-accessibility'
    selector: string
    node: {
      role?: string
      name?: string
      description?: string
      ignored: boolean
      properties: AccessibilityProperty[]
      nameSources: AccessibilityNameSource[]
      ignoredReasons: Array<{ reason: string; related?: AccessibilityRelatedElement[] }>
    }
    truncated: boolean
    elapsedMs: number
    limitations: string[]
  }
}
export const PREVIEW_ACCESSIBILITY_LIMITS = {
  selector: 1000, relatedSelector: 500, idref: 200, text: 1000, scalarText: 300,
  properties: 40, sources: 12, related: 24, reasons: 16, resultJson: 26000,
  timeoutMs: 5000
} as const

export function isPreviewAccessibilityOptions(value: unknown): value is PreviewAccessibilityOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return typeof v.selector === 'string' && v.selector.trim().length > 0 &&
    v.selector.length <= PREVIEW_ACCESSIBILITY_LIMITS.selector && v.frame === undefined && v.code === undefined
}

/** Strict projection prevents old or malformed runners from leaking raw AX values. */
export function isPreviewAccessibilityResult(value: unknown): value is PreviewAccessibilityResult {
  const L = PREVIEW_ACCESSIBILITY_LIMITS
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(key => allowed.includes(key))
  const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
  const optionalText = (v: unknown, max: number) => v === undefined || text(v, max)
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const bool = (v: unknown) => typeof v === 'boolean'
  const list = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max
  let relatedCount = 0
  const related = (v: unknown) => v === undefined || list(v, L.related) && v.every(item => {
    relatedCount++
    return record(item) && keys(item, ['selector', 'idref']) &&
      optionalText(item.selector, L.relatedSelector) && optionalText(item.idref, L.idref) &&
      (typeof item.selector === 'string' && item.selector.length > 0 || typeof item.idref === 'string' && item.idref.length > 0)
  })
  if (!record(value) || !keys(value, ['page', 'accessibility']) || !record(value.page) ||
    !keys(value.page, ['url', 'title']) || !text(value.page.url, 4096) || !text(value.page.title, 300) || !record(value.accessibility)) return false
  const a = value.accessibility, n = a.node
  if (!keys(a, ['version', 'surface', 'source', 'selector', 'node', 'truncated', 'elapsedMs', 'limitations']) ||
    a.version !== 1 || a.surface !== 'chromium' || a.source !== 'chromium-accessibility' ||
    !isPreviewAccessibilityOptions(a) || !record(n) ||
    !keys(n, ['role', 'name', 'description', 'ignored', 'properties', 'nameSources', 'ignoredReasons']) ||
    !optionalText(n.role, 80) || !optionalText(n.name, L.text) || !optionalText(n.description, L.text) || !bool(n.ignored)) return false
  if (!list(n.properties, L.properties) || !n.properties.every(p => record(p) && keys(p, ['name', 'value', 'related']) &&
    typeof p.name === 'string' && (ACCESSIBILITY_PROPERTIES as readonly string[]).includes(p.name) &&
    (p.value === undefined || bool(p.value) || finite(p.value) || text(p.value, L.scalarText)) && related(p.related) &&
    (p.value !== undefined || Array.isArray(p.related) && p.related.length > 0)) ||
    new Set(n.properties.map(p => (p as Record<string, unknown>).name)).size !== n.properties.length) return false
  if (!list(n.nameSources, L.sources) || !n.nameSources.every(s => record(s) &&
    keys(s, ['type', 'attribute', 'nativeSource', 'superseded', 'invalid', 'related']) && text(s.type, 80) &&
    optionalText(s.attribute, 80) && optionalText(s.nativeSource, 80) &&
    (s.superseded === undefined || bool(s.superseded)) && (s.invalid === undefined || bool(s.invalid)) && related(s.related))) return false
  if (!list(n.ignoredReasons, L.reasons) || !n.ignoredReasons.every(r => record(r) && keys(r, ['reason', 'related']) &&
    text(r.reason, 80) && related(r.related)) || relatedCount > L.related ||
    !bool(a.truncated) || !finite(a.elapsedMs) || a.elapsedMs < 0 || !list(a.limitations, 30) ||
    !a.limitations.every(item => text(item, 500))) return false
  try { return JSON.stringify(value).length <= L.resultJson } catch { return false }
}

/** Findings remain bounded observations, not a claim that an entire page passes QA. */
export interface PreviewAuditOptions {
  group?: string
  selector?: string
  rules?: string[]
  mode?: 'list' | 'run'
  offset?: number
  limit?: number
}

export interface PreviewAuditRule {
  id: string
  group: string
  title: string
  severity: 'info' | 'warning' | 'error'
  confidence: 'observed' | 'heuristic'
}

export interface PreviewAuditFinding extends PreviewAuditRule {
  selector: string
  evidence: string
}

export interface PreviewAuditResult {
  page: { url: string; title: string }
  audit: {
    version: 1
    group: string
    groups: string[]
    mode: 'list' | 'run'
    surface: 'proxy' | 'chromium'
    scope: string
    findings: PreviewAuditFinding[]
    rules: PreviewAuditRule[]
    total: number
    nextOffset?: number
    checkedRules: number
    scannedElements: number
    truncated: boolean
    elapsedMs: number
    limitations: string[]
  }
}

export const PREVIEW_AUDIT_LIMITS = {
  rules: 30, limit: 30, elements: 3000, findings: 500, selector: 1000,
  evidence: 300, id: 80
} as const

export function isPreviewAuditOptions(value: unknown): value is PreviewAuditOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  const id = (x: unknown): x is string => typeof x === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(x)
  const integer = (x: unknown, min: number, max: number) => x === undefined ||
    typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max
  return (v.group === undefined || id(v.group)) &&
    (v.selector === undefined || typeof v.selector === 'string' && v.selector.trim().length > 0 && v.selector.length <= PREVIEW_AUDIT_LIMITS.selector) &&
    (v.rules === undefined || Array.isArray(v.rules) && v.rules.length > 0 &&
      v.rules.length <= PREVIEW_AUDIT_LIMITS.rules && v.rules.every(id) && new Set(v.rules).size === v.rules.length) &&
    (v.mode === undefined || v.mode === 'list' || v.mode === 'run') &&
    integer(v.offset, 0, PREVIEW_AUDIT_LIMITS.findings) && integer(v.limit, 1, PREVIEW_AUDIT_LIMITS.limit)
}

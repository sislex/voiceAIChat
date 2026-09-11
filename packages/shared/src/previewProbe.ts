/** Pointer reachability and application readiness are deliberately separate observations. */
export interface PreviewProbeOptions {
  selector: string
}

export interface PreviewProbeResult {
  page: { url: string; title: string }
  probe: {
    version: 1
    surface: 'proxy' | 'chromium'
    selector: string
    tag: string
    visibility: {
      hasBox: boolean
      visibleByBrowser: boolean | null
      effectiveOpacity: number | null
      inViewport: boolean
      rectangles: Array<{ left: number; top: number; right: number; bottom: number }>
    }
    state: {
      nativeDisabled: boolean
      ariaDisabled: boolean
      inert: boolean | null
      nativeReadOnly: boolean
      ariaReadOnly: boolean
      ignoredReadOnly: boolean
      contentEditable: boolean
    }
    pointer: {
      status: 'no-box' | 'hidden' | 'offscreen' | 'reachable' | 'blocked' | 'unknown'
      points: Array<{ x: number; y: number; reachesTarget: boolean; hitIndex?: number }>
      hitTargets: Array<{ selector: string; tag: string }>
    }
    reasons: Array<{ code: string; selector?: string }>
    truncated: boolean
    elapsedMs: number
    limitations: string[]
  }
}

export const PREVIEW_PROBE_LIMITS = {
  selector: 1000, sourceSelector: 500, ancestors: 128, rectangles: 8,
  points: 40, hitTargets: 8, reasons: 30, modals: 16, resultJson: 26000
} as const

export function isPreviewProbeOptions(value: unknown): value is PreviewProbeOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const selector = (value as Record<string, unknown>).selector
  return typeof selector === 'string' && selector.trim().length > 0 && selector.length <= PREVIEW_PROBE_LIMITS.selector
}

/** Reject malformed or oversized runner reports instead of presenting them as verified state. */
export function isPreviewProbeResult(value: unknown): value is PreviewProbeResult {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const bool = (v: unknown) => typeof v === 'boolean'
  const list = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max
  if (!record(value) || !record(value.page) || !record(value.probe)) return false
  const p = value.probe, visibility = p.visibility, state = p.state, pointer = p.pointer
  if (!text(value.page.url, 4096) || !text(value.page.title, 300) || p.version !== 1 ||
    p.surface !== 'proxy' && p.surface !== 'chromium' || !isPreviewProbeOptions(p) || !text(p.tag, 80) ||
    !record(visibility) || !record(state) || !record(pointer)) return false
  if (!bool(visibility.hasBox) || !bool(visibility.inViewport) ||
    visibility.visibleByBrowser !== null && !bool(visibility.visibleByBrowser) ||
    visibility.effectiveOpacity !== null && (!finite(visibility.effectiveOpacity) || visibility.effectiveOpacity < 0 || visibility.effectiveOpacity > 1) ||
    !list(visibility.rectangles, PREVIEW_PROBE_LIMITS.rectangles) ||
    !visibility.rectangles.every(r => record(r) && ['left', 'top', 'right', 'bottom'].every(key => finite(r[key])))) return false
  if (!['nativeDisabled', 'ariaDisabled', 'nativeReadOnly', 'ariaReadOnly', 'ignoredReadOnly', 'contentEditable'].every(key => bool(state[key])) ||
    state.inert !== null && !bool(state.inert)) return false
  if (typeof pointer.status !== 'string' || !['no-box', 'hidden', 'offscreen', 'reachable', 'blocked', 'unknown'].includes(pointer.status) ||
    !list(pointer.hitTargets, PREVIEW_PROBE_LIMITS.hitTargets) ||
    !pointer.hitTargets.every(t => record(t) && text(t.selector, PREVIEW_PROBE_LIMITS.sourceSelector) && text(t.tag, 80)) ||
    !list(pointer.points, PREVIEW_PROBE_LIMITS.points)) return false
  const targetCount = pointer.hitTargets.length
  if (!pointer.points.every(point => record(point) && finite(point.x) && finite(point.y) && bool(point.reachesTarget) &&
    (point.hitIndex === undefined || typeof point.hitIndex === 'number' && Number.isInteger(point.hitIndex) && point.hitIndex >= 0 && point.hitIndex < targetCount))) return false
  if (!list(p.reasons, PREVIEW_PROBE_LIMITS.reasons) || !p.reasons.every(reason => record(reason) &&
    typeof reason.code === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(reason.code) &&
    (reason.selector === undefined || text(reason.selector, PREVIEW_PROBE_LIMITS.sourceSelector))) ||
    !bool(p.truncated) || !finite(p.elapsedMs) || p.elapsedMs < 0 ||
    !list(p.limitations, 40) || !p.limitations.every(item => text(item, 500))) return false
  try { return JSON.stringify(value).length <= PREVIEW_PROBE_LIMITS.resultJson } catch { return false }
}

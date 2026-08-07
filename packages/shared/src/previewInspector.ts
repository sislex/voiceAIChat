export const PREVIEW_INSPECTOR_MESSAGE_TYPE = 'voicechat.preview.element-selected.v1' as const
export const PREVIEW_INSPECTOR_COMMAND_TYPE = 'voicechat.preview.inspector.v1' as const
export const PREVIEW_INSPECTOR_TEXT_LIMIT = 2_000
export const PREVIEW_INSPECTOR_HTML_LIMIT = 8_000
export const PREVIEW_INSPECTOR_ARRAY_LIMIT = 64

export interface PreviewElementRect {
  x: number; y: number; top: number; right: number; bottom: number; left: number; width: number; height: number
}
export interface PreviewElementStyles {
  font: string; color: string; backgroundColor: string; margin: string; padding: string; border: string
  width: string; height: string; position: string; display: string
  flex: string; flexDirection: string; flexWrap: string; alignItems: string; justifyContent: string; gap: string
  grid: string; gridTemplateColumns: string; gridTemplateRows: string; gridArea: string
}
export interface PreviewElementPayload {
  tag: string; id: string; classes: string[]; dataAttributes: Record<string, string>
  selector: string; ancestors: string[]; rect: PreviewElementRect; pageUrl: string
  viewport: { width: number; height: number }; outerHTML: string; text: string; styles: PreviewElementStyles
}
export interface PreviewElementMessage { type: typeof PREVIEW_INSPECTOR_MESSAGE_TYPE; payload: PreviewElementPayload }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function bounded(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max }

export function isPreviewElementMessage(value: unknown): value is PreviewElementMessage {
  if (!record(value) || value.type !== PREVIEW_INSPECTOR_MESSAGE_TYPE || !record(value.payload)) return false
  const p = value.payload
  if (!bounded(p.tag, 64) || !bounded(p.id, 256) || !bounded(p.selector, 2_000) || !bounded(p.pageUrl, 4_096) ||
      !bounded(p.outerHTML, PREVIEW_INSPECTOR_HTML_LIMIT) || !bounded(p.text, PREVIEW_INSPECTOR_TEXT_LIMIT)) return false
  if (!Array.isArray(p.classes) || p.classes.length > PREVIEW_INSPECTOR_ARRAY_LIMIT || !p.classes.every((x) => bounded(x, 256))) return false
  if (!Array.isArray(p.ancestors) || p.ancestors.length > PREVIEW_INSPECTOR_ARRAY_LIMIT || !p.ancestors.every((x) => bounded(x, 512))) return false
  if (!record(p.dataAttributes) || Object.keys(p.dataAttributes).length > PREVIEW_INSPECTOR_ARRAY_LIMIT ||
      !Object.entries(p.dataAttributes).every(([k, v]) => k.length <= 256 && bounded(v, 2_000))) return false
  if (!record(p.rect)) return false
  const rect = p.rect
  if (!['x','y','top','right','bottom','left','width','height'].every((k) => finite(rect[k]))) return false
  if (!record(p.viewport) || !finite(p.viewport.width) || !finite(p.viewport.height) || !record(p.styles)) return false
  const styles = p.styles
  const styleKeys = ['font','color','backgroundColor','margin','padding','border','width','height','position','display','flex','flexDirection','flexWrap','alignItems','justifyContent','gap','grid','gridTemplateColumns','gridTemplateRows','gridArea']
  return styleKeys.every((k) => bounded(styles[k], 2_000))
}

/** Один iframe или цепочка селекторов от верхнего документа к вложенному. */
export type BrowserFramePath = string | string[]
export interface BrowserFrameTarget { frame?: BrowserFramePath }
export interface BrowserFrameContext { path: string[]; url: string; title: string; detached?: boolean }
export interface BrowserDocumentFrame extends BrowserFrameContext { name: string; visible: boolean }
export interface BrowserFramesResult {
  ok: boolean
  page: { url: string; title: string }
  frames: BrowserDocumentFrame[]
  total: number
  truncated?: boolean
  error?: string
}

export function isBrowserFramePath(value: unknown): value is BrowserFramePath {
  const path = typeof value === 'string' ? [value] : value
  return Array.isArray(path) && path.length > 0 && path.length <= 8 && path.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 2000)
}

export function normalizeBrowserFramePath(value?: BrowserFramePath): string[] {
  if (value === undefined) return []
  if (!isBrowserFramePath(value)) throw new Error('frame: нужен селектор iframe или цепочка из 1–8 селекторов')
  return typeof value === 'string' ? [value] : [...value]
}

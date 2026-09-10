export const BROWSER_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024
export const BROWSER_DOWNLOAD_TEXT_MAX_BYTES = 8 * 1024 * 1024
export const BROWSER_DOWNLOAD_MAX_ACTIVE = 8
export const BROWSER_DOWNLOAD_MAX_ENTRIES = 32
export const BROWSER_DOWNLOAD_TEXT_CHUNK = 12000
export const BROWSER_DOWNLOAD_MODEL_CHUNK = 8192
export const BROWSER_DOWNLOAD_FILE_CHUNK = 512 * 1024

export interface BrowserDownloadInfo {
  id: string
  tabId: string
  filename: string
  url: string
  urlTruncated?: boolean
  state: 'downloading' | 'completed' | 'failed' | 'canceled'
  startedAt: number
  completedAt?: number
  bytes?: number
  error?: string
}

export interface BrowserDownloadListOptions {
  tabId?: string
  offset?: number
  limit?: number
}
export interface BrowserDownloadListResult {
  ok: true
  downloads: BrowserDownloadInfo[]
  total: number
  offset: number
  nextOffset?: number
  truncated?: boolean
}
export interface BrowserDownloadReadOptions {
  encoding?: 'text' | 'base64'
  /** UTF-16 позиции текста или байты для base64; следующий offset возвращает раннер. */
  offset?: number
  limit?: number
}
interface DownloadReadBase {
  ok: true
  download: BrowserDownloadInfo
  offset: number
  total: number
  nextOffset?: number
  truncated?: boolean
}
export type BrowserDownloadReadResult = DownloadReadBase &
  ({ encoding: 'text'; text: string } | { encoding: 'base64'; base64: string })
export type BrowserDownloadMutationResult =
  | { ok: true; download: BrowserDownloadInfo }
  | { ok: true; deletedDownloadId: string }
export type BrowserDownloadResult =
  | BrowserDownloadListResult
  | BrowserDownloadReadResult
  | BrowserDownloadMutationResult
export type BrowserDownloadCommand =
  | ({ type: 'downloads' } & BrowserDownloadListOptions)
  | ({ type: 'readDownload'; downloadId: string } & BrowserDownloadReadOptions)
  | { type: 'cancelDownload' | 'deleteDownload'; downloadId: string }

export function browserDownloadId(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Некорректный downloadId')
  return value
}
export function browserDownloadFilename(value: string): string {
  return (
    value
      .replace(/[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 180) || 'download'
  )
}
export function normalizeBrowserDownloadRead(
  options: BrowserDownloadReadOptions = {}
): Required<BrowserDownloadReadOptions> {
  const encoding = options.encoding ?? 'text'
  const offset = options.offset ?? 0
  const limit = options.limit ?? (encoding === 'text' ? BROWSER_DOWNLOAD_TEXT_CHUNK : BROWSER_DOWNLOAD_MODEL_CHUNK)
  if (
    !['text', 'base64'].includes(encoding) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > (encoding === 'text' ? BROWSER_DOWNLOAD_TEXT_CHUNK : BROWSER_DOWNLOAD_FILE_CHUNK)
  )
    throw new Error('Некорректный диапазон файла')
  return { encoding, offset, limit }
}

/** Короткая выдача сохраняет полный JSON и следующий offset даже при длинных URL. */
export function browserDownloadList(
  downloads: BrowserDownloadInfo[],
  options: BrowserDownloadListOptions = {}
): BrowserDownloadListResult {
  const { offset = 0, limit = BROWSER_DOWNLOAD_MAX_ENTRIES, tabId } = options
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > BROWSER_DOWNLOAD_MAX_ENTRIES ||
    (tabId !== undefined && (typeof tabId !== 'string' || !tabId.trim() || tabId.length > 200))
  )
    throw new Error('Некорректный диапазон скачиваний')
  const filtered = downloads.filter((item) => tabId === undefined || item.tabId === tabId)
  const result: BrowserDownloadInfo[] = []
  let size = 100
  for (const item of filtered.slice(offset, offset + limit)) {
    const bounded = {
      ...item,
      url: item.url.slice(0, 2000),
      filename: browserDownloadFilename(item.filename),
      ...(item.url.length > 2000 ? { urlTruncated: true } : {}),
      ...(item.error ? { error: item.error.slice(0, 500) } : {})
    }
    const length = JSON.stringify(bounded).length + 1
    if (result.length && size + length > 12000) break
    result.push(bounded)
    size += length
  }
  const next = offset + result.length
  return {
    ok: true,
    downloads: result,
    total: filtered.length,
    offset,
    ...(next < filtered.length ? { nextOffset: next, truncated: true } : {})
  }
}

export function isBrowserDownloadInfo(value: unknown): value is BrowserDownloadInfo {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.tabId === 'string' &&
    typeof item.filename === 'string' &&
    typeof item.url === 'string' &&
    ['downloading', 'completed', 'failed', 'canceled'].includes(item.state as string) &&
    Number.isFinite(item.startedAt) &&
    (item.bytes === undefined || (Number.isSafeInteger(item.bytes) && (item.bytes as number) >= 0))
  )
}
export function isBrowserDownloadListResult(value: unknown): value is BrowserDownloadListResult {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    item.ok === true &&
    Array.isArray(item.downloads) &&
    item.downloads.every(isBrowserDownloadInfo) &&
    Number.isSafeInteger(item.total) &&
    (item.total as number) >= item.downloads.length &&
    Number.isSafeInteger(item.offset) &&
    (item.offset as number) >= 0
  )
}
export function isBrowserDownloadReadResult(value: unknown): value is BrowserDownloadReadResult {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    item.ok === true &&
    isBrowserDownloadInfo(item.download) &&
    Number.isSafeInteger(item.offset) &&
    (item.offset as number) >= 0 &&
    Number.isSafeInteger(item.total) &&
    (item.total as number) >= (item.offset as number) &&
    ((item.encoding === 'text' && typeof item.text === 'string') ||
      (item.encoding === 'base64' && typeof item.base64 === 'string'))
  )
}

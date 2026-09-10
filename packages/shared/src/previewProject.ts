/** Постоянный адрес текущего приложения: одинаковый для браузера, модели и standalone Reader. */
export const READER_PROJECT_ORIGIN = 'https://app.internal'
export interface ReaderProjectRequest {
  method: string
  path: string
  headers: Record<string, string | string[]>
  bodyBase64?: string
}
export interface ReaderProjectResponse {
  status: number
  headers: Record<string, string | string[]>
  bodyBase64: string
}

/** Скопированный адрес текущего приложения сохраняет путь/query/hash, но не порт транспорта. */
export function readerProjectUrl(value: string, ownOrigin?: string): string {
  try {
    const url = new URL(value)
    if (url.username || url.password) return value
    if (url.hostname === 'app.internal' && !url.port || ownOrigin && url.origin === new URL(ownOrigin).origin) {
      return READER_PROJECT_ORIGIN + url.pathname + url.search + url.hash
    }
  } catch { /* Проверку ошибочного ввода выполняет вызывающий. */ }
  return value
}

/** Вложенное приложение не должно открывать служебный RPC или рекурсивно проксировать само себя. */
export function isReaderProjectPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n\0]/.test(path)) return false
  try {
    const url = new URL(path, READER_PROJECT_ORIGIN)
    const pathname = decodeURIComponent(url.pathname).replace(/\/{2,}/g, '/')
    return !/^\/(?:api\/preview|internal|mcp)(?:\/|$)/i.test(pathname)
  } catch { return false }
}

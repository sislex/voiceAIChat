import { READER_PROJECT_ORIGIN, isReaderProjectPath, readerProjectUrl } from '@voicechat/shared'
import type { ReaderProjectRequest, ReaderProjectResponse } from '@voicechat/shared'
import { PreviewCookieStore, responseSetCookies } from './previewCookies.js'

export class ProjectPreviewError extends Error { constructor(readonly status: number, message: string) { super(message) } }
/** Один ограниченный переход к своему приложению, включая внутреннюю цепочку авторизации. */
export async function loadPreviewProject(
  request: (request: ReaderProjectRequest) => Promise<ReaderProjectResponse>,
  cookies: PreviewCookieStore, userId: string, url: URL, method: string,
  body: Buffer | string | undefined, headers: Record<string, string | string[]>, timeoutMs = 10_000
): Promise<{ status: number; headers: Record<string, string | string[]>; body: Buffer; finalUrl: URL }> {
  let expired = false
  const run = async () => {
    let current = url, verb = method, payload = body, outgoing = { ...headers }
    for (let i = 0; i <= 5; i++) {
      if (current.origin !== READER_PROJECT_ORIGIN || current.username || current.password || !isReaderProjectPath(current.pathname)) throw new ProjectPreviewError(403, 'Этот адрес нельзя открыть как страницу текущего приложения')
      const cookie = cookies.header(userId, current)
      const response = await request({ method: verb, path: current.pathname + current.search, headers: { ...outgoing, ...(cookie ? { cookie } : {}) }, ...(payload === undefined ? {} : { bodyBase64: Buffer.from(payload).toString('base64') }) })
      if (expired) throw new ProjectPreviewError(504, 'Приложение не ответило вовремя')
      cookies.store(userId, current, responseSetCookies(response.headers))
      const locationEntry = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'location')?.[1]
      const location = Array.isArray(locationEntry) ? locationEntry[0] : locationEntry
      if (![301,302,303,307,308].includes(response.status) || !location) return { ...response, body: Buffer.from(response.bodyBase64, 'base64'), finalUrl: current }
      if (i === 5) throw new ProjectPreviewError(502, 'Слишком много перенаправлений приложения')
      const next = new URL(readerProjectUrl(new URL(location, current).toString()))
      if (!next.hash && !location.includes('#')) next.hash = current.hash
      current = next
      if (response.status === 303 && verb !== 'HEAD' || (response.status === 301 || response.status === 302) && verb === 'POST') {
        verb = 'GET'; payload = undefined; outgoing = { ...outgoing }
        for (const name of ['content-type','content-length','content-encoding']) delete outgoing[name]
      }
    }
    throw new ProjectPreviewError(502, 'Слишком много перенаправлений приложения')
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([run(), new Promise<never>((_resolve,reject) => { timer = setTimeout(() => { expired = true; reject(new ProjectPreviewError(504, 'Приложение не ответило вовремя')) }, timeoutMs) })]) }
  finally { if (timer) clearTimeout(timer) }
}

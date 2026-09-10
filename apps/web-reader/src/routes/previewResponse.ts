import { promisify } from 'node:util'
import { gunzip, inflate, brotliDecompress } from 'node:zlib'
import { parse, type DefaultTreeAdapterMap } from 'parse5'

const LIMIT = 5 * 1024 * 1024
export class PreviewResponseError extends Error { constructor(readonly status: number, message: string) { super(message) } }
export const isPreviewText = (type: string): boolean => /^(?:text\/(?:html|css)|application\/xhtml\+xml)(?:;|$)|javascript|ecmascript/i.test(type)
export const previewContentType = (type: string): string => isPreviewText(type) ? type.replace(/;\s*charset\s*=\s*(?:"[^"]*"|'[^']*'|[^;]*)/ig, '') + '; charset=utf-8' : type
const charset = (value: string): string | undefined => /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(value)?.slice(1).find(Boolean)

/** Заголовок/BOM важнее декларации документа; после переписывания браузер получает UTF-8. */
export function decodePreviewText(body: Buffer, type: string): string {
  let encoding: string | undefined
  if (body[0] === 0xff && body[1] === 0xfe) encoding = 'utf-16le'
  else if (body[0] === 0xfe && body[1] === 0xff) encoding = 'utf-16be'
  else if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) encoding = 'utf-8'
  encoding ??= charset(type)
  const prefix = body.subarray(0, 4096).toString('latin1')
  if (!encoding && /html/i.test(type)) {
    // Парсер не принимает похожую строку из комментария или script за meta.
    const visit = (node: DefaultTreeAdapterMap['node']): void => {
      if (encoding) return
      if (node.nodeName === 'meta' && 'attrs' in node) {
        const attrs = Object.fromEntries((node.attrs ?? []).map(attr => [attr.name, attr.value]))
        encoding = attrs.charset || (attrs['http-equiv']?.toLowerCase() === 'content-type' ? charset(attrs.content ?? '') : undefined)
      }
      if ('childNodes' in node) for (const child of node.childNodes) visit(child)
    }
    visit(parse(prefix))
  }
  if (!encoding && /css/i.test(type)) encoding = /^@charset\s+["']([^"']+)["']/i.exec(prefix)?.[1]
  if (!encoding && /xml/i.test(type)) encoding = /^\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(prefix)?.[1]
  try { return new TextDecoder(encoding || 'utf-8').decode(body) }
  catch { return new TextDecoder('utf-8').decode(body) }
}

/** Распаковываем до переписывания и ограничиваем уже раскрытый размер, включая архивную бомбу. */
export async function decodePreviewResponse(body: Buffer, encoding: string | undefined): Promise<Buffer> {
  if (body.length > LIMIT) throw new PreviewResponseError(413, 'Ответ сайта слишком большой')
  // HEAD/204 могут объявлять сжатие, но не несут сжатого потока.
  if (!body.length) return body
  let decoded = body
  for (const format of (encoding ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean).reverse()) {
    if (format === 'identity') continue
    const unpack = format === 'gzip' || format === 'x-gzip' ? promisify(gunzip) : format === 'br' ? promisify(brotliDecompress) : format === 'deflate' ? promisify(inflate) : null
    if (!unpack) throw new PreviewResponseError(502, 'Неподдерживаемое сжатие ответа: ' + format)
    try { decoded = await unpack(decoded, { maxOutputLength: LIMIT }) }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE') throw new PreviewResponseError(413, 'Распакованный ответ сайта слишком большой')
      throw new PreviewResponseError(502, 'Не удалось распаковать ответ сайта')
    }
    if (decoded.length > LIMIT) throw new PreviewResponseError(413, 'Распакованный ответ сайта слишком большой')
  }
  return decoded
}

/** Правила браузера общие для публичного сайта, машины и текущего проекта. */
export function previewRedirect(current: URL, location: string, status: number, method: string, body: string | Buffer | undefined, headers: Record<string, string | string[]>): { url: URL; method: string; body: string | Buffer | undefined; headers: Record<string, string | string[]> } {
  const url = new URL(location, current), outgoing = { ...headers }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new PreviewResponseError(400, 'Разрешены только HTTP и HTTPS')
  if (!url.hash && !location.includes('#')) url.hash = current.hash
  if (url.origin !== current.origin) for (const name of Object.keys(outgoing)) if (['authorization', 'proxy-authorization', 'cookie'].includes(name.toLowerCase())) delete outgoing[name]
  if (status === 303 && method !== 'HEAD' || (status === 301 || status === 302) && method === 'POST') {
    method = 'GET'; body = undefined
    for (const name of Object.keys(outgoing)) if (['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location'].includes(name.toLowerCase())) delete outgoing[name]
  }
  return { url, method, body, headers: outgoing }
}

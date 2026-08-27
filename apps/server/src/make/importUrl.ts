// Импорт страницы по URL в проект Make: HTML → index.html, same-origin стили/скрипты/картинки →
// файлы проекта с переписанными ссылками. Не «зеркало сайта», а стартовая точка для редизайна:
// ограничено числом и размером файлов, хосты проверяются тем же SSRF-гардом, что у Web Reader.

import { assertPublicHost } from '../routes/previewProxy.js'

export interface ImportedFile { path: string; data: Buffer }

const LIMITS = { maxAssets: 30, maxAssetBytes: 2 * 1024 * 1024, maxHtmlBytes: 2 * 1024 * 1024, timeoutMs: 15_000 }
const ASSET_ATTR = /(<(?:link|script|img|source)\b[^>]*?\s(?:href|src)\s*=\s*)(["'])([^"']+)\2/gi

export class ImportUrlError extends Error {}

async function fetchBytes(url: URL, maxBytes: number, fetchImpl: typeof fetch): Promise<{ data: Buffer; type: string }> {
  await assertPublicHost(url.hostname)
  const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(LIMITS.timeoutMs), headers: { 'user-agent': 'Mozilla/5.0 (compatible; VoiceChatMake/1.0)' } })
  if (!res.ok) throw new ImportUrlError(`${url.href}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > maxBytes) throw new ImportUrlError(`${url.href}: больше ${Math.round(maxBytes / 1024)} КБ`)
  return { data: buf, type: res.headers.get('content-type') ?? '' }
}

/** Имя файла в проекте для ресурса: assets/<имя>, при коллизии — с суффиксом. */
function assetPath(url: URL, used: Set<string>): string {
  const base = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'asset').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'asset'
  let candidate = `assets/${base}`
  let n = 2
  while (used.has(candidate)) { candidate = `assets/${base.replace(/(\.[a-z0-9]+)?$/i, `-${n}$1`)}`; n++ }
  used.add(candidate)
  return candidate
}

export async function importFromUrl(rawUrl: string, fetchImpl: typeof fetch = fetch): Promise<ImportedFile[]> {
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new ImportUrlError('Некорректный URL') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ImportUrlError('Поддерживаются только http(s)-адреса')
  const page = await fetchBytes(url, LIMITS.maxHtmlBytes, fetchImpl)
  if (!/text\/html/i.test(page.type) && !/^\s*<(!doctype|html)/i.test(page.data.subarray(0, 512).toString('utf8'))) throw new ImportUrlError('По адресу не HTML-страница')
  let html = page.data.toString('utf8')
  const files: ImportedFile[] = []
  const used = new Set<string>()
  const mapped = new Map<string, string>()
  const candidates: Array<{ raw: string; abs: URL }> = []
  for (const m of html.matchAll(ASSET_ATTR)) {
    const raw = m[3]!
    if (/^(data:|blob:|javascript:|#|mailto:)/i.test(raw)) continue
    let abs: URL
    try { abs = new URL(raw, url) } catch { continue }
    if (abs.origin !== url.origin) continue
    if (!candidates.some((c) => c.abs.href === abs.href)) candidates.push({ raw, abs })
  }
  for (const c of candidates.slice(0, LIMITS.maxAssets)) {
    try {
      const asset = await fetchBytes(c.abs, LIMITS.maxAssetBytes, fetchImpl)
      const path = assetPath(c.abs, used)
      files.push({ path, data: asset.data })
      mapped.set(c.abs.href, path)
    } catch { /* недоступный ресурс остаётся абсолютной ссылкой на исходный сайт */ }
  }
  html = html.replace(ASSET_ATTR, (full, lead: string, q: string, raw: string) => {
    let abs: URL
    try { abs = new URL(raw, url) } catch { return full }
    const local = mapped.get(abs.href)
    return local ? `${lead}${q}${local}${q}` : abs.origin === url.origin ? `${lead}${q}${abs.href}${q}` : full
  })
  // Остальные относительные ссылки (<a href>) — в абсолютные, чтобы навигация из превью не ломалась.
  html = html.replace(/(<a\b[^>]*?\shref\s*=\s*)(["'])([^"'#][^"']*)\2/gi, (full, lead: string, q: string, raw: string) => {
    try { return `${lead}${q}${new URL(raw, url).href}${q}` } catch { return full }
  })
  if (!/<base\b/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>\n  <!-- импортировано из ${url.href} -->`)
  files.unshift({ path: 'index.html', data: Buffer.from(html, 'utf8') })
  return files
}

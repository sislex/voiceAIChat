// Import a URL into a Make project: HTML becomes index.html, while same-origin styles, scripts, and
// images become project files with rewritten links. This is a redesign starting point, with file
// count and size limits; hosts use the same SSRF guard as Web Reader.

import { assertPublicHost } from './publicHost.js'
import { githubArchiveUrls, parseGithubUrl } from '@voicechat/shared'
import { readZip, stripCommonRoot } from './zipRead.js'

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

/** Project filename for an asset: assets/<name>, with a suffix on collisions. */
function assetPath(url: URL, used: Set<string>): string {
  const base = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'asset').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'asset'
  let candidate = `assets/${base}`
  let n = 2
  while (used.has(candidate)) { candidate = `assets/${base.replace(/(\.[a-z0-9]+)?$/i, `-${n}$1`)}`; n++ }
  used.add(candidate)
  return candidate
}

/** GitHub repository (item 27): download the branch ZIP from codeload, strip the archive's common root, and select any subdirectory specified in the URL. */
export async function importFromGithub(rawUrl: string, fetchImpl: typeof fetch = fetch): Promise<ImportedFile[] | null> {
  const gh = parseGithubUrl(rawUrl)
  if (!gh) return null
  let lastError: unknown = null
  for (const zipUrl of githubArchiveUrls(gh)) {
    try {
      const { data } = await fetchBytes(new URL(zipUrl), 12 * 1024 * 1024, fetchImpl)
      let entries = stripCommonRoot(readZip(data))
      if (gh.subdir) {
        const prefix = gh.subdir.replace(/\/+$/, '') + '/'
        entries = entries.filter((e) => e.path.startsWith(prefix)).map((e) => ({ path: e.path.slice(prefix.length), data: e.data }))
        if (entries.length === 0) throw new ImportUrlError(`В репозитории нет каталога ${gh.subdir}`)
      }
      return entries
    } catch (e) { lastError = e; if (e instanceof ImportUrlError && !/HTTP 404/.test(e.message)) throw e }
  }
  throw lastError instanceof Error ? new ImportUrlError(`Не удалось скачать репозиторий: ${lastError.message}`) : new ImportUrlError('Не удалось скачать репозиторий')
}

export async function importFromUrl(rawUrl: string, fetchImpl: typeof fetch = fetch): Promise<ImportedFile[]> {
  const fromGithub = await importFromGithub(rawUrl, fetchImpl)
  if (fromGithub) return fromGithub
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
    } catch { /* Keep unavailable assets as absolute links to the original site. */ }
  }
  html = html.replace(ASSET_ATTR, (full, lead: string, q: string, raw: string) => {
    let abs: URL
    try { abs = new URL(raw, url) } catch { return full }
    const local = mapped.get(abs.href)
    return local ? `${lead}${q}${local}${q}` : abs.origin === url.origin ? `${lead}${q}${abs.href}${q}` : full
  })
  // Make remaining relative links (<a href>) absolute so preview navigation keeps working.
  html = html.replace(/(<a\b[^>]*?\shref\s*=\s*)(["'])([^"'#][^"']*)\2/gi, (full, lead: string, q: string, raw: string) => {
    try { return `${lead}${q}${new URL(raw, url).href}${q}` } catch { return full }
  })
  if (!/<base\b/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>\n  <!-- imported from ${url.href} -->`)
  files.unshift({ path: 'index.html', data: Buffer.from(html, 'utf8') })
  return files
}

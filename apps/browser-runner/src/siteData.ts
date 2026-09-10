import type { BrowserContext, CDPSession, Page } from 'playwright'
import { normalizeBrowserSiteDataReset, type BrowserSiteDataResetOptions, type BrowserSiteDataResetResult } from '@voicechat/shared'

export interface SiteDataSession {
  context: BrowserContext
  pages: Map<string, Page>
  origins: Set<string>
  bootstrapCookies: Array<{ name: string; host: string }>
}

export function httpOrigin(raw: string): string | null {
  try { const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol) ? url.origin : null } catch { return null }
}

const domainMatches = (host: string, domain: string): boolean => {
  const base = domain.replace(/^\./, '').toLowerCase()
  return host === base || host.endsWith(`.${base}`)
}

/** Cookie разделяются по домену, а хранилища — по origin. Bootstrap-cookie
 * открывает прокси машины, а не пользовательский аккаунт сайта: её сохраняем. */
export async function clearSiteData(session: SiteDataSession, currentPage: Page | undefined, options: BrowserSiteDataResetOptions, publicUrl: (url: string) => string): Promise<BrowserSiteDataResetResult> {
  const { scope, host } = normalizeBrowserSiteDataReset(options)
  const current = currentPage && httpOrigin(currentPage.url())
  if (scope === 'current' && !current) throw new Error('Открой сайт перед очисткой его данных')
  for (const page of session.pages.values()) for (const frame of page.frames()) {
    const origin = httpOrigin(frame.url()); if (origin) session.origins.add(origin)
  }
  const origins = [...session.origins].filter(origin => scope === 'current' ? origin === current : !host || [new URL(origin).hostname, new URL(publicUrl(origin)).hostname].includes(host))
  const hosts = new Set(origins.map(origin => new URL(origin).hostname))
  if (host) hosts.add(host)
  const cookies = (await session.context.cookies()).filter(cookie => {
    if (session.bootstrapCookies.some(bootstrap => cookie.name === bootstrap.name && domainMatches(bootstrap.host, cookie.domain))) return false
    return scope === 'all' && !host || [...hosts].some(host => domainMatches(host, cookie.domain))
  })
  const target = currentPage && !currentPage.isClosed() ? currentPage : [...session.pages.values()].find(page => !page.isClosed())
  const page = target ?? await session.context.newPage()
  let cdp: CDPSession | undefined
  const deadline = Date.now() + 10000
  const bounded = async <T>(job: () => Promise<T>): Promise<T> => {
    const left = deadline - Date.now()
    if (left <= 0) throw new Error('Истёк таймаут очистки данных сайта')
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([job(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Истёк таймаут очистки данных сайта')), left) })]) }
    finally { if (timer) clearTimeout(timer) }
  }
  try {
    const channel = await session.context.newCDPSession(page)
    cdp = channel
    for (const origin of origins) {
      await bounded(() => channel.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage,indexeddb,cache_storage,service_workers,file_systems,websql' }))
      // sessionStorage принадлежит вкладке и не входит в CDP origin storage.
      for (const opened of session.pages.values()) for (const frame of opened.frames()) {
        if (httpOrigin(frame.url()) === origin) await bounded(() => frame.evaluate('sessionStorage.clear()'))
      }
    }
    for (const cookie of cookies) await bounded(() => session.context.clearCookies({ name: cookie.name, domain: cookie.domain, path: cookie.path }))
    return { ok: true, clearedCookies: cookies.length, clearedOrigins: origins.map(origin => new URL(publicUrl(origin)).origin) }
  } finally {
    await cdp?.detach().catch(() => undefined)
    if (!target) await page.close().catch(() => undefined)
  }
}

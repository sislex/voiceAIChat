import { Cookie, CookieJar } from 'tough-cookie'

/** Серверный контейнер повторяет Domain/Path/expiry браузера и живёт в одном Reader-сервере. */
export class PreviewCookieStore {
  private readonly users = new Map<string, CookieJar>()
  store(userId: string, url: URL, header: string | string[] | undefined): void {
    if (header === undefined) return
    let jar = this.users.get(userId)
    if (!jar) { jar = new CookieJar(undefined, { prefixSecurity: 'strict' }); this.users.set(userId, jar) }
    for (const line of Array.isArray(header) ? header : [header]) {
      if (line.length > 4096) continue
      const cookie = Cookie.parse(line)
      if (!cookie || cookie.secure && url.protocol !== 'https:') continue
      // Агентские окружения принадлежат разным владельцам и не делят общий Domain.
      if (cookie.domain === 'machine.internal' || cookie.domain === 'internal') continue
      try { jar.setCookieSync(cookie, url.toString(), { ignoreError: true }) } catch { /* повреждённый Set-Cookie не ломает страницу */ }
    }
  }
  header(userId: string, url: URL): string | undefined {
    try { return this.users.get(userId)?.getCookieStringSync(url.toString()) || undefined } catch { return undefined }
  }
  clear(userId: string, host?: string): number {
    const jar = this.users.get(userId)
    if (!jar) return 0
    const serialized = jar.serializeSync()
    if (!serialized) return 0
    const cookies = serialized.cookies ?? []
    if (!host) { this.users.delete(userId); return cookies.length }
    const target = host.toLowerCase()
    const kept = cookies.filter(cookie => {
      const domain = typeof cookie.domain === 'string' ? cookie.domain : ''
      return domain !== target && !target.endsWith('.' + domain) && !domain.endsWith('.' + target)
    })
    this.users.set(userId, CookieJar.deserializeSync({ ...serialized, cookies: kept }))
    return cookies.length - kept.length
  }
  clearAll(): void { this.users.clear() }
}

/** Регистр имени HTTP-заголовка не меняет список Set-Cookie и не склеивает запятые Expires. */
export function responseSetCookies(headers: Record<string, string | string[] | undefined>): string[] {
  return Object.entries(headers).filter(([key]) => key.toLowerCase() === 'set-cookie').flatMap(([, value]) => value === undefined ? [] : Array.isArray(value) ? value : [value])
}

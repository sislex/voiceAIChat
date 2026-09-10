/** Reader сохраняет вход в сайты; QA начинает проверку с одноразового профиля. */
export type BrowserProfileMode = 'persistent' | 'ephemeral'

export function normalizeBrowserProfileMode(value: unknown): BrowserProfileMode {
  if (value === undefined) return 'ephemeral'
  if (value === 'persistent' || value === 'ephemeral') return value
  throw new Error('profileMode: нужен persistent или ephemeral')
}

export interface BrowserSiteDataResetOptions {
  /** По умолчанию — сайт активной вкладки; all очищает сайты этой сессии. */
  scope?: 'current' | 'all'
  /** Ограничение all одним доменом, включая его cookie с родительского домена. */
  host?: string
}

export interface BrowserSiteDataResetResult {
  ok: boolean
  clearedCookies: number
  clearedOrigins: string[]
  error?: string
}

export function isBrowserSiteDataResetResult(value: unknown): value is BrowserSiteDataResetResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  return result.ok === true && Number.isSafeInteger(result.clearedCookies) && (result.clearedCookies as number) >= 0 && Array.isArray(result.clearedOrigins) && result.clearedOrigins.every(origin => typeof origin === 'string')
}

/** Валидация до первой очистки: ошибочный host не должен превратиться в all. */
export function normalizeBrowserSiteDataReset(value: BrowserSiteDataResetOptions): Required<Pick<BrowserSiteDataResetOptions, 'scope'>> & Pick<BrowserSiteDataResetOptions, 'host'> {
  const scope = value.scope === undefined ? 'current' : value.scope
  if (scope !== 'current' && scope !== 'all') throw new Error('scope: нужен current или all')
  if (value.host === undefined) return { scope }
  if (scope !== 'all' || typeof value.host !== 'string' || !value.host.trim() || value.host.length > 255) throw new Error('host доступен только для scope=all и должен содержать домен')
  try {
    const raw = value.host.trim()
    if (/[\s/?#@\\]/.test(raw)) throw new Error()
    const url = new URL(`http://${raw}`)
    if (!url.hostname) throw new Error()
    return { scope, host: url.hostname.toLowerCase() }
  } catch { throw new Error('host: нужен домен без пути и схемы') }
}

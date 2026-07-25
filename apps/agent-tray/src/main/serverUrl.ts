// Преобразование ws-адреса агента в http-базу сервера (для REST: версия, .dmg).

/** ws(s)://host[/agent] → http(s)://host (без пути). '' при мусоре. */
export function httpBaseFromWs(wsUrl: string): string {
  try {
    const u = new URL(wsUrl)
    const proto = u.protocol === 'wss:' ? 'https:' : 'http:'
    return `${proto}//${u.host}`
  } catch {
    return ''
  }
}

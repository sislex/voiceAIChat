// Адрес сервера. По умолчанию — тот же origin (web раздаётся сервером или через
// dev-proxy Vite). Можно переопределить через VITE_SERVER_URL (напр. LAN/мобилка).
const RAW = import.meta.env.VITE_SERVER_URL as string | undefined

/** Базовый HTTP-URL сервера ('' = относительные пути к текущему origin). */
export const SERVER_HTTP = RAW ? RAW.replace(/\/$/, '') : ''

/** URL WebSocket-эндпоинта сервера. */
export function serverWsUrl(): string {
  if (RAW) return RAW.replace(/\/$/, '').replace(/^http/, 'ws') + '/ws'
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

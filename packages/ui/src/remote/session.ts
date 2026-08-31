// Сессия пользователя (web). С auth-roadmap п.5 токен в localStorage больше не хранится: сервер держит его
// в HttpOnly-cookie `vc_session`, а мутации подписываются заголовком `x-vc-csrf` из читаемой cookie `vc_csrf`.
// Bearer в памяти остаётся на время жизни страницы после свежего входа (и для старых токенов до переноса в cookie).

const TOKEN_KEY = 'vc.session.token'
let memoryToken: string | null = null

/** Токен для Authorization: из памяти (свежий вход) или из localStorage (унаследованный, до переноса в cookie). */
export function getToken(): string | null {
  if (memoryToken) return memoryToken
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** Свежий вход: токен только в памяти. `null` — выход: чистим и память, и унаследованный localStorage. */
export function setToken(token: string | null): void {
  memoryToken = token
  if (token) return
  try { localStorage.removeItem(TOKEN_KEY) } catch { /* приватный режим */ }
}

/** Унаследованный токен в localStorage — кандидат на перенос в cookie (`POST /api/session/cookie`). */
export function legacyToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function dropLegacyToken(): void {
  try { localStorage.removeItem(TOKEN_KEY) } catch { /* приватный режим */ }
}

/**
 * CSRF-токен из cookie; его наличие означает, что cookie-сессия есть.
 *
 * Имён два, потому что сервер разводит их по схеме: по https — `__Secure-vc_csrf`,
 * по http — `vc_csrf` (причина — в `apps/server/src/users/auth.ts`: cookie
 * различаются по хосту, и `Secure`-версия иначе затеняет обычную). Защищённое
 * имя приоритетнее: если в браузере лежат оба, актуально то, что поставил https.
 */
export function getCsrf(): string | null {
  if (typeof document === 'undefined') return null
  let plain: string | null = null
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === '__Secure-vc_csrf') return decodeURIComponent(rest.join('='))
    if (k === 'vc_csrf') plain = decodeURIComponent(rest.join('='))
  }
  return plain
}

/** Есть чем авторизоваться: Bearer в памяти/localStorage или cookie-сессия. */
export function hasSession(): boolean {
  return Boolean(getToken() || getCsrf())
}

/** Заголовки для REST: Bearer, если есть; CSRF — всегда при cookie-сессии (на GET сервер его игнорирует). */
export function authHeaders(): Record<string, string> {
  const out: Record<string, string> = {}
  const t = getToken()
  if (t) out.authorization = `Bearer ${t}`
  const csrf = getCsrf()
  if (csrf) out['x-vc-csrf'] = csrf
  return out
}

/**
 * Сервер ответил 401 — сессия истекла или отозвана. Обработчик ставит рантайм:
 * до этого код `expire()` в сторе существовал, но его никто не звал, и человек
 * оставался на сломанном экране с тостами «unauthorized» вместо экрана входа.
 */
let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.()
}

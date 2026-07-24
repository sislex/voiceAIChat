// Токен сессии пользователя (web). Хранится в localStorage, добавляется в
// Authorization для REST и в ?token= для WS. Общий для httpApi и wsClient.

const TOKEN_KEY = 'vc.session.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // localStorage недоступен (приватный режим/SSR) — молча игнорируем.
  }
}

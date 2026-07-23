// Статус авторизации CLI (claude / codex) — залогинен ли пользователь.
// Чистая логика разбора файлов авторизации (без доступа к ФС — её делает
// server/desktop и передаёт сюда содержимое), поэтому переиспользуется и тестируется.

import type { LlmProvider } from './types'

/** Статус входа одного CLI-движка. */
export interface CliLoginStatus {
  provider: LlmProvider
  /** Найдена ли валидная авторизация. */
  loggedIn: boolean
  /** Короткое пояснение для UI: тип подписки / режим входа / что сделать. */
  detail?: string
}

/** Статусы входа обоих движков. */
export interface LoginStatusMap {
  claude: CliLoginStatus
  codex: CliLoginStatus
}

/** Безопасный JSON.parse: объект или null (битый/пустой файл не роняет проверку). */
function safeParse(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Статус входа Claude по содержимому `~/.claude/.credentials.json`.
 * `raw` — текст файла (null, если файла нет); `now` — текущее время (ms);
 * `apiKeyEnv` — задан ли ANTHROPIC_API_KEY (альтернативный способ входа).
 */
export function claudeLoginStatus(raw: string | null, now: number, apiKeyEnv = false): CliLoginStatus {
  const oauth = safeParse(raw)?.claudeAiOauth as Record<string, unknown> | undefined
  const accessToken = oauth?.accessToken
  if (typeof accessToken === 'string' && accessToken) {
    const refreshExp = oauth?.refreshTokenExpiresAt
    if (typeof refreshExp === 'number' && refreshExp < now) {
      return { provider: 'claude', loggedIn: false, detail: 'сессия истекла — выполните `claude login`' }
    }
    const sub = oauth?.subscriptionType
    const detail = typeof sub === 'string' && sub ? `подписка ${sub}` : 'вход через Claude'
    return { provider: 'claude', loggedIn: true, detail }
  }
  if (apiKeyEnv) return { provider: 'claude', loggedIn: true, detail: 'API-ключ (ANTHROPIC_API_KEY)' }
  return { provider: 'claude', loggedIn: false, detail: 'вход не выполнен — выполните `claude login`' }
}

/**
 * Статус входа Codex по содержимому `~/.codex/auth.json`.
 * `raw` — текст файла (null, если файла нет); `apiKeyEnv` — задан ли OPENAI_API_KEY.
 */
export function codexLoginStatus(raw: string | null, apiKeyEnv = false): CliLoginStatus {
  const obj = safeParse(raw)
  if (obj) {
    const tokens = obj.tokens as Record<string, unknown> | undefined
    const accessToken = tokens?.access_token
    if (typeof accessToken === 'string' && accessToken) {
      return { provider: 'codex', loggedIn: true, detail: 'вход через ChatGPT' }
    }
    const key = obj.OPENAI_API_KEY
    if (typeof key === 'string' && key) {
      return { provider: 'codex', loggedIn: true, detail: 'API-ключ' }
    }
  }
  if (apiKeyEnv) return { provider: 'codex', loggedIn: true, detail: 'API-ключ (OPENAI_API_KEY)' }
  return { provider: 'codex', loggedIn: false, detail: 'вход не выполнен — выполните `codex login`' }
}

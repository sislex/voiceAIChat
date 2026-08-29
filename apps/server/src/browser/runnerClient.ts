// HTTP-клиент сервера к browser-runner (apps/browser-runner). Сервер сам Chromium
// не запускает — он оркеструет чужой сервис: поднимает сессию на разговор,
// шлёт команды и тянет кадры. Аналог RemoteLlmClient, но синхронный request/response.
//
// Ключи изоляции: sessionId = conversationId (глобально уникален, принадлежит
// одному владельцу — проверяется до вызова), userKey = uid, conversationKey =
// conversationId. Раннер сверяет пару при повторном старте (identity mismatch).

import type { BrowserCommandRequest, BrowserSessionMetadata, BrowserViewport } from '@voicechat/shared'

export interface BrowserRunnerClientOptions {
  baseUrl: string
  token: string
  fetchImpl?: typeof fetch
  /** Таймаут одного вызова раннера, мс (навигация внутри Chromium — до 30 с). */
  timeoutMs?: number
}

/** Ошибка вызова раннера с кодом, пригодным для маппинга в HTTP-статус роута. */
export class BrowserRunnerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'BrowserRunnerError'
  }
}

const DEFAULT_TIMEOUT_MS = 35_000

export interface BrowserStartInput {
  sessionId: string
  userKey: string
  conversationKey: string
  viewport?: BrowserViewport
}

export interface BrowserRunnerClient {
  start(input: BrowserStartInput): Promise<BrowserSessionMetadata>
  command(sessionId: string, request: BrowserCommandRequest, signal?: AbortSignal): Promise<BrowserSessionMetadata>
  screenshot(sessionId: string, request: BrowserCommandRequest): Promise<{ buffer: Buffer; mimeType: string }>
  stop(sessionId: string): Promise<boolean>
}

export function createBrowserRunnerClient(opts: BrowserRunnerClientOptions): BrowserRunnerClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const base = opts.baseUrl.replace(/\/$/, '')
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function call(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const abort = new AbortController()
    // Отмена рана обязана обрывать запрос: шаг `wait` держит соединение до
    // своего таймаута, и без этого «Отменить» срабатывало через полминуты.
    if (signal) {
      if (signal.aborted) abort.abort()
      else signal.addEventListener('abort', () => abort.abort(), { once: true })
    }
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    try {
      return await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${opts.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: abort.signal
      })
    } catch (err) {
      throw new BrowserRunnerError(502, err instanceof Error && err.name === 'AbortError' ? 'Browser Runner не ответил вовремя' : 'Browser Runner недоступен')
    } finally {
      clearTimeout(timer)
    }
  }

  async function asError(res: Response): Promise<BrowserRunnerError> {
    let message = `Browser Runner ответил ${res.status}`
    try {
      const data = await res.json() as { message?: unknown; error?: unknown }
      const detail = typeof data.message === 'string' ? data.message : typeof data.error === 'string' ? data.error : null
      if (detail) message = detail
    } catch { /* тело не JSON */ }
    // stale_* — конфликт состояния (409), not_found — 404, старт-провал — 503.
    const status = res.status === 404 ? 404 : res.status === 409 ? 409 : res.status === 503 ? 503 : 502
    return new BrowserRunnerError(status, message)
  }

  return {
    async start(input) {
      const res = await call('/v1/sessions', 'POST', input)
      if (!res.ok) throw await asError(res)
      return res.json() as Promise<BrowserSessionMetadata>
    },
    async command(sessionId, request, signal) {
      const res = await call(`/v1/sessions/${encodeURIComponent(sessionId)}/commands`, 'POST', request, signal)
      if (!res.ok) throw await asError(res)
      return res.json() as Promise<BrowserSessionMetadata>
    },
    async screenshot(sessionId, request) {
      const res = await call(`/v1/sessions/${encodeURIComponent(sessionId)}/commands`, 'POST', request)
      if (!res.ok) throw await asError(res)
      const mimeType = res.headers.get('content-type') ?? 'image/png'
      const buffer = Buffer.from(await res.arrayBuffer())
      return { buffer, mimeType }
    },
    async stop(sessionId) {
      const res = await call(`/v1/sessions/${encodeURIComponent(sessionId)}`, 'DELETE')
      if (!res.ok) throw await asError(res)
      const data = await res.json() as { stopped?: boolean }
      return data.stopped === true
    }
  }
}

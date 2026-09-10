import type { BrowserProfileMode, BrowserSiteDataResetResult } from '@voicechat/shared'
// HTTP-клиент сервера к browser-runner (apps/browser-runner). Сервер сам Chromium
// не запускает — он оркеструет чужой сервис: поднимает сессию на разговор,
// шлёт команды и тянет кадры. Аналог RemoteLlmClient, но синхронный request/response.
//
// Ключи изоляции: sessionId = conversationId (глобально уникален, принадлежит
// одному владельцу — проверяется до вызова), userKey = uid, conversationKey =
// conversationId. Раннер сверяет пару при повторном старте (identity mismatch).

import { BROWSER_SCREENSHOT_HEADER, type BrowserScreenshotMetadata, type BrowserFramesResult, type BrowserCommandRequest, type BrowserInspectResult, type BrowserSelectorResult, type BrowserSessionMetadata, type BrowserViewport } from '@voicechat/shared'

export interface BrowserRunnerClientOptions {
  baseUrl: string
  token: string
  fetchImpl?: typeof fetch
  /** Таймаут одного вызова раннера, мс (навигация внутри Chromium — до 30 с). */
  timeoutMs?: number
}

/** Что возвращает раннер на команду — зависит от её типа. */
export type BrowserRunnerCommandResult = BrowserSessionMetadata | BrowserSelectorResult | BrowserInspectResult | BrowserFramesResult | BrowserSiteDataResetResult

/** Ошибка вызова раннера с кодом, пригодным для маппинга в HTTP-статус роута. */
export class BrowserRunnerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'BrowserRunnerError'
  }
}

const DEFAULT_TIMEOUT_MS = 35_000

export interface BrowserStartInput {
  profileMode?: BrowserProfileMode
  sessionId: string
  userKey: string
  conversationKey: string
  viewport?: BrowserViewport
  /** Cookie контекста: ключ доступа Chromium к прокси превью (см. `machinePreview`). */
  cookies?: Array<{ name: string; value: string; url: string }>
}

export interface BrowserRunnerClient {
  start(input: BrowserStartInput): Promise<BrowserSessionMetadata>
  /**
   * Ответ зависит от команды: навигация и вкладки отдают метаданные сессии,
   * `selector` — результат действия, `inspect` — журналы. Раньше тип обещал
   * только метаданные, и все три вызова в этапе приводили ответ через
   * `as unknown as …` — то есть тип не помогал, а мешал.
   */
  command(sessionId: string, request: BrowserCommandRequest, signal?: AbortSignal): Promise<BrowserRunnerCommandResult>
  screenshot(sessionId: string, request: BrowserCommandRequest, signal?: AbortSignal): Promise<{ buffer: Buffer; mimeType: string; metadata?: BrowserScreenshotMetadata }>
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
    let cancelled = false
    if (signal) {
      if (signal.aborted) { cancelled = true; abort.abort() }
      else signal.addEventListener('abort', () => { cancelled = true; abort.abort() }, { once: true })
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
      const aborted = err instanceof Error && err.name === 'AbortError'
      // Отмену человека нельзя выдавать за таймаут раннера: по такому тексту
      // идут искать беду в инфраструктуре, которой нет.
      if (aborted && cancelled) throw new BrowserRunnerError(499, 'Запрос к Browser Runner отменён')
      throw new BrowserRunnerError(502, aborted ? 'Browser Runner не ответил вовремя' : 'Browser Runner недоступен')
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
      return res.json() as Promise<BrowserRunnerCommandResult>
    },
    async screenshot(sessionId, request, signal) {
      // Сигнал слушают все методы, кроме этого: после отмены снимок висел до
      // собственного таймаута в 35 с.
      const res = await call(`/v1/sessions/${encodeURIComponent(sessionId)}/commands`, 'POST', request, signal)
      if (!res.ok) throw await asError(res)
      const mimeType = res.headers.get('content-type') ?? 'image/png'
      const buffer = Buffer.from(await res.arrayBuffer())
      const metadata = screenshotMetadata(res.headers.get(BROWSER_SCREENSHOT_HEADER))
      return { buffer, mimeType, ...(metadata ? { metadata } : {}) }
    },
    async stop(sessionId) {
      const res = await call(`/v1/sessions/${encodeURIComponent(sessionId)}`, 'DELETE')
      if (!res.ok) throw await asError(res)
      const data = await res.json() as { stopped?: boolean }
      return data.stopped === true
    }
  }
}

/** Старый раннер и повреждённый заголовок оставляют картинку без выдуманных координат. */
function screenshotMetadata(raw: string | null): BrowserScreenshotMetadata | undefined {
  if (!raw || raw.length > 8192) return undefined
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as BrowserScreenshotMetadata
    const rect = value?.rect
    if (typeof value?.page?.url !== 'string' || typeof value.page.title !== 'string' || !['css', 'device'].includes(value.scale)) return undefined
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return undefined
    return value
  } catch { return undefined }
}

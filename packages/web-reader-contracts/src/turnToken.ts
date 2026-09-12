// Токены ходов для MCP «browser» (`/mcp/preview?turn=`): кому и в каком разговоре модель управляет
// превью. Раньше это был in-memory брокер ядра — и ход CI, зарегистрированный в отдельном процессе
// канбана, ядро не знало (инструменты браузера у ранов в remote не работали). Подписанный токен
// проверяется в любом процессе без состояния: `HMAC(mcpSecret, {u, c, e})`. Живёт до `exp` (сутки —
// дольше рана), а не «ровно один ход»: без `?k=<секрет>` он бесполезен, а секрет у исполнителя и так есть.
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Ход, от имени которого модель управляет превью. */
export interface PreviewToolEntry {
  userId: string
  conversationId: string
  ciCheck?: { runId: string; stepId: string; url: string }
}

export interface PreviewTurnTokens {
  /** Токен для `?turn=` этого хода. */
  issue(entry: PreviewToolEntry): string
  /** Контекст хода по токену; `undefined` — подпись не сошлась или срок вышел. */
  verify(token: string): PreviewToolEntry | undefined
}

/** Сколько живёт токен: ран длиннее суток — это уже не ран. */
export const PREVIEW_TURN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

interface Payload { u: string; c: string; e: number; check?: PreviewToolEntry['ciCheck'] }

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createPreviewTurnTokens(secret: string, opts: { ttlMs?: number; now?: () => number } = {}): PreviewTurnTokens {
  const ttlMs = opts.ttlMs ?? PREVIEW_TURN_TOKEN_TTL_MS
  const now = opts.now ?? Date.now
  return {
    issue(entry) {
      const payload = Buffer.from(JSON.stringify({ u: entry.userId, c: entry.conversationId, e: now() + ttlMs, ...(entry.ciCheck ? { check: entry.ciCheck } : {}) } satisfies Payload)).toString('base64url')
      return `${payload}.${sign(secret, payload)}`
    },
    verify(token) {
      const dot = token.indexOf('.')
      if (dot < 1) return undefined
      const payload = token.slice(0, dot)
      const given = Buffer.from(token.slice(dot + 1))
      const expected = Buffer.from(sign(secret, payload))
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined
      let parsed: Payload
      try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Payload } catch { return undefined }
      if (typeof parsed.u !== 'string' || typeof parsed.c !== 'string' || typeof parsed.e !== 'number' || parsed.e <= now()) return undefined
      if (parsed.check && (typeof parsed.check.runId !== 'string' || typeof parsed.check.stepId !== 'string' || typeof parsed.check.url !== 'string')) return undefined
      return { userId: parsed.u, conversationId: parsed.c, ...(parsed.check ? { ciCheck: parsed.check } : {}) }
    }
  }
}

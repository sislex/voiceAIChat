// LlmClient поверх HTTP: вместо spawn открывает POST /v1/run у контейнера-исполнителя,
// разбирает NDJSON-конверты и кормит их содержимым те же парсеры stream-json/JSONL,
// что и локальный CLI (llm/sinks.ts). Поэтому turns.ts, CI-раннер и парсеры shared
// не отличают удалённый ход от локального.
//
// Отмена уходит на DELETE /v1/run/:id (id генерирует сервер ещё до запроса — иначе
// отмену до первого байта было бы некуда адресовать) и дополнительно рвёт поток.
// Ошибки транспорта переводятся в человеческий текст — аналог describeSpawnError:
// пользователь должен прочитать «исполнитель недоступен», а не сетевой стектрейс.

import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import type { LlmClient, LlmHandle, LlmRequest, LlmStreamHandlers } from '../claude/types.js'
import { createSink, type LlmStreamSink } from './sinks.js'
import {
  parseRunnerLine,
  runnerCancelUrl,
  runnerRunUrl,
  type RunnerKind,
  type RunnerRunBody
} from './protocol.js'

export interface RemoteLlmClientOptions {
  /** Какой CLI просим у исполнителя: от этого зависят парсер и тексты ошибок. */
  kind: RunnerKind
  /** База URL исполнителя, напр. http://runner-work:8080. */
  baseUrl: string
  /** Bearer-токен исполнителя (пусто — без авторизации, только закрытая сеть). */
  token?: string
  /** Сколько ждать ЗАГОЛОВКОВ ответа /v1/run; сам ход не ограничен. */
  connectTimeoutMs?: number
  /** Инъекция fetch (для тестов). */
  fetchImpl?: typeof fetch
}

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000

function label(kind: RunnerKind): string {
  return kind === 'codex' ? 'Codex' : 'Claude'
}

/** Первый code в цепочке причин: node fetch прячет ECONNREFUSED в err.cause. */
function errorCode(err: unknown): string | undefined {
  const seen = new Set<unknown>()
  let cur: unknown = err
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur)
    const code = (cur as { code?: unknown }).code
    if (typeof code === 'string') return code
    cur = (cur as { cause?: unknown }).cause
  }
  return undefined
}

function message(err: unknown): string {
  const cause = (err as { cause?: unknown })?.cause
  if (cause instanceof Error && cause.message) return cause.message
  return err instanceof Error ? err.message : String(err)
}

/** Обрыв потока в середине хода — самая частая беда и самая непонятная без текста. */
function describeBrokenStream(kind: RunnerKind, detail = ''): string {
  return (
    `Соединение с исполнителем ${label(kind)} оборвалось до конца ответа` +
    `${detail ? ` (${detail})` : ''} — ход остановлен. Повторите запрос.`
  )
}

// Обрыв соединения undici сообщает по-разному (ECONNRESET, UND_ERR_SOCKET,
// «terminated»), и разбирать это пользователю незачем.
const SOCKET_CODES = ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ERR_STREAM_PREMATURE_CLOSE']

/**
 * Падение УЖЕ открытого потока: что бы ни сказал транспорт, для пользователя это
 * обрыв хода. Незнакомую причину добавляем в скобках — иначе нечего чинить.
 */
function describeStreamFailure(kind: RunnerKind, err: unknown): string {
  const code = errorCode(err)
  return describeBrokenStream(kind, code && SOCKET_CODES.includes(code) ? '' : message(err))
}

/** Аналог describeSpawnError для HTTP-транспорта. */
function describeTransportError(kind: RunnerKind, url: string, err: unknown): string {
  const code = errorCode(err)
  switch (code) {
    case 'ECONNREFUSED':
      return (
        `Исполнитель ${label(kind)} недоступен: соединение с ${url} отклонено. ` +
        `Проверьте, что контейнер-исполнитель запущен.`
      )
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Адрес исполнителя ${label(kind)} не разрешается (${url}). Проверьте VC_LLM_RUNNER_URL.`
    case 'ECONNRESET':
    case 'EPIPE':
    case 'UND_ERR_SOCKET':
      return describeBrokenStream(kind)
    default:
      return `Не удалось связаться с исполнителем ${label(kind)} (${url}): ${message(err)}`
  }
}

/** Ненулевой HTTP-статус: чаще всего это токен или адрес, а не модель. */
function describeHttpError(kind: RunnerKind, url: string, status: number, body: string): string {
  const snippet = body.trim().slice(0, 300)
  if (status === 401 || status === 403) {
    return (
      `Исполнитель ${label(kind)} отклонил запрос (${status}): проверьте токен ` +
      `VC_LLM_RUNNER_TOKEN.`
    )
  }
  if (status === 404) {
    return `Исполнитель ${label(kind)} не отвечает на POST ${url} (404). Проверьте адрес исполнителя.`
  }
  return `Исполнитель ${label(kind)} вернул ошибку ${status}${snippet ? `: ${snippet}` : ''}`
}

export class RemoteLlmClient implements LlmClient {
  constructor(private readonly opts: RemoteLlmClientOptions) {}

  send(req: LlmRequest, handlers: LlmStreamHandlers): LlmHandle {
    const runId = randomUUID()
    const sink = createSink(this.opts.kind, handlers)
    const abort = new AbortController()
    let cancelled = false

    void this.pump(runId, req, sink, abort)

    return {
      cancel: () => {
        if (cancelled) return
        cancelled = true
        // Приёмник глушим сразу: события после отмены хода никому не нужны.
        sink.detach()
        // Сначала явная отмена у исполнителя (он убивает CLI), затем разрыв потока.
        void this.requestCancel(runId)
        abort.abort()
      }
    }
  }

  /** Читает NDJSON-поток хода до конверта exit; любой другой финал — ошибка. */
  private async pump(
    runId: string,
    req: LlmRequest,
    sink: LlmStreamSink,
    abort: AbortController
  ): Promise<void> {
    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch
    const url = runnerRunUrl(this.opts.baseUrl)
    const body: RunnerRunBody = { id: runId, kind: this.opts.kind, request: req }
    const connectTimeoutMs = this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      abort.abort()
    }, connectTimeoutMs)

    let res: Response
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json', accept: 'application/x-ndjson' }),
        body: JSON.stringify(body),
        signal: abort.signal
      })
    } catch (err) {
      sink.fail(
        timedOut
          ? `Исполнитель ${label(this.opts.kind)} (${url}) не ответил за ` +
            `${Math.round(connectTimeoutMs / 1000)} с — ход остановлен.`
          : describeTransportError(this.opts.kind, url, err)
      )
      return
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      sink.fail(describeHttpError(this.opts.kind, url, res.status, text))
      return
    }
    if (!res.body) {
      sink.fail(describeBrokenStream(this.opts.kind))
      return
    }

    let sawExit = false
    try {
      const stream = Readable.fromWeb(res.body as never)
      for await (const line of createInterface({ input: stream })) {
        const ev = parseRunnerLine(line)
        if (!ev) continue
        if (ev.t === 'out') sink.line(ev.s)
        else if (ev.t === 'err') sink.stderrChunk(ev.s)
        else {
          sawExit = true
          sink.exit(ev.code)
        }
      }
    } catch (err) {
      // Отменённый ход сюда тоже попадает (AbortError), но приёмник уже отключён.
      sink.fail(describeStreamFailure(this.opts.kind, err))
      return
    }
    // Поток закончился без exit: исполнитель упал или сеть порвалась — иначе ход
    // остался бы висеть до перезапуска сервера.
    if (!sawExit) sink.fail(describeBrokenStream(this.opts.kind))
  }

  /** DELETE /v1/run/:id — исполнитель гасит свой CLI. Ошибки отмены не важны. */
  private async requestCancel(runId: string): Promise<void> {
    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch
    // Отмена не должна висеть на мёртвом исполнителе: свой короткий дедлайн.
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 5_000)
    try {
      await fetchImpl(runnerCancelUrl(this.opts.baseUrl, runId), {
        method: 'DELETE',
        headers: this.headers(),
        signal: abort.signal
      })
    } catch {
      /* исполнитель сам убьёт осиротевший ран по таймауту чтения потока */
    } finally {
      clearTimeout(timer)
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.opts.token ? { ...extra, authorization: `Bearer ${this.opts.token}` } : extra
  }
}

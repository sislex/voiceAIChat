import { randomUUID } from 'node:crypto'
import type { PreviewAction, PreviewActionResult, ServerMessage } from '@voicechat/shared'

export const PREVIEW_MCP_PATH = '/mcp/preview'

/** Сколько ждём ответ клиента: действие в живой вкладке быстрое, но открытие
 *  страницы проходит через прокси превью с его 10-секундным лимитом. */
export const PREVIEW_ACTION_TIMEOUT_MS = 20_000

/** Итог действия, каким его вернул клиент (или каким его закрыл relay). */
export interface PreviewActionOutcome {
  ok: boolean
  result?: PreviewActionResult
  error?: string
}

interface PendingRequest {
  userId: string
  conversationId: string
  /** Скольким клиентам ушёл запрос — ждём первый успех или все отказы. */
  expected: number
  answered: number
  firstError?: string
  action: PreviewAction
  timer: NodeJS.Timeout
  resolve(outcome: PreviewActionOutcome): void
}

/**
 * Транспорт «сервер → клиенты пользователя» для действий превью. Сессии WS
 * подписываются на подключении; запрос уходит всем клиентам пользователя,
 * выполняет его только тот, у кого чат действия активен. Остальные отвечают
 * отказом — resolve ждёт первый успех, либо все отказы, либо таймаут.
 */
export class PreviewActionRelay {
  private readonly sinks = new Map<string, Set<(m: ServerMessage) => void>>()
  private readonly pending = new Map<string, PendingRequest>()

  subscribe(userId: string, sink: (m: ServerMessage) => void): () => void {
    const set = this.sinks.get(userId) ?? new Set()
    set.add(sink)
    this.sinks.set(userId, set)
    return () => {
      set.delete(sink)
      if (!set.size) this.sinks.delete(userId)
    }
  }

  /** Только для тестов: сколько живых запросов (проверка на утечку таймеров). */
  pendingCount(): number {
    return this.pending.size
  }

  request(
    userId: string,
    conversationId: string,
    action: PreviewAction,
    timeoutMs = PREVIEW_ACTION_TIMEOUT_MS
  ): Promise<PreviewActionOutcome> {
    const sinks = this.sinks.get(userId)
    if (!sinks?.size) {
      return Promise.resolve({
        ok: false,
        error: 'Клиент с открытым приложением не подключён — панель превью недоступна.'
      })
    }
    const requestId = randomUUID()
    return new Promise((resolvePromise) => {
      const settle = (outcome: PreviewActionOutcome): void => {
        const entry = this.pending.get(requestId)
        if (!entry) return
        clearTimeout(entry.timer)
        this.pending.delete(requestId)
        resolvePromise(outcome)
      }
      this.pending.set(requestId, {
        userId,
        conversationId,
        expected: sinks.size,
        answered: 0,
        action,
        timer: setTimeout(
          () => settle({ ok: false, error: 'Клиентский мост Web Reader не ответил при формально подключённом клиенте.' }),
          timeoutMs
        ),
        resolve: settle
      })
      const message: ServerMessage = { t: 'preview.action', conversationId, requestId, action }
      for (const sink of sinks) sink(message)
    })
  }

  /** Ответ клиента; чужой userId или неизвестный requestId молча игнорируются. */
  resolve(userId: string, requestId: string, outcome: PreviewActionOutcome, conversationId?: string): void {
    const entry = this.pending.get(requestId)
    if (!entry || entry.userId !== userId || (conversationId !== undefined && entry.conversationId !== conversationId)) return
    const error = typeof outcome.error === 'string' ? outcome.error.slice(0, 2_000) : undefined
    if (outcome.ok) {
      const result = outcome.result as { url?: unknown; title?: unknown; navigated?: unknown; page?: { url?: unknown; title?: unknown } } | undefined
      const address = typeof result?.url === 'string' ? result.url : typeof result?.page?.url === 'string' ? result.page.url : entry.action.kind === 'open' ? entry.action.url : null
      const title = typeof result?.title === 'string' ? result.title : typeof result?.page?.title === 'string' ? result.page.title : null
      const changed: ServerMessage = {
        t: 'reader.changed', conversationId: entry.conversationId, address, title,
        navigated: entry.action.kind === 'open' || entry.action.kind === 'back' || entry.action.kind === 'forward' || result?.navigated === true,
        action: entry.action
      }
      for (const sink of this.sinks.get(userId) ?? []) sink(changed)
      entry.resolve({ ok: true, ...(outcome.result !== undefined ? { result: outcome.result } : {}) })
      return
    }
    entry.answered += 1
    if (entry.firstError === undefined && error) entry.firstError = error
    if (entry.answered >= entry.expected) {
      entry.resolve({ ok: false, error: entry.firstError ?? 'Действие в превью не выполнено.' })
    }
  }
}

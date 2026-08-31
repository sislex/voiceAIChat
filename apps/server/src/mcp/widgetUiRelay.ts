// Транспорт «сервер → браузер пользователя → результат» для действий канбан-
// ассистента в интерфейсе: открыть ссылку, нажать команду палитры, открыть
// карточку, спросить подтверждение. Устроен как PreviewActionRelay: запрос
// уходит всем клиентам пользователя, выполняет его тот, у кого открыт проект
// разговора, остальные отвечают отказом — ждём первый успех, все отказы или
// таймаут.
//
// Почему через браузер, а не «сервер сам сделает»: пользователь должен видеть
// то же, что видит ассистент. Навигация и нажатая кнопка происходят у него на
// экране, а не в невидимой копии состояния.

import { randomUUID } from 'node:crypto'
import type { ServerMessage, WidgetUiAction, WidgetUiActionResult } from '@voicechat/shared'

/** Обычные действия быстрые; подтверждение ждёт человека и живёт дольше. */
export const WIDGET_UI_TIMEOUT_MS = 15_000
export const WIDGET_UI_CONFIRM_TIMEOUT_MS = 5 * 60_000

export interface WidgetUiOutcome {
  ok: boolean
  result?: WidgetUiActionResult
  error?: string
}

interface PendingRequest {
  userId: string
  conversationId: string
  expected: number
  answered: number
  firstError?: string
  timer: NodeJS.Timeout
  resolve(outcome: WidgetUiOutcome): void
}

/**
 * Сколько действий в интерфейсе ассистент может сделать за минуту. Цикл
 * `ui_navigate` без тормоза дёргает экран пользователя быстрее, чем тот успевает
 * читать, поэтому предел жёсткий и общий на разговор.
 */
export const WIDGET_UI_RATE_LIMIT = 40
const RATE_WINDOW_MS = 60_000

export class WidgetUiRelay {
  private readonly sinks = new Map<string, Set<(m: ServerMessage) => void>>()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly recent = new Map<string, number[]>()

  /** Скользящее окно: событие старше минуты в счёт не идёт. */
  private overLimit(conversationId: string, now: number): boolean {
    const stamps = (this.recent.get(conversationId) ?? []).filter((at) => now - at < RATE_WINDOW_MS)
    if (stamps.length >= WIDGET_UI_RATE_LIMIT) {
      this.recent.set(conversationId, stamps)
      return true
    }
    stamps.push(now)
    this.recent.set(conversationId, stamps)
    return false
  }

  subscribe(userId: string, sink: (m: ServerMessage) => void): () => void {
    const set = this.sinks.get(userId) ?? new Set()
    set.add(sink)
    this.sinks.set(userId, set)
    return () => {
      set.delete(sink)
      if (!set.size) this.sinks.delete(userId)
    }
  }

  /** Только для тестов: проверка, что таймеры не текут. */
  pendingCount(): number {
    return this.pending.size
  }

  request(
    userId: string,
    conversationId: string,
    projectId: string,
    action: WidgetUiAction,
    timeoutMs = action.kind === 'confirm' ? WIDGET_UI_CONFIRM_TIMEOUT_MS : WIDGET_UI_TIMEOUT_MS
  ): Promise<WidgetUiOutcome> {
    const sinks = this.sinks.get(userId)
    if (!sinks?.size) {
      return Promise.resolve({ ok: false, error: 'Приложение пользователя не подключено: интерфейсом сейчас управлять нельзя.' })
    }
    // Подтверждение не считаем: его инициирует не цикл модели, а её попытка
    // что-то изменить, и она уже ограничена самим ожиданием ответа человека.
    if (action.kind !== 'confirm' && this.overLimit(conversationId, Date.now())) {
      return Promise.resolve({ ok: false, error: `Слишком много действий в интерфейсе подряд (предел ${WIDGET_UI_RATE_LIMIT} в минуту). Останови цикл и объясни пользователю, что происходит.` })
    }
    const requestId = randomUUID()
    return new Promise((resolvePromise) => {
      const settle = (outcome: WidgetUiOutcome): void => {
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
        timer: setTimeout(() => settle({
          ok: false,
          error: action.kind === 'confirm'
            ? 'Пользователь не ответил на запрос подтверждения.'
            : 'Приложение подключено, но не ответило на действие в интерфейсе.'
        }), timeoutMs),
        resolve: settle
      })
      const message: ServerMessage = { t: 'widget.action', conversationId, projectId, requestId, action }
      for (const sink of sinks) sink(message)
    })
  }

  /** Ответ клиента; чужой userId или неизвестный requestId молча игнорируются. */
  resolve(userId: string, requestId: string, outcome: WidgetUiOutcome, conversationId?: string): void {
    const entry = this.pending.get(requestId)
    if (!entry || entry.userId !== userId || (conversationId !== undefined && entry.conversationId !== conversationId)) return
    if (outcome.ok) {
      entry.resolve({ ok: true, ...(outcome.result !== undefined ? { result: outcome.result } : {}) })
      return
    }
    entry.answered += 1
    const error = typeof outcome.error === 'string' ? outcome.error.slice(0, 2_000) : undefined
    if (entry.firstError === undefined && error) entry.firstError = error
    if (entry.answered >= entry.expected) {
      entry.resolve({ ok: false, error: entry.firstError ?? 'Действие в интерфейсе не выполнено.' })
    }
  }
}

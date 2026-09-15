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
/** Короткая фраза о том, что изменилось после действия; пусто — нечего добавить к подписи. */
function narrate(kind: string, result: Record<string, unknown> | undefined, address: string | null): string {
  if (!result) return ''
  const host = (): string => { try { return address ? new URL(address).host : '' } catch { return '' } }
  const dialogs = Array.isArray(result.dialogs) ? result.dialogs.length : 0
  if ((kind === 'click' || kind === 'press' || kind === 'choose') && dialogs) return 'открылось окно'
  if ((kind === 'click' || kind === 'type' || kind === 'press' || kind === 'fill' || kind === 'choose') && result.navigated === true) return host() ? `перешёл на ${host()}` : 'перешёл на другую страницу'
  if (kind === 'open' && result.crossSite === true) return host() ? `перешёл на другой сайт: ${host()}` : 'перешёл на другой сайт'
  if (kind === 'open' && result.redirected === true) return host() ? `перенаправлено на ${host()}` : 'перенаправлено'
  if (result.needsConfirmation === true) return `ждёт подтверждения: ${typeof result.reason === 'string' ? result.reason : 'опасное действие'}`
  if (kind === 'click' && typeof result.obscuredBy === 'string') return 'цель перекрыта другим элементом'
  if (kind === 'click' && result.peeked === true) return typeof result.href === 'string' ? `ссылка ведёт на ${(() => { try { return new URL(result.href as string).host } catch { return result.href as string } })()}${result.external === true ? ' (другой сайт)' : ''}` : 'у элемента нет адреса'
  if (kind === 'bookmark' && Array.isArray(result.bookmarks)) return result.removed ? 'убрал закладку' : `запомнил страницу, закладок ${result.bookmarks.length}`
  if (kind === 'scroll' && typeof result.screens === 'number') return `пролистал ${result.screens} ${result.screens === 1 ? 'экран' : 'экрана'} до нужного места`
  if (kind === 'search' && typeof result.query === 'string') return `искал на сайте «${result.query}»`
  if (kind === 'select' && typeof result.selected === 'string' && result.selected) return `выделил «${result.selected.slice(0, 40)}${result.selected.length > 40 ? '…' : ''}»`
  if (kind === 'focus') return 'поставил курсор в поле'
  if (kind === 'dismiss') return result.dismissed === true ? (result.how === 'rejected' ? 'отклонил cookie' : result.how === 'accepted' ? 'принял cookie — иного выбора не было' : 'закрыл окно') : 'закрывать было нечего'
  const changes = result.changes as { addedTotal?: number; removedTotal?: number } | undefined
  if (kind === 'click' && changes && ((changes.addedTotal ?? 0) || (changes.removedTotal ?? 0))) return `на странице появилось ${changes.addedTotal ?? 0}, исчезло ${changes.removedTotal ?? 0}`
  if (kind === 'sequence' && typeof result.completed === 'number' && typeof result.total === 'number') return `${result.completed} из ${result.total} шагов`
  if (kind === 'fill' && Array.isArray(result.filled)) return `заполнил ${result.filled.length} ${result.filled.length === 1 ? 'поле' : 'поля'}${Array.isArray(result.missing) && result.missing.length ? `, не нашёл ${result.missing.length}` : ''}`
  if ((kind === 'click' || kind === 'type') && typeof result.waitedMs === 'number' && result.waitedMs > 0) return `дождался цели за ${Math.round(result.waitedMs / 100) / 10} с`
  if ((kind === 'type' || kind === 'fill') && Array.isArray(result.validation) && result.validation.length) return `${result.validation.length} ${result.validation.length === 1 ? 'ошибка' : 'ошибки'} формы`
  return ''
}

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
        error: `Панель Web Reader не подключена: у пользователя нет открытой вкладки приложения. Попроси его открыть раздел Web Reader этого чата (#/web-reader/${conversationId}) и повтори действие.`
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
          () => settle({ ok: false, error: 'Панель Web Reader не ответила: вкладка приложения открыта, но раздел Web Reader этого чата в ней не активен. Попроси пользователя переключиться на него и повтори.' }),
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
      // Итог действия едет в ленту панели словами: проверка — «пройдено/не пройдено», клик — «открылось окно»
      // или «перешёл на host», open — «перенаправлено». Человек читает ленту как рассказ, а не как список команд.
      const check = entry.action.kind === 'check' && result && typeof (result as { summary?: unknown }).summary === 'string' ? result as { summary: string; pass?: unknown } : null
      const navigated = entry.action.kind === 'open' || entry.action.kind === 'back' || entry.action.kind === 'forward' || result?.navigated === true
      const summary = check ? check.summary.slice(0, 200) : narrate(entry.action.kind, result as Record<string, unknown> | undefined, address)
      const changed: ServerMessage = {
        t: 'reader.changed', conversationId: entry.conversationId, address, title,
        navigated,
        action: entry.action,
        ...(summary ? { summary } : {}), ...(check ? { ok: check.pass === true } : {})
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

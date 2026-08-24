// MCP-эндпоинт «browser»: инструменты модели для управления панелью веб-превью
// пользователя (открыть URL, найти элемент, клик, ввод текста, структурированное
// чтение DOM). Сама страница живёт в браузере пользователя, поэтому сервер не
// исполняет действия: он транслирует их подключённым клиентам кадром
// `preview.action` и ждёт `preview.result`. Действие выполняет только клиент,
// у которого этот чат активен, — так модель ограничена активной страницей
// пользователя, а не произвольным браузингом.
//
// Устройство как у kb-эндпоинта: stateless (свежий McpServer на POST), доступ
// по секрету процесса `?k=`, ход адресуется токеном `?turn=` через in-memory
// брокер (выдаёт и снимает TurnManager).

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  PREVIEW_ACTION_LIMITS,
  isHttpUrl,
  previewResultJson,
  type PreviewAction,
  type PreviewActionResult,
  type ProjectTestUser,
  type ServerMessage
} from '@voicechat/shared'
import { MACHINE_PREVIEW_ALIAS_HOST, MACHINE_PREVIEW_SUFFIX } from '../routes/previewProxy.js'

export const PREVIEW_MCP_PATH = '/mcp/preview'

/** Сколько ждём ответ клиента: действие в живой вкладке быстрое, но открытие
 *  страницы проходит через прокси превью с его 10-секундным лимитом. */
export const PREVIEW_ACTION_TIMEOUT_MS = 20_000

/** Ход, от имени которого модель управляет превью (регистрирует turns.ts). */
export interface PreviewToolEntry {
  userId: string
  conversationId: string
}

/** In-memory брокер: токен хода → контекст. Токен живёт ровно один ход. */
class PreviewToolBroker {
  private readonly map = new Map<string, PreviewToolEntry>()
  register(token: string, entry: PreviewToolEntry): void {
    this.map.set(token, entry)
  }
  unregister(token: string): void {
    this.map.delete(token)
  }
  get(token: string): PreviewToolEntry | undefined {
    return this.map.get(token)
  }
  /** Только для тестов: сколько токенов держим (проверка на утечку). */
  size(): number {
    return this.map.size
  }
}

export const previewToolBroker = new PreviewToolBroker()

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

/**
 * Контекст тестовых окружений хода: машина разговора (для алиаса
 * machine.internal) и тестовые учётки проекта (инструмент test-users).
 */
export interface PreviewTurnContext {
  /** agentId машины разговора или null (нет машины / нет доступа). */
  machineOf(entry: PreviewToolEntry): string | null
  /** Тестовые пользователи проекта разговора (пусто — не заведены). */
  testUsersOf(entry: PreviewToolEntry): ProjectTestUser[]
}

export interface RegisterPreviewMcpOptions {
  secret: string
  relay: PreviewActionRelay
  broker?: PreviewToolBroker
  /** Контекст машин/тестовых пользователей; без него алиас и test-users недоступны. */
  context?: PreviewTurnContext
  /** Таймаут ожидания клиента (переопределяется в тестах). */
  timeoutMs?: number
}

/** Ответ инструмента: результат действия сериализованным JSON либо ошибка. */
function toolResult(outcome: PreviewActionOutcome): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  if (!outcome.ok) {
    return { content: [{ type: 'text', text: outcome.error ?? 'Действие в превью не выполнено.' }], isError: true }
  }
  if (outcome.result === undefined) return { content: [{ type: 'text', text: '{}' }] }
  const json = previewResultJson(outcome.result)
  if (json === null) {
    return {
      content: [{ type: 'text', text: 'Результат слишком большой. Сузь запрос: read с selector или find с меньшим limit.' }],
      isError: true
    }
  }
  return { content: [{ type: 'text', text: json }] }
}

export function registerPreviewMcp(app: FastifyInstance, opts: RegisterPreviewMcpOptions): void {
  const broker = opts.broker ?? previewToolBroker
  // Свой scope с парсером-пустышкой — тело читает транспорт MCP-SDK (см. kbMcp.ts).
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', (_req, _payload, done) => {
      done(null, undefined)
    })
    scope.post<{ Querystring: { k?: string; turn?: string } }>(PREVIEW_MCP_PATH, async (req, reply) => {
      if (req.query.k !== opts.secret) return reply.code(403).send({ error: 'forbidden' })
      const entry = broker.get(req.query.turn ?? '')
      const server = new McpServer({ name: 'browser', version: '1.0.0' })
      const noContext = {
        content: [{ type: 'text' as const, text: 'Контекст хода недоступен: действие в превью не выполнено.' }],
        isError: true
      }
      const run = async (action: PreviewAction): Promise<ReturnType<typeof toolResult>> => {
        if (!entry) return noContext
        const outcome = await opts.relay.request(entry.userId, entry.conversationId, action, opts.timeoutMs)
        return toolResult(outcome)
      }
      const L = PREVIEW_ACTION_LIMITS

      server.registerTool(
        'open',
        {
          description:
            'Открыть сайт в панели веб-превью пользователя. Адрес сохраняется как превью текущего чата. ' +
            'Только HTTP/HTTPS. Тестовое окружение на машине этого разговора открывается адресом ' +
            'http://machine.internal:<порт>/ — запрос уйдёт на 127.0.0.1:<порт> машины.',
          inputSchema: { url: z.string().max(L.url).describe('Полный адрес с протоколом http:// или https://') }
        },
        async ({ url }) => {
          if (!isHttpUrl(url)) {
            return { content: [{ type: 'text', text: 'Разрешены только HTTP и HTTPS адреса с протоколом.' }], isError: true }
          }
          let target = url
          const parsed = new URL(url)
          // Алиас «машина разговора»: канонизируем до <agentId>.machine.internal,
          // чтобы страница и все её под-запросы держали конкретную машину.
          if (parsed.hostname === MACHINE_PREVIEW_ALIAS_HOST) {
            const agentId = entry && opts.context ? opts.context.machineOf(entry) : null
            if (!agentId) {
              return {
                content: [{ type: 'text', text: 'У этого разговора нет доступной машины — выбери машину в настройках разговора, чтобы открывать её тестовое окружение.' }],
                isError: true
              }
            }
            parsed.hostname = agentId + MACHINE_PREVIEW_SUFFIX
            target = parsed.toString()
          }
          return run({ kind: 'open', url: target })
        }
      )

      server.registerTool(
        'hover',
        {
          description:
            'Навести курсор на элемент открытой в превью страницы (pointer/mouse-события): раскрывает выпадающие ' +
            'меню и hover-состояния. Нужен selector или text.',
          inputSchema: {
            selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента'),
            text: z.string().max(L.text).optional().describe('Видимый текст элемента')
          }
        },
        async ({ selector, text }) => {
          if (!text && !selector) {
            return { content: [{ type: 'text', text: 'Укажи selector или text.' }], isError: true }
          }
          return run({ kind: 'hover', ...(selector ? { selector } : {}), ...(text ? { text } : {}) })
        }
      )

      server.registerTool(
        'scroll',
        {
          description:
            'Прокрутить открытую в превью страницу или контейнер: to — к краю, dy — на пиксели (отрицательное — вверх). ' +
            'Полезно для лент с ленивой подгрузкой. Возвращает позицию прокрутки.',
          inputSchema: {
            selector: z.string().max(L.selector).optional().describe('CSS-селектор прокручиваемого контейнера (без него — окно)'),
            to: z.enum(['top', 'bottom']).optional().describe('Прокрутить к началу или концу'),
            dy: z.number().optional().describe('Сдвиг в пикселях (отрицательное значение — вверх)')
          }
        },
        async ({ selector, to, dy }) => {
          if (to === undefined && typeof dy !== 'number') {
            return { content: [{ type: 'text', text: 'Укажи to (top|bottom) или dy (пиксели).' }], isError: true }
          }
          return run({ kind: 'scroll', ...(selector ? { selector } : {}), ...(to ? { to } : {}), ...(typeof dy === 'number' ? { dy } : {}) })
        }
      )

      server.registerTool(
        'press',
        {
          description:
            'Нажать клавишу на открытой в превью странице (keydown+keyup): Escape, Enter, Tab, ArrowDown и т. п. ' +
            'selector фокусирует элемент перед нажатием; без него — активный элемент страницы.',
          inputSchema: {
            key: z.string().min(1).max(32).describe('Имя клавиши как в KeyboardEvent.key (Escape, Enter, ArrowDown, a…)'),
            selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента-получателя')
          }
        },
        async ({ key, selector }) => run({ kind: 'press', key, ...(selector ? { selector } : {}) })
      )

      server.registerTool(
        'test-users',
        {
          description:
            'Тестовые учётные записи проекта этого разговора для входа в тестовое окружение (логин, пароль, роль). ' +
            'Это заведомо тестовые креды: используй их с type/click на форме логина открытого окружения.',
          inputSchema: {}
        },
        async () => {
          if (!entry) return noContext
          const users = opts.context?.testUsersOf(entry) ?? []
          if (!users.length) {
            return { content: [{ type: 'text', text: 'У проекта нет тестовых пользователей. Их заводят в настройках проекта (секция «Тестовые пользователи»).' }] }
          }
          return { content: [{ type: 'text', text: JSON.stringify(users) }] }
        }
      )

      server.registerTool(
        'read',
        {
          description:
            'Структурированное содержимое открытой в превью страницы: заголовки, ссылки, кнопки, поля ввода ' +
            'и текстовая выжимка. selector ограничивает чтение поддеревом.',
          inputSchema: { selector: z.string().max(L.selector).optional().describe('CSS-селектор поддерева (без него — вся страница)') }
        },
        async ({ selector }) => run({ kind: 'read', ...(selector ? { selector } : {}) })
      )

      server.registerTool(
        'find',
        {
          description:
            'Найти элементы на открытой в превью странице по видимому тексту или CSS-селектору. ' +
            'Возвращает селекторы для click/type. Нужен text или selector.',
          inputSchema: {
            text: z.string().max(L.text).optional().describe('Видимый текст элемента (регистр не важен)'),
            selector: z.string().max(L.selector).optional().describe('CSS-селектор'),
            limit: z.number().optional().describe(`Максимум элементов (по умолчанию ${L.findDefault}, не больше ${L.findMax})`)
          }
        },
        async ({ text, selector, limit }) => {
          if (!text && !selector) {
            return { content: [{ type: 'text', text: 'Укажи text или selector.' }], isError: true }
          }
          return run({
            kind: 'find',
            ...(text ? { text } : {}),
            ...(selector ? { selector } : {}),
            ...(typeof limit === 'number' ? { limit } : {})
          })
        }
      )

      server.registerTool(
        'click',
        {
          description:
            'Клик по элементу открытой в превью страницы: по CSS-селектору или по видимому тексту ' +
            '(кликается ближайший кликабельный элемент). Нужен selector или text.',
          inputSchema: {
            selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента'),
            text: z.string().max(L.text).optional().describe('Видимый текст элемента')
          }
        },
        async ({ selector, text }) => {
          if (!text && !selector) {
            return { content: [{ type: 'text', text: 'Укажи selector или text.' }], isError: true }
          }
          return run({ kind: 'click', ...(selector ? { selector } : {}), ...(text ? { text } : {}) })
        }
      )

      server.registerTool(
        'type',
        {
          description:
            'Ввести текст в поле открытой в превью страницы (CSS-селектор поля). submit: true — отправить форму после ввода.',
          inputSchema: {
            selector: z.string().max(L.selector).describe('CSS-селектор поля ввода'),
            text: z.string().max(L.text).describe('Текст для ввода'),
            submit: z.boolean().optional().describe('Отправить форму после ввода')
          }
        },
        async ({ selector, text, submit }) => run({ kind: 'type', selector, text, ...(submit !== undefined ? { submit } : {}) })
      )

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      reply.hijack()
      try {
        await server.connect(transport)
        await transport.handleRequest(req.raw, reply.raw)
      } catch (err) {
        if (!reply.raw.writableEnded) {
          try {
            reply.raw.writeHead(500, { 'content-type': 'application/json' })
            reply.raw.end(JSON.stringify({ error: err instanceof Error ? err.message : 'mcp transport error' }))
          } catch {
            /* соединение уже закрыто */
          }
        }
      }
    })
  })
}

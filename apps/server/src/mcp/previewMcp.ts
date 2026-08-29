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
      const result = outcome.result as { url?: unknown; title?: unknown; navigated?: unknown } | undefined
      const address = typeof result?.url === 'string' ? result.url : entry.action.kind === 'open' ? entry.action.url : null
      const title = typeof result?.title === 'string' ? result.title : null
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

/**
 * Контекст тестовых окружений хода: машина разговора (для алиаса
 * machine.internal) и тестовые учётки проекта (инструмент test-users).
 */
/** Feature-preview окружение проекта в форме, пригодной для open Reader-ом. */
export interface PreviewEnvironmentInfo {
  taskId: string
  branch: string
  state: string
  healthy: boolean
  /** Адрес приложения окружения уже в форме http://<agentId>.machine.internal:<port>/. */
  appUrl: string | null
  storybookUrl: string | null
}

export interface PreviewTurnContext {
  /** agentId машины разговора или null (нет машины / нет доступа). */
  machineOf(entry: PreviewToolEntry): string | null
  /** Тестовые пользователи проекта разговора (пусто — не заведены). */
  testUsersOf(entry: PreviewToolEntry): ProjectTestUser[]
  /** Активные feature-preview окружения проекта разговора. */
  environmentsOf?(entry: PreviewToolEntry): PreviewEnvironmentInfo[]
  /** Сброс cookie-контейнера превью пользователя (host сужает до одного сайта). */
  clearCookies?(entry: PreviewToolEntry, host?: string): number
  /** Проектная/ролевая политика evaluate; audit вызывается для любого вердикта. */
  gateEvaluate?(entry: PreviewToolEntry, code: string, confirmed: boolean): { allowed: boolean; needsConfirmation?: boolean; reason?: string }
}

export interface RegisterPreviewMcpOptions {
  secret: string
  relay: PreviewActionRelay
  broker?: PreviewToolBroker
  /** Контекст машин/тестовых пользователей; без него алиас и test-users недоступны. */
  context?: PreviewTurnContext
  /** Таймаут ожидания клиента (переопределяется в тестах). */
  timeoutMs?: number
  /**
   * Исполнитель для разговоров Playwright Reader: их страница живёт в
   * изолированном Chromium сервера, а не в браузере пользователя, поэтому relay
   * туда не достаёт. Возвращает `null`, если разговор не тот или раннер не
   * настроен — тогда действие идёт прежним путём.
   */
  browserExecutor?: (userId: string, conversationId: string, action: PreviewAction) => Promise<PreviewActionOutcome | null>
  /**
   * Снимок из изолированного Chromium. Отдельно от `browserExecutor`, потому что
   * возвращает картинку `dataUrl`, а не структуру действия; `null` — «этот
   * разговор не про изолированный браузер, иди обычным путём».
   */
  browserScreenshot?: (userId: string, conversationId: string, args: { selector?: string }) => Promise<PreviewActionOutcome | null>
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
        // Playwright Reader исполняет действие на сервере; остальные разговоры —
        // в браузере пользователя, как раньше.
        const direct = await opts.browserExecutor?.(entry.userId, entry.conversationId, action)
        if (direct) return toolResult(direct)
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
        'screenshot',
        {
          description:
            'Скриншот открытой в превью страницы: элемента по CSS-селектору, области rect (координаты документа) ' +
            'или видимой части без аргументов. Возвращает картинку — используй, когда важен внешний вид, а не текст.',
          inputSchema: {
            selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента для снимка'),
            rect: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).optional().describe('Область в координатах документа страницы')
          }
        },
        async ({ selector, rect }) => {
          if (!entry) return noContext
          // Единственный инструмент со своим транспортом: он отдаёт картинку, а
          // не JSON. Из-за этого он же дольше всех ходил мимо browserExecutor —
          // в Playwright Reader снимок уходил в браузер пользователя, где
          // страницы этого разговора нет, и модель оставалась без вида страницы.
          // `rect` координатами документа раннер не поддерживает: у него снимок
          // либо вьюпорта, либо узла по селектору.
          const direct = await opts.browserScreenshot?.(entry.userId, entry.conversationId, { ...(selector ? { selector } : {}) })
          const outcome = direct ?? await opts.relay.request(entry.userId, entry.conversationId, {
            kind: 'screenshot',
            ...(selector ? { selector } : {}),
            ...(rect ? { rect } : {})
          }, opts.timeoutMs)
          if (!outcome.ok) return toolResult(outcome)
          const result = outcome.result as { dataUrl?: string; rect?: { x: number; y: number; width: number; height: number } } | undefined
          const match = typeof result?.dataUrl === 'string' ? /^data:(image\/[a-z+]+);base64,(.+)$/.exec(result.dataUrl) : null
          if (!match) {
            return { content: [{ type: 'text' as const, text: 'Снимок не получен: страница не вернула картинку.' }], isError: true }
          }
          const where = result?.rect ? `x=${result.rect.x}, y=${result.rect.y}, ${result.rect.width}×${result.rect.height} px` : ''
          return {
            content: [
              { type: 'image' as const, data: match[2], mimeType: match[1] },
              { type: 'text' as const, text: `Скриншот области страницы${where ? ` (${where})` : ''}.` }
            ]
          }
        }
      )

      server.registerTool(
        'errors',
        {
          description:
            'Накопленные ошибки открытой в превью страницы: JS-исключения, unhandledrejection, console.error и ' +
            'упавшие fetch/XHR (статус и реальный URL). Проверяй после действий при тестировании фич. clear очищает буфер.',
          inputSchema: { clear: z.boolean().optional().describe('Очистить буфер после чтения') }
        },
        async ({ clear }) => run({ kind: 'errors', ...(clear !== undefined ? { clear } : {}) })
      )

      server.registerTool(
        'wait',
        {
          description:
            'Дождаться появления элемента на открытой в превью странице (асинхронные SPA): CSS-селектор или видимый текст, ' +
            'таймаут до 8000 мс (по умолчанию 5000). Возвращает найденный элемент и время ожидания.',
          inputSchema: {
            selector: z.string().max(L.selector).optional().describe('CSS-селектор ожидаемого элемента'),
            text: z.string().max(L.text).optional().describe('Видимый текст ожидаемого элемента'),
            timeoutMs: z.number().positive().max(8_000).optional().describe('Таймаут ожидания, мс')
          }
        },
        async ({ selector, text, timeoutMs }) => {
          if (!selector && !text) {
            return { content: [{ type: 'text', text: 'Укажи selector или text.' }], isError: true }
          }
          return run({ kind: 'wait', ...(selector ? { selector } : {}), ...(text ? { text } : {}), ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}) })
        }
      )

      server.registerTool(
        'back',
        {
          description: 'Назад по истории открытой в превью страницы. После перехода перечитай страницу read.',
          inputSchema: {}
        },
        async () => run({ kind: 'back' })
      )

      server.registerTool(
        'forward',
        {
          description: 'Вперёд по истории открытой в превью страницы (после back). После перехода перечитай страницу read.',
          inputSchema: {}
        },
        async () => run({ kind: 'forward' })
      )

      server.registerTool(
        'network',
        {
          description:
            'Журнал сетевых запросов открытой в превью страницы (fetch/XHR/beacon): метод, реальный URL, статус, ' +
            'длительность. filter — подстрока URL. Проверяй, какие запросы ушли и с какими статусами.',
          inputSchema: {
            filter: z.string().max(300).optional().describe('Подстрока URL для фильтрации'),
            clear: z.boolean().optional().describe('Очистить журнал после чтения'),
            limit: z.number().positive().max(L.logMax).optional().describe(`Максимум записей (по умолчанию ${L.logDefault})`)
          }
        },
        async ({ filter, clear, limit }) => run({ kind: 'network', ...(filter ? { filter } : {}), ...(clear !== undefined ? { clear } : {}), ...(typeof limit === 'number' ? { limit } : {}) })
      )

      server.registerTool(
        'console',
        {
          description:
            'Журнал консоли открытой в превью страницы: console.log/info/warn/error. pattern — подстрока сообщения, ' +
            'level — только один уровень. Используй для отладки: добавь console.log в код и читай его здесь.',
          inputSchema: {
            pattern: z.string().max(300).optional().describe('Подстрока сообщения для фильтрации'),
            level: z.enum(['log', 'info', 'warn', 'error']).optional().describe('Только этот уровень'),
            clear: z.boolean().optional().describe('Очистить журнал после чтения'),
            limit: z.number().positive().max(L.logMax).optional().describe(`Максимум записей (по умолчанию ${L.logDefault})`)
          }
        },
        async ({ pattern, level, clear, limit }) => run({ kind: 'console', ...(pattern ? { pattern } : {}), ...(level ? { level } : {}), ...(clear !== undefined ? { clear } : {}), ...(typeof limit === 'number' ? { limit } : {}) })
      )

      server.registerTool(
        'evaluate',
        {
          description:
            'Выполнить JavaScript в контексте открытой в превью страницы и получить JSON результата (await для промисов). ' +
            'Для чтения состояния приложения, вызова функций страницы и нестандартных контролов, недоступных click/type.',
          inputSchema: {
            code: z.string().min(1).max(L.evaluateCode).describe('JS-выражение или код; результат сериализуется JSON'),
            confirm: z.boolean().optional().describe('true — пользователь явно подтвердил изменение страницы/хранилища/сети')
          }
        },
        async ({ code, confirm }) => {
          if (!entry) return noContext
          const verdict = opts.context?.gateEvaluate?.(entry, code, confirm === true)
          req.log.info({ event: 'reader.evaluate', userId: entry.userId, conversationId: entry.conversationId, allowed: verdict?.allowed ?? true, confirmed: confirm === true, reason: verdict?.reason }, 'reader evaluate gate')
          if (verdict && !verdict.allowed) {
            const prefix = verdict.needsConfirmation ? 'Требуется подтверждение пользователя. ' : 'Отклонено политикой проекта. '
            return { content: [{ type: 'text', text: prefix + (verdict.reason ?? '') }], isError: true }
          }
          return run({ kind: 'evaluate', code })
        }
      )

      const dragPoint = z.object({
        selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента (центр)'),
        x: z.number().optional().describe('Координата X вьюпорта'),
        y: z.number().optional().describe('Координата Y вьюпорта')
      })
      server.registerTool(
        'drag',
        {
          description:
            'Перетащить элемент открытой в превью страницы (канбан, сортировка, слайдеры): pointer-события ' +
            'от from к to (или HTML5 DnD у draggable-элементов). Точка — {selector} или {x, y}.',
          inputSchema: { from: dragPoint.describe('Откуда'), to: dragPoint.describe('Куда') }
        },
        async ({ from, to }) => {
          const valid = (p: { selector?: string; x?: number; y?: number }): boolean => Boolean(p.selector) || (typeof p.x === 'number' && typeof p.y === 'number')
          if (!valid(from) || !valid(to)) {
            return { content: [{ type: 'text', text: 'У from и to укажи selector либо пару x и y.' }], isError: true }
          }
          return run({ kind: 'drag', from, to })
        }
      )

      server.registerTool(
        'set',
        {
          description:
            'Установить значение сложного контрола формы на открытой в превью странице: select (value или видимая подпись option), ' +
            'checkbox/radio (checked), date/range/текстовые поля (value). События input/change диспатчатся как при живом вводе.',
          inputSchema: {
            selector: z.string().max(L.selector).describe('CSS-селектор контрола'),
            value: z.string().max(L.text).optional().describe('Значение (для select — value или подпись option)'),
            checked: z.boolean().optional().describe('Для checkbox/radio')
          }
        },
        async ({ selector, value, checked }) => {
          if (value === undefined && checked === undefined) {
            return { content: [{ type: 'text', text: 'Укажи value или checked.' }], isError: true }
          }
          return run({ kind: 'set', selector, ...(value !== undefined ? { value } : {}), ...(checked !== undefined ? { checked } : {}) })
        }
      )

      server.registerTool(
        'upload',
        {
          description:
            'Загрузить файл в input type=file открытой в превью страницы: содержимое передаётся base64 (до ~1 МБ). ' +
            'Диспатчит input/change как при выборе файла пользователем.',
          inputSchema: {
            selector: z.string().max(L.selector).describe('CSS-селектор input type=file'),
            name: z.string().min(1).max(255).describe('Имя файла (например report.csv)'),
            base64: z.string().min(1).max(L.uploadBase64).describe('Содержимое файла в base64'),
            mimeType: z.string().max(100).optional().describe('MIME-тип (по умолчанию application/octet-stream)')
          }
        },
        async ({ selector, name, base64, mimeType }) => run({ kind: 'upload', selector, name, base64, ...(mimeType ? { mimeType } : {}) })
      )

      server.registerTool(
        'viewport',
        {
          description:
            'Ширина вьюпорта превью в пикселях — проверка мобильной и планшетной вёрстки (375, 768, 1024…). ' +
            '0 — вернуть адаптив (по ширине панели). Исполняет Reader, страница просто переверстается.',
          inputSchema: { width: z.number().min(0).max(10_000).describe('Ширина в px; 0 — адаптив') }
        },
        async ({ width }) => run({ kind: 'viewport', width })
      )

      server.registerTool(
        'a11y',
        {
          description:
            'Дерево доступности открытой в превью страницы: роли и имена элементов, как их видит скринридер ' +
            '(button «Сохранить», textbox «Пароль»), с селекторами для click/type. Компактнее read для навигации по UI.',
          inputSchema: {
            selector: z.string().max(L.selector).optional().describe('CSS-селектор поддерева (без него — вся страница)'),
            limit: z.number().positive().max(L.a11yNodes).optional().describe(`Максимум узлов (по умолчанию ${L.a11yNodes})`)
          }
        },
        async ({ selector, limit }) => run({ kind: 'a11y', ...(selector ? { selector } : {}), ...(typeof limit === 'number' ? { limit } : {}) })
      )

      server.registerTool(
        'edits',
        {
          description:
            'Правки, сделанные пользователем в режиме «Редактировать» на открытой странице (selector → стили/текст/удаление). ' +
            'Используй, когда просят «сделай как я поправил»: перенеси эти правки в исходники проекта.',
          inputSchema: {}
        },
        async () => run({ kind: 'edits' })
      )

      server.registerTool(
        'reset-session',
        {
          description:
            'Сбросить cookie-сессии превью (логины в окружениях/сайтах): без host — все, с host — только один сайт. ' +
            'Используй, чтобы перелогиниться под другим тестовым пользователем.',
          inputSchema: { host: z.string().max(255).optional().describe('Домен сайта (например agent-1.machine.internal); без него — все сайты') }
        },
        async ({ host }) => {
          if (!entry) return noContext
          if (!opts.context?.clearCookies) {
            return { content: [{ type: 'text', text: 'Сброс сессий недоступен на этом сервере.' }], isError: true }
          }
          const cleared = opts.context.clearCookies(entry, host)
          return { content: [{ type: 'text', text: `Сброшено cookie: ${cleared}. Открой страницу заново (open), чтобы увидеть разлогиненное состояние.` }] }
        }
      )

      server.registerTool(
        'environment',
        {
          description:
            'Активные feature-preview окружения проекта этого разговора: адрес для open (machine.internal), ' +
            'ветка, состояние и готовность. Открой appUrl и тестируй фичу задачи.',
          inputSchema: {}
        },
        async () => {
          if (!entry) return noContext
          const environments = opts.context?.environmentsOf?.(entry) ?? []
          if (!environments.length) {
            return { content: [{ type: 'text', text: 'У проекта разговора нет активных feature-preview окружений. Запусти окружение из карточки задачи (секция «Тестовое окружение») либо подними dev-сервер на машине и открой http://machine.internal:<порт>/.' }] }
          }
          return { content: [{ type: 'text', text: JSON.stringify(environments) }] }
        }
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
            '(кликается ближайший кликабельный элемент). Нужен selector или text. ' +
            'dblclick — двойной, button: right — контекстное меню, modifiers — клик с зажатыми клавишами.',
          inputSchema: {
            selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента'),
            text: z.string().max(L.text).optional().describe('Видимый текст элемента'),
            button: z.enum(['left', 'right']).optional().describe('Кнопка мыши (right — contextmenu)'),
            dblclick: z.boolean().optional().describe('Двойной клик'),
            modifiers: z.array(z.enum(['shift', 'ctrl', 'alt', 'meta'])).max(4).optional().describe('Зажатые модификаторы')
          }
        },
        async ({ selector, text, button, dblclick, modifiers }) => {
          if (!text && !selector) {
            return { content: [{ type: 'text', text: 'Укажи selector или text.' }], isError: true }
          }
          return run({
            kind: 'click',
            ...(selector ? { selector } : {}),
            ...(text ? { text } : {}),
            ...(button ? { button } : {}),
            ...(dblclick !== undefined ? { dblclick } : {}),
            ...(modifiers?.length ? { modifiers } : {})
          })
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

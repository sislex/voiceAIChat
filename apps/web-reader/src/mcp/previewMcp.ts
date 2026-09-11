import { PREVIEW_MCP_PATH, type PreviewActionRelay, type PreviewActionOutcome, type PreviewTurnContext } from '@voicechat/web-reader-contracts'
export { PREVIEW_MCP_PATH, PreviewActionRelay, PREVIEW_ACTION_TIMEOUT_MS } from '@voicechat/web-reader-contracts'
export type { PreviewActionOutcome, PreviewTurnContext, PreviewEnvironmentInfo } from '@voicechat/web-reader-contracts'
import { BROWSER_EVALUATE_MIN_TIMEOUT, BROWSER_EVALUATE_MAX_TIMEOUT, normalizeBrowserEvaluateOptions } from '@voicechat/shared'
import { browserDiagnosticsRequireChromium, normalizeBrowserDiagnosticOptions } from '@voicechat/shared'
import { BROWSER_DOWNLOAD_MODEL_CHUNK, BROWSER_DOWNLOAD_TEXT_CHUNK, isBrowserDownloadInfo, isBrowserDownloadListResult, isBrowserDownloadReadResult } from '@voicechat/shared'
import { BROWSER_DIALOG_ANSWER_LIMIT, normalizeBrowserDialogAnswer, isBrowserDialogListResult, isBrowserSessionMetadata } from '@voicechat/shared'
import { isBrowserSiteDataResetResult, normalizeBrowserSiteDataReset } from '@voicechat/shared'
import type { BrowserActionOutcome, BrowserImageResult, BrowserControlCommand, BrowserModelScreenshotOptions } from '@voicechat/shared'
// MCP-эндпоинт «browser»: инструменты модели для управления панелью веб-превью
// пользователя (открыть URL, найти элемент, клик, ввод текста, структурированное
// чтение DOM). Сама страница живёт в браузере пользователя, поэтому сервер не
// исполняет действия: он транслирует их подключённым клиентам кадром
// `preview.action` и ждёт `preview.result`. Действие выполняет только клиент,
// у которого этот чат активен, — так модель ограничена активной страницей
// пользователя, а не произвольным браузингом.
//
// Устройство как у kb-эндпоинта: stateless (свежий McpServer на POST), доступ
// по секрету процесса `?k=`, ход адресуется подписанным токеном `?turn=`
// (`reader/turnToken.ts`) — его выдаёт TurnManager или хуки CI в любом процессе.

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  PREVIEW_ACTION_LIMITS,
  isBrowserWaitOptions,
  browserWaitRequiresChromium,
  isHttpUrl,
  previewResultJson,
  type PreviewAction,
} from '@voicechat/shared'
import { MACHINE_PREVIEW_ALIAS_HOST, MACHINE_PREVIEW_SUFFIX } from '../routes/previewProxy.js'
import { createPreviewTurnTokens, type PreviewTurnTokens } from '@voicechat/web-reader-contracts'

export type { PreviewToolEntry } from '@voicechat/web-reader-contracts'

export interface RegisterPreviewMcpOptions {
  secret: string
  /** Действие в панели браузера пользователя; в отдельном процессе ридера — RPC к ядру. */
  relay: Pick<PreviewActionRelay, 'request'>
  /** Проверка токенов ходов; по умолчанию — подписанные тем же `secret`. */
  turns?: PreviewTurnTokens
  /** Контекст машин/тестовых пользователей; без него алиас и test-users недоступны. */
  context?: PreviewTurnContext
  /** Таймаут ожидания клиента (переопределяется в тестах). */
  timeoutMs?: number
  /**
   * Исполнитель для разговоров Playwright Reader: их страница живёт в
   * изолированном Chromium сервера, а не в браузере пользователя, поэтому relay
   * туда не достаёт. Возвращает `null` только для разговоров без Chromium-цели;
   * недоступность раннера возвращается ошибкой, без переключения в relay.
   */
  browserExecutor?: (userId: string, conversationId: string, action: PreviewAction) => Promise<BrowserActionOutcome | null>
  /** Вкладки и загрузка Chromium; обычному iframe этот порт недоступен. */
  browserControl?: (userId: string, conversationId: string, command: BrowserControlCommand) => Promise<BrowserActionOutcome | null>
  /**
   * Снимок из изолированного Chromium. Отдельно от `browserExecutor`, потому что
   * возвращает картинку `dataUrl`, а не структуру действия; `null` — «этот
   * разговор не про изолированный браузер, иди обычным путём».
   */
  browserScreenshot?: (userId: string, conversationId: string, args: BrowserModelScreenshotOptions) => Promise<BrowserActionOutcome | null>
}

/** Ответ инструмента: результат действия сериализованным JSON либо ошибка. */
function toolResult(outcome: PreviewActionOutcome | BrowserActionOutcome): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
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
  const turns = opts.turns ?? createPreviewTurnTokens(opts.secret)
  // Свой scope с парсером-пустышкой — тело читает транспорт MCP-SDK (см. kbMcp.ts).
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', (_req, _payload, done) => {
      done(null, undefined)
    })
    scope.post<{ Querystring: { k?: string; turn?: string } }>(PREVIEW_MCP_PATH, async (req, reply) => {
      if (req.query.k !== opts.secret) return reply.code(403).send({ error: 'forbidden' })
      const entry = turns.verify(req.query.turn ?? '')
      const server = new McpServer({ name: 'browser', version: '1.0.0' })
      const noContext = {
        content: [{ type: 'text' as const, text: 'Контекст хода недоступен: действие в превью не выполнено.' }],
        isError: true
      }
      const run = async (action: PreviewAction): Promise<ReturnType<typeof toolResult>> => {
        if (!entry) return noContext
        if (action.kind === 'console' || action.kind === 'network') {
          try { normalizeBrowserDiagnosticOptions(action) } catch (error) { return toolResult({ ok: false, error: String(error) }) }
        }
        if (action.kind === 'evaluate') {
          try { normalizeBrowserEvaluateOptions(action) } catch (error) { return toolResult({ ok: false, error: String(error) }) }
        }
        // Playwright Reader исполняет действие на сервере; остальные разговоры —
        // в браузере пользователя, как раньше.
        const direct = await opts.browserExecutor?.(entry.userId, entry.conversationId, action)
        if (direct?.ok && (action.kind === 'console' || action.kind === 'network') && browserDiagnosticsRequireChromium(action)) {
          const result = direct.result
          if (!result || !('cursor' in result) || typeof result.cursor !== 'number' || !(action.kind === 'console' ? 'console' in result && Array.isArray(result.console) : 'network' in result && Array.isArray(result.network))) return toolResult({ ok: false, error: 'Раннер не подтвердил расширенное чтение журнала. Обновите browser-runner.' })
        }
        if (direct?.ok && action.kind === 'evaluate' && action.timeoutMs !== undefined && (!direct.result || !('valueFormat' in direct.result) || !('elapsedMs' in direct.result))) return toolResult({ ok: false, error: 'Раннер не подтвердил ограничение evaluate. Обновите browser-runner.' })
        if (direct) return toolResult(direct)
        if ((action.kind === 'console' || action.kind === 'network') && browserDiagnosticsRequireChromium(action)) return toolResult({ ok: false, error: 'Вкладки, курсор и расширенные фильтры журналов доступны только в Playwright Reader или Chromium-проверке.' })
        if (action.kind === 'evaluate' && action.timeoutMs !== undefined) return toolResult({ ok: false, error: 'timeoutMs evaluate доступен только в Playwright Reader или Chromium-проверке.' })
        if (action.frame !== undefined) return toolResult({ ok: false, error: 'frame доступен только в Playwright Reader или Chromium-проверке.' })
        const outcome = await opts.relay.request(entry.userId, entry.conversationId, action, opts.timeoutMs)
        return toolResult(outcome)
      }
      const L = PREVIEW_ACTION_LIMITS
      server.registerTool('audit', {
        description: 'Inspect the current Web Reader document in proxy or native Chromium mode for QA issues. Returns rule IDs, selectors, severity, evidence, coverage limits and nextOffset. Use mode:list to discover checks, mode:run to inspect. The returned groups list discovers available diagnostic areas. Heuristic findings require visual confirmation. Default group: markup. This tool does not modify the page.',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        inputSchema: {
          group: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/).optional(),
          selector: z.string().trim().min(1).max(1000).optional(),
          rules: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,79}$/)).min(1).max(30).refine(ids => new Set(ids).size === ids.length).optional(),
          mode: z.enum(['list', 'run']).optional(),
          offset: z.number().int().min(0).max(500).optional(),
          limit: z.number().int().min(1).max(30).optional()
        }
      }, async options => run({ kind: 'audit', ...options }))
      const frameSchema = z.union([z.string().trim().min(1).max(L.selector), z.array(z.string().trim().min(1).max(L.selector)).min(1).max(8)]).optional().describe('Селектор iframe или цепочка вложенных iframe из frames. Только Chromium; без параметра — верхняя страница.')
      // Одинаковое разрешение машины для open и new-tab: доступ берётся из хода.
      const resolveUrl = async (url: string): Promise<{ url: string } | { error: string }> => {
        if (!isHttpUrl(url)) return { error: 'Разрешены только HTTP и HTTPS адреса с протоколом.' }
        const parsed = new URL(url)
        if (parsed.hostname === MACHINE_PREVIEW_ALIAS_HOST) {
          const agentId = await (entry && opts.context ? opts.context.machineOf(entry) : null)
          if (!agentId) return { error: 'У этого разговора нет доступной машины — выбери машину в настройках разговора, чтобы открывать её тестовое окружение.' }
          parsed.hostname = agentId + MACHINE_PREVIEW_SUFFIX
          return { url: parsed.toString() }
        }
        return { url }
      }
      const control = async (command: BrowserControlCommand): Promise<ReturnType<typeof toolResult>> => {
        if (!entry) return noContext
        const result = await opts.browserControl?.(entry.userId, entry.conversationId, command)
        return toolResult(result ?? { ok: false, error: 'Эта команда доступна только для Playwright Reader или Chromium-проверки задачи.' })
      }
      for (const [name, type, description] of [
        ['frames', 'frames', 'Живые iframe выбранной вкладки: frame path, фактический URL после редиректа, заголовок, имя и видимость. Передавай path как frame последующим инструментам.'],
        ['tabs', 'status', 'Список вкладок Playwright Reader: id, URL, заголовок, активная вкладка и openerTabId всплывающего окна. Не меняет активную вкладку.'],
        ['reload', 'reload', 'Перезагрузить активную вкладку Playwright Reader и дождаться DOM.'],
        ['stop-loading', 'stop', 'Остановить загрузку активной страницы Playwright Reader, сохранив вкладку и браузерную сессию.']
      ] as const) server.registerTool(name, { description, inputSchema: {} }, async () => control({ type }))
      for (const [name, type, description] of [
        ['select-tab', 'selectTab', 'Выбрать вкладку Playwright Reader по id из tabs. Последующие действия и чтение выполняются в ней.'],
        ['close-tab', 'closeTab', 'Закрыть вкладку Playwright Reader по id из tabs. После popup вернуться к открывшей его вкладке, если она жива.']
      ] as const) server.registerTool(name, {
        description, inputSchema: { tabId: z.string().min(1).max(256).describe('id вкладки из tabs') }
      }, async ({ tabId }) => control({ type, tabId }))
      server.registerTool('downloads', {
        description: 'Скачивания Chromium: id, имя, исходный URL, вкладка, состояние и размер готового файла. HTTP-вложения и Blob-экспорт страницы; downloadId затем передаётся read-download. Возвращает nextOffset для продолжения списка.',
        inputSchema: { tabId: z.string().min(1).max(200).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(32).optional() }
      }, async options => {
        if (!entry) return noContext
        const result = await opts.browserControl?.(entry.userId, entry.conversationId, { type: 'downloads', ...options })
        if (!result) return toolResult({ ok: false, error: 'Скачивания доступны только в Playwright Reader или Chromium-проверке.' })
        if (result.ok && !isBrowserDownloadListResult(result.result)) return toolResult({ ok: false, error: 'Раннер не поддерживает каталог скачиваний.' })
        return toolResult(result)
      })
      server.registerTool('read-download', {
        description: 'Прочитать готовый файл из downloads. text — UTF-8 (до 8 МиБ), offset в UTF-16 позициях; base64 — исходные байты, offset в байтах. Используй nextOffset до его отсутствия; бинарные файлы читай base64. Файлы живут до остановки сессии, лимит файла64 МиБ.',
        inputSchema: { downloadId: z.string().min(1).max(200), encoding: z.enum(['text', 'base64']).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(BROWSER_DOWNLOAD_TEXT_CHUNK).optional() }
      }, async options => {
        if (!entry) return noContext
        if (options.encoding === 'base64' && options.limit !== undefined && options.limit > BROWSER_DOWNLOAD_MODEL_CHUNK) return toolResult({ ok: false, error: 'Порция base64 для модели — до8192 байт.' })
        const result = await opts.browserControl?.(entry.userId, entry.conversationId, { type: 'readDownload', ...options })
        if (!result) return toolResult({ ok: false, error: 'Чтение скачанного файла доступно только в Playwright Reader или Chromium-проверке.' })
        if (result.ok && (!isBrowserDownloadReadResult(result.result) || result.result.download.id !== options.downloadId)) return toolResult({ ok: false, error: 'Раннер не подтвердил содержимое выбранного файла.' })
        return toolResult(result)
      })
      for (const [name, type, description] of [
        ['cancel-download', 'cancelDownload', 'Отменить незавершённое скачивание по id. Если файл успел завершиться, возвращается completed.'],
        ['delete-download', 'deleteDownload', 'Удалить скачивание и его временный файл из этой сессии; незавершённое сначала отменяется.']
      ] as const) server.registerTool(name, { description, inputSchema: { downloadId: z.string().min(1).max(200) } }, async ({ downloadId }) => {
        if (!entry) return noContext
        const result = await opts.browserControl?.(entry.userId, entry.conversationId, { type, downloadId })
        if (!result) return toolResult({ ok: false, error: 'Управление скачиваниями доступно только в Playwright Reader или Chromium-проверке.' })
        const value = result.result
        const confirmed = value && 'ok' in value && value.ok === true && (type === 'deleteDownload'
          ? 'deletedDownloadId' in value && value.deletedDownloadId === downloadId
          : 'download' in value && isBrowserDownloadInfo(value.download) && value.download.id === downloadId)
        if (result.ok && !confirmed) return toolResult({ ok: false, error: 'Раннер не подтвердил изменение скачивания.' })
        return toolResult(result)
      })
      server.registerTool('dialogs', {
        description: 'Открытые JavaScript-диалоги Chromium: id, вкладка, тип, сообщение и исходный текст prompt. Диалог ждёт явного ответа handle-dialog; tabId сужает список.',
        inputSchema: { tabId: z.string().min(1).max(200).optional() }
      }, async ({ tabId }) => {
        if (!entry) return noContext
        const result = await opts.browserControl?.(entry.userId, entry.conversationId, { type: 'dialogs', ...(tabId ? { tabId } : {}) })
        if (!result) return toolResult({ ok: false, error: 'Диалоги доступны только в Playwright Reader или Chromium-проверке.' })
        if (result.ok && !isBrowserDialogListResult(result.result)) return toolResult({ ok: false, error: 'Раннер не поддерживает диалоги сайтов.' })
        return toolResult(result)
      })
      server.registerTool('handle-dialog', {
        description: 'Ответить на конкретный диалог из dialogs: accept=true принять, false отменить. promptText только для принятия prompt; без него сохраняется исходное значение, пустая строка очищает. После ответа проверь результат действия на странице.',
        inputSchema: { dialogId: z.string().min(1).max(200), accept: z.boolean(), promptText: z.string().max(BROWSER_DIALOG_ANSWER_LIMIT).optional() }
      }, async ({ dialogId, accept, promptText }) => {
        if (!entry) return noContext
        try { normalizeBrowserDialogAnswer({ dialogId, accept, promptText }) } catch (error) { return toolResult({ ok: false, error: error instanceof Error ? error.message : 'Некорректный ответ' }) }
        const result = await opts.browserControl?.(entry.userId, entry.conversationId, { type: 'handleDialog', dialogId, accept, ...(promptText !== undefined ? { promptText } : {}) })
        if (!result) return toolResult({ ok: false, error: 'Ответ на диалог доступен только в Playwright Reader или Chromium-проверке.' })
        if (result.ok && (!isBrowserSessionMetadata(result.result) || !Array.isArray(result.result.dialogs))) return toolResult({ ok: false, error: 'Раннер не подтвердил ответ на диалог.' })
        return toolResult(result)
      })
      server.registerTool('new-tab', {
        description: 'Открыть и выбрать новую вкладку Playwright Reader. URL необязателен (пустая вкладка); HTTP/HTTPS и machine.internal работают как в open.',
        inputSchema: { url: z.string().max(L.url).optional() }
      }, async ({ url }) => {
        if (!entry) return noContext
        if (url === undefined) return control({ type: 'newTab' })
        const target = await resolveUrl(url)
        return 'error' in target ? toolResult({ ok: false, error: target.error }) : control({ type: 'newTab', url: target.url })
      })

      server.registerTool(
        'open',
        {
          description:
            'Открыть сайт в панели веб-превью пользователя. Адрес сохраняется как превью текущего чата. ' +
            'Только HTTP/HTTPS. Тестовое окружение на машине этого разговора открывается адресом ' +
            'https://app.internal/ — текущее приложение с любым путём или #/маршрутом; ' +
            'http://machine.internal:<порт>/ — запрос уйдёт на 127.0.0.1:<порт> машины.',
          inputSchema: { frame: frameSchema, url: z.string().max(L.url).describe('Полный адрес с протоколом http:// или https://') }
        },
        async ({ frame, url }) => {
          const target = await resolveUrl(url)
          return 'error' in target ? toolResult({ ok: false, error: target.error }) : run({ kind: 'open', ...(frame !== undefined ? { frame } : {}), url: target.url })
        }
      )

      server.registerTool(
        'hover',
        {
          description:
            'Навести курсор на элемент открытой в превью страницы (pointer/mouse-события): раскрывает выпадающие ' +
            'меню и hover-состояния. Нужен selector или text.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента'),
            text: z.string().max(L.text).optional().describe('Видимый текст элемента')
          }
        },
        async ({ frame, selector, text }) => {
          if (!text && !selector) {
            return { content: [{ type: 'text', text: 'Укажи selector или text.' }], isError: true }
          }
          return run({ kind: 'hover', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}), ...(text ? { text } : {}) })
        }
      )

      server.registerTool(
        'scroll',
        {
          description:
            'Прокрутить открытую в превью страницу или контейнер: to — к краю, dx/dy — по горизонтали/вертикали в пикселях. ' +
            'Полезно для лент с ленивой подгрузкой. Возвращает позицию прокрутки.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор прокручиваемого контейнера (без него — окно)'),
            to: z.enum(['top', 'bottom']).optional().describe('Прокрутить к началу или концу'),
            dx: z.number().min(-100000).max(100000).optional().describe('Горизонтальный сдвиг в пикселях, отрицательное — влево'),
            dy: z.number().min(-100000).max(100000).optional().describe('Вертикальный сдвиг в пикселях, отрицательное — вверх')
          }
        },
        async ({ frame, selector, to, dx, dy }) => {
          if (to === undefined && typeof dy !== 'number' && typeof dx !== 'number') {
            return { content: [{ type: 'text', text: 'Укажи to (top|bottom), dx или dy (пиксели).' }], isError: true }
          }
          return run({ kind: 'scroll', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}), ...(to ? { to } : {}), ...(typeof dy === 'number' ? { dy } : {}), ...(typeof dx === 'number' ? { dx } : {}) })
        }
      )

      server.registerTool(
        'press',
        {
          description:
            'Нажать клавишу на открытой в превью странице (keydown+keyup): Escape, Enter, Tab, ArrowDown и т. п. ' +
            'selector фокусирует элемент перед нажатием; без него — активный элемент страницы.',
          inputSchema: { frame: frameSchema,
            key: z.string().min(1).max(32).describe('Имя клавиши как в KeyboardEvent.key (Escape, Enter, ArrowDown, a…)'),
            selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента-получателя')
          }
        },
        async ({ frame, key, selector }) => run({ kind: 'press', ...(frame !== undefined ? { frame } : {}), key, ...(selector ? { selector } : {}) })
      )

      server.registerTool(
        'screenshot',
        {
          description:
            'Скриншот открытой в превью страницы: элемента по CSS-селектору, области rect (координаты документа) ' +
            'или видимой части без аргументов. В Chromium доступны fullPage, animations и timeoutMs. ' +
            'Снимок Chromium имеет CSS-масштаб 1:1 с координатами действий. Возвращает картинку и контекст страницы.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента для снимка'),
            rect: z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(), width: z.number().finite().positive(), height: z.number().finite().positive() }).optional().describe('Область в координатах документа страницы'),
            fullPage: z.boolean().optional().describe('Вся страница Chromium, включая область ниже окна'),
            animations: z.enum(['allow', 'disabled']).optional().describe('Отключить анимации только на время снимка Chromium'),
            timeoutMs: z.number().int().min(100).max(30000).optional().describe('Ожидание снимка Chromium, включая шрифты; по умолчанию 10000 мс')
          }
        },
        async ({ frame, selector, rect, fullPage, animations, timeoutMs }) => {
          if (!entry) return noContext
          if ([Boolean(selector), Boolean(rect), fullPage === true].filter(Boolean).length > 1) return toolResult({ ok: false, error: 'Выбери один режим снимка: selector, rect или fullPage' })
          // Единственный инструмент со своим транспортом: он отдаёт картинку, а
          // не JSON. Из-за этого он же дольше всех ходил мимо browserExecutor —
          // в Playwright Reader снимок уходил в браузер пользователя, где
          // страницы этого разговора нет, и модель оставалась без вида страницы.
          const direct = await opts.browserScreenshot?.(entry.userId, entry.conversationId, {
            ...(frame !== undefined ? { frame } : {}),
            ...(selector ? { selector } : {}), ...(rect ? { rect } : {}),
            ...(fullPage !== undefined ? { fullPage } : {}), ...(animations ? { animations } : {}),
            ...(timeoutMs !== undefined ? { timeoutMs } : {})
          })
          if (!direct && (frame !== undefined || fullPage || animations || timeoutMs !== undefined)) return toolResult({ ok: false, error: 'frame, fullPage, animations и timeoutMs доступны только в Playwright Reader или Chromium-проверке.' })
          const outcome = direct ?? await opts.relay.request(entry.userId, entry.conversationId, {
            kind: 'screenshot',
            ...(selector ? { selector } : {}),
            ...(rect ? { rect } : {})
          }, opts.timeoutMs)
          if (!outcome.ok) return toolResult(outcome)
          const result = outcome.result as BrowserImageResult | undefined
          const match = typeof result?.dataUrl === 'string' ? /^data:(image\/[a-z+]+);base64,(.+)$/.exec(result.dataUrl) : null
          if (!match) {
            return { content: [{ type: 'text' as const, text: 'Снимок не получен: страница не вернула картинку.' }], isError: true }
          }
          const where = result?.rect ? `x=${result.rect.x}, y=${result.rect.y}, ${result.rect.width}×${result.rect.height} CSS px` : ''
          return {
            content: [
              { type: 'image' as const, data: match[2], mimeType: match[1] },
              { type: 'text' as const, text: `Скриншот области страницы${where ? ` (${where})` : ''}.${result?.page ? `\nСтраница: ${JSON.stringify(result.page)}` : ''}${result?.frame ? `\nДокумент iframe: ${JSON.stringify(result.frame)}` : ''}${result?.clipped ? '\nЭлемент выходит за границы iframe; показана только видимая часть.' : ''}` }
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
            'Дождаться готовности страницы. selector вместе с text ждёт текст внутри элемента. ' +
            'В Chromium доступны state, enabled, editable, checked, value, count, URL, loadState и predicate. ' +
            'Условия делят один таймаут до 30000 мс (по умолчанию 5000). Ответ сообщает время ожидания. ' +
            'load не ждёт будущие запросы SPA: для них используй содержимое или predicate.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('Селектор ожидаемого элемента'),
            text: z.string().max(L.text).optional().describe('Текст элемента или текст внутри selector'),
            state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional().describe('Состояние элемента; по умолчанию visible, при count проверяется наличие узлов'),
            enabled: z.boolean().optional().describe('Элемент должен быть доступен или отключён'),
            editable: z.boolean().optional().describe('Поле должно разрешать или запрещать редактирование'),
            checked: z.boolean().optional().describe('Ожидаемое состояние флажка'),
            value: z.string().max(L.text).optional().describe('Точное значение input/textarea/select, в том числе пустое'),
            count: z.number().int().min(0).max(100000).optional().describe('Число совпадений селектора, включая скрытые'),
            url: z.string().max(L.url).optional().describe('Публичный URL или шаблон с *'),
            loadState: z.enum(['domcontentloaded', 'load']).optional().describe('Готовность DOM или завершение загрузки документа'),
            predicate: z.string().max(L.evaluateCode).optional().describe('Синхронное JS-выражение или функция без аргументов, дающая truthy'),
            timeoutMs: z.number().positive().max(30000).optional().describe('Общий таймаут ожидания, мс')
          }
        },
        async (options) => {
          if (!isBrowserWaitOptions(options)) return { content: [{ type: 'text', text: 'Укажи selector/text или url/loadState/predicate и совместимые условия ожидания.' }], isError: true }
          const action = { kind: 'wait' as const, ...options }
          if (options.frame !== undefined || browserWaitRequiresChromium(options)) {
            if (!entry) return noContext
            if (options.predicate) {
              // Повторяющееся условие не должно обходить project gate evaluate.
              const verdict = await opts.context?.gateEvaluate?.(entry, options.predicate, false)
              req.log.info({ event: 'reader.wait-predicate', userId: entry.userId, conversationId: entry.conversationId, allowed: verdict?.allowed ?? true, reason: verdict?.reason }, 'reader predicate gate')
              if (verdict && !verdict.allowed) return toolResult({ ok: false, error: verdict.needsConfirmation
                ? 'Условие wait требует изменения страницы, хранилища или сети. Выполни действие отдельным инструментом и затем ожидай состояние.'
                : `Условие wait отклонено политикой проекта: ${verdict.reason ?? ''}` })
            }
            const direct = await opts.browserExecutor?.(entry.userId, entry.conversationId, action)
            return toolResult(direct ?? { ok: false, error: 'Расширенные условия wait доступны только в Playwright Reader или Chromium-проверке.' })
          }
          return run(action)
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

      const logSchema = {
        tabId: z.string().min(1).max(200).optional().describe('Вкладка Chromium; по умолчанию активная, включая её историю'),
        allTabs: z.boolean().optional().describe('Все вкладки Chromium; несовместимо с tabId'),
        since: z.number().int().nonnegative().optional().describe('Только новые и обновлённые записи после cursor предыдущего ответа Chromium'),
        before: z.number().int().nonnegative().optional().describe('Продолжить старые записи: nextBefore предыдущего ответа Chromium'),
        clear: z.boolean().optional().describe('В Chromium удалить только возвращённые записи'),
        limit: z.number().int().positive().max(L.logMax).optional().describe(`Максимум записей (по умолчанию ${L.logDefault}); truncated/nextBefore сообщают о продолжении`)
      }
      server.registerTool('network', {
        description: 'Журнал сети выбранной вкладки. В Chromium: публичный URL, статус, pending/response/completed/failed, тип ресурса, длительность, причина сбоя и связи перенаправлений. cursor учитывает завершение ранее начатых запросов. filter — подстрока URL. Журнал ограничен; dropped показывает вытеснение.',
        inputSchema: { ...logSchema, filter: z.string().max(300).optional(),
          state: z.enum(['pending', 'response', 'completed', 'failed']).optional(),
          resourceType: z.string().max(100).optional(),
          failedOnly: z.boolean().optional().describe('Только сетевые сбои и HTTP >= 400') }
      }, async options => run({ kind: 'network', ...options }))
      server.registerTool('console', {
        description: 'Консоль выбранной вкладки: log/info/warn/error. pattern — буквальная подстрока сообщения без учёта регистра. В Chromium доступны вложенные args, stack исключения, источник и курсор. argsPending означает незавершённое чтение объекта; argsUnavailable/argsTruncated — неполные данные. Журнал ограничен; dropped показывает вытеснение.',
        inputSchema: { ...logSchema, pattern: z.string().max(300).optional(), level: z.enum(['log', 'info', 'warn', 'error']).optional() }
      }, async options => run({ kind: 'console', ...options }))

      server.registerTool('styles', {
        description: 'Вычисленные CSS-свойства элемента. selector принимает целиком результат find/read, включая Shadow DOM; frame выбирает вложенный документ Chromium.',
        inputSchema: { frame: frameSchema, selector: z.string().min(1).max(L.selector), properties: z.array(z.string().min(1).max(128)).max(50).optional() }
      }, async ({ frame, selector, properties }) => run({ kind: 'styles', selector, ...(frame !== undefined ? { frame } : {}), ...(properties ? { properties } : {}) }))

      server.registerTool(
        'evaluate',
        {
          description:
            'Выполнить JavaScript в контексте открытой в превью страницы и получить JSON результата (await для промисов). ' +
            'Для чтения состояния приложения, вызова функций страницы и нестандартных контролов, недоступных click/type. ' +
            'Chromium: по умолчанию 5000мс без ожидания ответа на диалог. valueFormat=json сохраняет JSON, preview помечает специальные типы через $type/$ref (JSON Pointer в ответе), preview-json — неполный JSON-префикс; truncated сообщает сокращение. Для полного значения запрашивай нужную часть. DOM-узел возвращает описание, Map/Set и циклы читаются структурно.',
          inputSchema: { frame: frameSchema,
            code: z.string().min(1).max(L.evaluateCode).describe('JS-выражение или код; результат сериализуется JSON'),
            timeoutMs: z.number().int().min(BROWSER_EVALUATE_MIN_TIMEOUT).max(BROWSER_EVALUATE_MAX_TIMEOUT).optional().describe('Лимит исполнения Chromium; async-операции страницы после таймаута могут продолжиться, проверь состояние перед повтором'),
            confirm: z.boolean().optional().describe('true — пользователь явно подтвердил изменение страницы/хранилища/сети')
          }
        },
        async ({ frame, code, confirm, timeoutMs }) => {
          if (!entry) return noContext
          const verdict = await opts.context?.gateEvaluate?.(entry, code, confirm === true)
          req.log.info({ event: 'reader.evaluate', userId: entry.userId, conversationId: entry.conversationId, allowed: verdict?.allowed ?? true, confirmed: confirm === true, reason: verdict?.reason }, 'reader evaluate gate')
          if (verdict && !verdict.allowed) {
            const prefix = verdict.needsConfirmation ? 'Требуется подтверждение пользователя. ' : 'Отклонено политикой проекта. '
            return { content: [{ type: 'text', text: prefix + (verdict.reason ?? '') }], isError: true }
          }
          return run({ kind: 'evaluate', ...(frame !== undefined ? { frame } : {}), code, ...(timeoutMs !== undefined ? { timeoutMs } : {}) })
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
          inputSchema: { frame: frameSchema, from: dragPoint.describe('Откуда'), to: dragPoint.describe('Куда') }
        },
        async ({ frame, from, to }) => {
          const valid = (p: { selector?: string; x?: number; y?: number }): boolean => Boolean(p.selector) || (typeof p.x === 'number' && typeof p.y === 'number')
          if (!valid(from) || !valid(to)) {
            return { content: [{ type: 'text', text: 'У from и to укажи selector либо пару x и y.' }], isError: true }
          }
          return run({ kind: 'drag', ...(frame !== undefined ? { frame } : {}), from, to })
        }
      )

      server.registerTool(
        'set',
        {
          description:
            'Установить значение сложного контрола формы на открытой в превью странице: select (value или видимая подпись option), ' +
            'checkbox/radio (checked), date/range/текстовые поля (value). События input/change диспатчатся как при живом вводе.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).describe('CSS-селектор контрола'),
            value: z.string().max(L.text).optional().describe('Значение (для select — value или подпись option)'),
            checked: z.boolean().optional().describe('Для checkbox/radio')
          }
        },
        async ({ frame, selector, value, checked }) => {
          if (value === undefined && checked === undefined) {
            return { content: [{ type: 'text', text: 'Укажи value или checked.' }], isError: true }
          }
          return run({ kind: 'set', ...(frame !== undefined ? { frame } : {}), selector, ...(value !== undefined ? { value } : {}), ...(checked !== undefined ? { checked } : {}) })
        }
      )

      server.registerTool(
        'upload',
        {
          description:
            'Загрузить файл в input type=file открытой в превью страницы: содержимое передаётся base64 (до 8 МиБ). ' +
            'Диспатчит input/change как при выборе файла пользователем.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).describe('CSS-селектор input type=file'),
            name: z.string().min(1).max(255).describe('Имя файла (например report.csv)'),
            base64: z.string().max(L.uploadBase64).describe('Содержимое файла в base64; пустая строка — файл нулевой длины'),
            mimeType: z.string().max(100).optional().describe('MIME-тип (по умолчанию application/octet-stream)')
          }
        },
        async ({ frame, selector, name, base64, mimeType }) => run({ kind: 'upload', ...(frame !== undefined ? { frame } : {}), selector, name, base64, ...(mimeType ? { mimeType } : {}) })
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
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор поддерева (без него — вся страница)'),
            limit: z.number().positive().max(L.a11yNodes).optional().describe(`Максимум узлов (по умолчанию ${L.a11yNodes})`)
          }
        },
        async ({ frame, selector, limit }) => run({ kind: 'a11y', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}), ...(typeof limit === 'number' ? { limit } : {}) })
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
            'Сбросить вход в сайты: в Chromium очищаются cookie, localStorage, IndexedDB, кеш и service workers; в Web Reader — cookie прокси. Без host — все сайты сессии, с host — один домен. ' +
            'Используй, чтобы перелогиниться под другим тестовым пользователем.',
          inputSchema: { host: z.string().max(255).optional().describe('Домен сайта (например agent-1.machine.internal); без него — все сайты') }
        },
        async ({ host }) => {
          if (!entry) return noContext
          let options
          try { options = normalizeBrowserSiteDataReset({ scope: 'all', ...(host !== undefined ? { host } : {}) }) }
          catch (error) { return toolResult({ ok: false, error: error instanceof Error ? error.message : 'Некорректный host' }) }
          const browser = await opts.browserControl?.(entry.userId, entry.conversationId, { type: 'clearSiteData', ...options })
          if (browser) {
            if (!browser.ok) return toolResult(browser)
            if (!isBrowserSiteDataResetResult(browser.result)) return toolResult({ ok: false, error: 'Раннер не подтвердил очистку данных сайта' })
            // Машинные превью дополнительно держат cookie удалённого сайта в
            // серверном jar, поэтому одной очистки Chromium им недостаточно.
            opts.context?.clearCookies?.(entry, options.host)
            return toolResult(browser)
          }
          if (!opts.context?.clearCookies) {
            return { content: [{ type: 'text', text: 'Сброс сессий недоступен на этом сервере.' }], isError: true }
          }
          const cleared = opts.context.clearCookies(entry, options.host)
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
          const environments = (await opts.context?.environmentsOf?.(entry)) ?? []
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
          const users = (await opts.context?.testUsersOf(entry)) ?? []
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
            'и текстовая выжимка. Chromium также описывает таблицы и iframe. selector ограничивает чтение поддеревом. ' +
            'Для длинного текста повторяй read с offset из nextOffset; structureTruncated означает, что структуру лучше читать по selector.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор поддерева (без него — вся страница)'),
            limit: z.number().int().min(100).max(20_000).optional().describe('Символов текста в порции (по умолчанию 4000)'),
            offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().describe('Начальная позиция текста; продолжение берётся из nextOffset')
          }
        },
        async ({ frame, selector, limit, offset }) => run({ kind: 'read', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}), ...(limit !== undefined ? { limit } : {}), ...(offset !== undefined ? { offset } : {}) })
      )

      server.registerTool(
        'find',
        {
          description:
            'Найти элементы на открытой в превью странице по видимому тексту или CSS-селектору. ' +
            'Возвращает селекторы для click/type. Нужен text или selector.',
          inputSchema: { frame: frameSchema,
            text: z.string().max(L.text).optional().describe('Видимый текст элемента (регистр не важен)'),
            selector: z.string().max(L.selector).optional().describe('CSS-селектор'),
            limit: z.number().optional().describe(`Максимум элементов (по умолчанию ${L.findDefault}, не больше ${L.findMax})`),
            visibleOnly: z.boolean().optional().describe('Исключить скрытые элементы до применения лимита')
          }
        },
        async ({ frame, text, selector, limit, visibleOnly }) => {
          if (!text && !selector) {
            return { content: [{ type: 'text', text: 'Укажи text или selector.' }], isError: true }
          }
          return run({
            kind: 'find', ...(frame !== undefined ? { frame } : {}),
            ...(text ? { text } : {}),
            ...(selector ? { selector } : {}),
            ...(typeof limit === 'number' ? { limit } : {}),
            ...(visibleOnly !== undefined ? { visibleOnly } : {})
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
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента'),
            text: z.string().max(L.text).optional().describe('Видимый текст элемента'),
            button: z.enum(['left', 'right']).optional().describe('Кнопка мыши (right — contextmenu)'),
            dblclick: z.boolean().optional().describe('Двойной клик'),
            modifiers: z.array(z.enum(['shift', 'ctrl', 'alt', 'meta'])).max(4).optional().describe('Зажатые модификаторы')
          }
        },
        async ({ frame, selector, text, button, dblclick, modifiers }) => {
          if (!text && !selector) {
            return { content: [{ type: 'text', text: 'Укажи selector или text.' }], isError: true }
          }
          return run({
            kind: 'click', ...(frame !== undefined ? { frame } : {}),
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
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).describe('CSS-селектор поля ввода'),
            text: z.string().max(L.text).describe('Текст для ввода'),
            submit: z.boolean().optional().describe('Отправить форму после ввода')
          }
        },
        async ({ frame, selector, text, submit }) => run({ kind: 'type', ...(frame !== undefined ? { frame } : {}), selector, text, ...(submit !== undefined ? { submit } : {}) })
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

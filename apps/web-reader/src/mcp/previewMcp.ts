import { PREVIEW_MCP_PATH, type PreviewActionRelay, type PreviewActionOutcome, type PreviewTurnContext } from '@voicechat/web-reader-contracts'
export { PREVIEW_MCP_PATH, PreviewActionRelay, PREVIEW_ACTION_TIMEOUT_MS } from '@voicechat/web-reader-contracts'
export type { PreviewActionOutcome, PreviewTurnContext, PreviewEnvironmentInfo } from '@voicechat/web-reader-contracts'
import { BROWSER_EVALUATE_MIN_TIMEOUT, BROWSER_EVALUATE_MAX_TIMEOUT, isPreviewAction, normalizeBrowserEvaluateOptions } from '@voicechat/shared'
import { browserDiagnosticsRequireChromium, normalizeBrowserDiagnosticOptions } from '@voicechat/shared'
import { BROWSER_DOWNLOAD_MODEL_CHUNK, BROWSER_DOWNLOAD_TEXT_CHUNK, isBrowserDownloadInfo, isBrowserDownloadListResult, isBrowserDownloadReadResult } from '@voicechat/shared'
import { BROWSER_DIALOG_ANSWER_LIMIT, normalizeBrowserDialogAnswer, isBrowserDialogListResult, isBrowserSessionMetadata } from '@voicechat/shared'
import { isBrowserSiteDataResetResult, normalizeBrowserSiteDataReset } from '@voicechat/shared'
import { isPreviewProbeResult, PREVIEW_PROBE_LIMITS } from '@voicechat/shared'
import { isPreviewAccessibilityResult, PREVIEW_ACCESSIBILITY_LIMITS } from '@voicechat/shared'
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
import { isRecording, recordAction, recordExpectation, scenarioOf, startRecording, stopRecording } from './turnRecorder.js'
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

function validProbeReport(value: unknown, surface: 'proxy' | 'chromium'): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const fields = value as Record<string, unknown>
  const result = { page: fields.page, probe: fields.probe }
  return isPreviewProbeResult(result) && result.probe.surface === surface
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
        if (direct?.ok && action.kind === 'probe' && !validProbeReport(direct.result, 'chromium')) return toolResult({ ok: false, error: 'The native runner did not return a valid control probe. Update browser-runner and retry.' })
        if (direct?.ok && action.kind === 'accessibility') {
          const fields = direct.result as Record<string, unknown> | undefined
          const result = { page: fields?.page, accessibility: fields?.accessibility }
          if (!isPreviewAccessibilityResult(result)) return toolResult({ ok: false, error: 'The runner did not return valid native accessibility evidence. Update browser-runner and retry.' })
          return toolResult({ ok: true, result })
        }
        // Успешное действие становится шагом сценария, если идёт запись: путь
        // модели ничем не отличается от пути человека, а на выходе у неё
        // оставался только текст хода, из которого сценарий не восстановить.
        if (direct?.ok) recordAction(entry.conversationId, action)
        if (direct) return toolResult(direct)
        if ((action.kind === 'console' || action.kind === 'network') && browserDiagnosticsRequireChromium(action)) return toolResult({ ok: false, error: 'Вкладки, курсор и расширенные фильтры журналов доступны только в Playwright Reader или Chromium-проверке.' })
        if (action.kind === 'evaluate' && action.timeoutMs !== undefined) return toolResult({ ok: false, error: 'timeoutMs evaluate доступен только в Playwright Reader или Chromium-проверке.' })
        if (action.kind === 'accessibility') return toolResult({ ok: false, error: 'Native accessibility requires Chromium mode. Switch the Web Reader engine to Chromium.' })
        if (action.frame !== undefined) return toolResult({ ok: false, error: 'frame доступен только в Playwright Reader или Chromium-проверке.' })
        const outcome = await opts.relay.request(entry.userId, entry.conversationId, action, opts.timeoutMs)
        if (outcome.ok) recordAction(entry.conversationId, action)
        if (outcome.ok && action.kind === 'probe' && !validProbeReport(outcome.result, 'proxy')) return toolResult({ ok: false, error: 'The proxy page did not return a valid control probe. Reload the Web Reader page and retry.' })
        return toolResult(outcome)
      }
      const L = PREVIEW_ACTION_LIMITS
      server.registerTool('accessibility', {
        description: 'Read one exact standard CSS target from Chromium’s native accessibility tree, including hidden or ignored nodes. Returns role, name, description, selected states, name-source precedence and related selectors. This source differs from the DOM-derived a11y snapshot. Does not click, focus, scroll or return live control values. Name and description are application text. Read truncation and limits; single-node evidence does not prove a screen-reader scenario. Chromium only; no frame scope or caller code.',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        inputSchema: {
          selector: z.string().trim().min(1).max(PREVIEW_ACCESSIBILITY_LIMITS.selector),
          frame: z.never().optional(),
          code: z.never().optional()
        }
      }, async options => run({ kind: 'accessibility', ...options }))
      server.registerTool('probe', {
        description: 'Observe one standard CSS target without clicking, focusing, scrolling or reading its value. Reports browser visibility, native and declared disabled/read-only/inert state, sampled pointer interception and source selectors. Hidden targets can be inspected. Pointer reachability is separate from activation and does not guarantee a successful application action. Read limits and truncation; frame scope is not supported.',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        inputSchema: { selector: z.string().trim().min(1).max(PREVIEW_PROBE_LIMITS.selector), frame: z.never().optional() }
      }, async options => run({ kind: 'probe', ...options }))
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
            'selector фокусирует элемент перед нажатием; без него — активный элемент страницы. ' +
            'repeat повторяет нажатие (ArrowDown до нужной строки списка) — это дешевле, чем звать press по разу.',
          inputSchema: { frame: frameSchema,
            key: z.string().min(1).max(32).describe('Имя клавиши как в KeyboardEvent.key (Escape, Enter, ArrowDown, a…)'),
            selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента-получателя'),
            repeat: z.number().int().min(1).max(50).optional().describe('Сколько раз нажать подряд (по умолчанию 1)')
          }
        },
        async ({ frame, key, selector, repeat }) => run({ kind: 'press', ...(frame !== undefined ? { frame } : {}), key, ...(selector ? { selector } : {}), ...(repeat !== undefined ? { repeat } : {}) })
      )

      server.registerTool(
        'hotkey',
        {
          description:
            'Сочетание клавиш, как его нажимает человек: primary+a выделить всё, primary+c копировать, ' +
            'shift+Tab назад по фокусу, primary+Enter отправить форму. ' +
            'primary — основной модификатор системы раннера: бери именно его для правки и выделения, ' +
            'иначе на macOS ctrl+a уводит курсор в начало строки вместо выделения. ' +
            'Без selector уходит в активный элемент.',
          inputSchema: { frame: frameSchema,
            key: z.string().min(1).max(32).describe('Клавиша без модификаторов (a, c, Enter, Tab, ArrowDown)'),
            modifiers: z.array(z.enum(['primary', 'shift', 'ctrl', 'alt', 'meta'])).min(1).max(4).describe('Модификаторы; primary — Ctrl на Linux/Windows и Cmd на macOS'),
            selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента-получателя'),
            repeat: z.number().int().min(1).max(50).optional().describe('Сколько раз нажать подряд')
          }
        },
        async ({ frame, key, modifiers, selector, repeat }) => run({ kind: 'hotkey', ...(frame !== undefined ? { frame } : {}), key, modifiers, ...(selector ? { selector } : {}), ...(repeat !== undefined ? { repeat } : {}) })
      )

      server.registerTool(
        'focus',
        {
          description:
            'Поставить фокус на элемент без клика — так работает переход по Tab, и именно так ловятся ' +
            'ошибки клавиатурной доступности: клик по пункту меню и переход на него фокусом дают разные события. ' +
            'Возвращает элемент в фокусе: селектор, роль, значение, видимое кольцо фокуса и признак «внутри диалога».',
          inputSchema: { frame: frameSchema, selector: z.string().max(L.selector).describe('CSS-селектор элемента') }
        },
        async ({ frame, selector }) => run({ kind: 'focus', ...(frame !== undefined ? { frame } : {}), selector })
      )

      server.registerTool(
        'focused',
        {
          description:
            'Что сейчас в фокусе: селектор, тег, роль, имя, значение поля, нарисовано ли кольцо фокуса ' +
            'и находится ли элемент внутри открытого диалога. Фокус не двигает — зови после press Tab, ' +
            'чтобы понять, куда попал, и заметить ловушку фокуса в модальном окне.',
          inputSchema: { frame: frameSchema }
        },
        async ({ frame }) => run({ kind: 'focus', ...(frame !== undefined ? { frame } : {}) })
      )

      server.registerTool(
        'focus-order',
        {
          description:
            'Порядок обхода по Tab: элементы в том порядке, в каком их получит клавиатура ' +
            '(положительный tabindex идёт первым, остальные — по DOM). Для каждого — селектор, имя, роль, ' +
            'tabIndex и видимость. Так видно недостижимые кнопки и вырванные из потока элементы, не нажимая Tab по разу.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор поддерева (без него — вся страница)'),
            limit: z.number().int().min(1).max(200).optional().describe('Максимум элементов (по умолчанию 50)')
          }
        },
        async ({ frame, selector, limit }) => run({ kind: 'focusOrder', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}), ...(limit !== undefined ? { limit } : {}) })
      )

      server.registerTool(
        'clear',
        {
          description:
            'Очистить поле ввода так же, как это делает человек (Ctrl+A → Delete): значение стирается, ' +
            'события input/change уходят странице. type с пустым текстом этого не даёт.',
          inputSchema: { frame: frameSchema, selector: z.string().max(L.selector).describe('CSS-селектор поля') }
        },
        async ({ frame, selector }) => run({ kind: 'clear', ...(frame !== undefined ? { frame } : {}), selector })
      )

      server.registerTool(
        'select-text',
        {
          description:
            'Выделить текст элемента (или всей страницы без selector) — то же, что протащить курсор по тексту. ' +
            'Возвращает выделенное. Дальше его можно скопировать (copy) или заменить вводом.',
          inputSchema: { frame: frameSchema, selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента') }
        },
        async ({ frame, selector }) => run({ kind: 'selectText', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}) })
      )

      server.registerTool(
        'copy',
        {
          description:
            'Прочитать текущее выделение страницы — то, что попало бы в буфер обмена по Ctrl+C. ' +
            'Работает и для выделения внутри поля ввода. Не меняет страницу.',
          inputSchema: { frame: frameSchema }
        },
        async ({ frame }) => run({ kind: 'copy', ...(frame !== undefined ? { frame } : {}) })
      )

      server.registerTool(
        'paste',
        {
          description:
            'Вставить текст в поле так, как это делает Ctrl+V: странице уходит событие paste с clipboardData, ' +
            'и редакторы, которые читают именно его (а обычный ввод игнорируют), ведут себя как у человека. ' +
            'Без selector вставляет в элемент в фокусе.',
          inputSchema: { frame: frameSchema,
            text: z.string().max(L.text).describe('Вставляемый текст'),
            selector: z.string().max(L.selector).optional().describe('CSS-селектор поля (по умолчанию — элемент в фокусе)')
          }
        },
        async ({ frame, text, selector }) => run({ kind: 'paste', ...(frame !== undefined ? { frame } : {}), text, ...(selector ? { selector } : {}) })
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
            'В Chromium доступны state, enabled, editable, checked, value, count, URL, loadState, network, stable и predicate. ' +
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
            network: z.literal('idle').optional().describe('Сетевая тишина: данные догрузились, а не только разметка — то, чего человек ждёт, глядя на спиннер'),
            stable: z.boolean().optional().describe('Элемент перестал двигаться: у меню и модальных окон анимация идёт после появления в DOM, и клик по едущему элементу промахивается'),
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
            values: z.array(z.string().max(L.text)).min(1).max(64).optional().describe('Несколько значений для select multiple: по одному они затирают друг друга'),
            checked: z.boolean().optional().describe('Для checkbox/radio')
          }
        },
        async ({ frame, selector, value, values, checked }) => {
          if (value === undefined && values === undefined && checked === undefined) {
            return { content: [{ type: 'text', text: 'Укажи value, values или checked.' }], isError: true }
          }
          return run({ kind: 'set', ...(frame !== undefined ? { frame } : {}), selector, ...(value !== undefined ? { value } : {}), ...(values !== undefined ? { values } : {}), ...(checked !== undefined ? { checked } : {}) })
        }
      )

      const formFieldSchema = z.object({
        selector: z.string().max(L.selector).describe('CSS-селектор поля'),
        value: z.string().max(L.text).optional().describe('Значение поля или подпись option'),
        values: z.array(z.string().max(L.text)).min(1).max(64).optional().describe('Несколько значений для select multiple'),
        checked: z.boolean().optional().describe('Для checkbox/radio')
      })

      server.registerTool(
        'fill-form',
        {
          description:
            'Заполнить форму целиком за один вызов: список полей со значениями, подписями option или checked. ' +
            'Так же, как это делает человек — одним действием. Поле за вызовом теряется на формах, которые ' +
            'перерисовываются между обращениями (управляемые поля React). ' +
            'Ответ перечисляет результат по каждому полю; частично заполненная форма считается неуспехом. ' +
            'delay — посимвольный ввод для полей с автодополнением.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор формы (по умолчанию первая форма страницы)'),
            fields: z.array(formFieldSchema).min(1).max(50).describe('Поля формы по порядку заполнения'),
            delay: z.number().min(0).max(200).optional().describe('Пауза между символами в мс')
          }
        },
        async ({ frame, selector, fields, delay }) => run({
          kind: 'fillForm', ...(frame !== undefined ? { frame } : {}),
          ...(selector ? { selector } : {}), fields,
          ...(delay !== undefined ? { delay } : {})
        })
      )

      server.registerTool(
        'form-state',
        {
          description:
            'Что сейчас в форме: поля, значения, подписи, обязательность, блокировка и сообщение проверки браузера. ' +
            'Так проверяется результат заполнения до отправки. Значение поля пароля не возвращается.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор формы (по умолчанию первая форма страницы)'),
            limit: z.number().int().min(1).max(200).optional().describe('Максимум полей (по умолчанию 50)')
          }
        },
        async ({ frame, selector, limit }) => run({ kind: 'formState', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}), ...(limit !== undefined ? { limit } : {}) })
      )

      server.registerTool(
        'validity',
        {
          description:
            'Почему браузер не отправит форму: поля, не прошедшие проверку, их сообщения и причины ' +
            '(valueMissing, patternMismatch, rangeOverflow…). Спрашивай до submit — иначе причина отказа ' +
            'видна только по тому, что страница решила нарисовать.',
          inputSchema: { frame: frameSchema, selector: z.string().max(L.selector).optional().describe('CSS-селектор формы или одного поля') }
        },
        async ({ frame, selector }) => run({ kind: 'validity', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}) })
      )

      server.registerTool(
        'submit',
        {
          description:
            'Отправить форму так же, как это делает Enter: сначала проверка браузера (и её сообщение), ' +
            'затем обработчик submit страницы. Отличается от клика по кнопке тем, что не зависит от того, ' +
            'какой именно элемент страница считает кнопкой отправки.',
          inputSchema: { frame: frameSchema, selector: z.string().max(L.selector).optional().describe('CSS-селектор формы или поля внутри неё') }
        },
        async ({ frame, selector }) => run({ kind: 'submit', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}) })
      )

      server.registerTool(
        'options',
        {
          description:
            'Варианты, которые предлагает контрол: option у select (с выбранными и выключенными), ' +
            'подсказки datalist у поля ввода, кнопки группы radio. Без этого модель угадывала подписи ' +
            'и получала отказ set по несуществующему значению.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).describe('CSS-селектор контрола'),
            limit: z.number().int().min(1).max(500).optional().describe('Максимум вариантов (по умолчанию 100)')
          }
        },
        async ({ frame, selector, limit }) => run({ kind: 'options', ...(frame !== undefined ? { frame } : {}), selector, ...(limit !== undefined ? { limit } : {}) })
      )

      server.registerTool(
        'drop-file',
        {
          description:
            'Перетащить файлы в зону загрузки: странице уходит настоящее событие drop с DataTransfer. ' +
            'Половина загрузчиков в вебе не имеет input[type=file] вовсе и слушает именно drop — ' +
            'туда upload не доходит. До 16 файлов, вместе до 8 МиБ.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).describe('CSS-селектор зоны перетаскивания'),
            files: z.array(z.object({
              name: z.string().min(1).max(255).describe('Имя файла'),
              base64: z.string().max(L.uploadBase64).describe('Содержимое в base64'),
              mimeType: z.string().max(100).optional().describe('MIME-тип')
            })).min(1).max(16).describe('Файлы')
          }
        },
        async ({ frame, selector, files }) => run({ kind: 'dropFile', ...(frame !== undefined ? { frame } : {}), selector, files })
      )

      server.registerTool(
        'upload',
        {
          description:
            'Загрузить файл в input type=file открытой в превью страницы: содержимое передаётся base64 (до 8 МиБ). ' +
            'Диспатчит input/change как при выборе файла пользователем. ' +
            'files — несколько файлов сразу в поле с multiple; для зоны перетаскивания без input есть drop-file.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).describe('CSS-селектор input type=file'),
            name: z.string().min(1).max(255).optional().describe('Имя файла (например report.csv)'),
            base64: z.string().max(L.uploadBase64).optional().describe('Содержимое файла в base64; пустая строка — файл нулевой длины'),
            mimeType: z.string().max(100).optional().describe('MIME-тип (по умолчанию application/octet-stream)'),
            files: z.array(z.object({
              name: z.string().min(1).max(255),
              base64: z.string().max(L.uploadBase64),
              mimeType: z.string().max(100).optional()
            })).min(1).max(16).optional().describe('Несколько файлов для поля с multiple')
          }
        },
        async ({ frame, selector, name, base64, mimeType, files }) => {
          if (!files && (name === undefined || base64 === undefined)) {
            return { content: [{ type: 'text', text: 'Укажи name и base64 либо массив files.' }], isError: true }
          }
          return run({
            kind: 'upload', ...(frame !== undefined ? { frame } : {}), selector,
            name: name ?? files![0].name, base64: base64 ?? files![0].base64,
            ...(mimeType ? { mimeType } : {}), ...(files ? { files } : {})
          })
        }
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
            'DOM-derived role/name snapshot of the open preview page, with selectors for click/type. ' +
            'This compact navigation aid can differ from Chromium native accessibility; use accessibility for native evidence about one selected node.',
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
        'record',
        {
          description:
            'Запись сценария из твоих же действий: start начинает, stop заканчивает, status показывает ход. ' +
            'Человек в панели записывает свой проход и получает воспроизводимые шаги — у модели этого не было, ' +
            'хотя проходит путь чаще всего она, в задаче канбана, где потом нужен автотест. ' +
            'Читающие действия (read, find, screenshot) в запись не идут — прогонять их нечего.',
          inputSchema: {
            do: z.enum(['start', 'stop', 'status']).describe('Что сделать'),
            name: z.string().max(120).optional().describe('Имя сценария (при start)'),
            startUrl: z.string().max(L.url).optional().describe('Стартовый адрес; по умолчанию — адрес открытой страницы')
          }
        },
        async ({ do: operation, name, startUrl }) => {
          if (!entry) return noContext
          if (operation === 'start') {
            startRecording(entry.conversationId, startUrl ?? '', name)
            return toolResult({ ok: true, result: { recording: true, steps: 0 } as never })
          }
          if (operation === 'stop') {
            const scenario = scenarioOf(entry.conversationId)
            stopRecording(entry.conversationId)
            return toolResult({ ok: true, result: (scenario ?? { recording: false }) as never })
          }
          const scenario = scenarioOf(entry.conversationId)
          return toolResult({ ok: true, result: { recording: isRecording(entry.conversationId), ...(scenario ? { steps: scenario.steps.length, scenario } : {}) } as never })
        }
      )

      server.registerTool(
        'replay',
        {
          description:
            'Прогнать сценарий по шагам: записанный (record) или переданный целиком. ' +
            'После каждого шага проверяется его ожидаемый текст. Отчёт говорит, какой шаг упал и почему — ' +
            'это и есть автотест, который остаётся после проверки задачи. ' +
            'Прогон останавливается на первом упавшем шаге: дальше страница уже не та.',
          inputSchema: {
            scenario: z.object({
              name: z.string().max(120).optional(),
              startUrl: z.string().max(L.url),
              steps: z.array(z.object({
                id: z.string().max(64),
                title: z.string().max(200),
                action: z.record(z.string(), z.unknown()),
                expectText: z.string().max(L.text).optional(),
                expectAbsentText: z.string().max(L.text).optional()
              })).min(1).max(100)
            }).optional().describe('Сценарий целиком; без него берётся записанный в этом разговоре'),
            expectTimeoutMs: z.number().int().min(100).max(30_000).optional().describe('Сколько ждать ожидаемый текст после шага')
          }
        },
        async ({ scenario, expectTimeoutMs }) => {
          if (!entry) return noContext
          const plan = scenario ?? scenarioOf(entry.conversationId)
          if (!plan || !plan.steps.length) return toolResult({ ok: false, error: 'Нечего прогонять: сценарий пуст. Включи запись (record start) или передай scenario.' })
          const send = async (action: PreviewAction): Promise<{ ok: boolean; error?: string }> => {
            const direct = await opts.browserExecutor?.(entry.userId, entry.conversationId, action)
            if (direct) return { ok: direct.ok, ...(direct.error ? { error: direct.error } : {}) }
            const outcome = await opts.relay.request(entry.userId, entry.conversationId, action, opts.timeoutMs)
            return { ok: outcome.ok, ...(outcome.error ? { error: outcome.error } : {}) }
          }
          const report: Array<{ id: string; title: string; ok: boolean; detail?: string }> = []
          if (plan.startUrl) {
            const opened = await send({ kind: 'open', url: plan.startUrl })
            if (!opened.ok) return toolResult({ ok: false, error: `Стартовый адрес не открылся: ${opened.error ?? 'отказ'}` })
          }
          for (const step of plan.steps) {
            if (!isPreviewAction(step.action)) { report.push({ id: step.id, title: step.title, ok: false, detail: 'Шаг содержит неизвестное действие' }); break }
            const outcome = await send(step.action as PreviewAction)
            if (!outcome.ok) { report.push({ id: step.id, title: step.title, ok: false, detail: outcome.error ?? 'Действие не выполнено' }); break }
            // Проверка живёт на шаге: «нажал — увидел» это одно событие, и ждать
            // текст нужно сразу после действия, а не перед следующим.
            if (step.expectText) {
              const waited = await send({ kind: 'wait', text: step.expectText, ...(expectTimeoutMs ? { timeoutMs: expectTimeoutMs } : {}) })
              if (!waited.ok) { report.push({ id: step.id, title: step.title, ok: false, detail: `Не дождались текста «${step.expectText}»` }); break }
            }
            if (step.expectAbsentText) {
              const hidden = await send({ kind: 'wait', text: step.expectAbsentText, state: 'hidden', ...(expectTimeoutMs ? { timeoutMs: expectTimeoutMs } : {}) })
              if (!hidden.ok) { report.push({ id: step.id, title: step.title, ok: false, detail: `На странице остался текст «${step.expectAbsentText}»` }); break }
            }
            report.push({ id: step.id, title: step.title, ok: true })
          }
          const failed = report.find((item) => !item.ok)
          return toolResult({
            ok: !failed,
            ...(failed ? { error: `Шаг «${failed.title}»: ${failed.detail ?? 'не выполнен'}` } : {}),
            result: { passed: !failed, steps: report, total: plan.steps.length } as never
          })
        }
      )

      server.registerTool(
        'record-check',
        {
          description:
            'Прикрепить проверку к последнему записанному шагу: после него текст обязан быть на странице ' +
            '(или обязан отсутствовать — absent). В сценарии «нажал — увидел» это одно событие, ' +
            'поэтому проверка живёт на шаге, а не становится отдельным. ' +
            'Сценарий без единой проверки проходит, даже если страница сломана.',
          inputSchema: {
            text: z.string().min(1).max(L.text).describe('Ожидаемый текст'),
            absent: z.boolean().optional().describe('true — текста быть не должно')
          }
        },
        async ({ text, absent }) => {
          if (!entry) return noContext
          const attached = recordExpectation(entry.conversationId, text, absent === true)
          return toolResult(attached
            ? { ok: true, result: { attached: true } as never }
            : { ok: false, error: 'Нет записанного шага: включи запись (record start) и сделай действие.' })
        }
      )

      server.registerTool(
        'storage',
        {
          description:
            'Хранилище сайта (localStorage и sessionStorage): что страница держит между перезагрузками. ' +
            'Здесь живёт половина дефектов «у меня работает» — устаревший флаг, недописанный черновик, ' +
            'включённая фича. do: read (по умолчанию), set, remove, clear. Значения длиннее 500 символов ' +
            'возвращаются обрезанными, но с полным размером в bytes. ' +
            'В отличие от evaluate, этот инструмент не считается выполнением произвольного кода.',
          inputSchema: { frame: frameSchema,
            area: z.enum(['local', 'session', 'both']).optional().describe('Какое хранилище (по умолчанию оба)'),
            do: z.enum(['read', 'set', 'remove', 'clear']).optional().describe('Что сделать'),
            key: z.string().max(400).optional().describe('Ключ (обязателен для set и remove; для read фильтрует)'),
            value: z.string().max(100_000).optional().describe('Значение для set'),
            limit: z.number().int().min(1).max(200).optional().describe('Сколько ключей вернуть (по умолчанию 50)')
          }
        },
        async ({ frame, area, do: operation, key, value, limit }) => {
          if (operation === 'set' && (key === undefined || value === undefined)) return { content: [{ type: 'text', text: 'Для set нужны key и value.' }], isError: true }
          if (operation === 'remove' && key === undefined) return { content: [{ type: 'text', text: 'Для remove нужен key.' }], isError: true }
          return run({ kind: 'storage', ...(frame !== undefined ? { frame } : {}), ...(area ? { area } : {}), ...(operation ? { do: operation } : {}), ...(key !== undefined ? { key } : {}), ...(value !== undefined ? { value } : {}), ...(limit !== undefined ? { limit } : {}) })
        }
      )

      server.registerTool(
        'source',
        {
          description:
            'Исходная разметка страницы или элемента порциями (offset/limit, nextOffset). ' +
            'Нужна там, где текст не отвечает на вопрос: атрибуты, скрытые поля, data-* и порядок узлов. ' +
            'read даёт содержимое глазами человека, source — то, что на самом деле в документе.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор элемента (без него — весь документ)'),
            offset: z.number().int().min(0).optional().describe('Смещение в символах'),
            limit: z.number().int().min(100).max(20_000).optional().describe('Размер порции (по умолчанию 4000)')
          }
        },
        async ({ frame, selector, offset, limit }) => run({ kind: 'source', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}), ...(offset !== undefined ? { offset } : {}), ...(limit !== undefined ? { limit } : {}) })
      )

      server.registerTool(
        'csv',
        {
          description:
            'Таблица целиком в CSV: форма, которую человек вставляет в таблицу или в комментарий задачи. ' +
            'Кавычки и переводы строк экранируются. table отвечает «что в третьей строке», csv — «дай всё».',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).describe('CSS-селектор таблицы'),
            offset: z.number().int().min(0).optional().describe('С какой строки'),
            limit: z.number().int().min(1).max(500).optional().describe('Сколько строк (по умолчанию 100)')
          }
        },
        async ({ frame, selector, offset, limit }) => run({ kind: 'csv', ...(frame !== undefined ? { frame } : {}), selector, ...(offset !== undefined ? { offset } : {}), ...(limit !== undefined ? { limit } : {}) })
      )

      server.registerTool(
        'expect',
        {
          description:
            'Несколько проверок страницы разом, одним вердиктом: есть ли текст, виден ли элемент, ' +
            'сколько их, что в поле, какой адрес. Человек описывает экран одним предложением — ' +
            '«итого 500, ошибки нет, три строки»; здесь то же самое, и ответ говорит, ' +
            'что именно не сошлось и что на странице вместо этого.',
          inputSchema: { frame: frameSchema,
            checks: z.array(z.union([
              z.object({ is: z.literal('text'), value: z.string().max(L.text), selector: z.string().max(L.selector).optional(), absent: z.boolean().optional() }),
              z.object({ is: z.literal('visible'), selector: z.string().max(L.selector), absent: z.boolean().optional() }),
              z.object({ is: z.literal('count'), selector: z.string().max(L.selector), value: z.number().int().min(0).max(100_000) }),
              z.object({ is: z.literal('value'), selector: z.string().max(L.selector), value: z.string().max(L.text) }),
              z.object({ is: z.literal('url'), value: z.string().max(L.url) })
            ])).min(1).max(20).describe('Проверки; все должны сойтись')
          }
        },
        async ({ frame, checks }) => run({ kind: 'expect', ...(frame !== undefined ? { frame } : {}), checks: checks as never })
      )

      server.registerTool(
        'note',
        {
          description:
            'Оставить человеку строку о том, чем ты сейчас занят в браузере: она появится в ленте панели ' +
            'рядом с действиями. По списку команд намерение не восстанавливается, а человек смотрит на кадр ' +
            'и не понимает, что происходит. Пиши коротко и по делу, перед долгим участком работы.',
          inputSchema: { text: z.string().min(1).max(500).describe('Что ты делаешь и зачем') }
        },
        async ({ text }) => {
          if (!entry) return noContext
          const result = await opts.browserControl?.(entry.userId, entry.conversationId, { type: 'note', text })
          return toolResult(result ?? { ok: false, error: 'Заметки доступны только в Playwright Reader или Chromium-проверке.' })
        }
      )

      server.registerTool(
        'history',
        {
          description:
            'Что происходило в этой браузерной сессии: действия человека и модели в порядке событий, ' +
            'с итогом каждого. Полезно после передачи управления («что человек успел сделать»), ' +
            'при разборе своей же ошибки и для отчёта в задаче. clear очищает ленту.',
          inputSchema: {
            actor: z.enum(['user', 'assistant']).optional().describe('Только человек или только модель'),
            limit: z.number().int().min(1).max(200).optional().describe('Сколько последних записей (по умолчанию 30)'),
            clear: z.boolean().optional().describe('Очистить ленту')
          }
        },
        async (options) => {
          if (!entry) return noContext
          const result = await opts.browserControl?.(entry.userId, entry.conversationId, { type: 'history', ...options })
          return toolResult(result ?? { ok: false, error: 'Лента сессии доступна только в Playwright Reader или Chromium-проверке.' })
        }
      )

      server.registerTool(
        'emulate',
        {
          description:
            'Среда, в которой сидит человек: тема системы (dark/light), уменьшенная анимация, ' +
            'высокий контраст, отсутствие сети и геопозиция. Страница ведёт себя под ними по-разному, ' +
            'и такие дефекты иначе находит только тот, у кого именно такая настройка. ' +
            'Действует на все вкладки сессии и переживает переходы. Ответ показывает, что теперь в силе.',
          inputSchema: {
            colorScheme: z.enum(['light', 'dark', 'no-preference']).optional().describe('prefers-color-scheme страницы'),
            reducedMotion: z.enum(['reduce', 'no-preference']).optional().describe('prefers-reduced-motion'),
            forcedColors: z.enum(['active', 'none']).optional().describe('Режим высокой контрастности системы'),
            offline: z.boolean().optional().describe('Отключить сеть: так проверяется поведение без интернета'),
            geolocation: z.object({
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
              accuracy: z.number().min(0).optional()
            }).nullable().optional().describe('Координаты для страницы; null убирает позицию. Разрешение geolocation выдаётся автоматически'),
            permissions: z.array(z.string().max(64)).max(16).optional().describe('Разрешения сайта (geolocation, clipboard-read…); пустой список отзывает все')
          }
        },
        async (options) => {
          if (!entry) return noContext
          const result = await opts.browserControl?.(entry.userId, entry.conversationId, { type: 'environment', ...options })
          return toolResult(result ?? { ok: false, error: 'Эмуляция среды доступна только в Playwright Reader или Chromium-проверке.' })
        }
      )

      server.registerTool(
        'cookies',
        {
          description:
            'Cookies сессии браузера: list читает, add ставит одну, clear убирает все или одну по имени. ' +
            'Значение длинной cookie возвращается сокращённым — это доступ к аккаунту, и в переписке ему не место. ' +
            'Для входа тестовой учёткой обычно достаточно add с url сайта.',
          inputSchema: {
            action: z.enum(['list', 'add', 'clear']).describe('Что сделать'),
            name: z.string().max(200).optional().describe('Имя cookie'),
            value: z.string().max(4_096).optional().describe('Значение (для add)'),
            url: z.string().max(L.url).optional().describe('Адрес сайта (для add, вместо domain/path)'),
            domain: z.string().max(253).optional().describe('Домен (для add вместе с path)'),
            path: z.string().max(1_024).optional().describe('Путь (по умолчанию /)'),
            expires: z.number().optional().describe('Срок жизни, unix-время в секундах'),
            httpOnly: z.boolean().optional(),
            secure: z.boolean().optional(),
            sameSite: z.enum(['Strict', 'Lax', 'None']).optional()
          }
        },
        async (options) => {
          if (!entry) return noContext
          const result = await opts.browserControl?.(entry.userId, entry.conversationId, { type: 'cookies', ...options })
          return toolResult(result ?? { ok: false, error: 'Cookies доступны только в Playwright Reader или Chromium-проверке.' })
        }
      )

      server.registerTool(
        'media',
        {
          description:
            'Видео и аудио страницы: что играет, сколько длится, где сейчас, выключен ли звук. ' +
            'do управляет ими как человек — play, pause, mute, unmute; seconds перематывает. ' +
            'Отказ автовоспроизведения возвращается причиной, а не молчанием: человек увидел бы то же самое.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор конкретного video/audio'),
            do: z.enum(['play', 'pause', 'mute', 'unmute']).optional().describe('Действие над первым найденным элементом'),
            seconds: z.number().min(0).max(86_400).optional().describe('Перемотать на эту секунду')
          }
        },
        async ({ frame, selector, do: action, seconds }) => run({ kind: 'media', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}), ...(action ? { do: action } : {}), ...(seconds !== undefined ? { seconds } : {}) })
      )

      server.registerTool(
        'scroll-until',
        {
          description:
            'Прокручивать ленту, пока не покажется цель (selector или text) или не кончится содержимое. ' +
            'Для лент с ленивой подгрузкой: обычный scroll на них либо останавливается на первом экране, ' +
            'либо крутится вслепую. Между шагами есть пауза на подгрузку. ' +
            'Ответ говорит, нашлась ли цель, сколько было прокруток и дошли ли до конца.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор цели'),
            text: z.string().max(L.text).optional().describe('Видимый текст цели'),
            container: z.string().max(L.selector).optional().describe('CSS-селектор прокручиваемого контейнера (без него — окно)'),
            maxScrolls: z.number().int().min(1).max(50).optional().describe('Сколько прокруток максимум (по умолчанию 10)'),
            step: z.number().min(1).max(10_000).optional().describe('Шаг прокрутки в пикселях (по умолчанию 800)')
          }
        },
        async ({ frame, selector, text, container, maxScrolls, step }) => {
          if (!selector && !text) return { content: [{ type: 'text', text: 'Укажи selector или text.' }], isError: true }
          return run({ kind: 'scrollUntil', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}), ...(text ? { text } : {}), ...(container ? { container } : {}), ...(maxScrolls !== undefined ? { maxScrolls } : {}), ...(step !== undefined ? { step } : {}) })
        }
      )

      server.registerTool(
        'count',
        {
          description:
            'Сколько элементов подходит под селектор или текст: видимых и всего. ' +
            'Проверка «стало на одну строку больше» не требует читать их текст и не съедает контекст хода.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).optional().describe('CSS-селектор'),
            text: z.string().max(L.text).optional().describe('Видимый текст'),
            visibleOnly: z.boolean().optional().describe('false — считать и скрытые (по умолчанию считаются видимые)')
          }
        },
        async ({ frame, selector, text, visibleOnly }) => {
          if (!selector && !text) return { content: [{ type: 'text', text: 'Укажи selector или text.' }], isError: true }
          return run({ kind: 'count', ...(frame !== undefined ? { frame } : {}), ...(selector ? { selector } : {}), ...(text ? { text } : {}), ...(visibleOnly !== undefined ? { visibleOnly } : {}) })
        }
      )

      server.registerTool(
        'table',
        {
          description:
            'Таблица так, как её читает человек: строки записями под заголовками колонок, с порциями ' +
            'offset/limit и nextOffset. columns оставляет только нужные колонки. ' +
            'В отличие от read, не теряет связь ячейки со своим заголовком.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).describe('CSS-селектор таблицы'),
            offset: z.number().int().min(0).optional().describe('С какой строки читать'),
            limit: z.number().int().min(1).max(200).optional().describe('Сколько строк (по умолчанию 20)'),
            columns: z.array(z.string().max(200)).min(1).max(32).optional().describe('Заголовки нужных колонок')
          }
        },
        async ({ frame, selector, offset, limit, columns }) => run({ kind: 'table', ...(frame !== undefined ? { frame } : {}), selector, ...(offset !== undefined ? { offset } : {}), ...(limit !== undefined ? { limit } : {}), ...(columns ? { columns } : {}) })
      )

      server.registerTool(
        'list',
        {
          description:
            'Повторяющиеся блоки страницы (карточки, лента, результаты поиска) записями: заголовок, текст, ' +
            'ссылка и свои кнопки каждого блока с селекторами. Плоский текст read теряет, какая кнопка ' +
            'к какой карточке относится, — и клик уходил в соседнюю.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).describe('CSS-селектор повторяющегося блока'),
            offset: z.number().int().min(0).optional().describe('С какого блока читать'),
            limit: z.number().int().min(1).max(100).optional().describe('Сколько блоков (по умолчанию 20)')
          }
        },
        async ({ frame, selector, offset, limit }) => run({ kind: 'list', ...(frame !== undefined ? { frame } : {}), selector, ...(offset !== undefined ? { offset } : {}), ...(limit !== undefined ? { limit } : {}) })
      )

      server.registerTool(
        'metrics',
        {
          description:
            'Куда прокручена страница и сколько её осталось: позиция, полная высота, размер окна, ' +
            'сколько экранов ниже и достигнут ли низ. Ответ на вопрос «я всё прочитал или это только начало».',
          inputSchema: { frame: frameSchema }
        },
        async ({ frame }) => run({ kind: 'metrics', ...(frame !== undefined ? { frame } : {}) })
      )

      server.registerTool(
        'measure',
        {
          description:
            'Геометрия элемента: положение, размер, попадает ли во вьюпорт, перекрыт ли другим узлом ' +
            '(липкой шапкой — обычная причина «клик не сработал») и на сколько нужно прокрутить до него.',
          inputSchema: { frame: frameSchema, selector: z.string().max(L.selector).describe('CSS-селектор элемента') }
        },
        async ({ frame, selector }) => run({ kind: 'measure', ...(frame !== undefined ? { frame } : {}), selector })
      )

      server.registerTool(
        'highlight',
        {
          description:
            'Обвести элемент рамкой прямо на странице на несколько секунд — человек в панели увидит, ' +
            'о каком элементе идёт речь. Селектор в переписке нечитаем, рамка в кадре понятна сразу.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).describe('CSS-селектор элемента'),
            ms: z.number().min(100).max(10_000).optional().describe('Сколько держать рамку, мс (по умолчанию 1500)')
          }
        },
        async ({ frame, selector, ms }) => run({ kind: 'highlight', ...(frame !== undefined ? { frame } : {}), selector, ...(ms !== undefined ? { ms } : {}) })
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
            'Ввести текст в поле открытой в превью страницы (CSS-селектор поля). submit: true — отправить форму после ввода. ' +
            'delay — посимвольный ввод с паузой: без него значение ставится целиком, и автодополнение страницы не просыпается.',
          inputSchema: { frame: frameSchema,
            selector: z.string().max(L.selector).describe('CSS-селектор поля ввода'),
            text: z.string().max(L.text).describe('Текст для ввода'),
            submit: z.boolean().optional().describe('Отправить форму после ввода'),
            delay: z.number().min(0).max(200).optional().describe('Пауза между символами в мс: поле получит каждое нажатие — так срабатывают автодополнение и поиск с задержкой')
          }
        },
        async ({ frame, selector, text, submit, delay }) => run({ kind: 'type', ...(frame !== undefined ? { frame } : {}), selector, text, ...(submit !== undefined ? { submit } : {}), ...(delay !== undefined ? { delay } : {}) })
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

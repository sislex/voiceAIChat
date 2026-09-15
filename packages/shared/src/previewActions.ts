import { isPreviewAccessibilityOptions, type PreviewAccessibilityOptions, type PreviewAccessibilityResult } from './previewAccessibility'
import { BROWSER_EVALUATE_CODE_LIMIT, normalizeBrowserEvaluateOptions, type BrowserEvaluateOptions } from './browserEvaluation'
import { isPreviewAuditOptions, type PreviewAuditOptions, type PreviewAuditResult } from './previewAudit'
import { isPreviewProbeOptions, type PreviewProbeOptions, type PreviewProbeResult } from './previewProbe'
import { normalizeBrowserDiagnosticOptions, type BrowserConsoleOptions, type BrowserNetworkOptions } from './browserDiagnostics'
// Управление открытым сайтом в панели превью и чтение его DOM из хода модели.
//
// Три берега одного протокола:
//  - сервер (mcp/previewMcp.ts) транслирует вызов инструмента модели клиенту
//    кадром ServerMessage `preview.action` и ждёт `preview.result`;
//  - UI (PreviewPane) выполняет `open` сам, а DOM-действия пересылает в iframe
//    превью postMessage-командой и возвращает ответ странице;
//  - автономный скрипт превью (previewProxy.ts) исполняет DOM-действие и
//    отвечает result-сообщением родителю.
// Здесь — типы действий, лимиты и runtime-валидаторы конвертов. Чистые функции:
// без DOM и сети, чтобы обе стороны (сервер и UI) проверяли одно и то же.

import { isBrowserFramePath, type BrowserFrameTarget } from './browserFrames'
import type { BrowserActionOutcome } from './playwrightReader'
import { BROWSER_UPLOAD_LIMIT_BYTES } from './browserLimits'
import { isBrowserWaitOptions, type BrowserWaitOptions } from './browserWaiting'

export const PREVIEW_ACTION_COMMAND_TYPE = 'voicechat.preview.action.v1' as const
export const PREVIEW_ACTION_RESULT_TYPE = 'voicechat.preview.action-result.v1' as const
/** Внутренний iframe сообщает recorder-оболочке, что инъецированный мост DOM готов. */
export const PREVIEW_PAGE_READY_TYPE = 'voicechat.preview.page-ready.v1' as const
export const PREVIEW_PAGE_LOADING_TYPE = 'voicechat.preview.page-loading.v1' as const

/** Лимиты полезной нагрузки: страница не должна вливать в ход мегабайты DOM. */
export const PREVIEW_ACTION_LIMITS = {
  selector: 2_000,
  url: 4_096,
  /** Текст для ввода/поиска. */
  text: 2_000,
  /** Текст одного элемента в списках (find/read). */
  elementText: 200,
  findDefault: 10,
  findMax: 30,
  headings: 64,
  links: 100,
  buttons: 50,
  inputs: 50,
  /** Текстовая выжимка страницы в `read`. */
  snippet: 4_000,
  /** Кап сериализованного результата, который сервер вернёт модели. */
  resultJson: 32_000,
  /** Отдельный кап результата со снимком (dataUrl не влезает в resultJson). */
  screenshotJson: 2_000_000,
  /** Код evaluate и сериализованное значение его результата. */
  evaluateCode: BROWSER_EVALUATE_CODE_LIMIT,
  evaluateValue: 8_000,
  /** Файл upload: до 8 МиБ бинарных данных с учётом увеличения в base64. */
  uploadBase64: Math.ceil(BROWSER_UPLOAD_LIMIT_BYTES / 3) * 4,
  /** Журналы network/console: сколько записей отдаётся за раз. */
  logDefault: 50,
  logMax: 100,
  /** Узлы дерева доступности в a11y. */
  a11yNodes: 200
} as const

/** Модификаторы клика (клавиши, зажатые на время события). */
export const PREVIEW_CLICK_MODIFIERS = ['shift', 'ctrl', 'alt', 'meta'] as const
export type PreviewClickModifier = (typeof PREVIEW_CLICK_MODIFIERS)[number]

/**
 * Модификаторы сочетания. Кроме явных клавиш есть `primary` — «выделить всё»
 * и «копировать» на Linux и на macOS нажимаются разными клавишами, а модель не
 * знает, под какой системой крутится раннер: Control+A на macOS уводит курсор
 * в начало строки вместо выделения, и это выглядело как молчаливый отказ.
 */
export const PREVIEW_HOTKEY_MODIFIERS = ['shift', 'ctrl', 'alt', 'meta', 'primary'] as const
export type PreviewHotkeyModifier = (typeof PREVIEW_HOTKEY_MODIFIERS)[number]

/** Одна проверка `expect`: намеренно узкий набор — это то, что человек говорит
 *  об экране вслух, а не язык выражений. */
export type PreviewExpectation =
  | { is: 'text'; selector?: string; value: string; absent?: boolean }
  | { is: 'visible'; selector: string; absent?: boolean }
  | { is: 'count'; selector: string; value: number }
  | { is: 'value'; selector: string; value: string }
  | { is: 'url'; value: string }

/** Поле формы в массовом заполнении. */
export interface PreviewFormField {
  selector: string
  value?: string
  values?: string[]
  checked?: boolean
}

/** Файл, передаваемый странице байтами: и в input[type=file], и в зону drop. */
export interface PreviewUploadFile {
  name: string
  mimeType?: string
  base64: string
}

/** Точка или элемент — источник/цель перетаскивания. */
export interface PreviewDragPoint {
  selector?: string
  x?: number
  y?: number
}

/** Действие браузера, запрошенное моделью. `open` выполняет сам UI (без iframe). */
export type PreviewAction = BrowserFrameTarget & (
  | ({ kind: 'audit'; diagnostic?: boolean } & PreviewAuditOptions)
  | ({ kind: 'probe'; diagnostic?: boolean } & PreviewProbeOptions)
  | ({ kind: 'accessibility'; diagnostic?: boolean } & PreviewAccessibilityOptions)
  | { kind: 'open'; url: string; diagnostic?: boolean }
  | { kind: 'find'; text?: string; selector?: string; limit?: number; visibleOnly?: boolean; diagnostic?: boolean }
  /** Клик: обычный, двойной (dblclick), правый (button: right) и с модификаторами. */
  | { kind: 'click'; selector?: string; text?: string; button?: 'left' | 'right'; dblclick?: boolean; modifiers?: PreviewClickModifier[]; diagnostic?: boolean }
  | { kind: 'type'; selector: string; text: string; submit?: boolean; delay?: number; diagnostic?: boolean }
  | { kind: 'read'; selector?: string; limit?: number; offset?: number; diagnostic?: boolean }
  | { kind: 'styles'; selector: string; properties?: string[]; diagnostic?: boolean }
  /** Наведение курсора: pointer/mouse-события по элементу (выпадающие меню). */
  | { kind: 'hover'; selector?: string; text?: string; diagnostic?: boolean }
  /** Прокрутка окна или контейнера: к краю (`to`) либо на `dy` пикселей. */
  | { kind: 'scroll'; selector?: string; to?: 'top' | 'bottom'; dx?: number; dy?: number; diagnostic?: boolean }
  /** Нажатие клавиши (Escape, Enter, Tab, ArrowDown, …) на элементе или активном поле. */
  | { kind: 'press'; key: string; selector?: string; repeat?: number; diagnostic?: boolean }
  /**
   * Keyboard shortcut with modifiers held, the way a person presses it
   * (Control+A, Meta+C, Shift+Tab). Separate from `press` because the model
   * kept spelling shortcuts as three keyDown/keyUp calls and lost a modifier
   * in the middle, leaving the page typing in uppercase forever.
   */
  | { kind: 'hotkey'; key: string; modifiers: PreviewHotkeyModifier[]; repeat?: number; selector?: string; diagnostic?: boolean }
  /** Focus an element without clicking it, or report the focused one when no selector is given. */
  | { kind: 'focus'; selector?: string; diagnostic?: boolean }
  /** Empty an input the way Ctrl+A Delete does, firing input/change. */
  | { kind: 'clear'; selector: string; diagnostic?: boolean }
  /** Select the text of an element (or the whole page) as a drag would. */
  | { kind: 'selectText'; selector?: string; diagnostic?: boolean }
  /** Read the current selection — what Ctrl+C would copy. */
  | { kind: 'copy'; diagnostic?: boolean }
  /** Paste text into the focused field (or `selector`), firing a paste event. */
  | { kind: 'paste'; selector?: string; text: string; diagnostic?: boolean }
  /** Tab order of the page: the path a keyboard-only person walks, in order. */
  | { kind: 'focusOrder'; selector?: string; limit?: number; diagnostic?: boolean }
  /** Прокручивать ленту, пока не появится цель или не кончится содержимое. */
  | { kind: 'scrollUntil'; selector?: string; text?: string; container?: string; maxScrolls?: number; step?: number; diagnostic?: boolean }
  /** Сколько узлов подходит под условие — проверка без чтения их текста. */
  | { kind: 'count'; selector?: string; text?: string; visibleOnly?: boolean; diagnostic?: boolean }
  /** Таблица строками под заголовками, с порциями. */
  | { kind: 'table'; selector: string; offset?: number; limit?: number; columns?: string[]; diagnostic?: boolean }
  /** Повторяющиеся блоки (карточки, лента) записями со своими действиями. */
  | { kind: 'list'; selector: string; offset?: number; limit?: number; diagnostic?: boolean }
  /** Куда прокручена страница и сколько её осталось ниже. */
  | { kind: 'metrics'; diagnostic?: boolean }
  /** Геометрия элемента: виден ли, перекрыт ли, сколько прокрутки до него. */
  | { kind: 'measure'; selector: string; diagnostic?: boolean }
  /** Обвести элемент в кадре, чтобы человек увидел, о чём речь. */
  | { kind: 'highlight'; selector: string; ms?: number; diagnostic?: boolean }
  /** Видео и аудио страницы: состояние и управление, как у человека. */
  | { kind: 'media'; selector?: string; do?: 'play' | 'pause' | 'mute' | 'unmute'; seconds?: number; diagnostic?: boolean }
  /** Несколько проверок разом с общим вердиктом — как человек описывает экран. */
  | { kind: 'expect'; checks: PreviewExpectation[]; diagnostic?: boolean }
  /** Что происходило в сессии: обе стороны, в порядке событий. */
  | { kind: 'history'; actor?: 'user' | 'assistant'; limit?: number; clear?: boolean; diagnostic?: boolean }
  /** Строка от модели в панель человека: чем она сейчас занята. */
  | { kind: 'note'; text: string; diagnostic?: boolean }
  /** Среда браузера: тема системы, уменьшенная анимация, контраст, сеть, место. */
  | { kind: 'environment'; colorScheme?: 'light' | 'dark' | 'no-preference'; reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none'; offline?: boolean; geolocation?: { latitude: number; longitude: number; accuracy?: number } | null; permissions?: string[]; diagnostic?: boolean }
  /** Снимок области: элемент по селектору, явный rect (координаты документа) или видимая область. */
  | { kind: 'screenshot'; selector?: string; rect?: { x: number; y: number; width: number; height: number }; diagnostic?: boolean }
  /** Ошибки открытой страницы: JS-исключения, unhandledrejection, console.error, неуспешные fetch/XHR. */
  | { kind: 'errors'; clear?: boolean; diagnostic?: boolean }
  /** Дождаться появления элемента (selector или видимый text) с таймаутом. */
  | ({ kind: 'wait'; diagnostic?: boolean } & BrowserWaitOptions)
  /** Назад по истории внутренней страницы (переход подтверждается page-ready). */
  | { kind: 'back'; diagnostic?: boolean }
  /** Вперёд по истории внутренней страницы (симметрично back). */
  | { kind: 'forward'; diagnostic?: boolean }
  /** Сохранённые правки edit-режима текущей страницы (перенести «как поправил» в код). */
  | { kind: 'edits'; diagnostic?: boolean }
  /** Журнал сетевых запросов страницы (fetch/XHR/beacon): фильтр по подстроке URL. */
  | ({ kind: 'network'; diagnostic?: boolean } & BrowserNetworkOptions)
  /** Журнал console.log/info/warn/error страницы: фильтр по подстроке и уровню. */
  | ({ kind: 'console'; diagnostic?: boolean } & Omit<BrowserConsoleOptions, 'regex'>)
  /** Выполнить JS в контексте страницы; результат сериализуется JSON (кап evaluateValue). */
  | ({ kind: 'evaluate'; diagnostic?: boolean } & BrowserEvaluateOptions)
  /** Перетаскивание pointer-событиями (или HTML5 DnD у draggable) от from к to. */
  | { kind: 'drag'; from: PreviewDragPoint; to: PreviewDragPoint; diagnostic?: boolean }
  /** Установить значение сложного контрола: select (по value или подписи option), checkbox/radio (checked), date/range (value). */
  | { kind: 'set'; selector: string; value?: string; values?: string[]; checked?: boolean; diagnostic?: boolean }
  /** Заполнить форму целиком: человек заполняет её одним действием, а не полем за вызов. */
  | { kind: 'fillForm'; selector?: string; fields: PreviewFormField[]; delay?: number; diagnostic?: boolean }
  /** Что сейчас в форме: поля, значения, обязательность — проверка результата заполнения. */
  | { kind: 'formState'; selector?: string; limit?: number; diagnostic?: boolean }
  /** Валидация браузера: какие поля не дают отправить форму и почему. */
  | { kind: 'validity'; selector?: string; diagnostic?: boolean }
  /** Отправить форму так же, как Enter: с валидацией и обработчиком submit. */
  | { kind: 'submit'; selector?: string; diagnostic?: boolean }
  /** Варианты контрола: select, datalist, группа radio. */
  | { kind: 'options'; selector: string; limit?: number; diagnostic?: boolean }
  /** Перетащить файлы в зону загрузки — путь без input[type=file]. */
  | { kind: 'dropFile'; selector: string; files: PreviewUploadFile[]; diagnostic?: boolean }
  /** Загрузить файл в input type=file: содержимое приходит base64 от модели. */
  | { kind: 'upload'; selector: string; name: string; mimeType?: string; base64: string; files?: PreviewUploadFile[]; diagnostic?: boolean }
  /** Ширина вьюпорта превью в пикселях (исполняет Reader, не страница); 0 — адаптив. */
  | { kind: 'viewport'; width: number; diagnostic?: boolean }
  /** Дерево доступности страницы: роли и имена как их видит скринридер. */
  | { kind: 'a11y'; selector?: string; limit?: number; diagnostic?: boolean }
)

/** DOM-действия, которые уходят в iframe (все, кроме `open`). */
export type PreviewDomAction = Exclude<PreviewAction, { kind: 'open' }>

/** Короткое описание элемента страницы в ответах find/click/type. */
export interface PreviewActionElement {
  selector: string
  tag: string
  text: string
  /** Ссылка (для <a>) — как в DOM страницы, без переписывания на прокси. */
  href?: string
  /** ARIA-роль или тип поля ввода — чем элемент является для пользователя. */
  role?: string
  disabled?: boolean
  readOnly?: boolean
  checked?: boolean | 'mixed'
  expanded?: boolean
  selected?: boolean
  required?: boolean
  invalid?: boolean
}

export interface PreviewPageInfo {
  url: string
  title: string
}

export interface PreviewFindResult {
  page: PreviewPageInfo
  elements: PreviewActionElement[]
  /** Сколько всего совпадений на странице (elements обрезан лимитом). */
  total: number
}

export interface PreviewClickResult {
  page: PreviewPageInfo
  clicked: PreviewActionElement
}

export interface PreviewTypeResult {
  page: PreviewPageInfo
  typed: PreviewActionElement
  submitted: boolean
}

/** Структурированное содержимое страницы (или поддерева по selector). */
export interface PreviewReadResult {
  page: PreviewPageInfo
  headings: { level: number; text: string }[]
  links: { text: string; href: string }[]
  buttons: string[]
  inputs: { selector: string; type: string; name: string; placeholder: string; value: string; label?: string; expanded?: boolean; selected?: boolean; disabled?: boolean; readOnly?: boolean; checked?: boolean | 'mixed'; required?: boolean; invalid?: boolean }[]
  /** Видимый текст (обрезан лимитом) — на случай страниц без семантики. */
  text: string
  total?: number
  offset?: number
  nextOffset?: number
  truncated?: boolean
}

export interface PreviewOpenResult {
  url: string
}

export interface PreviewStylesResult {
  page: PreviewPageInfo
  selector: string
  styles: Record<string, string>
}

export interface PreviewHoverResult {
  page: PreviewPageInfo
  hovered: PreviewActionElement
}

export interface PreviewScrollResult {
  page: PreviewPageInfo
  /** Что прокручено: окно или контейнер по селектору. */
  target: string
  scrolled: { top: number; left: number; maxTop: number; maxLeft?: number }
}

export interface PreviewPressResult {
  page: PreviewPageInfo
  pressed: { key: string; selector: string }
}

/** Снимок области страницы: PNG/JPEG data-URL и итоговый rect в координатах документа. */
export interface PreviewScreenshotResult {
  page: PreviewPageInfo
  rect: { x: number; y: number; width: number; height: number }
  dataUrl: string
}

/** Запись об ошибке страницы (кольцевой буфер инъецированного скрипта). */
export interface PreviewPageError {
  kind: 'error' | 'unhandledrejection' | 'console.error' | 'network'
  message: string
  /** Для network: реальный (не прокси) адрес и статус ответа. */
  url?: string
  status?: number
  /** Миллисекунды с загрузки страницы (performance.now на момент ошибки). */
  at: number
}

export interface PreviewErrorsResult {
  page: PreviewPageInfo
  errors: PreviewPageError[]
  /** Сколько всего накоплено (errors обрезан лимитом выдачи). */
  total: number
}

export interface PreviewWaitResult {
  page: PreviewPageInfo
  found: PreviewActionElement
  waitedMs: number
}

export interface PreviewBackResult {
  page: PreviewPageInfo
  navigating: boolean
}

/** Запись журнала сетевых запросов страницы (кольцевой буфер скрипта). */
export interface PreviewNetworkEntry {
  /** Транспорт запроса: fetch, XHR, beacon или загрузка самой страницы. */
  via: 'fetch' | 'xhr' | 'beacon'
  method: string
  /** Реальный (не прокси) адрес. */
  url: string
  status?: number
  /** Длительность запроса, мс (нет — запрос ещё в полёте или упал до ответа). */
  ms?: number
  error?: string
  /** Миллисекунды с загрузки страницы на момент старта запроса. */
  at: number
}

export interface PreviewNetworkResult {
  page: PreviewPageInfo
  requests: PreviewNetworkEntry[]
  /** Сколько всего накоплено (requests обрезан лимитом выдачи). */
  total: number
}

/** Запись журнала консоли страницы. */
export interface PreviewConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
  at: number
}

export interface PreviewConsoleResult {
  page: PreviewPageInfo
  messages: PreviewConsoleEntry[]
  total: number
}

export interface PreviewEvaluateResult {
  page: PreviewPageInfo
  /** JSON.stringify результата (обрезан капом evaluateValue); undefined → "undefined". */
  value: string
}

export interface PreviewDragResult {
  page: PreviewPageInfo
  dragged: PreviewActionElement
  /** Итоговая точка отпускания в координатах вьюпорта. */
  to: { x: number; y: number }
  /** Какой механикой выполнено: pointer-события или HTML5 DnD. */
  via: 'pointer' | 'html5'
}

export interface PreviewSetResult {
  page: PreviewPageInfo
  set: PreviewActionElement
  /** Итоговое состояние контрола после установки. */
  value: string
}

export interface PreviewUploadResult {
  page: PreviewPageInfo
  uploaded: { selector: string; name: string; size: number }
}

/** Результат viewport: исполняет Reader-оболочка, страница не участвует. */
export interface PreviewViewportResult {
  /** Применённая ширина в px; 0 — адаптив (по ширине панели). */
  width: number
}

/** Узел дерева доступности: роль и имя как их видит скринридер. */
export interface PreviewA11yNode {
  disabled?: boolean
  readOnly?: boolean
  checked?: boolean | 'mixed'
  expanded?: boolean
  selected?: boolean
  required?: boolean
  invalid?: boolean
  role: string
  name: string
  selector: string
  /** Глубина вложенности узла относительно корня обхода. */
  level: number
}

export interface PreviewA11yResult {
  page: PreviewPageInfo
  nodes: PreviewA11yNode[]
  total: number
}

/** Правка edit-режима одного элемента (selector → что изменено). */
export interface PreviewEditEntry {
  selector: string
  style?: Record<string, string>
  text?: string
  deleted?: boolean
}

export interface PreviewEditsResult {
  page: PreviewPageInfo
  edits: PreviewEditEntry[]
}

export type PreviewActionResult =
  | PreviewAuditResult
  | PreviewProbeResult
  | PreviewAccessibilityResult
  | PreviewOpenResult
  | PreviewFindResult
  | PreviewClickResult
  | PreviewTypeResult
  | PreviewReadResult
  | PreviewStylesResult
  | PreviewHoverResult
  | PreviewScrollResult
  | PreviewPressResult
  | PreviewScreenshotResult
  | PreviewErrorsResult
  | PreviewWaitResult
  | PreviewBackResult
  | PreviewEditsResult
  | PreviewNetworkResult
  | PreviewConsoleResult
  | PreviewEvaluateResult
  | PreviewDragResult
  | PreviewSetResult
  | PreviewUploadResult
  | PreviewViewportResult
  | PreviewA11yResult

/** Команда родителя в iframe превью. */
export interface PreviewActionCommand {
  type: typeof PREVIEW_ACTION_COMMAND_TYPE
  requestId: string
  action: PreviewDomAction
}

/** Ответ iframe родителю (тот же конверт UI шлёт серверу в preview.result). */
export interface PreviewActionResultMessage {
  type: typeof PREVIEW_ACTION_RESULT_TYPE
  requestId: string
  ok: boolean
  result?: PreviewActionResult
  error?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}
function optBounded(value: unknown, max: number): boolean {
  return value === undefined || bounded(value, max)
}

/** Валидатор действия (вход инструмента уже проверил zod — это проверка КОНВЕРТА). */
export function isPreviewAction(value: unknown): value is PreviewAction {
  if (!record(value)) return false
  if (value.frame !== undefined && !isBrowserFramePath(value.frame)) return false
  const L = PREVIEW_ACTION_LIMITS
  switch (value.kind) {
    case 'open':
      return bounded(value.url, L.url) && isHttpUrl(value.url)
    case 'find':
      return (
        optBounded(value.text, L.text) &&
        optBounded(value.selector, L.selector) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isFinite(value.limit))) &&
        (value.visibleOnly === undefined || typeof value.visibleOnly === 'boolean') &&
        (value.text !== undefined || value.selector !== undefined)
      )
    case 'click':
      return (
        optBounded(value.text, L.text) &&
        optBounded(value.selector, L.selector) &&
        (value.text !== undefined || value.selector !== undefined) &&
        (value.button === undefined || value.button === 'left' || value.button === 'right') &&
        (value.dblclick === undefined || typeof value.dblclick === 'boolean') &&
        (value.modifiers === undefined || (Array.isArray(value.modifiers) && value.modifiers.length <= 4 && value.modifiers.every((item) => (PREVIEW_CLICK_MODIFIERS as readonly string[]).includes(item as string))))
      )
    case 'type':
      return bounded(value.selector, L.selector) && bounded(value.text, L.text) &&
        (value.submit === undefined || typeof value.submit === 'boolean') &&
        // A per-character delay is what makes autocomplete and debounced search
        // behave as they do for a person; fill() pastes and they never fire.
        (value.delay === undefined || (typeof value.delay === 'number' && Number.isFinite(value.delay) && value.delay >= 0 && value.delay <= 200))
    case 'read':
      return optBounded(value.selector, L.selector) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 100 && value.limit <= 20_000)) &&
        (value.offset === undefined || (typeof value.offset === 'number' && Number.isSafeInteger(value.offset) && value.offset >= 0))
    case 'styles':
      return bounded(value.selector, L.selector) &&
        (value.properties === undefined || (Array.isArray(value.properties) && value.properties.length <= 32 && value.properties.every((item) => bounded(item, 100))))
    case 'hover':
      return (
        optBounded(value.text, L.text) &&
        optBounded(value.selector, L.selector) &&
        (value.text !== undefined || value.selector !== undefined)
      )
    case 'scroll':
      return (
        optBounded(value.selector, L.selector) &&
        (value.to === undefined || value.to === 'top' || value.to === 'bottom') &&
        (value.dy === undefined || (typeof value.dy === 'number' && Number.isFinite(value.dy) && Math.abs(value.dy) <= 100_000)) &&
        (value.dx === undefined || (typeof value.dx === 'number' && Number.isFinite(value.dx) && Math.abs(value.dx) <= 100_000)) &&
        (value.to !== undefined || value.dy !== undefined || value.dx !== undefined)
      )
    case 'press':
      return (
        typeof value.key === 'string' && value.key.length >= 1 && value.key.length <= 32 &&
        optBounded(value.selector, L.selector) && keyRepeat(value.repeat)
      )
    case 'hotkey':
      return (
        typeof value.key === 'string' && value.key.length >= 1 && value.key.length <= 32 &&
        Array.isArray(value.modifiers) && value.modifiers.length > 0 && value.modifiers.length <= 4 &&
        value.modifiers.every((item) => (PREVIEW_HOTKEY_MODIFIERS as readonly string[]).includes(item as string)) &&
        optBounded(value.selector, L.selector) && keyRepeat(value.repeat)
      )
    case 'focus':
    case 'selectText':
      return optBounded(value.selector, L.selector)
    case 'clear':
      return bounded(value.selector, L.selector)
    case 'copy':
      return true
    case 'paste':
      return bounded(value.text, L.text) && optBounded(value.selector, L.selector)
    case 'scrollUntil':
      return (
        optBounded(value.selector, L.selector) && optBounded(value.text, L.text) && optBounded(value.container, L.selector) &&
        (value.selector !== undefined || value.text !== undefined) &&
        (value.maxScrolls === undefined || (typeof value.maxScrolls === 'number' && Number.isInteger(value.maxScrolls) && value.maxScrolls >= 1 && value.maxScrolls <= 50)) &&
        (value.step === undefined || (typeof value.step === 'number' && Number.isFinite(value.step) && value.step > 0 && value.step <= 10_000))
      )
    case 'count':
      return optBounded(value.selector, L.selector) && optBounded(value.text, L.text) &&
        (value.selector !== undefined || value.text !== undefined) &&
        (value.visibleOnly === undefined || typeof value.visibleOnly === 'boolean')
    case 'table':
      return bounded(value.selector, L.selector) &&
        (value.offset === undefined || (typeof value.offset === 'number' && Number.isInteger(value.offset) && value.offset >= 0)) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 200)) &&
        (value.columns === undefined || (Array.isArray(value.columns) && value.columns.length > 0 && value.columns.length <= 32 && value.columns.every((item) => bounded(item, 200))))
    case 'list':
      return bounded(value.selector, L.selector) &&
        (value.offset === undefined || (typeof value.offset === 'number' && Number.isInteger(value.offset) && value.offset >= 0)) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 100))
    case 'metrics':
      return true
    case 'measure':
      return bounded(value.selector, L.selector)
    case 'expect':
      return Array.isArray(value.checks) && value.checks.length > 0 && value.checks.length <= 20 && value.checks.every((check) => isExpectation(check))
    case 'history':
      return (value.actor === undefined || value.actor === 'user' || value.actor === 'assistant') &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 200)) &&
        (value.clear === undefined || typeof value.clear === 'boolean')
    case 'note':
      return bounded(value.text, 500) && value.text.trim().length > 0
    case 'media':
      return optBounded(value.selector, L.selector) &&
        (value.do === undefined || ['play', 'pause', 'mute', 'unmute'].includes(value.do as string)) &&
        (value.seconds === undefined || (typeof value.seconds === 'number' && Number.isFinite(value.seconds) && value.seconds >= 0 && value.seconds <= 86_400))
    case 'environment':
      return (
        (value.colorScheme === undefined || ['light', 'dark', 'no-preference'].includes(value.colorScheme as string)) &&
        (value.reducedMotion === undefined || ['reduce', 'no-preference'].includes(value.reducedMotion as string)) &&
        (value.forcedColors === undefined || ['active', 'none'].includes(value.forcedColors as string)) &&
        (value.offline === undefined || typeof value.offline === 'boolean') &&
        (value.geolocation === undefined || value.geolocation === null || (record(value.geolocation) &&
          typeof value.geolocation.latitude === 'number' && Math.abs(value.geolocation.latitude) <= 90 &&
          typeof value.geolocation.longitude === 'number' && Math.abs(value.geolocation.longitude) <= 180 &&
          (value.geolocation.accuracy === undefined || (typeof value.geolocation.accuracy === 'number' && value.geolocation.accuracy >= 0)))) &&
        (value.permissions === undefined || (Array.isArray(value.permissions) && value.permissions.length <= 16 && value.permissions.every((item) => bounded(item, 64)))) &&
        ['colorScheme', 'reducedMotion', 'forcedColors', 'offline', 'geolocation', 'permissions'].some((key) => value[key] !== undefined)
      )
    case 'highlight':
      return bounded(value.selector, L.selector) &&
        (value.ms === undefined || (typeof value.ms === 'number' && Number.isFinite(value.ms) && value.ms >= 100 && value.ms <= 10_000))
    case 'focusOrder':
      return optBounded(value.selector, L.selector) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 200))
    case 'screenshot': {
      if (!optBounded(value.selector, L.selector)) return false
      if (value.rect === undefined) return true
      if (!record(value.rect)) return false
      const rect = value.rect
      return (['x', 'y', 'width', 'height'] as const).every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key] as number) && Math.abs(rect[key] as number) <= 100_000) &&
        (rect.width as number) > 0 && (rect.height as number) > 0
    }
    case 'audit':
      return value.frame === undefined && isPreviewAuditOptions(value)
    case 'accessibility':
      return isPreviewAccessibilityOptions(value)
    case 'probe':
      return value.frame === undefined && isPreviewProbeOptions(value)
    case 'errors':
      return value.clear === undefined || typeof value.clear === 'boolean'
    case 'wait':
      return isBrowserWaitOptions(value)
    case 'back':
    case 'forward':
    case 'edits':
      return true
    case 'network':
      return (
        validDiagnosticOptions(value) &&
        (value.state === undefined || ['pending', 'response', 'completed', 'failed'].includes(value.state as string)) &&
        optBounded(value.resourceType, 100) &&
        (value.failedOnly === undefined || typeof value.failedOnly === 'boolean') &&
        optBounded(value.filter, 300) &&
        (value.clear === undefined || typeof value.clear === 'boolean') &&
        logLimit(value.limit)
      )
    case 'console':
      return (
        validDiagnosticOptions(value) &&
        optBounded(value.pattern, 300) &&
        (value.level === undefined || value.level === 'log' || value.level === 'info' || value.level === 'warn' || value.level === 'error') &&
        (value.clear === undefined || typeof value.clear === 'boolean') &&
        logLimit(value.limit)
      )
    case 'evaluate':
      try { normalizeBrowserEvaluateOptions(value as unknown as BrowserEvaluateOptions); return true } catch { return false }
    case 'drag':
      return isDragPoint(value.from) && isDragPoint(value.to)
    case 'set':
      return (
        bounded(value.selector, L.selector) &&
        optBounded(value.value, L.text) &&
        (value.values === undefined || (Array.isArray(value.values) && value.values.length > 0 && value.values.length <= 64 && value.values.every((item) => bounded(item, L.text)))) &&
        (value.checked === undefined || typeof value.checked === 'boolean') &&
        (value.value !== undefined || value.values !== undefined || value.checked !== undefined)
      )
    case 'fillForm':
      return (
        optBounded(value.selector, L.selector) &&
        Array.isArray(value.fields) && value.fields.length > 0 && value.fields.length <= 50 &&
        value.fields.every((field) => isFormField(field)) &&
        (value.delay === undefined || (typeof value.delay === 'number' && Number.isFinite(value.delay) && value.delay >= 0 && value.delay <= 200))
      )
    case 'formState':
      return optBounded(value.selector, L.selector) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 200))
    case 'validity':
    case 'submit':
      return optBounded(value.selector, L.selector)
    case 'options':
      return bounded(value.selector, L.selector) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 500))
    case 'dropFile':
      return bounded(value.selector, L.selector) && isUploadFiles(value.files)
    case 'upload':
      // Несколько файлов передаются массивом; одиночная форма остаётся ради
      // совместимости с уже написанными ходами модели.
      if (value.files !== undefined) return bounded(value.selector, L.selector) && isUploadFiles(value.files)
      return (
        bounded(value.selector, L.selector) &&
        bounded(value.name, 255) && value.name.length > 0 &&
        optBounded(value.mimeType, 100) &&
        bounded(value.base64, L.uploadBase64)
      )
    case 'viewport':
      return typeof value.width === 'number' && Number.isFinite(value.width) && value.width >= 0 && value.width <= 10_000
    case 'a11y':
      return optBounded(value.selector, L.selector) && (value.limit === undefined || (typeof value.limit === 'number' && Number.isFinite(value.limit)))
    default:
      return false
  }
}

function validDiagnosticOptions(value: Record<string, unknown>): boolean {
  try { normalizeBrowserDiagnosticOptions(value); return true } catch { return false }
}

function isExpectation(value: unknown): boolean {
  if (!record(value)) return false
  const L = PREVIEW_ACTION_LIMITS
  if (value.is === 'text') return bounded(value.value, L.text) && optBounded(value.selector, L.selector) && (value.absent === undefined || typeof value.absent === 'boolean')
  if (value.is === 'visible') return bounded(value.selector, L.selector) && (value.absent === undefined || typeof value.absent === 'boolean')
  if (value.is === 'count') return bounded(value.selector, L.selector) && typeof value.value === 'number' && Number.isInteger(value.value) && value.value >= 0 && value.value <= 100_000
  if (value.is === 'value') return bounded(value.selector, L.selector) && typeof value.value === 'string' && value.value.length <= L.text
  if (value.is === 'url') return bounded(value.value, L.url)
  return false
}

function isFormField(value: unknown): boolean {
  if (!record(value)) return false
  const L = PREVIEW_ACTION_LIMITS
  return bounded(value.selector, L.selector) &&
    optBounded(value.value, L.text) &&
    (value.values === undefined || (Array.isArray(value.values) && value.values.length > 0 && value.values.length <= 64 && value.values.every((item) => bounded(item, L.text)))) &&
    (value.checked === undefined || typeof value.checked === 'boolean') &&
    (value.value !== undefined || value.values !== undefined || value.checked !== undefined)
}

/** Общий бюджет на все файлы тот же, что на один: он упирается в память раннера. */
function isUploadFiles(value: unknown): boolean {
  const L = PREVIEW_ACTION_LIMITS
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return false
  let total = 0
  for (const item of value) {
    if (!record(item)) return false
    if (!bounded(item.name, 255) || item.name.length === 0) return false
    if (!optBounded(item.mimeType, 100)) return false
    if (!bounded(item.base64, L.uploadBase64)) return false
    total += (item.base64 as string).length
  }
  return total <= L.uploadBase64
}

/** Repeat of a keystroke: a person holds a key, but not a thousand times. */
function keyRepeat(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 50)
}

function logLimit(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= PREVIEW_ACTION_LIMITS.logMax)
}

function isDragPoint(value: unknown): value is PreviewDragPoint {
  if (!record(value)) return false
  const coords = (value.x === undefined && value.y === undefined) ||
    (typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y) && Math.abs(value.x) <= 100_000 && Math.abs(value.y) <= 100_000)
  if (!coords) return false
  if (value.selector !== undefined && !bounded(value.selector, PREVIEW_ACTION_LIMITS.selector)) return false
  return value.selector !== undefined || value.x !== undefined
}

export function isPreviewDomAction(value: unknown): value is PreviewDomAction {
  return isPreviewAction(value) && value.kind !== 'open'
}

/** Только HTTP/HTTPS: прочие схемы в превью не открываются (см. previewProxy). */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isPreviewActionCommand(value: unknown): value is PreviewActionCommand {
  return (
    record(value) &&
    value.type === PREVIEW_ACTION_COMMAND_TYPE &&
    bounded(value.requestId, 128) &&
    isPreviewDomAction(value.action)
  )
}

/**
 * Валидатор ответа. Структуру result глубоко не проверяем: его собирает наш же
 * скрипт превью, а модель получает сериализованный JSON. Держим только конверт
 * и общий кап размера — от него зависит контекст хода.
 */
export function isPreviewActionResultMessage(value: unknown): value is PreviewActionResultMessage {
  if (!record(value) || value.type !== PREVIEW_ACTION_RESULT_TYPE) return false
  if (!bounded(value.requestId, 128) || typeof value.ok !== 'boolean') return false
  if (!optBounded(value.error, 2_000)) return false
  if (value.result === undefined) return true
  if (!record(value.result)) return false
  try {
    const cap = isScreenshotResult(value.result) ? PREVIEW_ACTION_LIMITS.screenshotJson : PREVIEW_ACTION_LIMITS.resultJson
    return JSON.stringify(value.result).length <= cap
  } catch {
    return false
  }
}

/** Результат снимка: единственный тип, которому разрешён кап больше resultJson. */
export function isScreenshotResult(result: Record<string, unknown>): boolean {
  return typeof result.dataUrl === 'string' && result.dataUrl.startsWith('data:image/')
}

/**
 * Сериализация результата для ответа модели: null — результат превысил кап
 * (вызывающий отвечает ошибкой, а не обрезанным невалидным JSON).
 */
export function previewResultJson(result: NonNullable<BrowserActionOutcome['result']>): string | null {
  const json = JSON.stringify(result)
  return json.length <= PREVIEW_ACTION_LIMITS.resultJson ? json : null
}

/**
 * Системный хинт модели про инструменты браузера. Подключается исполнителем
 * CLI вместе с URL MCP-эндпоинта `browser` (см. apps/llm-runner).
 *
 * `chromium` — поверхность браузерной проверки задачи: страницы у пользователя
 * нет, вместо неё изолированный Chromium сервера, и dev-сервер на машине
 * поднимает сама модель. Всё остальное — те же инструменты, поэтому меняется
 * только вступление и хвост про окружение.
 */
export function previewToolHint(surface: 'panel' | 'chromium' = 'panel'): string {
  const opening = surface === 'chromium'
    ? 'Проверять результат в браузере — часть твоей работы над этой задачей. Браузер — изолированный Chromium на сервере, '
      + 'панели у пользователя нет: страница существует только пока ты с ней работаешь инструментами mcp__browser__*, '
      + 'и она сохраняется между вызовами. Инструменты: '
    : 'Рядом с чатом у пользователя открыта панель веб-превью. Управляй ею инструментами mcp__browser__*: '
  return (
    opening +
    'open {url} — открыть сайт в превью; read {selector?, limit?, offset?} — структурированное содержимое страницы ' +
    '(заголовки, ссылки, кнопки, поля ввода); nextOffset продолжает длинный текст. find {text|selector, limit?, visibleOnly?} — найти элементы; ' +
    'В Chromium read включает открытый Shadow DOM и слоты; закрытые roots недоступны. ' +
    'Селекторы из read/find передавай в следующее действие целиком, включая >> nth; после изменения DOM повтори поиск. ' +
    'В Chromium selector вместе с text ограничивает click, hover и find текстом внутри селектора. ' +
    'click {selector|text} — клик по элементу; type {selector, text, submit?} — ввести текст в поле. ' +
    'Действия выполняются только на странице, открытой в превью активного чата пользователя. ' +
    'Просьбы «открой сайт …», «нажми …», «что на странице?» выполняй этими инструментами, а не shell-командами. ' +
    'После open или click, ведущего к переходу, страница загружается заново — перечитай её read перед следующим действием. ' +
    'Дополнительно: hover {selector|text} — навести курсор (выпадающие меню); scroll {to: top|bottom | dy, selector?} — ' +
    'прокрутить окно или контейнер (ленивые ленты); press {key, selector?} — нажать клавишу (Escape, Enter, Tab, ArrowDown…); ' +
    'screenshot {selector? | rect? | fullPage?, animations?, timeoutMs?} — картинка элемента, области или видимой части страницы. ' +
    'В Chromium fullPage снимает всю страницу, animations: disabled стабилизирует кадр; timeoutMs ограничивает ожидание, по умолчанию 10000 мс. ' +
    'Координаты снимка Chromium и действий — CSS px; rect задаётся в координатах документа; ' +
    'errors {clear?} — накопленные ошибки страницы (JS-исключения, console.error, упавшие запросы) — проверяй их после действий при тестировании; ' +
    'wait {selector|text, timeoutMs?} — дождаться появления элемента; в Chromium selector вместе с text ждёт текст внутри элемента. ' +
    'Дополнительные условия wait в Chromium: state (attached/detached/visible/hidden), enabled, editable, checked, value, count, url (шаблон с *), loadState (domcontentloaded/load), predicate (синхронное JS-условие). ' +
    'Условия делят один timeoutMs до 30000 мс; count включает скрытые узлы, по умолчанию видимость проверяется только без count. Для SPA жди нужное содержимое или predicate, один load не означает готовность приложения. ' +
    'back/forward — по истории страницы; ' +
    'В Chromium frames перечисляет живые iframe: передавай path как frame в read/find/click/type/hover/scroll/wait/set/upload/a11y/evaluate/styles/open/screenshot. ' +
    'frame — селектор iframe или цепочка до восьми уровней, работает и для документов другого origin; без него действие адресуется верхней странице. Селекторы read/find относительны выбранному frame. ' +
    'open с frame меняет только вложенный документ. press с frame требует selector, drag — два селектора. ' +
    'Снимок frame показывает видимую область; selector ограничивает её элементом, clipped сообщает усечение. fullPage и rect используются без frame. ' +
    'styles {selector, properties?, frame?} — вычисленные CSS-свойства. ' +
    'В Playwright Reader и Chromium-проверке также доступны tabs — список вкладок с id; new-tab {url?}; ' +
    'select-tab {tabId}; close-tab {tabId}; reload — перезагрузка; stop-loading — остановка загрузки без закрытия сессии. ' +
    'После открытия popup вызови tabs, найди его по openerTabId и выбери select-tab перед чтением или вводом. ' +
    'edits — правки, сделанные пользователем в режиме «Редактировать» (перенеси их в код, если просят «сделай как я поправил»); ' +
    'network {filter?, clear?} — журнал fetch/XHR-запросов страницы (метод, реальный URL, статус, длительность); ' +
    'console {pattern?, level?, clear?} — журнал console.log/info/warn/error; ' +
    'evaluate {code} — выполнить JS в контексте страницы и получить JSON результата (состояние стора, обход нестандартных контролов); ' +
    'drag {from, to} — перетащить элемент (канбан, сортировка): from/to — {selector} или {x, y}; ' +
    'set {selector, value|checked} — установить select по значению или подписи option, checkbox/radio, date/range; ' +
    'upload {selector, name, base64, mimeType?} — загрузить файл в input type=file; ' +
    'viewport {width} — ширина превью в px (0 — адаптив) для проверки мобильной вёрстки; ' +
    'a11y {selector?} returns a DOM-derived role/name snapshot; it can differ from the browser accessibility tree. ' +
    'accessibility {selector} in Chromium returns the selected node from the native browser accessibility tree: role, name, description, states, name sources and related selectors. It does not interact, return control values or support frame scope. Read limits; a single-node observation is not a screen-reader scenario test. ' +
    'In both Web Reader engines, audit {group?, selector?, rules?, mode?, limit?, offset?} reports bounded QA findings with selectors and evidence. ' +
    'probe {selector} observes one standard CSS target, including hidden controls: visibility, disabled/read-only/inert state, sampled pointer blockers and source selectors. It never clicks, focuses or scrolls. Pointer reachability does not guarantee successful activation; inspect all state and limitations. ' +
    'Use mode:list to discover checks, then mode:run (default); follow nextOffset and read limitations. Default group: markup. ' +
    'Heuristic findings need visual confirmation; no findings never proves the whole application bug-free. ' +
    'Тестовое окружение, запущенное на машине этого разговора (dev-сервер репозитория, feature-preview), открывай ' +
    'Текущее приложение открывай по https://app.internal/ (путь и #/маршрут сохраняются); вход выполняется внутри страницы. Dev-сервер машины — ' +
    'адресом http://machine.internal:<порт>/ — прокси доставит запрос на 127.0.0.1:<порт> машины разговора; ' +
    'типовой цикл: поправь код в репозитории машины, запусти или перезапусти dev-сервер, открой machine.internal и проверь фичу. ' +
    'Тестовые учётные записи проекта для входа в окружение возвращает инструмент test-users — логинься ими через type/click.' +
    (surface === 'chromium'
      ? ' Dev-сервер никто не поднимет за тебя: запусти его на машине в фоне через mcp__remote__bash (nohup … &), ' +
        'дождись порта и только потом открывай http://machine.internal:<порт>/. ' +
        'Убедиться, что фича работает, — обязательная часть шага: открой затронутый экран, пройди по нему, ' +
        'проверь errors и приложи screenshot к отчёту о работе.'
      : '')
  )
}

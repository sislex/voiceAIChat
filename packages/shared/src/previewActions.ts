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
  evaluateCode: 4_000,
  evaluateValue: 8_000,
  /** Файл upload: base64-содержимое (~1 МБ бинарных данных). */
  uploadBase64: 1_500_000,
  /** Журналы network/console: сколько записей отдаётся за раз. */
  logDefault: 50,
  logMax: 100,
  /** Узлы дерева доступности в a11y. */
  a11yNodes: 200
} as const

/** Модификаторы клика (клавиши, зажатые на время события). */
export const PREVIEW_CLICK_MODIFIERS = ['shift', 'ctrl', 'alt', 'meta'] as const
export type PreviewClickModifier = (typeof PREVIEW_CLICK_MODIFIERS)[number]

/** Точка или элемент — источник/цель перетаскивания. */
export interface PreviewDragPoint {
  selector?: string
  x?: number
  y?: number
}

/** Действие браузера, запрошенное моделью. `open` выполняет сам UI (без iframe). */
export type PreviewAction =
  | { kind: 'open'; url: string; diagnostic?: boolean }
  | { kind: 'find'; text?: string; selector?: string; limit?: number; diagnostic?: boolean }
  /** Клик: обычный, двойной (dblclick), правый (button: right) и с модификаторами. */
  | { kind: 'click'; selector?: string; text?: string; button?: 'left' | 'right'; dblclick?: boolean; modifiers?: PreviewClickModifier[]; diagnostic?: boolean }
  | { kind: 'type'; selector: string; text: string; submit?: boolean; diagnostic?: boolean }
  | { kind: 'read'; selector?: string; diagnostic?: boolean }
  | { kind: 'styles'; selector: string; properties?: string[]; diagnostic?: boolean }
  /** Наведение курсора: pointer/mouse-события по элементу (выпадающие меню). */
  | { kind: 'hover'; selector?: string; text?: string; diagnostic?: boolean }
  /** Прокрутка окна или контейнера: к краю (`to`) либо на `dy` пикселей. */
  | { kind: 'scroll'; selector?: string; to?: 'top' | 'bottom'; dy?: number; diagnostic?: boolean }
  /** Нажатие клавиши (Escape, Enter, Tab, ArrowDown, …) на элементе или активном поле. */
  | { kind: 'press'; key: string; selector?: string; diagnostic?: boolean }
  /** Снимок области: элемент по селектору, явный rect (координаты документа) или видимая область. */
  | { kind: 'screenshot'; selector?: string; rect?: { x: number; y: number; width: number; height: number }; diagnostic?: boolean }
  /** Ошибки открытой страницы: JS-исключения, unhandledrejection, console.error, неуспешные fetch/XHR. */
  | { kind: 'errors'; clear?: boolean; diagnostic?: boolean }
  /** Дождаться появления элемента (selector или видимый text) с таймаутом. */
  | { kind: 'wait'; selector?: string; text?: string; timeoutMs?: number; diagnostic?: boolean }
  /** Назад по истории внутренней страницы (переход подтверждается page-ready). */
  | { kind: 'back'; diagnostic?: boolean }
  /** Вперёд по истории внутренней страницы (симметрично back). */
  | { kind: 'forward'; diagnostic?: boolean }
  /** Сохранённые правки edit-режима текущей страницы (перенести «как поправил» в код). */
  | { kind: 'edits'; diagnostic?: boolean }
  /** Журнал сетевых запросов страницы (fetch/XHR/beacon): фильтр по подстроке URL. */
  | { kind: 'network'; filter?: string; clear?: boolean; limit?: number; diagnostic?: boolean }
  /** Журнал console.log/info/warn/error страницы: фильтр по подстроке и уровню. */
  | { kind: 'console'; pattern?: string; level?: 'log' | 'info' | 'warn' | 'error'; clear?: boolean; limit?: number; diagnostic?: boolean }
  /** Выполнить JS в контексте страницы; результат сериализуется JSON (кап evaluateValue). */
  | { kind: 'evaluate'; code: string; diagnostic?: boolean }
  /** Перетаскивание pointer-событиями (или HTML5 DnD у draggable) от from к to. */
  | { kind: 'drag'; from: PreviewDragPoint; to: PreviewDragPoint; diagnostic?: boolean }
  /** Установить значение сложного контрола: select (по value или подписи option), checkbox/radio (checked), date/range (value). */
  | { kind: 'set'; selector: string; value?: string; checked?: boolean; diagnostic?: boolean }
  /** Загрузить файл в input type=file: содержимое приходит base64 от модели. */
  | { kind: 'upload'; selector: string; name: string; mimeType?: string; base64: string; diagnostic?: boolean }
  /** Ширина вьюпорта превью в пикселях (исполняет Reader, не страница); 0 — адаптив. */
  | { kind: 'viewport'; width: number; diagnostic?: boolean }
  /** Дерево доступности страницы: роли и имена как их видит скринридер. */
  | { kind: 'a11y'; selector?: string; limit?: number; diagnostic?: boolean }

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
  inputs: { selector: string; type: string; name: string; placeholder: string; value: string }[]
  /** Видимый текст (обрезан лимитом) — на случай страниц без семантики. */
  text: string
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
  scrolled: { top: number; left: number; maxTop: number }
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
  const L = PREVIEW_ACTION_LIMITS
  switch (value.kind) {
    case 'open':
      return bounded(value.url, L.url) && isHttpUrl(value.url)
    case 'find':
      return (
        optBounded(value.text, L.text) &&
        optBounded(value.selector, L.selector) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isFinite(value.limit))) &&
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
        (value.submit === undefined || typeof value.submit === 'boolean')
    case 'read':
      return optBounded(value.selector, L.selector)
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
        (value.to !== undefined || value.dy !== undefined)
      )
    case 'press':
      return (
        typeof value.key === 'string' && value.key.length >= 1 && value.key.length <= 32 &&
        optBounded(value.selector, L.selector)
      )
    case 'screenshot': {
      if (!optBounded(value.selector, L.selector)) return false
      if (value.rect === undefined) return true
      if (!record(value.rect)) return false
      const rect = value.rect
      return (['x', 'y', 'width', 'height'] as const).every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key] as number) && Math.abs(rect[key] as number) <= 100_000) &&
        (rect.width as number) > 0 && (rect.height as number) > 0
    }
    case 'errors':
      return value.clear === undefined || typeof value.clear === 'boolean'
    case 'wait':
      return (
        optBounded(value.selector, L.selector) &&
        optBounded(value.text, L.text) &&
        (value.selector !== undefined || value.text !== undefined) &&
        (value.timeoutMs === undefined || (typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs) && value.timeoutMs > 0 && value.timeoutMs <= 8_000))
      )
    case 'back':
    case 'forward':
    case 'edits':
      return true
    case 'network':
      return (
        optBounded(value.filter, 300) &&
        (value.clear === undefined || typeof value.clear === 'boolean') &&
        logLimit(value.limit)
      )
    case 'console':
      return (
        optBounded(value.pattern, 300) &&
        (value.level === undefined || value.level === 'log' || value.level === 'info' || value.level === 'warn' || value.level === 'error') &&
        (value.clear === undefined || typeof value.clear === 'boolean') &&
        logLimit(value.limit)
      )
    case 'evaluate':
      return bounded(value.code, L.evaluateCode)
    case 'drag':
      return isDragPoint(value.from) && isDragPoint(value.to)
    case 'set':
      return (
        bounded(value.selector, L.selector) &&
        optBounded(value.value, L.text) &&
        (value.checked === undefined || typeof value.checked === 'boolean') &&
        (value.value !== undefined || value.checked !== undefined)
      )
    case 'upload':
      return (
        bounded(value.selector, L.selector) &&
        bounded(value.name, 255) && value.name.length > 0 &&
        optBounded(value.mimeType, 100) &&
        bounded(value.base64, L.uploadBase64) && value.base64.length > 0
      )
    case 'viewport':
      return typeof value.width === 'number' && Number.isFinite(value.width) && value.width >= 0 && value.width <= 10_000
    case 'a11y':
      return optBounded(value.selector, L.selector) && (value.limit === undefined || (typeof value.limit === 'number' && Number.isFinite(value.limit)))
    default:
      return false
  }
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
export function previewResultJson(result: PreviewActionResult): string | null {
  const json = JSON.stringify(result)
  return json.length <= PREVIEW_ACTION_LIMITS.resultJson ? json : null
}

/**
 * Системный хинт модели про инструменты браузера. Подключается исполнителем
 * CLI вместе с URL MCP-эндпоинта `browser` (см. apps/llm-runner).
 */
export function previewToolHint(): string {
  return (
    'Рядом с чатом у пользователя открыта панель веб-превью. Управляй ею инструментами mcp__browser__*: ' +
    'open {url} — открыть сайт в превью; read {selector?} — структурированное содержимое страницы ' +
    '(заголовки, ссылки, кнопки, поля ввода); find {text|selector, limit?} — найти элементы; ' +
    'click {selector|text} — клик по элементу; type {selector, text, submit?} — ввести текст в поле. ' +
    'Действия выполняются только на странице, открытой в превью активного чата пользователя. ' +
    'Просьбы «открой сайт …», «нажми …», «что на странице?» выполняй этими инструментами, а не shell-командами. ' +
    'После open или click, ведущего к переходу, страница загружается заново — перечитай её read перед следующим действием. ' +
    'Дополнительно: hover {selector|text} — навести курсор (выпадающие меню); scroll {to: top|bottom | dy, selector?} — ' +
    'прокрутить окно или контейнер (ленивые ленты); press {key, selector?} — нажать клавишу (Escape, Enter, Tab, ArrowDown…); ' +
    'screenshot {selector? | rect?} — картинка элемента, области или видимой части страницы, когда важен внешний вид, а не текст; ' +
    'errors {clear?} — накопленные ошибки страницы (JS-исключения, console.error, упавшие запросы) — проверяй их после действий при тестировании; ' +
    'wait {selector|text, timeoutMs?} — дождаться появления элемента (асинхронные SPA); back/forward — по истории страницы; ' +
    'edits — правки, сделанные пользователем в режиме «Редактировать» (перенеси их в код, если просят «сделай как я поправил»); ' +
    'network {filter?, clear?} — журнал fetch/XHR-запросов страницы (метод, реальный URL, статус, длительность); ' +
    'console {pattern?, level?, clear?} — журнал console.log/info/warn/error; ' +
    'evaluate {code} — выполнить JS в контексте страницы и получить JSON результата (состояние стора, обход нестандартных контролов); ' +
    'drag {from, to} — перетащить элемент (канбан, сортировка): from/to — {selector} или {x, y}; ' +
    'set {selector, value|checked} — установить select по значению или подписи option, checkbox/radio, date/range; ' +
    'upload {selector, name, base64, mimeType?} — загрузить файл в input type=file; ' +
    'viewport {width} — ширина превью в px (0 — адаптив) для проверки мобильной вёрстки; ' +
    'a11y {selector?} — дерево доступности (роли и имена, как их видит скринридер). ' +
    'Тестовое окружение, запущенное на машине этого разговора (dev-сервер репозитория, feature-preview), открывай ' +
    'адресом http://machine.internal:<порт>/ — прокси доставит запрос на 127.0.0.1:<порт> машины разговора; ' +
    'типовой цикл: поправь код в репозитории машины, запусти или перезапусти dev-сервер, открой machine.internal и проверь фичу. ' +
    'Тестовые учётные записи проекта для входа в окружение возвращает инструмент test-users — логинься ими через type/click.'
  )
}

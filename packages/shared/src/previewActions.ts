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
  resultJson: 32_000
} as const

/** Действие браузера, запрошенное моделью. `open` выполняет сам UI (без iframe). */
export type PreviewAction =
  | { kind: 'open'; url: string; diagnostic?: boolean }
  | { kind: 'find'; text?: string; selector?: string; limit?: number; diagnostic?: boolean }
  | { kind: 'click'; selector?: string; text?: string; diagnostic?: boolean }
  | { kind: 'type'; selector: string; text: string; submit?: boolean; diagnostic?: boolean }
  | { kind: 'read'; selector?: string; diagnostic?: boolean }
  | { kind: 'styles'; selector: string; properties?: string[]; diagnostic?: boolean }

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

export type PreviewActionResult =
  | PreviewOpenResult
  | PreviewFindResult
  | PreviewClickResult
  | PreviewTypeResult
  | PreviewReadResult
  | PreviewStylesResult

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
        (value.text !== undefined || value.selector !== undefined)
      )
    case 'type':
      return bounded(value.selector, L.selector) && bounded(value.text, L.text) &&
        (value.submit === undefined || typeof value.submit === 'boolean')
    case 'read':
      return optBounded(value.selector, L.selector)
    case 'styles':
      return bounded(value.selector, L.selector) &&
        (value.properties === undefined || (Array.isArray(value.properties) && value.properties.length <= 32 && value.properties.every((item) => bounded(item, 100))))
    default:
      return false
  }
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
    return JSON.stringify(value.result).length <= PREVIEW_ACTION_LIMITS.resultJson
  } catch {
    return false
  }
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
    'После open или click, ведущего к переходу, страница загружается заново — перечитай её read перед следующим действием.'
  )
}

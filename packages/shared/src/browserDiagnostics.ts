export const BROWSER_LOG_CAPACITY = 200
export const BROWSER_LOG_RESULT_BUDGET = 24000
export const BROWSER_LOG_MESSAGE_LIMIT = 2000
export const BROWSER_LOG_STACK_LIMIT = 4000

export type BrowserConsoleLevel = 'log' | 'info' | 'warn' | 'error'
export type BrowserNetworkState = 'pending' | 'response' | 'completed' | 'failed'
export interface BrowserDiagnosticOptions {
  tabId?: string
  allTabs?: boolean
  /** Только новые или обновлённые записи после курсора предыдущего ответа. */
  since?: number
  /** Продолжение более старой части журнала: значение nextBefore из ответа. */
  before?: number
  limit?: number
  clear?: boolean
}
export interface BrowserConsoleOptions extends BrowserDiagnosticOptions {
  level?: BrowserConsoleLevel
  pattern?: string
  /** Raw inspect сохраняет прежний regex; mapper модельного console задаёт false. */
  regex?: boolean
}
export interface BrowserNetworkOptions extends BrowserDiagnosticOptions {
  filter?: string
  state?: BrowserNetworkState
  resourceType?: string
  failedOnly?: boolean
}
export interface BrowserLogContext {
  id?: string
  sequence?: number
  tabId?: string
  pageUrl?: string
  frameUrl?: string
}
export interface BrowserLogSummary {
  total?: number
  returned?: number
  truncated?: boolean
  cursor?: number
  nextBefore?: number
  cleared?: number
  /** Число вытесненных записей всего буфера, до фильтра по вкладке. */
  dropped?: number
}
export type BrowserDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | BrowserDiagnosticValue[]
  | { [key: string]: BrowserDiagnosticValue }

export function browserConsoleLevel(value: string): BrowserConsoleLevel {
  if (value === 'warning' || value === 'warn') return 'warn'
  if (value === 'error' || value === 'assert') return 'error'
  return value === 'info' ? 'info' : 'log'
}
export function normalizeBrowserDiagnosticOptions<T extends BrowserDiagnosticOptions>(value: T): T & { limit: number } {
  if (!value || typeof value !== 'object') throw new Error('Некорректные параметры журнала')
  const limit = value.limit ?? 50
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit должен быть положительным целым числом')
  for (const key of ['since', 'before'] as const)
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key]! < 0))
      throw new Error('Некорректный курсор журнала')
  if (value.since !== undefined && value.before !== undefined && value.since >= value.before)
    throw new Error('since должен предшествовать before')
  if (value.tabId !== undefined && (typeof value.tabId !== 'string' || !value.tabId.trim() || value.tabId.length > 200))
    throw new Error('Некорректная вкладка журнала')
  for (const key of ['allTabs', 'clear'] as const)
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('Некорректный параметр журнала')
  if (value.allTabs && value.tabId !== undefined) throw new Error('Выберите tabId или allTabs')
  return { ...value, limit: Math.min(limit, BROWSER_LOG_CAPACITY) }
}
/** Прокси Web Reader не знает вкладок и курсора журналов Chromium. */
export function browserDiagnosticsRequireChromium(
  value: BrowserDiagnosticOptions & { state?: string; resourceType?: string; failedOnly?: boolean }
): boolean {
  return (
    value.tabId !== undefined ||
    value.allTabs === true ||
    value.since !== undefined ||
    value.before !== undefined ||
    value.state !== undefined ||
    value.resourceType !== undefined ||
    value.failedOnly === true
  )
}

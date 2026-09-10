/** Условия готовности страницы: все указанные условия должны завершиться. */
export interface BrowserWaitOptions {
  selector?: string
  text?: string
  timeoutMs?: number
  state?: 'attached' | 'detached' | 'visible' | 'hidden'
  enabled?: boolean
  editable?: boolean
  checked?: boolean
  value?: string
  count?: number
  /** Точный адрес или шаблон с *; проверяется публичный host alias. */
  url?: string
  loadState?: 'domcontentloaded' | 'load'
  /** Выражение JavaScript или функция без аргументов, синхронно дающая truthy. */
  predicate?: string
}

export function isBrowserWaitOptions(value: unknown): value is BrowserWaitOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const optionalText = (key: string, limit: number, empty = false) => { const field = item[key]; return field === undefined || (typeof field === 'string' && (empty || Boolean(field.trim())) && field.length <= limit) }
  if (!optionalText('selector', 2000) || !optionalText('text', 2000) || !optionalText('value', 2000, true) || !optionalText('url', 4096) || !optionalText('predicate', 4000)) return false
  if (item.timeoutMs !== undefined && (typeof item.timeoutMs !== 'number' || !Number.isFinite(item.timeoutMs) || item.timeoutMs <= 0 || item.timeoutMs > 30_000)) return false
  if (item.state !== undefined && (typeof item.state !== 'string' || !['attached', 'detached', 'visible', 'hidden'].includes(item.state))) return false
  if (item.loadState !== undefined && (typeof item.loadState !== 'string' || !['domcontentloaded', 'load'].includes(item.loadState))) return false
  if (['enabled', 'editable', 'checked'].some(key => item[key] !== undefined && typeof item[key] !== 'boolean')) return false
  if (item.count !== undefined && (typeof item.count !== 'number' || !Number.isInteger(item.count) || item.count < 0 || item.count > 100_000)) return false
  const target = item.selector !== undefined || item.text !== undefined
  if (!target && ['state', 'enabled', 'editable', 'checked', 'value', 'count'].some(key => item[key] !== undefined)) return false
  if (item.count === 0 && ((item.state === 'visible' || item.state === 'attached') || ['enabled', 'editable', 'checked', 'value'].some(key => item[key] !== undefined))) return false
  if (typeof item.count === 'number' && item.count > 0 && item.state === 'detached') return false
  return target || item.url !== undefined || item.loadState !== undefined || item.predicate !== undefined
}

/** Старый iframe не должен выдавать наличие узла за выполнение новых условий. */
export function browserWaitRequiresChromium(options: BrowserWaitOptions): boolean {
  return ['state', 'enabled', 'editable', 'checked', 'value', 'count', 'url', 'loadState', 'predicate'].some(key => options[key as keyof BrowserWaitOptions] !== undefined)
    || Boolean(options.selector && options.text) || (options.timeoutMs ?? 5000) > 8000
}

/** Простой wildcard без регулярного выражения и его обратного перебора. */
export function browserUrlMatches(url: string, pattern: string): boolean {
  const normalize = (value: string) => { try { return new URL(value).toString() } catch { return value } }
  url = normalize(url); pattern = normalize(pattern)
  let at = 0, expected = 0, star = -1, retry = 0
  while (at < url.length) {
    if (pattern[expected] === url[at]) { at++; expected++ }
    else if (pattern[expected] === '*') { star = expected++; retry = at }
    else if (star >= 0) { expected = star + 1; at = ++retry }
    else return false
  }
  while (pattern[expected] === '*') expected++
  return expected === pattern.length
}

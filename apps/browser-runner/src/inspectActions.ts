import type { BrowserConsoleEntry, BrowserInspectAction, BrowserInspectResult, BrowserNetworkEntry } from '@voicechat/shared'

/**
 * Осмотр страницы: журналы консоли и сети плюс вычисленные стили. Логика
 * отделена от sessionManager и принимает узкие типы, чтобы проверяться без
 * Chromium — как и селекторные действия.
 */
export interface InspectLogs {
  console: BrowserConsoleEntry[]
  network: BrowserNetworkEntry[]
}

/** Минимум от Playwright для вычисленных стилей и произвольного кода. */
export interface InspectPage {
  evaluate<T>(fn: (arg: { selector: string; properties: string[] }) => T, arg: { selector: string; properties: string[] }): Promise<T>
  /** Код строкой — так модель присылает `evaluate`. */
  evaluate(fn: string): Promise<unknown>
}

/** Значение из страницы обязано пережить JSON: у результата может не быть
 *  структуры, а лог рана и ответ модели — текст. */
const EVALUATE_VALUE_LIMIT = 20_000
function serializeEvaluated(value: unknown): unknown {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return typeof value === 'string' && value.length > EVALUATE_VALUE_LIMIT ? `${value.slice(0, EVALUATE_VALUE_LIMIT)}…` : value
  }
  try {
    const json = JSON.stringify(value)
    if (json === undefined) return null
    return json.length > EVALUATE_VALUE_LIMIT ? `${json.slice(0, EVALUATE_VALUE_LIMIT)}…` : JSON.parse(json)
  } catch { return String(value).slice(0, EVALUATE_VALUE_LIMIT) }
}

const clampLimit = (value: number | undefined, fallback: number): number =>
  Math.min(Math.max(value ?? fallback, 1), 200)

export async function runInspectAction(logs: InspectLogs, page: InspectPage, action: BrowserInspectAction): Promise<BrowserInspectResult> {
  if (action.kind === 'console') {
    // Битое выражение прилетало исключением и уходило наружу как 422 с сырым
    // текстом движка: модель (и человек в панели) видели «Invalid regular
    // expression: …» вместо понятного «вот что не так с фильтром».
    let pattern: RegExp | null = null
    if (action.pattern) {
      try { pattern = new RegExp(action.pattern, 'i') }
      catch { return { ok: false, error: `Фильтр «${action.pattern}» — не регулярное выражение` } }
    }
    const filtered = logs.console.filter((entry) =>
      (!action.level || entry.level === action.level) && (!pattern || pattern.test(entry.text)))
    // Отдаём хвост: свежие записи полезнее первых, а объём ограничен.
    const result = filtered.slice(-clampLimit(action.limit, 50))
    if (action.clear) logs.console.length = 0
    return { ok: true, console: result }
  }
  if (action.kind === 'network') {
    const needle = action.filter?.toLowerCase()
    const filtered = logs.network.filter((entry) => !needle || entry.url.toLowerCase().includes(needle))
    const result = filtered.slice(-clampLimit(action.limit, 50))
    if (action.clear) logs.network.length = 0
    return { ok: true, network: result }
  }
  if (action.kind === 'evaluate') {
    // Гейт (политика проекта, подтверждение опасного кода) стоит выше — на
    // MCP-инструменте, до выбора транспорта, поэтому здесь его не дублируем.
    try { return { ok: true, value: serializeEvaluated(await page.evaluate(action.code)) } }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : 'Код не выполнен' } }
  }
  try {
    // Тело исполняется в браузере, а у пакета нет библиотеки DOM (это Node-сервис),
    // поэтому нужные глобальные объявляются здесь узкими типами.
    const styles = await page.evaluate(({ selector, properties }) => {
      const scope = globalThis as unknown as {
        document: { querySelector(value: string): unknown }
        getComputedStyle(node: unknown): { getPropertyValue(name: string): string }
      }
      const node = scope.document.querySelector(selector)
      if (!node) return null
      const computed = scope.getComputedStyle(node)
      const keys = properties.length ? properties : ['display', 'position', 'color', 'background-color', 'font-size', 'width', 'height']
      const out: Record<string, string> = {}
      for (const key of keys) out[key] = computed.getPropertyValue(key)
      return out
    }, { selector: action.selector, properties: action.properties ?? [] })
    if (!styles) return { ok: false, error: `Узел ${action.selector} не найден` }
    return { ok: true, styles }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : 'Стили не прочитались' }
  }
}

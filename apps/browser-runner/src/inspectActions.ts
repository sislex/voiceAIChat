import { readBrowserDiagnostics } from './diagnosticReading.js'
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
interface InspectLocator {
  first(): InspectLocator
  evaluate(fn: (node: unknown, arg: unknown) => unknown, arg?: unknown, options?: { timeout?: number }): Promise<unknown>
}
export interface InspectPage {
  locator(selector: string): InspectLocator
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

export async function runInspectAction(logs: InspectLogs, page: InspectPage, action: BrowserInspectAction): Promise<BrowserInspectResult> {
  if (action.kind === 'console' || action.kind === 'network') return readBrowserDiagnostics(logs, action)
  if (action.kind === 'evaluate') {
    // Гейт (политика проекта, подтверждение опасного кода) стоит выше — на
    // MCP-инструменте, до выбора транспорта, поэтому здесь его не дублируем.
    try { return { ok: true, value: serializeEvaluated(await page.evaluate(action.code)) } }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : 'Код не выполнен' } }
  }
  try {
    // Тело исполняется в браузере, а у пакета нет библиотеки DOM (это Node-сервис),
    // поэтому нужные глобальные объявляются здесь узкими типами.
    const styles = await page.locator(action.selector).first().evaluate((node, argument) => {
      const properties = argument as string[]
      const scope = globalThis as unknown as {
        getComputedStyle(node: unknown): { getPropertyValue(name: string): string }
      }
      if (!node) return null
      const computed = scope.getComputedStyle(node)
      const keys = properties.length ? properties : ['display', 'position', 'color', 'background-color', 'font-size', 'width', 'height']
      const out: Record<string, string> = {}
      for (const key of keys) out[key] = computed.getPropertyValue(key)
      return out
    }, action.properties ?? [], { timeout: 5000 }) as Record<string, string> | null
    if (!styles) return { ok: false, error: `Узел ${action.selector} не найден` }
    return { ok: true, styles }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : 'Стили не прочитались' }
  }
}

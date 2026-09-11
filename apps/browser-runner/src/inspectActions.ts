import { readBrowserDiagnostics } from './diagnosticReading.js'
import { nativeAuditExpression, nativeProbeExpression } from '@voicechat/browser-contracts/audit'
import { isPreviewProbeResult } from '@voicechat/shared'
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

export async function runInspectAction(logs: InspectLogs, page: InspectPage, action: Exclude<BrowserInspectAction, { kind: 'evaluate' }>): Promise<BrowserInspectResult> {
  if (action.kind === 'console' || action.kind === 'network') return readBrowserDiagnostics(logs, action)
  if (action.kind === 'accessibility') return { ok: false, error: 'Native accessibility requires the top-level Chromium page context.' }
  try {
    if (action.kind === 'probe') {
      const result = await page.evaluate(nativeProbeExpression(action))
      if (!isPreviewProbeResult(result) || result.probe.surface !== 'chromium') return { ok: false, error: 'Chromium did not return a valid control probe report.' }
      return { ok: true, ...result }
    }
    if (action.kind === 'audit') {
      const result = await page.evaluate(nativeAuditExpression(action)) as Pick<BrowserInspectResult, 'page' | 'audit'>
      if (result?.audit?.version !== 1 || result.audit.surface !== 'chromium') return { ok: false, error: 'Chromium did not return an audit report.' }
      return { ok: true, ...result }
    }
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
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : 'Page inspection failed.' }
  }
}

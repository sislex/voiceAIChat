import { parseWebRecorderScenario } from '@shared/webRecorderScenario'
import type { WebRecorderScenarioStep } from '@shared/webRecorder'

/** Query и hash выбирают разные страницы SPA; прежний ключ смешивал их сценарии. */
export function scenarioKey(pageUrl: string): string | null {
  try { const url = new URL(pageUrl); return /^https?:$/.test(url.protocol) ? 'voicechat.reader.scenario.v2:' + url.toString() : null } catch { return null }
}
export function loadScenario(pageUrl: string | null, storage: Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem' | 'removeItem'>> = localStorage): WebRecorderScenarioStep[] {
  if (!pageUrl) return []
  const key = scenarioKey(pageUrl)
  if (!key) return []
  try {
    const current = storage.getItem(key)
    if (current !== null) return parseWebRecorderScenario(current)
    // Старый список можно однозначно перенести только для URL без query/hash.
    const url = new URL(pageUrl)
    if (url.search || url.hash) return []
    const legacyKey = 'voicechat.reader.scenario.v1:' + url.origin + url.pathname
    const legacy = storage.getItem(legacyKey)
    const steps = parseWebRecorderScenario(legacy)
    if (legacy !== null && storage.setItem && storage.removeItem) {
      try { storage.setItem(key, JSON.stringify(steps)); storage.removeItem(legacyKey) } catch { /* исходник сохраняется, если перенос не удался */ }
    }
    return steps
  } catch { return [] }
}

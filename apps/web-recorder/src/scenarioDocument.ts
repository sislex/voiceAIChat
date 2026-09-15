import { PREVIEW_ACTION_LIMITS } from '@shared/previewActions'
import { normalizeWebRecorderStep, WEB_RECORDER_SCENARIO_LIMITS } from '@shared/webRecorderScenario'
import type { WebRecorderScenarioStep } from '@shared/webRecorder'
export interface ScenarioDocument { format: 'web-reader-scenario'; version: 1; pageUrl: string; steps: WebRecorderScenarioStep[] }
export const SCENARIO_FILE_LIMIT = WEB_RECORDER_SCENARIO_LIMITS.json
export function parseScenarioDocument(text: string): ScenarioDocument {
  if (new TextEncoder().encode(text).length > SCENARIO_FILE_LIMIT) throw new Error('Файл сценария превышает 1 МБ.')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('Не удалось прочитать JSON сценария.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ожидается документ сценария.')
  const doc = value as Record<string, unknown>
  if (doc.format !== 'web-reader-scenario' || doc.version !== 1) throw new Error('Формат или версия сценария не поддерживается.')
  let url: URL
  try { url = new URL(String(doc.pageUrl)) } catch { throw new Error('Адрес исходной страницы некорректен.') }
  if (!/^https?:$/.test(url.protocol) || typeof doc.pageUrl !== 'string' || doc.pageUrl.length > PREVIEW_ACTION_LIMITS.url) throw new Error('Адрес исходной страницы должен быть HTTP(S).')
  if (!Array.isArray(doc.steps) || !doc.steps.length || doc.steps.length > WEB_RECORDER_SCENARIO_LIMITS.steps) throw new Error('Сценарий должен содержать от 1 до 200 шагов.')
  const steps = doc.steps.map((value, index) => {
    const step = normalizeWebRecorderStep(value)
    if (!step) throw new Error(`Шаг ${index + 1}: некорректное действие, селектор или значение.`)
    return step
  })
  return { format: 'web-reader-scenario', version: 1, pageUrl: url.toString(), steps }
}
export function exportScenarioDocument(pageUrl: string, steps: readonly WebRecorderScenarioStep[]): string {
  // Apply the import contract on export too, including redaction and size limits.
  const result = JSON.stringify(parseScenarioDocument(JSON.stringify({ format: 'web-reader-scenario', version: 1, pageUrl, steps })), null, 2)
  if (new TextEncoder().encode(result).length > SCENARIO_FILE_LIMIT) throw new Error('Файл сценария превышает 1 МБ.')
  return result
}

import { PREVIEW_ACTION_LIMITS } from './previewActions'
import type { WebRecorderScenarioStep } from './webRecorder'

export const WEB_RECORDER_SCENARIO_LIMITS = { steps: 200, json: 1_000_000 } as const

/** Устаревшая или повреждённая запись не должна ломать весь список или раскрывать секрет. */
export function normalizeWebRecorderStep(value: unknown): WebRecorderScenarioStep | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const step = value as Record<string, unknown>
  if (step.kind !== 'click' && step.kind !== 'type') return null
  if (typeof step.selector !== 'string' || !step.selector.trim() || step.selector.length > PREVIEW_ACTION_LIMITS.selector) return null
  if (step.sensitive !== undefined && typeof step.sensitive !== 'boolean') return null
  if (step.submit !== undefined && (typeof step.submit !== 'boolean' || step.kind !== 'type')) return null
  if (typeof step.text !== 'string' || step.text.length > PREVIEW_ACTION_LIMITS.text) return null
  const sensitive = step.sensitive === true
  return { kind: step.kind, selector: step.selector, text: sensitive ? '' : step.text, sensitive, ...(step.kind === 'type' && step.submit === true ? { submit: true } : {}) }
}

export function parseWebRecorderScenario(json: string | null): WebRecorderScenarioStep[] {
  if (!json || json.length > WEB_RECORDER_SCENARIO_LIMITS.json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    const result: WebRecorderScenarioStep[] = []
    for (const value of parsed.slice(0, WEB_RECORDER_SCENARIO_LIMITS.steps)) { const step = normalizeWebRecorderStep(value); if (step) result.push(step) }
    return result
  } catch { return [] }
}

/** Склеиваются только соседние input одного поля; click и submit сохраняют границы. */
export function appendWebRecorderStep(steps: readonly WebRecorderScenarioStep[], step: WebRecorderScenarioStep): WebRecorderScenarioStep[] {
  const previous = steps.at(-1)
  if (previous?.kind === 'type' && step.kind === 'type' && previous.selector === step.selector && previous.sensitive === step.sensitive && !previous.submit) return [...steps.slice(0, -1), step]
  if (steps.length >= WEB_RECORDER_SCENARIO_LIMITS.steps) return [...steps]
  return [...steps, step]
}

export const BROWSER_EVALUATE_TIMEOUT = 5000
export const BROWSER_EVALUATE_MIN_TIMEOUT = 100
export const BROWSER_EVALUATE_MAX_TIMEOUT = 15000
export const BROWSER_EVALUATE_CODE_LIMIT = 4000
export const BROWSER_EVALUATE_RESULT_BUDGET = 20000

export interface BrowserEvaluateOptions {
  code: string
  /** Время исполнения без ожидания ответа человека на JavaScript-диалог. */
  timeoutMs?: number
}
export interface BrowserEvaluationSummary {
  /** json — исходная структура; preview — специальные типы с $type/$ref. */
  valueFormat?: 'json' | 'preview' | 'preview-json'
  /** typeof исходного значения; null выделен отдельно. */
  valueType?: string
  /** Измеренная длительность, включая ожидание диалога. */
  elapsedMs?: number
  timedOut?: boolean
}
export function normalizeBrowserEvaluateOptions(value: BrowserEvaluateOptions): Required<BrowserEvaluateOptions> {
  if (!value || typeof value.code !== 'string' || !value.code.trim() || value.code.length > BROWSER_EVALUATE_CODE_LIMIT)
    throw new Error(`evaluate: нужен непустой код до ${BROWSER_EVALUATE_CODE_LIMIT} символов`)
  const timeoutMs = value.timeoutMs ?? BROWSER_EVALUATE_TIMEOUT
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < BROWSER_EVALUATE_MIN_TIMEOUT ||
    timeoutMs > BROWSER_EVALUATE_MAX_TIMEOUT
  )
    throw new Error(
      `evaluate: timeoutMs должен быть целым числом от ${BROWSER_EVALUATE_MIN_TIMEOUT} до ${BROWSER_EVALUATE_MAX_TIMEOUT}`
    )
  return { code: value.code, timeoutMs }
}

// Разбор ответов и подписи подготовки задач: чистые функции без сервера, общие для сборки канбана
// (`kanban/module.ts`) и её тестов. Вынесены из `server.ts` вместе с канбан-кластером.
import { DEFAULT_CODEX_MODEL, type AcceptanceCriterionSnapshot, type LlmProvider } from '@voicechat/shared'

/** Remove prose only when it surrounds one complete, unambiguous object.
 * A damaged first candidate must never be skipped in favour of a later one.
 */
export function preparationJsonObject(text: string): Record<string, unknown> {
  const raw = text.trim()
  const start = raw.indexOf('{')
  if (start < 0 || ['[', ']', '}'].some(char => raw.slice(0, start).includes(char))) throw new Error('Expected one JSON object')
  let depth = 0
  let quoted = false
  let escaped = false
  let end = -1
  for (let i = start; i < raw.length; i++) {
    const c = raw[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (c === String.fromCharCode(92)) escaped = true
      else if (c === '"') quoted = false
    } else if (c === '"') quoted = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) { end = i + 1; break }
  }
  if (end < 0 || ['{', '}', '[', ']'].some(char => raw.slice(end).includes(char))) throw new Error('Модель должна вернуть ровно один JSON-объект: неоднозначное обрамление')
  const value = JSON.parse(raw.slice(start, end)) as Record<string, unknown>
  // Null means no reference only for this optional field; other nulls survive.
  if (Array.isArray(value.decisions)) for (const decision of value.decisions) {
    if (decision && typeof decision === 'object' && !Array.isArray(decision) && decision.questionId === null) delete decision.questionId
  }
  return value
}

export function parseQaPreparationResponse(text: string): AcceptanceCriterionSnapshot[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const start = text.indexOf('['), end = text.lastIndexOf(']')
  const raw = (fenced ?? (start >= 0 && end > start ? text.slice(start, end + 1) : text)).trim()
  let value: unknown
  try { value = JSON.parse(raw) }
  catch (cause) { throw new Error(`Невалидный JSON: ${cause instanceof Error ? cause.message : String(cause)}`) }
  if (!Array.isArray(value) || value.length === 0) throw new Error('Модель не вернула ни одного сценария')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Сценарий ${index + 1}: ожидается объект`)
    const row = item as Record<string, unknown>
    for (const field of ['title','description','preconditions','steps','testData','expectedResult'] as const) {
      if (typeof row[field] !== 'string') throw new Error(`Сценарий ${index + 1}: поле ${field} должно быть строкой`)
    }
    const strings = row as Record<'title'|'description'|'preconditions'|'steps'|'testData'|'expectedResult', string> & Record<string, unknown>
    if (!strings.title.trim() || !strings.steps.trim() || !strings.expectedResult.trim()) throw new Error(`Сценарий ${index + 1}: title, steps и expectedResult не могут быть пустыми`)
    if (typeof row.required !== 'boolean') throw new Error(`Сценарий ${index + 1}: поле required должно быть boolean`)
    if (row.testType !== 'manual' && row.testType !== 'mixed' && row.testType !== 'not_testable_in_app') throw new Error(`Сценарий ${index + 1}: недопустимый testType`)
    return { title: strings.title.trim(), description: strings.description.trim(), preconditions: strings.preconditions.trim(), steps: strings.steps.trim(), testData: strings.testData.trim(), expectedResult: strings.expectedResult.trim(), required: row.required, testType: row.testType }
  })
}

/**
 * Этап workflow, под которым живут настройки LLM «Подготовки к разработке».
 * Отдельного вида расхода у неё нет, а по смыслу это планирование задачи, поэтому
 * движок и модель она наследует из настроек стадии `planning`.
 */

/** Модель Claude по умолчанию для подготовки — прежняя константа этапа. */
const TASK_PREPARATION_CLAUDE_MODEL = 'sonnet'

/**
 * Модель CLI подготовки: явный выбор любого уровня наследования, иначе дефолт
 * движка. `default` в настройках Claude означает «модель не выбрана», поэтому он
 * ведёт на sonnet — как было до того, как подготовка научилась читать настройки.
 */
export function taskPreparationModel(provider: LlmProvider, model: string): string {
  const explicit = model.trim()
  if (provider === 'codex') return explicit || DEFAULT_CODEX_MODEL
  return explicit && explicit !== 'default' ? explicit : TASK_PREPARATION_CLAUDE_MODEL
}

/** Похоже ли падение CLI на отсутствующую или протухшую авторизацию профиля. */
const CLI_AUTH_FAILURE = /authenticat|oauth|unauthor|not logged in|login|credential|api key|401|403/i

/**
 * Ошибка подготовки с указанием движка и владельца CLI-профиля. CLI запускается
 * в профиле нажавшего кнопку, поэтому «OAuth session expired» у пользователя,
 * который логинился только в другой движок, — это состояние его профиля, а не
 * поломка подготовки; из сырой строки CLI это не видно.
 */
export function taskPreparationFailure(provider: LlmProvider, userId: string, message: string): string {
  const label = provider === 'codex' ? 'Codex' : 'Claude'
  const head = `Подготовка через ${label} CLI (профиль пользователя «${userId}»)`
  return CLI_AUTH_FAILURE.test(message)
    ? `${head}: CLI не авторизован — войдите в ${label} под этим профилем. Ответ CLI: ${message}`
    : `${head} завершилась ошибкой: ${message}`
}


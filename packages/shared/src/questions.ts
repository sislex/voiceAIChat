// Уточняющие вопросы модели с вариантами ответов (форма в чате).
//
// Договорённость с моделью: если ей нужны уточнения, она добавляет В КОНЦЕ
// ответа fenced-блок ```questions с JSON-массивом вопросов. Клиент вырезает
// блок из текста, показывает форму с вариантами; собранные ответы уходят
// обычным сообщением пользователя. Чистые функции — без DOM и сети.

/** Один вопрос модели с предложенными вариантами ответа. */
export interface QuestionSpec {
  /** Текст вопроса. */
  q: string
  /** Предложенные варианты ответа (минимум один). */
  options: string[]
  /** true — можно выбрать несколько вариантов (чекбоксы вместо радио). */
  multi?: boolean
}

/** Результат разбора текста ответа с questions-блоком. */
export interface ParsedQuestions {
  /** Текст ответа без блока вопросов (для обычного рендера Markdown). */
  body: string
  /** Разобранные вопросы (непустой массив). */
  questions: QuestionSpec[]
}

/** Язык fenced-блока, в котором модель передаёт вопросы. */
export const QUESTIONS_FENCE = 'questions'

const FENCE_RE = /```questions[^\S\n]*\n([\s\S]*?)```[^\S\n]*/

/**
 * Инструкция модели о формате уточняющих вопросов. Добавляется к каждому
 * промпту (работает одинаково для Claude CLI и Codex CLI — без опоры на
 * системный промпт конкретного движка).
 */
export const QUESTIONS_HINT = [
  'Если для продолжения тебе нужно задать пользователю уточняющие вопросы,',
  'добавь в самом конце ответа блок с JSON-массивом вопросов и вариантов ответа:',
  '```questions',
  '[{"q":"Текст вопроса?","options":["Вариант 1","Вариант 2"],"multi":false}]',
  '```',
  '"multi": true — разрешён выбор нескольких вариантов. Предлагай 2–5 осмысленных',
  'вариантов на вопрос. Не упоминай этот блок и его формат в тексте ответа;',
  'если вопросов нет — не добавляй блок вовсе.'
].join('\n')

/** Дописывает к промпту инструкцию о формате вопросов (пустой промпт не трогает). */
export function appendQuestionsHint(prompt: string): string {
  if (!prompt.trim()) return prompt
  return `${prompt}\n\n${QUESTIONS_HINT}`
}

/** Валидация одного вопроса из JSON (терпим к мусору от модели). */
function toQuestion(v: unknown): QuestionSpec | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { q?: unknown; options?: unknown; multi?: unknown }
  if (typeof o.q !== 'string' || !o.q.trim()) return null
  if (!Array.isArray(o.options)) return null
  const options = o.options
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
  if (options.length === 0) return null
  return { q: o.q.trim(), options, ...(o.multi === true ? { multi: true } : {}) }
}

/**
 * Ищет в тексте ответа блок ```questions``` и разбирает его. Возвращает null,
 * если блока нет или JSON битый/пустой — тогда текст рендерится как обычно.
 */
export function parseQuestions(text: string): ParsedQuestions | null {
  const m = FENCE_RE.exec(text)
  if (!m) return null
  let raw: unknown
  try {
    raw = JSON.parse(m[1])
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  const questions = raw.map(toQuestion).filter((q): q is QuestionSpec => q !== null)
  if (questions.length === 0) return null
  const body = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim()
  return { body, questions }
}

/** Ответ пользователя на один вопрос (выбранные варианты и/или свой текст). */
export interface QuestionAnswer {
  q: string
  /** Итоговый ответ (выбранные варианты, при multi — через «; »). */
  answer: string
}

/**
 * Собирает выбранные ответы в текст реплики пользователя. Один вопрос —
 * просто ответ; несколько — нумерованный список «вопрос — ответ».
 */
export function formatAnswers(answers: QuestionAnswer[]): string {
  const filled = answers.filter((a) => a.answer.trim().length > 0)
  if (filled.length === 0) return ''
  if (filled.length === 1) return filled[0].answer.trim()
  return filled.map((a, i) => `${i + 1}. ${a.q} — ${a.answer.trim()}`).join('\n')
}

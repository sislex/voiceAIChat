// Помощник промптов: по черновику запроса пользователя просим у LLM несколько
// переформулировок. Одноразовый вызов (как KB-reranker): собственную сессию не
// заводим, историю разговора не трогаем, инструменты и shell выключены.

import type { ModifierPrompt } from '@voicechat/shared'
import type { LlmClient } from '../claude/types.js'

/** Сколько вариантов просим и сколько максимум возвращаем. */
const MAX_VARIANTS = 4
/** Быстрая и дешёвая модель — доступна всем ролям (см. clampModelForRole). */
const SUGGEST_MODEL = 'haiku'
/** Переформулировки — операция короткая; не держим CLI дольше этого. */
const TIMEOUT_MS = 25_000

export class PromptSuggester {
  constructor(private readonly client: LlmClient, private readonly model = SUGGEST_MODEL) {}

  suggest(text: string, modifiers: ModifierPrompt[] = [], userId?: string): Promise<string[]> {
    const draft = text.trim()
    if (!draft) return Promise.resolve([])
    const prompt = [
      'Ты — помощник по формулировке запросов к ИИ-ассистенту разработчика.',
      'Пользователь начал писать запрос (черновик ниже). Предложи ' +
        `${MAX_VARIANTS} переформулировки: более чёткие, конкретные и полные версии ` +
        'того же запроса. Сохраняй исходный смысл, намерение и язык черновика.',
      'Не отвечай на запрос и не выполняй его. Не задавай вопросов. Не вызывай инструменты.',
      'Верни только JSON без пояснений: {"variants":["...","..."]}.',
      ...(modifiers.length > 0
        ? ['Дополнительные инструкции (применяй строго в указанном порядке):', ...modifiers.map((item, index) => `${index + 1}. ${item.text.trim()}`)]
        : []),
      `Черновик запроса:\n${draft}`
    ].join('\n\n')

    return new Promise((resolve, reject) => {
      let acc = ''
      const timer = setTimeout(() => {
        handle.cancel()
        reject(new Error('Помощник промптов не ответил вовремя'))
      }, TIMEOUT_MS)
      const handle = this.client.send(
        { prompt, sessionId: null, model: this.model, permissionMode: 'plan', executionDisabled: true, userId },
        {
          onSession: () => {},
          onDelta: (delta) => {
            acc += delta
          },
          onDone: (final) => {
            clearTimeout(timer)
            try {
              resolve(parseVariants(final || acc))
            } catch (error) {
              reject(error)
            }
          },
          onError: (message) => {
            clearTimeout(timer)
            reject(new Error(message))
          }
        }
      )
    })
  }
}

/** Достаём массив строк из ответа LLM, терпимо к ```json-обёртке и мусору. */
export function parseVariants(raw: string): string[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // На случай текста вокруг JSON — выхватываем первый {...} блок.
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('Помощник промптов вернул неразборчивый ответ')
    parsed = JSON.parse(m[0])
  }
  const variants = (parsed as { variants?: unknown }).variants
  if (!Array.isArray(variants)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of variants) {
    if (typeof v !== 'string') continue
    const s = v.trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= MAX_VARIANTS) break
  }
  return out
}

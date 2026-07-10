// Абстракция LLM-клиента (Шаг 8). Позволяет мокать Claude в тестах и подменять
// реализацию (сейчас — Claude Code CLI).

export interface LlmRequest {
  /** Готовый текст промпта (сборка — на стороне вызывающего: см. claudeService.ts). */
  prompt: string
  /** session-id Claude для продолжения разговора (null — новый/сброшенный). */
  sessionId: string | null
  /** Модель для CLI (алиас, напр. 'sonnet' | 'opus'). */
  model: string
}

/** Колбэки потокового ответа. Ровно один из onDone/onError вызывается в конце. */
export interface LlmStreamHandlers {
  /** Очередной фрагмент текста ответа. */
  onDelta(text: string): void
  /** session-id, полученный от CLI (сохранить в БД для --resume). */
  onSession(sessionId: string): void
  /** Успешное завершение с полным текстом ответа. */
  onDone(fullText: string): void
  /** Ошибка (CLI не найден / не залогинен / ненулевой код и т.п.). */
  onError(message: string): void
}

export interface LlmHandle {
  /** Прервать текущий запрос (barge-in/смена разговора). */
  cancel(): void
}

/** Клиент к LLM. Потоковый: результаты приходят через handlers. */
export interface LlmClient {
  send(req: LlmRequest, handlers: LlmStreamHandlers): LlmHandle
}

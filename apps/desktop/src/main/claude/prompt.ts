// Сборка промпта для Claude (Шаг 8). Чистые функции.

import type { MessageRole } from '@shared/types'
import type { SttSegmentWire } from '@shared/ipc'

/** Добавляет к телу промпта просьбу прочитать вложенные файлы (пути абсолютные). */
function withAttachments(body: string, attachmentPaths: string[]): string {
  const files = attachmentPaths.filter((p) => p.trim().length > 0)
  if (files.length === 0) return body
  const list = files.map((p) => `- ${p}`).join('\n')
  const note = `К сообщению приложены файлы — прочитай их и учти при ответе:\n${list}`
  return body ? `${body}\n\n${note}` : note
}

/**
 * Промпт для одного хода (при продолжении сессии `--resume`). При нескольких
 * говорящих проставляет метки `[Спикер N]:`; при одном — просто склеенный текст.
 */
export function buildPrompt(segments: SttSegmentWire[], attachmentPaths: string[] = []): string {
  const nonEmpty = segments.filter((s) => s.text.trim().length > 0)

  const distinctSpeakers = new Set(nonEmpty.map((s) => s.speakerId))
  let body: string
  if (nonEmpty.length === 0) {
    body = ''
  } else if (distinctSpeakers.size <= 1) {
    body = nonEmpty.map((s) => s.text.trim()).join(' ')
  } else {
    body = nonEmpty.map((s) => `[Спикер ${s.speakerId}]: ${s.text.trim()}`).join('\n')
  }

  return withAttachments(body, attachmentPaths)
}

/** Реплика для сборки промпта из истории (роль + текст). */
export interface PromptMessage {
  role: MessageRole
  text: string
}

/**
 * Промпт из полной истории разговора — для «холодного» старта сессии (новый
 * разговор либо сессия сброшена после удаления/правки). Контекст модели = текущая
 * история в БД, поэтому удалённые реплики в него не попадают.
 */
export function buildConversationPrompt(
  messages: PromptMessage[],
  attachmentPaths: string[] = []
): string {
  const nonEmpty = messages.filter((m) => m.text.trim().length > 0)
  let body: string
  if (nonEmpty.length <= 1) {
    body = nonEmpty[0]?.text.trim() ?? ''
  } else {
    body = nonEmpty
      .map((m) => `${m.role === 'ai' ? 'Ассистент' : 'Пользователь'}: ${m.text.trim()}`)
      .join('\n\n')
  }
  return withAttachments(body, attachmentPaths)
}

/** Маппинг модели из настроек в алиас модели Claude CLI. */
export function claudeModelAlias(model: string): string {
  if (model.startsWith('opus')) return 'opus'
  if (model.startsWith('sonnet')) return 'sonnet'
  return 'sonnet'
}

// Экспорт разговора в Markdown/JSON. Чистые функции (без DOM/файловой системы).

import type { Conversation, Message, MessageRole } from './types'

/** Человекочитаемая подпись роли для экспорта. */
function roleLabel(role: MessageRole): string {
  if (role === 'ai') return 'Ассистент'
  const n = Number(role.slice(1))
  return n > 1 ? `Пользователь ${n}` : 'Пользователь'
}

/** Разговор в Markdown: заголовок + реплики в хронологическом порядке. */
export function conversationToMarkdown(conv: Conversation, messages: Message[]): string {
  const header = `# ${conv.title}\n`
  const body = messages
    .map((m) => `**${roleLabel(m.role)}** (${m.time}):\n\n${m.text.trim()}`)
    .join('\n\n---\n\n')
  return body ? `${header}\n${body}\n` : `${header}\n_Пустой разговор._\n`
}

/** Разговор в JSON (стабильная форма для архива/переноса). */
export function conversationToJson(conv: Conversation, messages: Message[]): string {
  return JSON.stringify(
    {
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messages: messages.map((m) => ({
        role: m.role,
        text: m.text,
        time: m.time,
        createdAt: m.createdAt
      }))
    },
    null,
    2
  )
}

/** Имя файла экспорта: слаг названия + расширение. */
export function exportFileName(title: string, format: 'md' | 'json'): string {
  const slug =
    title
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'разговор'
  return `${slug}.${format}`
}

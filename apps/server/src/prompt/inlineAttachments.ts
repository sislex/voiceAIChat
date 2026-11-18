import type { LlmAttachment } from '@voicechat/shared'

/** One text attachment larger than this is described, not inlined. */
export const INLINE_ATTACHMENT_FILE_BYTES = 64 * 1024
/** All inlined attachments of a turn together. */
export const INLINE_ATTACHMENT_TOTAL_BYTES = 200 * 1024

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|bmp|heic|tiff?|svg)$/i

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

/** Text means valid UTF-8 without control bytes other than tab, line feed and carriage return. */
function textOf(bytes: Buffer): string | null {
  for (const byte of bytes) if (byte < 9 || (byte > 13 && byte < 32)) return null
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return null }
}

/**
 * Attachments of a turn whose model has no tools (Chat, Required, a text-only deployment). Such a
 * model cannot open a path, and asked to «read the file» it invents tool calls. Small text files
 * therefore travel inside the prompt; every other file is named with the reason it is not readable.
 */
/**
 * Base64 characters of attachments one executor request may carry. The runner accepts a 32 MiB
 * body; the rest is left for the prompt, the history and JSON framing.
 */
export const EXECUTOR_ATTACHMENT_BASE64_BUDGET = 24 * 1024 * 1024

/** True when the attachments of a turn do not fit into one executor request. */
export function attachmentsExceedExecutorBudget(attachments: Pick<LlmAttachment, 'dataBase64'>[]): boolean {
  return attachments.reduce((sum, attachment) => sum + attachment.dataBase64.length, 0) > EXECUTOR_ATTACHMENT_BASE64_BUDGET
}

/**
 * `oversize`: the turn has tools, but its attachments together are too large to be sent to the
 * executor, so they degrade to the same prompt form instead of failing the turn with HTTP 413.
 */
export function inlineAttachmentsPrompt(attachments: Pick<LlmAttachment, 'runnerName' | 'dataBase64'>[], mode: 'no-tools' | 'oversize' = 'no-tools'): string {
  if (!attachments.length) return ''
  let budget = INLINE_ATTACHMENT_TOTAL_BYTES
  const blocks: string[] = []
  const notes: string[] = []
  for (const attachment of attachments) {
    const bytes = Buffer.from(attachment.dataBase64, 'base64')
    const name = attachment.runnerName
    if (IMAGE_NAME.test(name) && !/\.svg$/i.test(name)) {
      notes.push(`- ${name} (${size(bytes.byteLength)}): ${mode === 'oversize' ? 'изображение; не передано из-за общего размера вложений' : 'изображение; в этом режиме модель изображений не получает'}`)
      continue
    }
    const text = bytes.byteLength <= INLINE_ATTACHMENT_FILE_BYTES && bytes.byteLength <= budget ? textOf(bytes) : null
    if (text === null) {
      const reason = mode === 'oversize' ? 'не передан из-за общего размера вложений' : bytes.byteLength > INLINE_ATTACHMENT_FILE_BYTES || bytes.byteLength > budget ? 'файл слишком большой для этого режима' : 'двоичный файл'
      notes.push(`- ${name} (${size(bytes.byteLength)}): ${reason}`)
      continue
    }
    budget -= bytes.byteLength
    blocks.push(`<attached-file name=${JSON.stringify(name)}>\n${text}\n</attached-file>`)
  }
  const parts: string[] = []
  if (blocks.length) parts.push(`К сообщению приложены файлы, их содержимое ниже:\n${blocks.join('\n')}`)
  if (notes.length) {
    parts.push(mode === 'oversize'
      ? `Приложены файлы, которые не переданы тебе: вместе вложения сообщения больше лимита одного запроса (${size(EXECUTOR_ATTACHMENT_BASE64_BUDGET / 4 * 3)}).\n${notes.join('\n')}\n` +
        'Не пытайся открыть эти файлы и не выдумывай их содержимое. Скажи пользователю, что вложения слишком велики, и попроси прислать их по частям или меньшего размера.'
      : `Приложены файлы, содержимое которых в этом режиме недоступно:\n${notes.join('\n')}\n` +
        'Инструментов для чтения файлов у тебя нет: не пытайся их открыть и не выдумывай содержимое. ' +
        'Если без этих файлов ответить нельзя, скажи пользователю, что для работы с ними нужен режим Workspace.')
  }
  return parts.join('\n\n')
}

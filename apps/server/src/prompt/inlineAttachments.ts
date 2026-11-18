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
export function inlineAttachmentsPrompt(attachments: Pick<LlmAttachment, 'runnerName' | 'dataBase64'>[]): string {
  if (!attachments.length) return ''
  let budget = INLINE_ATTACHMENT_TOTAL_BYTES
  const blocks: string[] = []
  const notes: string[] = []
  for (const attachment of attachments) {
    const bytes = Buffer.from(attachment.dataBase64, 'base64')
    const name = attachment.runnerName
    if (IMAGE_NAME.test(name) && !/\.svg$/i.test(name)) {
      notes.push(`- ${name} (${size(bytes.byteLength)}): изображение; в этом режиме модель изображений не получает`)
      continue
    }
    const text = bytes.byteLength <= INLINE_ATTACHMENT_FILE_BYTES && bytes.byteLength <= budget ? textOf(bytes) : null
    if (text === null) {
      const reason = bytes.byteLength > INLINE_ATTACHMENT_FILE_BYTES || bytes.byteLength > budget ? 'файл слишком большой для этого режима' : 'двоичный файл'
      notes.push(`- ${name} (${size(bytes.byteLength)}): ${reason}`)
      continue
    }
    budget -= bytes.byteLength
    blocks.push(`<attached-file name=${JSON.stringify(name)}>\n${text}\n</attached-file>`)
  }
  const parts: string[] = []
  if (blocks.length) parts.push(`К сообщению приложены файлы, их содержимое ниже:\n${blocks.join('\n')}`)
  if (notes.length) {
    parts.push(`Приложены файлы, содержимое которых в этом режиме недоступно:\n${notes.join('\n')}\n` +
      'Инструментов для чтения файлов у тебя нет: не пытайся их открыть и не выдумывай содержимое. ' +
      'Если без этих файлов ответить нельзя, скажи пользователю, что для работы с ними нужен режим Workspace.')
  }
  return parts.join('\n\n')
}

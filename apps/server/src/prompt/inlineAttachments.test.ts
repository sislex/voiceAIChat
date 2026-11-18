import { describe, expect, it } from 'vitest'
import { INLINE_ATTACHMENT_FILE_BYTES, INLINE_ATTACHMENT_TOTAL_BYTES, inlineAttachmentsPrompt } from './inlineAttachments.js'

const file = (runnerName: string, content: string | Buffer) => ({ runnerName, dataBase64: Buffer.from(content).toString('base64') })

describe('inlineAttachmentsPrompt', () => {
  it('returns nothing without attachments', () => {
    expect(inlineAttachmentsPrompt([])).toBe('')
  })

  it('puts a small text file into the prompt and never asks the model to read a path', () => {
    const prompt = inlineAttachmentsPrompt([file('notes.txt', 'Секретное слово: ромашка')])
    expect(prompt).toContain('<attached-file name="notes.txt">\nСекретное слово: ромашка\n</attached-file>')
    expect(prompt).not.toContain('прочитай')
    expect(prompt).not.toContain('недоступно')
  })

  it('names images, binary and oversized files with the reason instead of their content', () => {
    const prompt = inlineAttachmentsPrompt([
      file('photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])),
      file('archive.zip', Buffer.from([0x50, 0x4b, 3, 4, 0, 0])),
      file('big.log', 'x'.repeat(INLINE_ATTACHMENT_FILE_BYTES + 1))
    ])
    expect(prompt).toContain('- photo.png (7 Б): изображение')
    expect(prompt).toContain('- archive.zip (6 Б): двоичный файл')
    expect(prompt).toContain('- big.log (64.0 КБ): файл слишком большой для этого режима')
    expect(prompt).toContain('не пытайся их открыть')
    expect(prompt).not.toContain('<attached-file')
  })

  it('stops inlining when the turn budget is spent', () => {
    const chunk = 'y'.repeat(INLINE_ATTACHMENT_FILE_BYTES)
    const count = Math.floor(INLINE_ATTACHMENT_TOTAL_BYTES / INLINE_ATTACHMENT_FILE_BYTES)
    const prompt = inlineAttachmentsPrompt(Array.from({ length: count + 1 }, (_, index) => file(`part-${index}.txt`, chunk)))
    expect(prompt.match(/<attached-file /g)).toHaveLength(count)
    expect(prompt).toContain(`- part-${count}.txt (64.0 КБ): файл слишком большой для этого режима`)
  })
})

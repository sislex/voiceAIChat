import { describe, expect, it } from 'vitest'
import { attachmentsExceedExecutorBudget, EXECUTOR_ATTACHMENT_BASE64_BUDGET, INLINE_ATTACHMENT_FILE_BYTES, INLINE_ATTACHMENT_TOTAL_BYTES, inlineAttachmentsPrompt } from './inlineAttachments.js'

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
  it('names attachments that do not fit into one executor request instead of sending them', () => {
    const big = { runnerName: 'video.bin', dataBase64: 'A'.repeat(EXECUTOR_ATTACHMENT_BASE64_BUDGET + 4) }
    const note = { runnerName: 'note.txt', dataBase64: Buffer.from('короткая заметка').toString('base64') }
    expect(attachmentsExceedExecutorBudget([note])).toBe(false)
    expect(attachmentsExceedExecutorBudget([note, big])).toBe(true)
    const prompt = inlineAttachmentsPrompt([note, { runnerName: 'big.bin', dataBase64: Buffer.from([0, 1, 2]).toString('base64') }], 'oversize')
    expect(prompt).toContain('<attached-file name="note.txt">\nкороткая заметка')
    expect(prompt).toContain('- big.bin (3 Б): не передан из-за общего размера вложений')
    expect(prompt).toContain('больше лимита одного запроса (18.0 МБ)')
    expect(prompt).not.toContain('нужен режим Workspace')
  })

  it('advises Workspace only where Workspace has tools', () => {
    const files = [file('photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])), file('big.log', 'x'.repeat(INLINE_ATTACHMENT_FILE_BYTES + 1))]
    const chosenMode = inlineAttachmentsPrompt(files, 'no-tools')
    expect(chosenMode).toContain('нужен режим Workspace')
    const server = inlineAttachmentsPrompt(files, 'server-no-tools')
    expect(server).not.toContain('Workspace')
    expect(server).toContain('на этом сервере чтение таких файлов недоступно')
    expect(server).toContain('Не советуй сменить режим')
    expect(server).toContain('- photo.png (7 Б): изображение; на этом сервере модель изображений не получает')
    expect(server).toContain('- big.log (64.0 КБ): файл слишком большой для передачи текстом')
  })
})

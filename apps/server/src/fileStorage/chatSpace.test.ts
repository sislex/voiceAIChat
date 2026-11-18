import { describe, expect, it, vi } from 'vitest'
import type { FileStorageService } from '../../../../packages/file-storage/src/service.js'
import { chatSpaceTitle, chatUploadPath, deleteChatSpaces, openChatSpace, orphanChatSpaces, renameChatSpaces } from './chatSpace.js'

const space = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: 'chat', ownerId: 'u', title: 'Chat files', ref: 'c1', ...over })
const storage = (over: Record<string, unknown>) => over as unknown as FileStorageService
const day = Date.UTC(2026, 10, 18, 12)

describe('chat storage space', () => {
  it('names the space after the conversation and falls back for an empty title', () => {
    expect(chatSpaceTitle('  План ремонта ')).toBe('План ремонта')
    expect(chatSpaceTitle('')).toBe('Chat files')
    expect(chatSpaceTitle('x'.repeat(300))).toHaveLength(200)
  })

  it('renames an existing space on open and survives a failed rename', async () => {
    const updateSpace = vi.fn(async (_u: string, id: string, body: { title: string }) => space(id, body))
    const opened = await openChatSpace(storage({ createSpace: async () => space('s1'), updateSpace }), 'u', 'c1', 'Отчёт')
    expect(updateSpace).toHaveBeenCalledWith('u', 's1', { title: 'Отчёт' })
    expect(opened.title).toBe('Отчёт')
    const kept = await openChatSpace(storage({ createSpace: async () => space('s1'), updateSpace: async () => { throw new Error('down') } }), 'u', 'c1', 'Отчёт')
    expect(kept.title).toBe('Chat files')
  })

  it('renames and deletes only chat spaces the user owns for that conversation', async () => {
    const spaces = [space('s1'), space('s2', { ref: 'c2' }), space('s3', { ownerId: 'other' }), space('s4', { kind: 'make-project' })]
    const updateSpace = vi.fn(async () => space('s1')), deleteSpace = vi.fn(async () => {})
    const service = storage({ listSpaces: async () => spaces, updateSpace, deleteSpace })
    await renameChatSpaces(service, 'u', 'c1', 'Новое имя')
    expect(updateSpace.mock.calls).toEqual([['u', 's1', { title: 'Новое имя' }]])
    expect(await deleteChatSpaces(service, 'u', 'c1')).toBe(1)
    expect(deleteSpace.mock.calls).toEqual([['u', 's1']])
  })

  it('puts attachments into a dated folder and never hands out one path twice', async () => {
    const listEntries = async () => ({ entries: [{ path: '2026-11-18/report.pdf' }] })
    const service = storage({ listEntries })
    expect(await chatUploadPath(service, 'u', 'sp-a', 'notes.txt', day)).toBe('2026-11-18/notes.txt')
    expect(await chatUploadPath(service, 'u', 'sp-a', 'notes.txt', day)).toBe('2026-11-18/notes (2).txt')
    expect(await chatUploadPath(service, 'u', 'sp-a', 'report.pdf', day)).toBe('2026-11-18/report (2).pdf')
    expect(await chatUploadPath(service, 'u', 'sp-a', 'a/b\\c', day)).toBe('2026-11-18/a_b_c')
    expect(await chatUploadPath(service, 'u', 'sp-b', 'notes.txt', day)).toBe('2026-11-18/notes.txt')
  })

  it('finds only the owner\'s chat spaces whose conversation is gone', async () => {
    const listSpaces = async () => [
      space('live', { ref: 'c1' }), space('gone', { ref: 'c2' }), space('foreign', { ref: 'c3', ownerId: 'other' }),
      space('personal', { kind: 'personal', ref: null }), space('make', { kind: 'make-project', ref: 'c4' })
    ]
    const orphans = await orphanChatSpaces(storage({ listSpaces }), 'u', async id => id === 'c1')
    expect(orphans.map(item => item.id)).toEqual(['gone'])
  })
})

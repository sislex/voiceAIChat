import { describe, expect, it, vi } from 'vitest'
import type { FileStorageService } from '../../../../packages/file-storage/src/service.js'
import { chatSpaceTitle, chatUploadPath, deleteChatSpaces, localDate, openChatSpace, orphanChatSpaces, renameChatSpaces, syncLegacyChatSpaceTitles } from './chatSpace.js'
import { chatFilesUseStorage } from './chatSpace.js'

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

  it('dates attachment folders in the server time zone, not UTC', () => {
    // Prod check 2026-11-22: a file sent at 01:10 in Minsk landed in the previous day's folder.
    const lateUtc = Date.UTC(2026, 10, 21, 22, 10)
    expect(localDate(lateUtc, 'UTC')).toBe('2026-11-21')
    expect(localDate(lateUtc, 'Europe/Minsk')).toBe('2026-11-22')
  })

  it('renames legacy «Chat files» spaces to their conversation title once listed', async () => {
    const updateSpace = vi.fn(async (_u: string, id: string, patch: { title: string }) => space(id, patch))
    const service = storage({ updateSpace })
    const titles: Record<string, string | null> = { c1: 'План отпуска', c2: null }
    const result = await syncLegacyChatSpaceTitles(service, 'u', [
      space('legacy', { ref: 'c1' }), space('untitled', { ref: 'c2' }), space('named', { ref: 'c1', title: 'Своё имя' }),
      space('foreign', { ref: 'c1', ownerId: 'other' }), space('personal', { kind: 'personal', ref: null })
    ] as never, async (_u, id) => titles[id])
    expect(updateSpace.mock.calls).toEqual([['u', 'legacy', { title: 'План отпуска' }]])
    expect(result.map(item => item.title)).toEqual(['План отпуска', 'Chat files', 'Своё имя', 'Chat files', 'Chat files'])
  })

  it('returns the list untouched when the storage answer is not an array or has holes', async () => {
    const updateSpace = vi.fn()
    const lookup = async () => 'Название'
    const wrapped = { spaces: [space('legacy')] }
    expect(await syncLegacyChatSpaceTitles(storage({ updateSpace }), 'u', wrapped as never, lookup)).toBe(wrapped)
    expect(await syncLegacyChatSpaceTitles(storage({ updateSpace }), 'u', null as never, lookup)).toBeNull()
    const result = await syncLegacyChatSpaceTitles(storage({ updateSpace }), 'u', [null, space('legacy')] as never, lookup)
    expect(result[0]).toBeNull()
    expect(updateSpace).toHaveBeenCalledTimes(1)
  })

  it('keeps a legacy title when the conversation lookup or the rename fails', async () => {
    const failingRename = vi.fn(async () => { throw new Error('storage down') })
    const lookupFails = await syncLegacyChatSpaceTitles(storage({ updateSpace: vi.fn() }), 'u', [space('a')] as never, async () => { throw new Error('db down') })
    expect(lookupFails.map(item => item.title)).toEqual(['Chat files'])
    const renameFails = await syncLegacyChatSpaceTitles(storage({ updateSpace: failingRename }), 'u', [space('b')] as never, async () => 'План')
    expect(failingRename).toHaveBeenCalledTimes(1)
    expect(renameFails.map(item => item.title)).toEqual(['Chat files'])
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

it('stores chat attachments in file storage when the plan has no machines', () => {
  const base = { storage: true, oauth: false, setting: 'machine' }
  expect(chatFilesUseStorage({ ...base, capabilities: ['chat.use'] })).toBe(true)
  expect(chatFilesUseStorage({ ...base, capabilities: ['chat.use', 'machines.use'] })).toBe(false)
  expect(chatFilesUseStorage({ ...base, capabilities: undefined })).toBe(false)
  expect(chatFilesUseStorage({ ...base, setting: 'storage', capabilities: undefined })).toBe(true)
  expect(chatFilesUseStorage({ ...base, oauth: true, capabilities: undefined })).toBe(true)
  expect(chatFilesUseStorage({ ...base, storage: false, capabilities: ['chat.use'] })).toBe(false)
})

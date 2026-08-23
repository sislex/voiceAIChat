import { describe, expect, it, vi } from 'vitest'
import { imageBlock, type Message } from '@voicechat/shared'
import { GeneratedCleanupService, withGeneratedFileLease, type GeneratedCleanupDeps } from './generatedCleanup.js'

const NOW = Date.UTC(2026, 7, 23)
const target = { userId: 'u', conversationId: 'c' }
const storage = {
  binding: { conversationId: 'c', machineId: 'm', storageId: 's', relativePath: 'chats/c' },
  storage: { id: 's', machineId: 'm', rootPath: '/store', formatVersion: 1, status: 'ready' as const },
  chatRoot: '/store/chats/c',
  attachments: '/store/chats/c/attachments',
  generated: '/store/chats/c/.generated',
  artifacts: '/store/chats/c/artifacts'
}

function message(text: string): Message {
  return { id: 'msg', conversationId: 'c', role: 'ai', text, time: '10:00', createdAt: NOW }
}

function deps(overrides: Partial<GeneratedCleanupDeps> = {}): GeneratedCleanupDeps {
  return {
    targets: () => [target],
    ttlDays: () => 30,
    messages: () => [],
    resolve: async () => storage,
    list: async () => ({ entries: [] }),
    deleteFile: vi.fn(async () => undefined),
    defer: vi.fn(),
    complete: vi.fn(),
    log: vi.fn(),
    now: () => NOW,
    ...overrides
  }
}

describe('GeneratedCleanupService', () => {
  it('удаляет только непосредственный просроченный обычный файл и публикует счётчики', async () => {
    const d = deps({
      list: async () => ({ entries: [
        { name: 'old.png', kind: 'file', mtime: NOW - 31 * 86_400_000 },
        { name: 'cutoff.png', kind: 'file', mtime: NOW - 30 * 86_400_000 },
        { name: 'link', kind: 'symlink', mtime: 0 },
        { name: 'nested', kind: 'dir', mtime: 0 },
        { name: '../outside', kind: 'file', mtime: 0 }
      ] })
    })
    const result = await new GeneratedCleanupService(d).run()
    expect(d.deleteFile).toHaveBeenCalledTimes(1)
    expect(d.deleteFile).toHaveBeenCalledWith('m', '/store/chats/c/.generated/old.png')
    expect(result).toMatchObject({ checked: 5, deleted: 1, skipped: 4, deferred: 0 })
    expect(d.log).toHaveBeenCalledWith(result)
  })

  it('сохраняет файл, упомянутый актуальным image-блоком', async () => {
    const path = '/store/chats/c/.generated/live.png'
    const d = deps({
      messages: () => [message(imageBlock({ path, agentId: 'm' }))],
      list: async () => ({ entries: [{ name: 'live.png', kind: 'file', mtime: 0 }] })
    })
    expect(await new GeneratedCleanupService(d).run()).toMatchObject({ deleted: 0, skipped: 1 })
  })

  it('lease защищает незавершённую операцию', async () => {
    const path = '/store/chats/c/.generated/busy.png'
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const operation = withGeneratedFileLease('m', path, () => held)
    const d = deps({ list: async () => ({ entries: [{ name: 'busy.png', kind: 'file', mtime: 0 }] }) })
    expect(await new GeneratedCleanupService(d).run()).toMatchObject({ deleted: 0, skipped: 1 })
    release()
    await operation
  })

  it('сохраняет retry при offline и считает ENOENT идемпотентным успехом', async () => {
    const offline = deps({ resolve: async () => { throw new Error('Машина не в сети') } })
    expect(await new GeneratedCleanupService(offline).run()).toMatchObject({ deferred: 1 })
    expect(offline.defer).toHaveBeenCalled()

    const missing = deps({
      list: async () => ({ entries: [{ name: 'gone.png', kind: 'file', mtime: 0 }] }),
      deleteFile: async () => { throw new Error('ENOENT') }
    })
    expect(await new GeneratedCleanupService(missing).run()).toMatchObject({ deleted: 1, deferred: 0 })
  })
})

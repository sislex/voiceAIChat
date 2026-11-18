import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageAttachment } from '@voicechat/shared'
import { VoiceChatDb } from './db/database.js'
import { conversationDraftUploads, removeConversationUploads, sweepDraftUploads } from './draftUploads.js'
import { UploadStore, type StoredUpload, type UploadPersistence } from './uploads.js'

const HOUR = 60 * 60_000
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function setup(now: { value: number }) {
  const dir = mkdtempSync(join(tmpdir(), 'draft-uploads-'))
  dirs.push(dir)
  const stored = new Map<string, StoredUpload>()
  const persistence: UploadPersistence = {
    save: async upload => { stored.set(upload.id, { ...upload }) },
    remove: async id => { stored.delete(id) }
  }
  const uploads = new UploadStore(dir, persistence, () => now.value)
  const add = (name: string, conversationId: string, ownerId = 'owner') => {
    const record = uploads.saveStorage(name, { spaceId: `space-${conversationId}`, path: `2026-11-18/${name}` }, 100, 'text/plain', ownerId, conversationId)
    uploads.track(record)
    return record
  }
  return { dir, stored, persistence, uploads, add }
}

describe('sweepDraftUploads', () => {
  it('removes only old unbound storage uploads and keeps sent, queued and fresh ones', async () => {
    const now = { value: 1_000_000_000_000 }
    const { uploads, stored, add } = setup(now)
    const abandoned = add('abandoned.txt', 'c1')
    const sent = add('sent.txt', 'c1')
    const gone = add('gone.txt', 'deleted')
    now.value += 25 * HOUR
    const fresh = add('fresh.txt', 'c1')
    const local = uploads.save('local.txt', Buffer.from('x'), 'text/plain', 'owner')
    local.conversationId = 'c1'
    local.createdAt = now.value - 30 * HOUR
    uploads.track(local)

    const deleted: string[] = []
    const deps = {
      uploads,
      now: () => now.value,
      conversationExists: async (_user: string, id: string) => id === 'c1',
      conversationAttachments: async (): Promise<MessageAttachment[]> => [{ name: 'sent.txt', path: sent.path, storage: sent.storage } as MessageAttachment],
      deleteStorageFile: async (_user: string, spaceId: string, path: string) => { deleted.push(`${spaceId}/${path}`) }
    }

    const dry = await sweepDraftUploads(deps)
    expect(dry).toMatchObject({ applied: false, removed: 0, freedBytes: 0 })
    expect(dry.drafts.map(item => [item.name, item.backend])).toEqual([['local.txt', 'server'], ['abandoned.txt', 'storage']])
    expect(dry.drafts[1].ageMs).toBe(25 * HOUR)
    expect(deleted).toEqual([])
    expect(stored.size).toBe(5)

    const applied = await sweepDraftUploads(deps, { apply: true })
    expect(applied).toMatchObject({ applied: true, removed: 1, freedBytes: 100, failed: 0 })
    expect(deleted).toEqual(['space-c1/2026-11-18/abandoned.txt'])
    expect(uploads.get(abandoned.id)).toBeUndefined()
    // A sent attachment keeps its file and its record: the record removes the file with the conversation.
    expect(uploads.get(sent.id)).toBeDefined()
    expect(uploads.get(gone.id)).toBeUndefined()
    expect(uploads.get(fresh.id)).toBeDefined()
    // Files on the server or a machine keep the previous behaviour.
    expect(uploads.get(local.id)).toBeDefined()
    await vi.waitFor(() => expect([...stored.keys()].sort()).toEqual([fresh.id, local.id, sent.id].sort()))
  })

  it('keeps the upload for the next sweep when storage fails and honours the owner filter and a custom age', async () => {
    const now = { value: 1_000_000_000_000 }
    const { uploads, add } = setup(now)
    const mine = add('mine.txt', 'c1')
    add('other.txt', 'c2', 'someone')
    now.value += 5_000
    const log = vi.fn()
    const report = await sweepDraftUploads({
      uploads, now: () => now.value, log,
      conversationExists: async () => true,
      conversationAttachments: async () => [],
      deleteStorageFile: async () => { throw new Error('storage_unavailable') }
    }, { apply: true, maxAgeMs: 0, userId: 'owner' })
    expect(report).toMatchObject({ removed: 0, failed: 1 })
    expect(report.drafts.map(item => item.name)).toEqual(['mine.txt'])
    expect(uploads.get(mine.id)).toBeDefined()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('storage_unavailable'))
  })
})

describe('upload records', () => {
  it('survive a restart through the chat repository (sqlite)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'draft-uploads-db-'))
    dirs.push(dir)
    const db = new VoiceChatDb(join(dir, 'db.sqlite'))
    await db.ready
    try {
      const persistence: UploadPersistence = {
        save: upload => db.chat.saveUploadRecord({ id: upload.id, userId: upload.ownerId, conversationId: upload.conversationId, record: JSON.stringify(upload), createdAt: upload.createdAt }),
        remove: id => db.chat.deleteUploadRecord(id)
      }
      const first = new UploadStore(join(dir, 'uploads'), persistence, () => 42)
      const kept = first.saveStorage('a.txt', { spaceId: 's', path: 'p/a.txt' }, 7, 'text/plain', 'owner', 'c1')
      first.track(kept)
      const untracked = first.saveRemote('task.txt', '/m/task.txt', 'agent', 3, 'text/plain', 'owner')
      first.track(untracked)
      await vi.waitFor(async () => expect(await db.chat.listUploadRecords()).toHaveLength(1))

      const second = new UploadStore(join(dir, 'uploads'), persistence)
      second.hydrate((await db.chat.listUploadRecords()).map(row => ({ ...(JSON.parse(row.record) as StoredUpload), id: row.id, createdAt: row.createdAt })))
      expect(second.get(kept.id)).toMatchObject({ name: 'a.txt', ownerId: 'owner', conversationId: 'c1', createdAt: 42, storage: { spaceId: 's', path: 'p/a.txt' } })
      expect(second.get(untracked.id)).toBeUndefined()

      second.remove(kept.id)
      await vi.waitFor(async () => expect(await db.chat.listUploadRecords()).toHaveLength(0))
    } finally { await db.close() }
  })

  it('lists the draft of a conversation without sent attachments and without other owners or conversations', async () => {
    const now = { value: 1_000_000_000_000 }
    const { uploads, add } = setup(now)
    const draft = add('draft.txt', 'c1')
    const sent = add('sent.txt', 'c1')
    add('other-conversation.txt', 'c2')
    add('other-owner.txt', 'c1', 'stranger')
    const deps = { uploads, conversationAttachments: async (): Promise<MessageAttachment[]> => [{ name: 'sent.txt', path: sent.path, uploadId: sent.id } as MessageAttachment] }
    expect((await conversationDraftUploads(deps, 'owner', 'c1')).map(upload => upload.id)).toEqual([draft.id])
    expect(await conversationDraftUploads(deps, 'owner', 'none')).toEqual([])
  })

  it('removes the records of a deleted conversation at once and its machine files without waiting for a broken machine', async () => {
    const now = { value: 1_000_000_000_000 }
    const { uploads, stored, add } = setup(now)
    const inStorage = add('in-storage.txt', 'c1')
    const onMachine = uploads.saveRemote('m.png', '/home/u/.voicechat_uploads/aa.png', 'machine-1', 10, 'image/png', 'owner')
    onMachine.conversationId = 'c1'; uploads.track(onMachine)
    const offline = uploads.saveRemote('o.png', '/home/u/.voicechat_uploads/bb.png', 'machine-2', 10, 'image/png', 'owner')
    offline.conversationId = 'c1'; uploads.track(offline)
    const local = uploads.save('local.txt', Buffer.from('x'), 'text/plain', 'owner')
    local.conversationId = 'c1'; uploads.track(local)
    const kept = add('kept.txt', 'c2')
    const deletedOnMachine: string[] = []
    const logged: string[] = []
    const pending = removeConversationUploads({
      uploads,
      deleteMachineFile: async (agentId, path) => { if (agentId === 'machine-2') throw new Error('offline'); deletedOnMachine.push(`${agentId}:${path}`) },
      log: message => logged.push(message)
    }, 'owner', 'c1')
    // Records are gone before any machine answered.
    expect([inStorage, onMachine, offline, local].map(upload => uploads.get(upload.id))).toEqual([undefined, undefined, undefined, undefined])
    expect(existsSync(local.path)).toBe(false)
    expect(await pending).toEqual({ records: 4, machineFiles: 1, failed: 1 })
    expect(deletedOnMachine).toEqual(['machine-1:/home/u/.voicechat_uploads/aa.png'])
    expect(logged.join()).toContain('machine-2')
    expect(uploads.get(kept.id)).toBeDefined()
    await vi.waitFor(() => expect([...stored.keys()]).toEqual([kept.id]))
  })
})

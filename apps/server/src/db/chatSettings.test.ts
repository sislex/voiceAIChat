import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings, type ChatSettingsSnapshot } from '@voicechat/shared'
import { VoiceChatDb } from './database.js'

const databases: VoiceChatDb[] = []
const directories: string[] = []
const open = (file = ':memory:') => { const db = new VoiceChatDb(file); databases.push(db); return db }
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close()
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const patch = (revision: number, owner: 'account' | 'conversation', values: object) => ({ version: 1, expectedRevision: revision, owner, values })

describe('canonical persisted chat settings', () => {
  it('migrates partial legacy settings and instruction flags once, and reconciles old account writes', async () => {
    const db = open()
    await db.settings.saveSettings('alice', { theme: 'dark', chatInstructions: { console: false } } as unknown as Settings)
    const migrated = (await db.settings.getChatSettings('alice'))!
    expect(migrated.account).toMatchObject({ theme: 'dark', voice: DEFAULT_SETTINGS.voice })
    expect(migrated.account.chatInstructions).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'console', enabled: false })]))
    expect(await db.settings.getChatSettings('alice')).toEqual(migrated)
    await db.settings.saveSettings('alice', { ...await db.settings.getSettings('alice'), theme: 'light' })
    expect(await db.settings.patchChatSettings('alice', patch(migrated.revision, 'account', { theme: 'green' })))
      .toMatchObject({ code: 'settings_revision_conflict', current: { revision: migrated.revision + 1, account: { theme: 'light' } } })
    await db.settings.deleteUserSettings('alice')
    expect(await db.settings.getChatSettings('alice')).toMatchObject({ revision: 0, account: { theme: DEFAULT_SETTINGS.theme } })
  })

  it('migrates legacy account and conversation fields without copying device state', async () => {
    const db = open()
    await db.settings.saveSettings('alice', { ...DEFAULT_SETTINGS, theme: 'dark', micDeviceId: 'local-device' })
    const c = await db.chat.createConversation('alice', 'Legacy')
    await db.chat.setConversationExecTarget('alice', c.id, 'offline-machine', '/work', ['review'], 'codex', 'custom-model')
    const value = await db.settings.getChatSettings('alice', c.id)
    expect(value).toMatchObject({ version: 1, revision: 0, account: { theme: 'dark' }, conversation: {
      title: 'Legacy', execTarget: 'offline-machine', workdir: '/work', skills: ['review'], codexModel: 'custom-model'
    }, device: {} })
    expect(value!.account).not.toHaveProperty('micDeviceId')
    expect(await db.settings.getChatSettings('alice', c.id)).toEqual(value)
    expect(await db.settings.getChatSettings('bob', c.id)).toBeNull()
  })

  it('rejects stale writes, persists account changes across conversations and detects legacy edits', async () => {
    const db = open()
    const a = await db.chat.createConversation('alice', 'A')
    const b = await db.chat.createConversation('alice', 'B')
    const initial = (await db.settings.getChatSettings('alice', a.id))!
    const changed = await db.settings.patchChatSettings('alice', patch(initial.revision, 'account', { theme: 'dark' })) as ChatSettingsSnapshot
    expect(changed.revision).toBe(initial.revision + 1)
    expect((await db.settings.getChatSettings('alice', b.id))!.account.theme).toBe('dark')
    const current = (await db.settings.getChatSettings('alice', a.id))!
    expect(await db.settings.patchChatSettings('alice', patch(initial.revision, 'conversation', { title: 'Lost' }), a.id))
      .toEqual({ code: 'settings_revision_conflict', current })
    await db.chat.renameConversation('alice', a.id, 'Legacy edit')
    const conflict = await db.settings.patchChatSettings('alice', patch(current.revision, 'conversation', { title: 'Lost' }), a.id)
    expect(conflict).toMatchObject({ code: 'settings_revision_conflict', current: { conversation: { title: 'Legacy edit' } } })
    expect((await db.chat.getConversation('alice', a.id))!.title).toBe('Legacy edit')
  })

  it('round-trips the account inventory and applies context presets to the legacy runtime', async () => {
    const db = open()
    const c = await db.chat.createConversation('alice', 'A')
    const before = (await db.settings.getChatSettings('alice', c.id))!
    const updated = await db.settings.patchChatSettings('alice', patch(before.revision, 'account', {
      ...before.account, contextPresets: [{ id: 'quiet', name: 'Quiet', disabled: ['personalization'] }]
    })) as ChatSettingsSnapshot
    const selected = await db.settings.patchChatSettings('alice', patch(updated.revision, 'conversation', { contextPresetId: 'quiet' }), c.id) as ChatSettingsSnapshot
    expect(selected.conversation).toMatchObject({ contextPresetId: 'quiet', disabledContext: ['personalization'] })
    expect((await db.chat.getConversation('alice', c.id))!.disabledContext).toEqual(['personalization'])
    await db.chat.setConversationContextEnabled('alice', c.id, 'personalization', true)
    expect((await db.settings.getChatSettings('alice', c.id))!.conversation.contextPresetId).toBeNull()
  })

  it('applies real conversation fields, restores provider models, and rolls back invalid domain changes', async () => {
    const db = open()
    const c = await db.chat.createConversation('alice', 'A')
    let state = (await db.settings.getChatSettings('alice', c.id))!
    state = await db.settings.patchChatSettings('alice', patch(state.revision, 'conversation', {
      title: 'Updated', llmProvider: 'codex', codexModel: 'model-c', model: 'model-a', skills: ['review'], kbMode: 'off'
    }), c.id) as ChatSettingsSnapshot
    expect(await db.chat.getConversation('alice', c.id)).toMatchObject({ title: 'Updated', llmModel: 'model-c', skillNames: ['review'], kbContextMode: 'off' })
    state = await db.settings.patchChatSettings('alice', patch(state.revision, 'conversation', { llmProvider: 'claude' }), c.id) as ChatSettingsSnapshot
    expect((await db.chat.getConversation('alice', c.id))!.llmModel).toBe('model-a')
    await expect(db.settings.patchChatSettings('alice', patch(state.revision, 'conversation', { title: 'Rollback', disabledContext: ['platform-instructions'] }), c.id)).rejects.toThrow()
    expect(await db.settings.getChatSettings('alice', c.id)).toEqual(state)
    await expect(db.settings.patchChatSettings('alice', patch(state.revision, 'conversation', { projectId: 'foreign' }), c.id)).rejects.toThrow()
  })

  it('round-trips a normal conversation snapshot and removes its migrated state on deletion', async () => {
    const db = open()
    const c = await db.chat.createConversation('alice', 'A')
    const initial = (await db.settings.getChatSettings('alice', c.id))!
    const changed = await db.settings.patchChatSettings('alice', patch(initial.revision, 'conversation', initial.conversation), c.id) as ChatSettingsSnapshot
    expect(changed.conversation).toEqual(initial.conversation)
    await db.chat.deleteConversation('alice', c.id)
    expect(await db.settings.getChatSettings('alice', c.id)).toBeNull()
    expect((await db.settings.getChatSettings('alice'))!.revision).toBe(changed.revision + 1)
  })

  it.each([
    { owner: 'device', values: { micDeviceId: 'x' } },
    { owner: 'account', values: { micDeviceId: 'x' } },
    { owner: 'account', values: { theme: true } },
    { owner: 'account', values: { autoSpeak: 'true' } },
    { owner: 'conversation', values: { previewUrl: 'javascript:alert(1)' } },
    { owner: 'conversation', values: { skills: [12] } },
    { owner: 'account', values: [] }
  ])('rejects malformed writes atomically: %j', async input => {
    const db = open()
    const before = await db.settings.getChatSettings('alice')
    await expect(db.settings.patchChatSettings('alice', { version: 1, expectedRevision: 0, ...input })).rejects.toThrow()
    expect(await db.settings.getChatSettings('alice')).toEqual(before)
  })

  it.skipIf(Boolean(process.env.VC_TEST_DB_URL))('shares durable revisions between independent connections and survives restart', async () => {
    const dir = mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : tmpdir(), 'chat-settings-'))
    directories.push(dir)
    const file = join(dir, 'settings.sqlite')
    const first = open(file)
    const c = await first.chat.createConversation('alice', 'A')
    const initial = (await first.settings.getChatSettings('alice', c.id))!
    const second = open(file)
    await second.ready
    const results = await Promise.all([
      first.settings.patchChatSettings('alice', patch(initial.revision, 'conversation', { title: 'Host A' }), c.id),
      second.settings.patchChatSettings('alice', patch(initial.revision, 'conversation', { title: 'Host B' }), c.id)
    ])
    expect(results.filter(value => value && 'code' in value)).toHaveLength(1)
    const saved = await first.settings.getChatSettings('alice', c.id)
    expect(await second.settings.getChatSettings('alice', c.id)).toEqual(saved)
    await first.close(); databases.splice(databases.indexOf(first), 1)
    await second.close(); databases.splice(databases.indexOf(second), 1)
    expect(await open(file).settings.getChatSettings('alice', c.id)).toEqual(saved)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { INVALID_HISTORY_CURSOR, REST, stripServiceData, type ConversationWithMessages, type TurnMeta } from '@voicechat/shared'
import { setupRestHarness } from './restHarness.js'

const h = setupRestHarness()
const meta: TurnMeta = { activity: [{ kind: 'thinking', summary: 'Trace', raw: 'private' }], inputTokens: 12 }

describe('paged conversation transport', () => {
  it.each(['chat', 'make'] as const)('pages %s history without full-history reads or duplicates despite appends', async scope => {
    const c = await h.db.chat.createConversation(h.U, 'History', scope === 'make' ? 'make' : null)
    const original = []
    for (let i = 0; i < 7; i++) original.push(await h.db.chat.addMessage(h.U, c.id, 'ai', `Message ${i}`, '10:00', undefined, meta))
    const url = (before?: string) => `${REST.conversation(c.id, { limit: 3, before })}&scope=${scope}`
    const full = await h.inj({ method: 'GET', url: `${REST.conversation(c.id)}?scope=${scope}&before=ignored` })
    expect(full.statusCode).toBe(200)
    expect(full.json().messages.map((m: { id: string }) => m.id)).toEqual(original.map(m => m.id))
    expect(full.json()).not.toHaveProperty('history')
    const list = vi.spyOn(h.db.chat, 'listMessages').mockRejectedValue(Error('must not load all messages'))
    try {
      const first = await h.inj({ method: 'GET', url: url() })
      expect(first.statusCode).toBe(200)
      let page = first.json<ConversationWithMessages>()
      expect(page.history).toEqual({ hasMore: true, oldestId: original[4].id, total: 7 })
      expect(page.messages.map(m => m.id)).toEqual(original.slice(4).map(m => m.id))
      expect(page.messages[0].meta).toEqual(stripServiceData(meta))
      await h.db.chat.addMessage(h.U, c.id, 'ai', 'Appended', '10:00')
      let ids = page.messages.map(m => m.id)
      for (let i = 0; page.history!.hasMore && i < 5; i++) {
        const response = await h.inj({ method: 'GET', url: url(page.history!.oldestId!) })
        expect(response.statusCode).toBe(200)
        page = response.json<ConversationWithMessages>()
        expect(page.history!.total).toBe(8)
        ids = [...page.messages.map(m => m.id), ...ids]
      }
      expect(page.history).toEqual({ hasMore: false, oldestId: original[0].id, total: 8 })
      expect(ids).toEqual(original.map(m => m.id))
      expect(new Set(ids).size).toBe(7)
      const empty = await h.inj({ method: 'GET', url: url(original[0].id) })
      expect(empty.json()).toMatchObject({ messages: [], history: { hasMore: false, oldestId: null, total: 8 } })
      const settings = (await h.db.settings.getChatSettings(h.U, c.id))!
      await h.db.settings.patchChatSettings(h.U, { version: 1, owner: 'conversation', expectedRevision: settings.revision, values: { loadServiceData: true } }, c.id)
      expect((await h.inj({ method: 'GET', url: url(original[4].id) })).json().messages[0].meta).toEqual(meta)
      expect(list).not.toHaveBeenCalled()
    } finally { list.mockRestore() }
  })

  it('rejects missing, deleted and foreign cursors, validates limits and protects ownership', async () => {
    const c = await h.db.chat.createConversation(h.U)
    expect((await h.inj({ method: 'GET', url: REST.conversation(c.id, { limit: 200 }) })).json())
      .toMatchObject({ messages: [], history: { total: 0, hasMore: false, oldestId: null } })
    const deleted = await h.db.chat.addMessage(h.U, c.id, 'u1', 'deleted', '10:00')
    await h.db.chat.deleteMessage(h.U, c.id, deleted.id)
    const other = await h.db.chat.createConversation('other')
    const foreign = await h.db.chat.addMessage('other', other.id, 'u1', 'private', '10:00')
    for (const before of ['missing', deleted.id, foreign.id]) {
      const response = await h.inj({ method: 'GET', url: REST.conversation(c.id, { limit: 1, before }) })
      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe(INVALID_HISTORY_CURSOR)
    }
    for (const query of ['limit=0', 'limit=201', 'limit=-1', 'limit=1.5', 'limit=x', 'limit=', 'limit=1&limit=2', 'limit=1&before=']) {
      expect((await h.inj({ method: 'GET', url: `${REST.conversation(c.id)}?${query}` })).statusCode).toBe(400)
    }
    expect((await h.inj({ method: 'GET', url: REST.conversation(other.id, { limit: 1, before: foreign.id }) })).statusCode).toBe(404)
  })
})

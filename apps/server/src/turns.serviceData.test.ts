import { expect, it } from 'vitest'
import { stripServiceData, type ServerMessage } from '@voicechat/shared'
import { VoiceChatDb } from './db/database.js'
import { createTurnManager } from './turns.js'
import type { LlmStreamHandlers } from './claude/types.js'

for (const enabled of [false, true]) {
  for (const finish of ['done', 'cancel', 'flush'] as const) {
    it(`projects both claude.done metadata fields for ${finish}, enabled=${enabled}`, async () => {
      const db = new VoiceChatDb(':memory:')
      await db.identity.createUser('admin', '', 'admin')
      const c = await db.chat.createConversation('admin', 'Turn')
      await db.chat.addMessage('admin', c.id, 'u1', 'Question', '10:00')
      const settings = (await db.settings.getChatSettings('admin', c.id))!
      await db.settings.patchChatSettings('admin', { version: 1, owner: 'conversation', expectedRevision: settings.revision, values: { loadServiceData: enabled } }, c.id)
      let handlers: LlmStreamHandlers | undefined
      const turns = createTurnManager({ db, claude: { send(_req, h) {
        handlers = h
        h.onActivity?.({ kind: 'thinking', summary: 'Thinking', raw: 'private trace' })
        void h.onDelta('Answer')
        return { cancel() {} }
      } } })
      const events: ServerMessage[] = []
      turns.subscribe(event => events.push(event))
      try {
        await turns.start({ userId: 'admin', conversationId: c.id, segments: [{ speakerId: 1, text: 'Question' }] })
        expect(handlers).toBeDefined()
        expect(turns.active('admin')[0]?.activity?.[0]?.raw).toBe('private trace')
        if (finish === 'done') await handlers!.onDone('Answer')
        else if (finish === 'cancel') await turns.cancel(c.id)
        else await turns.flushInterrupted()
        await turns.idle()
        const persisted = (await db.chat.listMessages('admin', c.id)).find(message => message.role === 'ai')!
        expect(persisted.meta?.activity?.[0].raw).toBe('private trace')
        expect(persisted.meta?.request?.prompt).toBeTruthy()
        const done = events.find(event => event.t === 'claude.done')
        const expected = enabled ? persisted.meta : stripServiceData(persisted.meta!)
        expect(done).toMatchObject({ t: 'claude.done', meta: expected, message: { meta: expected } })
        if (done?.t === 'claude.done' && !enabled) {
          expect(done.meta?.activity).toBeUndefined()
          expect(done.message?.meta?.request?.prompt).toBeUndefined()
        }
      } finally { await turns.flushInterrupted(); await turns.idle(); await db.close() }
    })
  }
}

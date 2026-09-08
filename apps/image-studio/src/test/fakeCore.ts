import { randomUUID } from 'node:crypto'
import type { ImageStudioConversation, ImageStudioCore } from '../core.js'

/** Только порт ядра; тесты студии не открывают SQLite и не импортируют сервер. */
export function fakeCore() {
  const conversations = new Map<string, { owner: string; conversation: ImageStudioConversation }>()
  const core: ImageStudioCore = {
    async conversation(userId, id) { const found = conversations.get(id); return found?.owner === userId ? found.conversation : null },
    async renameConversation(userId, id, title) { const found = await core.conversation(userId, id); if (found) found.title = title },
    async readGenerated() { return null },
    async generate() { throw new Error('Генератор не настроен в тесте') }
  }
  return {
    core,
    async createConversation(owner: string, title: string, assistantKind: ImageStudioConversation['assistantKind'] = null) {
      const conversation = { id: randomUUID(), title, assistantKind }
      conversations.set(conversation.id, { owner, conversation })
      return conversation
    }
  }
}

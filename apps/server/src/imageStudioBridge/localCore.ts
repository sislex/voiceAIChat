import type { ImageStudioCore, ImageStudioGeneration } from '@voicechat/image-studio'
import type { VoiceChatDb } from '../db/database.js'
import type { LlmClient } from '../claude/types.js'
import { llmImageStudioGenerator } from './generator.js'

export class LocalImageStudioCore implements ImageStudioCore {
  constructor(private readonly opts: {
    db: VoiceChatDb
    client: LlmClient
    profileHome(userId: string): string
    readGenerated(userId: string, path: string): Promise<{ dataBase64: string } | null>
  }) {}
  async conversation(userId: string, id: string) {
    const conversation = await this.opts.db.chat.getConversation(userId, id)
    return conversation ? { id: conversation.id, title: conversation.title, assistantKind: conversation.assistantKind } : null
  }
  async renameConversation(userId: string, id: string, title: string): Promise<void> { await this.opts.db.chat.renameConversation(userId, id, title) }
  readGenerated(userId: string, path: string) { return this.opts.readGenerated(userId, path) }

  async generate(userId: string, input: ImageStudioGeneration): Promise<Buffer> {
    let cancelled = false
    let cancel = () => {}
    input.onCancel?.(() => { cancelled = true; cancel() })
    const settings = await this.opts.db.settings.getSettings(userId)
    if (cancelled) throw new Error('Генерация отменена')
    return llmImageStudioGenerator({
      client: this.opts.client, userId, model: settings.codexModel, cwd: this.opts.profileHome(userId),
      readGenerated: (path) => this.readGenerated(userId, path)
    })({ ...input, onCancel: (fn) => { cancel = fn; if (cancelled) fn() } })
  }
}

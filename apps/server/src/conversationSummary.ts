import type { Conversation, LlmClient, Message } from '@voicechat/shared'
import type { VoiceChatDb } from './db/database.js'

export const SUMMARY_MESSAGE_THRESHOLD = 40

export interface ConversationSummaryService {
  consider(userId: string, conversationId: string): void
  refresh(userId: string, conversationId: string): Promise<Conversation | null>
}

function summaryPrompt(previous: Conversation['summary'], messages: Message[]): string {
  const history = messages.map((message) => `[${message.id}] ${message.role}: ${message.text}`).join('\n\n')
  return `Update the rolling conversation summary below using the new messages. Preserve useful prior facts.
Include decisions, chosen styles and tokens, open tasks, and names of files and components. Be factual and concise.
Return only the updated summary, at most 1,500 words. Do not use tools.

PREVIOUS SUMMARY:
${previous?.text ?? '(none)'}

NEW MESSAGES:
${history}`
}

function atMost1500Words(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.length <= 1500 ? text.trim() : words.slice(0, 1500).join(' ')
}

export function createConversationSummaryService(deps: {
  db: VoiceChatDb
  client: LlmClient
  model: string
  publish?: (userId: string, conversation: Conversation) => void | Promise<void>
  now?: () => number
  logError?: (error: unknown) => void
}): ConversationSummaryService {
  const active = new Map<string, Promise<Conversation | null>>()
  const retryAt = new Map<string, number>()
  const now = deps.now ?? Date.now

  const run = async (userId: string, conversationId: string, force: boolean): Promise<Conversation | null> => {
    const snapshot = await deps.db.chat.summaryMessages(userId, conversationId)
    if (!snapshot || snapshot.messages.length === 0) return snapshot ? await deps.db.chat.getConversation(userId, conversationId) : null
    const minimum = retryAt.get(conversationId) ?? SUMMARY_MESSAGE_THRESHOLD
    if (!force && snapshot.messages.length < minimum) return await deps.db.chat.getConversation(userId, conversationId)
    const last = snapshot.messages.at(-1)!
    try {
      const text = await new Promise<string>((resolve, reject) => {
        deps.client.send({
          userId,
          prompt: summaryPrompt(snapshot.summary, snapshot.messages),
          sessionId: null,
          model: deps.model,
          permissionMode: 'plan',
          textOnly: true,
          executionDisabled: true
        }, {
          onDelta: () => {}, onSession: () => {},
          onDone: (fullText) => resolve(fullText),
          onError: (message) => reject(new Error(message))
        })
      })
      const summaryText = atMost1500Words(text)
      if (!summaryText) throw new Error('summary runner returned empty text')
      const conversation = await deps.db.chat.setConversationSummary(userId, conversationId, {
        text: summaryText, coversUntilMessageId: last.id, updatedAt: now()
      })
      retryAt.delete(conversationId)
      if (conversation) await deps.publish?.(userId, conversation)
      return conversation
    } catch (error) {
      retryAt.set(conversationId, snapshot.messages.length + SUMMARY_MESSAGE_THRESHOLD)
      deps.logError?.(error)
      return await deps.db.chat.getConversation(userId, conversationId)
    }
  }

  const refresh = (userId: string, conversationId: string, force = true): Promise<Conversation | null> => {
    const key = `${userId}\0${conversationId}`
    const current = active.get(key)
    if (current) return current
    const promise = run(userId, conversationId, force).finally(() => active.delete(key))
    active.set(key, promise)
    return promise
  }
  return {
    consider(userId, conversationId) { void refresh(userId, conversationId, false) },
    refresh: (userId, conversationId) => refresh(userId, conversationId, true)
  }
}

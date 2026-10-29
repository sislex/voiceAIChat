import type { Conversation, LlmClient, Message } from '@voicechat/shared'
import type { VoiceChatDb } from './db/database.js'

export const SUMMARY_MESSAGE_THRESHOLD = 40
export const SUMMARY_PROMPT_CHARS = 32_000
const SUMMARY_TEXT_CHARS = 8_000
const MESSAGE_CHARS = 2_000
const HISTORY_CHARS = 20_000

function excerpt(message: Message): string {
  return `[${message.id}] ${message.role}: ${message.text.slice(0, MESSAGE_CHARS)}`
}

/** Deterministic emergency context: prior facts followed by newest messages first. */
export function fallbackSummary(previous: Conversation['summary'], messages: Message[]): NonNullable<Conversation['summary']> {
  let text = `PREVIOUS SUMMARY:\n${previous?.text.slice(0, 4_000) ?? '(none)'}\n\nRECENT MESSAGES (newest first):\n`
  for (let index = messages.length - 1; index >= 0 && text.length < 12_000; index--) {
    text += excerpt(messages[index]!) + '\n\n'
  }
  return {
    text: text.slice(0, 12_000),
    coversUntilMessageId: messages.at(-1)!.id,
    updatedAt: Date.now(),
    source: 'fallback'
  }
}

export interface SummaryFailure {
  event: 'conversation_summary_failed'
  conversationId: string
  model: string
  reason: string
  error: string
  messageCount: number
  promptChars: number
}

export function logSummaryFailure(event: SummaryFailure): void {
  console.log(JSON.stringify(event))
}

function* chunks(messages: Message[]): Generator<Message[]> {
  let batch: Message[] = []
  let size = 0
  for (const message of messages) {
    const chars = excerpt(message).length + 2
    if (batch.length && size + chars > HISTORY_CHARS) {
      yield batch
      batch = []
      size = 0
    }
    batch.push(message)
    size += chars
  }
  if (batch.length) yield batch
}

export interface ConversationSummaryService {
  consider(userId: string, conversationId: string): void
  refresh(userId: string, conversationId: string): Promise<Conversation | null>
}

function summaryPrompt(previous: Conversation['summary'], messages: Message[]): string {
  const history = messages.map(excerpt).join('\n\n')
  return `Update the rolling conversation summary below using the new messages. Preserve useful prior facts.
Include decisions, chosen styles and tokens, open tasks, and names of files and components. Be factual and concise.
Return only the updated summary, at most 1,500 words. Do not use tools.

PREVIOUS SUMMARY:
${previous?.text.slice(0, SUMMARY_TEXT_CHARS) ?? '(none)'}

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
  fallback?: { client: LlmClient; model: string }
  publish?: (userId: string, conversation: Conversation) => void | Promise<void>
  now?: () => number
  logError?: (event: SummaryFailure) => void
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
      let previous = snapshot.summary
      let summaryText = ''
      for (const batch of chunks(snapshot.messages)) {
        const prompt = summaryPrompt(previous, batch).slice(0, SUMMARY_PROMPT_CHARS)
        let succeeded = false
        for (const runner of [deps, ...(deps.fallback ? [deps.fallback] : [])]) {
          try {
            const text = await new Promise<string>((resolve, reject) => {
              let handle: ReturnType<LlmClient['send']> | undefined
              const timer = setTimeout(() => {
                const error = new Error('summary runner timed out')
                error.name = 'SummaryTimeout'
                reject(error)
                try { handle?.cancel() } catch { /* Timeout already rejected the attempt. */ }
              }, 30_000)
              try {
                handle = runner.client.send({
                  userId, prompt, sessionId: null, model: runner.model,
                  permissionMode: 'plan', textOnly: true, executionDisabled: true
                }, {
                  onDelta: () => {}, onSession: () => {},
                  onDone: (text) => { clearTimeout(timer); resolve(text) },
                  onError: (message) => { clearTimeout(timer); reject(new Error(message)) }
                })
              } catch (error) {
                clearTimeout(timer)
                reject(error)
              }
            })
            summaryText = atMost1500Words(text).slice(0, SUMMARY_TEXT_CHARS)
            if (!summaryText) throw new Error('summary runner returned empty text')
            succeeded = true
            break
          } catch (error) {
            (deps.logError ?? logSummaryFailure)({
              event: 'conversation_summary_failed', conversationId, model: runner.model,
              reason: error instanceof Error ? error.name : 'runner_error',
              error: error instanceof Error ? error.message : String(error),
              messageCount: batch.length, promptChars: prompt.length
            })
          }
        }
        if (!succeeded) throw new Error('summary runners failed')
        previous = { text: summaryText, coversUntilMessageId: batch.at(-1)!.id, updatedAt: now() }
      }
      const conversation = await deps.db.chat.setConversationSummary(userId, conversationId, {
        text: summaryText, coversUntilMessageId: last.id, updatedAt: now()
      })
      retryAt.delete(conversationId)
      if (conversation) await deps.publish?.(userId, conversation)
      return conversation
    } catch {
      retryAt.set(conversationId, snapshot.messages.length + SUMMARY_MESSAGE_THRESHOLD)
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

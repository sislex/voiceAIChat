import { calculateThreadCost, THREAD_COST_THRESHOLDS, resumeSessionIdFor, effectiveChatInstructions,
  chatInstructionHints, type Conversation, type ConversationThreadCost } from '@voicechat/shared'
import type { VoiceChatDb } from './db/database.js'
import { fallbackSummary, logSummaryFailure, type ConversationSummaryService } from './conversationSummary.js'

export class ThreadResetError extends Error {
  constructor(readonly code: string, readonly statusCode: number) { super(code) }
}

export function threadCostThresholds(): ConversationThreadCost['thresholds'] {
  const positive = (value: string | undefined, fallback: number) => {
    const n = Number(value)
    return Number.isSafeInteger(n) && n > 0 ? n : fallback
  }
  const considerTokens = positive(process.env.VC_THREAD_RESET_CONSIDER_TOKENS, THREAD_COST_THRESHOLDS.considerTokens)
  const resetTokens = positive(process.env.VC_THREAD_RESET_RESET_TOKENS, THREAD_COST_THRESHOLDS.resetTokens)
  return resetTokens >= considerTokens ? { considerTokens, resetTokens } : { ...THREAD_COST_THRESHOLDS }
}

/**
 * Make conversations start a fresh thread before a turn whose context would cross Haiku's long-context
 * price step (100k input tokens): every later call of a long thread re-reads and re-writes the whole
 * cache at the higher rate. `VC_MAKE_THREAD_ROLLOVER_TOKENS=0` turns the rule off.
 */
export const MAKE_THREAD_ROLLOVER_TOKENS = 90_000

export function makeThreadRolloverTokens(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.VC_MAKE_THREAD_ROLLOVER_TOKENS
  if (raw === undefined || raw.trim() === '') return MAKE_THREAD_ROLLOVER_TOKENS
  const n = Number(raw)
  return Number.isSafeInteger(n) && n >= 0 ? n : MAKE_THREAD_ROLLOVER_TOKENS
}

/** Threshold crossed by the context of the latest completed turn; 0 when no rollover is due. */
export function makeThreadRolloverDue(conv: Conversation, threshold = makeThreadRolloverTokens()): number {
  const used = conv.contextUsage?.usedTokens
  return conv.assistantKind === 'make' && threshold > 0 && typeof used === 'number' && used >= threshold ? used : 0
}

export function makeThreadRolloverNote(threshold: number): string {
  return `Начат новый тред: контекст беседы превысил ${Math.round(threshold / 1000)} тыс. токенов, предыдущее сохранено в сводке.`
}

export async function conversationThreadCost(db: VoiceChatDb, userId: string, conv: Conversation): Promise<ConversationThreadCost> {
  const settings = await db.settings.getSettings(userId)
  const project = conv.projectId && conv.llmProvider === null
    ? await db.ci.getCiLlmConfig('project', conv.projectId) ?? await db.ci.ciLlmDefaultsForUser(userId) : null
  // The stored session owns its cost, even after a default provider change.
  const provider = conv.claudeSessionId?.startsWith('codex:') ? 'codex'
    : conv.claudeSessionId ? 'claude' : conv.llmProvider ?? project?.provider ?? settings.llmProvider
  const sessionId = resumeSessionIdFor(conv.claudeSessionId, provider)
  const turns = sessionId ? await db.chat.threadTurnCosts(userId, conv.id, provider, sessionId) : []
  const instructionChars = chatInstructionHints(effectiveChatInstructions(settings.chatInstructions, conv.disabledContext ?? [])).join('\n').length
  const inputTokens = Math.ceil((instructionChars + (conv.summary?.text.length ?? 0) +
    await db.chat.latestUserMessageChars(userId, conv.id)) / 4)
  return calculateThreadCost(provider, !!sessionId, turns, { inputTokens, durationMs: 0 }, threadCostThresholds())
}

/** Caller holds the turn admission lock across summary generation and session clearing. */
export async function resetConversationThread(
  db: VoiceChatDb, summary: Pick<ConversationSummaryService, 'refresh'> | undefined,
  userId: string, conversationId: string, summarize: boolean, note?: string
): Promise<Conversation | null> {
  const conv = await db.chat.getConversation(userId, conversationId)
  if (!conv) return null
  const cost = await conversationThreadCost(db, userId, conv)
  if (summarize) {
    try {
      await summary?.refresh(userId, conversationId)
    } catch (error) {
      logSummaryFailure({
        event: 'conversation_summary_failed', conversationId, model: 'summary-service',
        reason: error instanceof Error ? error.name : 'summary_failed',
        error: error instanceof Error ? error.message : String(error),
        messageCount: 0, promptChars: 0
      })
    }
    // Re-read after any in-flight background run: cover only its remaining messages.
    const pending = await db.chat.summaryMessages(userId, conversationId)
    if (!pending) return null
    if (pending.messages.length) {
      await db.chat.setConversationSummary(userId, conversationId, fallbackSummary(pending.summary, pending.messages))
    }
  }
  return db.chat.resetConversationThread(userId, conversationId,
    cost.last ? cost.last.inputTokens + cost.last.cacheReadTokens : 0, note)
}

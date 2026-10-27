import { calculateThreadCost, THREAD_COST_THRESHOLDS, resumeSessionIdFor, effectiveChatInstructions,
  chatInstructionHints, type Conversation, type ConversationThreadCost } from '@voicechat/shared'
import type { VoiceChatDb } from './db/database.js'
import type { ConversationSummaryService } from './conversationSummary.js'

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
  userId: string, conversationId: string, summarize: boolean
): Promise<Conversation | null> {
  const conv = await db.chat.getConversation(userId, conversationId)
  if (!conv) return null
  const cost = await conversationThreadCost(db, userId, conv)
  if (summarize) {
    if (!summary) throw new ThreadResetError('summary_unavailable', 503)
    // Existing refresh is best effort. Verify its boundary before discarding the session.
    const pending = await db.chat.summaryMessages(userId, conversationId)
    const target = pending?.messages.at(-1)?.id
    let refreshed = await summary.refresh(userId, conversationId)
    if (!refreshed) return null
    // An already running background summary may cover an earlier boundary.
    if (target && refreshed.summary?.coversUntilMessageId !== target) {
      refreshed = await summary.refresh(userId, conversationId)
      if (!refreshed || refreshed.summary?.coversUntilMessageId !== target) throw new ThreadResetError('summary_failed', 503)
    }
  }
  return db.chat.resetConversationThread(userId, conversationId,
    cost.last ? cost.last.inputTokens + cost.last.cacheReadTokens : 0)
}

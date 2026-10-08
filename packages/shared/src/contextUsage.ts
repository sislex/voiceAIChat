import type { ConversationContextUsage, LlmProvider, TurnMeta } from './types'

/** Conservative fallback for an unknown model: never promise more than 128k. */
export const DEFAULT_MODEL_WINDOW_TOKENS = 128_000

const MODEL_WINDOWS: ReadonlyArray<[RegExp, number]> = [
  [/^claude-/i, 200_000],
  [/^(gpt-5|codex)/i, 400_000]
]

export function modelWindowTokens(model: string): number {
  return MODEL_WINDOWS.find(([pattern]) => pattern.test(model))?.[1] ?? DEFAULT_MODEL_WINDOW_TOKENS
}

/** Builds the latest-thread fill snapshot from one completed assistant turn. */
export function conversationContextUsage(
  provider: LlmProvider,
  model: string,
  meta: TurnMeta,
  measuredAt: number
): ConversationContextUsage | undefined {
  const usedTokens = provider === 'codex'
    ? meta.contextInputTokens
    : (meta.inputTokens ?? 0) + (meta.cacheReadTokens ?? 0) + (meta.cacheCreationTokens ?? 0)
  if (typeof usedTokens !== 'number' || !Number.isFinite(usedTokens) || usedTokens < 0) return undefined
  return { usedTokens, windowTokens: modelWindowTokens(model), provider, model, measuredAt }
}

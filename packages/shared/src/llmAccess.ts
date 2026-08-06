import { CLAUDE_MODELS, CODEX_MODELS, type LlmProvider } from './types'

/** A deny-list entry: '*' blocks an entire provider. No entries mean full access. */
export interface UserLlmAccess {
  provider: LlmProvider
  modelId: string
}

export function isProviderAllowed(access: UserLlmAccess[], provider: LlmProvider): boolean {
  return !access.some((entry) => entry.provider === provider && entry.modelId === '*')
}

export function isModelAllowedForUser(access: UserLlmAccess[], provider: LlmProvider, model: string): boolean {
  return isProviderAllowed(access, provider) && !access.some((entry) => entry.provider === provider && entry.modelId === model)
}

export function allowedModels(access: UserLlmAccess[], provider: LlmProvider): Array<{ id: string; label: string; hint?: string }> {
  const models = provider === 'claude' ? CLAUDE_MODELS : CODEX_MODELS
  return models.filter((model) => isModelAllowedForUser(access, provider, model.id))
}

export function clampModel(access: UserLlmAccess[], provider: LlmProvider, model: string): string | null {
  if (isModelAllowedForUser(access, provider, model)) return model
  return allowedModels(access, provider)[0]?.id ?? null
}

export function firstAllowedProvider(access: UserLlmAccess[]): LlmProvider | null {
  return (['claude', 'codex'] as LlmProvider[]).find((provider) => isProviderAllowed(access, provider) && allowedModels(access, provider).length > 0) ?? null
}

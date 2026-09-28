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

export interface ChatModelMenuItem {
  provider: LlmProvider
  id: string
  label: string
  current: boolean
}

export interface ChatModelMenu {
  state: 'new' | 'started'
  primary: ChatModelMenuItem[]
  catalogLabel: 'Модели' | 'Все модели'
  catalog: ChatModelMenuItem[]
  unavailable: boolean
}

/** Pure menu projection shared by every chat composer owner. */
export function chatModelMenu(input: {
  messageCount: number
  provider: LlmProvider
  model: string
  access: UserLlmAccess[]
}): ChatModelMenu {
  const item = (provider: LlmProvider, model: { id: string; label: string }): ChatModelMenuItem => ({
    provider,
    id: model.id,
    label: model.label,
    current: provider === input.provider && model.id === input.model
  })
  const codex = allowedModels(input.access, 'codex').map((model) => item('codex', model))
  const claude = allowedModels(input.access, 'claude').map((model) => item('claude', model))
  if (input.messageCount === 0) {
    return { state: 'new', primary: codex, catalogLabel: 'Модели', catalog: claude, unavailable: codex.length + claude.length === 0 }
  }
  const currentAllowed = isModelAllowedForUser(input.access, input.provider, input.model)
  const current = item(input.provider, { id: input.model, label: input.model })
  const full = [...codex, ...claude]
  if (currentAllowed && !full.some((entry) => entry.provider === current.provider && entry.id === current.id)) full.unshift(current)
  return {
    state: 'started',
    primary: currentAllowed ? [current] : [],
    catalogLabel: 'Все модели',
    catalog: full,
    unavailable: full.length === 0
  }
}

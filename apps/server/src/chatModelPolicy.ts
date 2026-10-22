import { CLAUDE_MODELS, CODEX_MODELS, clampModel, isModelAllowedForUser, type LlmProvider, type UserLlmAccess } from '@voicechat/shared'

export interface ChatModelSelection { provider: LlmProvider; model: string }
export type ChatModelPolicy = readonly ChatModelSelection[]
const catalog = { claude: CLAUDE_MODELS, codex: CODEX_MODELS }

export function parseChatModelPolicy(value: string | undefined): ChatModelPolicy | undefined {
  if (value === undefined) return undefined
  const result: ChatModelSelection[] = []
  for (const entry of value.split(',')) {
    const [provider, model, extra] = entry.trim().split(':')
    if (extra !== undefined || (provider !== 'claude' && provider !== 'codex')
      || !catalog[provider].some(item => item.id === model)) throw Error('Invalid VC_CHAT_MODELS')
    if (!result.some(item => item.provider === provider && item.model === model)) result.push({ provider, model })
  }
  return result
}

/** Preserve user restrictions while narrowing the deployment's model catalog. */
export function deploymentModelAccess(access: UserLlmAccess[], policy?: ChatModelPolicy): UserLlmAccess[] {
  if (!policy) return access
  const result = [...access]
  for (const provider of ['claude', 'codex'] as const) {
    const enabled = policy.filter(item => item.provider === provider)
    if (!enabled.length) result.push({ provider, modelId: '*' })
    else for (const model of catalog[provider]) {
      if (!enabled.some(item => item.model === model.id)) result.push({ provider, modelId: model.id })
    }
  }
  return result.filter((entry, i) => result.findIndex(item => item.provider === entry.provider && item.modelId === entry.modelId) === i)
}

/** Unknown or stale requested IDs cannot escape an explicit deployment allowlist. */
export function deploymentModel(access: UserLlmAccess[], provider: LlmProvider, requested: string, policy?: ChatModelPolicy): string | null {
  if (!policy) return clampModel(access, provider, requested)
  const allowed = policy.filter(item => item.provider === provider && isModelAllowedForUser(access, provider, item.model))
  return allowed.find(item => item.model === requested)?.model ?? allowed[0]?.model ?? null
}

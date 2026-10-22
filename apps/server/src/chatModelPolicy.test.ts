import { describe, expect, it } from 'vitest'
import { allowedModels } from '@voicechat/shared'
import { deploymentModel, deploymentModelAccess, parseChatModelPolicy } from './chatModelPolicy.js'
import { loadConfig } from './config.js'

const selection = 'codex:gpt-5.6-luna,codex:gpt-5.6-terra,codex:gpt-5.6-sol'
const policy = parseChatModelPolicy(selection)!

describe('deployment model selection', () => {
  it('exposes only the configured Codex catalog and picks the first allowed default', () => {
    const access = deploymentModelAccess([], policy)
    expect(allowedModels(access, 'claude')).toEqual([])
    expect(allowedModels(access, 'codex').map(item => item.id).sort()).toEqual(policy.map(item => item.model).sort())
    expect(deploymentModel(access, 'codex', 'arbitrary-provider-model', policy)).toBe('gpt-5.6-luna')
    expect(deploymentModel(access, 'claude', 'sonnet', policy)).toBeNull()
    expect(deploymentModel(access, 'codex', 'gpt-5.6-sol', policy)).toBe('gpt-5.6-sol')
  })

  it('cannot restore a model or provider revoked for the user', () => {
    expect(deploymentModel(deploymentModelAccess([{ provider: 'codex', modelId: 'gpt-5.6-luna' }], policy),
      'codex', 'gpt-5.6-luna', policy)).toBe('gpt-5.6-terra')
    expect(deploymentModel(deploymentModelAccess([{ provider: 'codex', modelId: '*' }], policy), 'codex', 'gpt-5.6-sol', policy)).toBeNull()
  })

  it('preserves the legacy catalog when no selector is supplied', () => {
    expect(parseChatModelPolicy(undefined)).toBeUndefined()
    expect(loadConfig({ VC_CHAT_MODELS: '' }).chatModels).toBeUndefined()
    expect(deploymentModel([], 'codex', 'legacy-custom-model')).toBe('legacy-custom-model')
  })

  it.each(['', '*', 'codex:unknown', 'other:gpt-5.6-luna', 'codex:gpt-5.6-luna:extra'])('fails startup on invalid selector %j', value => {
    expect(() => parseChatModelPolicy(value)).toThrow('Invalid VC_CHAT_MODELS')
  })

  it('loads the selector through the real server configuration', () => {
    expect(loadConfig({ VC_CHAT_MODELS: selection }).chatModels).toEqual(policy)
    expect(loadConfig({ VC_CHAT_TEXT_ONLY: 'true' }).chatTextOnly).toBe(true)
    expect(loadConfig({}).chatTextOnly).toBe(false)
  })
})

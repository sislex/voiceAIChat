import { expect, it, vi } from 'vitest'
import { allowedModels, type Settings } from '@voicechat/shared'
import { setupRestHarness } from './restHarness.js'
import { createTurnManager } from '../turns.js'
import { parseChatModelPolicy } from '../chatModelPolicy.js'
import type { LlmClient, LlmRequest } from '../claude/types.js'

const selection = 'codex:gpt-5.6-luna,codex:gpt-5.6-terra,codex:gpt-5.6-sol'
const harness = setupRestHarness({ env: { VC_CHAT_MODELS: selection } })

async function firstTurn(conversationId?: string) {
  const { db, U } = harness
  const requests: LlmRequest[] = []
  const codex: LlmClient = { send(request, handlers) {
    requests.push(request)
    handlers.onDone('Synthetic answer')
    return { cancel() {} }
  } }
  const claude: LlmClient = { send: vi.fn(() => { throw Error('Unexpected Claude dispatch') }) }
  const engineClient = vi.fn(() => codex)
  const turns = createTurnManager({ db, claude, codex, engineClient,
    chatModels: parseChatModelPolicy(selection), chatTextOnly: true })
  const conversation = conversationId ?? (await db.chat.createConversation(U, 'First public turn')).id
  await turns.start({ userId: U, conversationId: conversation, segments: [{ speakerId: 1, text: 'Hello' }] })
  await turns.idle()
  return { requests, engineClient }
}

it('exposes deployment restrictions on both personal access endpoints and in the context inspector', async () => {
  const { db, inj, U } = harness
  await db.identity.setUserLlmAccess(U, [{ provider: 'codex', modelId: 'gpt-5.6-luna' }])
  for (const url of ['/api/llm-access', '/api/me/llm-access']) {
    const response = await inj({ method: 'GET', url })
    expect(response.statusCode).toBe(200)
    expect(allowedModels(response.json(), 'claude')).toEqual([])
    expect(allowedModels(response.json(), 'codex').map(model => model.id).sort()).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra'])
  }
  const conversation = await db.chat.createConversation(U, 'Public chat')
  const snapshot = await inj({ method: 'GET', url: `/api/conversations/${conversation.id}/context-snapshot` })
  expect(snapshot.statusCode).toBe(200)
  expect(snapshot.json().summary).toMatchObject({ provider: 'codex', model: 'gpt-5.6-terra' })
})

it('returns the first-turn deployment model for a fresh account without writing its preferences', async () => {
  const { db, inj, U } = harness
  const stored = await db.settings.getSettings(U)
  expect(stored.llmProvider).toBe('claude')
  const response = await inj({ method: 'GET', url: '/api/settings' })
  expect(response.statusCode).toBe(200)
  expect(response.json()).toEqual({ ...stored, llmProvider: 'codex', codexModel: 'gpt-5.6-luna' })
  expect(await db.settings.getSettings(U)).toEqual(stored)
  const { requests } = await firstTurn()
  expect(requests).toHaveLength(1)
  expect(requests[0]?.model).toBe(response.json().codexModel)
})

it('projects PUT responses while persisting only the submitted preference patch', async () => {
  const { db, inj, U } = harness
  const stored = await db.settings.getSettings(U)
  const changed = await inj({ method: 'PUT', url: '/api/settings', payload: { theme: 'dark' } })
  expect(changed.statusCode).toBe(200)
  expect(changed.json()).toEqual({ ...stored, theme: 'dark', llmProvider: 'codex', codexModel: 'gpt-5.6-luna' })
  expect(await db.settings.getSettings(U)).toEqual({ ...stored, theme: 'dark' })

  const selected = await inj({ method: 'PUT', url: '/api/settings', payload: { llmProvider: 'codex', codexModel: 'gpt-5.6-sol' } })
  expect(selected.statusCode).toBe(200)
  expect(selected.json()).toMatchObject({ llmProvider: 'codex', codexModel: 'gpt-5.6-sol', theme: 'dark' })
  expect(await db.settings.getSettings(U)).toMatchObject({ llmProvider: 'codex', codexModel: 'gpt-5.6-sol', theme: 'dark' })
  expect((await firstTurn()).requests[0]?.model).toBe('gpt-5.6-sol')
})

it('uses current user revocations and deployment order without persisting the projected model', async () => {
  const { db, inj, U } = harness
  const stored = await db.settings.getSettings(U)
  await db.identity.setUserLlmAccess(U, [{ provider: 'codex', modelId: 'gpt-5.6-luna' }])
  expect((await inj({ method: 'GET', url: '/api/settings' })).json()).toMatchObject({ llmProvider: 'codex', codexModel: 'gpt-5.6-terra' })
  await db.identity.setUserLlmAccess(U, [
    { provider: 'codex', modelId: 'gpt-5.6-luna' }, { provider: 'codex', modelId: 'gpt-5.6-terra' }
  ])
  expect((await inj({ method: 'GET', url: '/api/settings' })).json()).toMatchObject({ llmProvider: 'codex', codexModel: 'gpt-5.6-sol' })
  expect((await firstTurn()).requests[0]?.model).toBe('gpt-5.6-sol')
  expect(await db.settings.getSettings(U)).toEqual(stored)
})

it('does not invent an executable selection when the user has no allowed models', async () => {
  const { db, inj, U } = harness
  await db.identity.setUserLlmAccess(U, [{ provider: 'codex', modelId: '*' }])
  const stored = await db.settings.getSettings(U)
  expect((await inj({ method: 'GET', url: '/api/settings' })).json()).toEqual(stored)
  const access = (await inj({ method: 'GET', url: '/api/llm-access' })).json()
  expect(allowedModels(access, 'claude')).toEqual([])
  expect(allowedModels(access, 'codex')).toEqual([])
  expect((await firstTurn()).requests).toEqual([])
})

it.each(['allowed', 'wrong-provider', 'wrong-role'] as const)('preserves an explicit %s engine preference while the first turn resolves transport separately', async scenario => {
  const { db, inj, U } = harness
  const engine = await db.llm.createLlmEngine({ name: 'Preferred transport', kind: scenario === 'wrong-provider' ? 'claude' : 'codex',
    baseUrl: 'http://synthetic.invalid', token: 'synthetic', enabled: true, allowedRoles: scenario === 'wrong-role' ? ['tester'] : ['admin'], isDefault: false })
  const fallback = await db.llm.createLlmEngine({ name: 'Default Codex transport', kind: 'codex',
    baseUrl: 'http://synthetic.invalid', token: 'synthetic', enabled: true, allowedRoles: ['admin'], isDefault: true })
  const stored = { ...await db.settings.getSettings(U), llmEngineId: engine.id }
  await db.settings.saveSettings(U, stored)
  const response = (await inj({ method: 'GET', url: '/api/settings' })).json<Settings>()
  expect(response).toEqual({ ...stored, llmProvider: 'codex', codexModel: 'gpt-5.6-luna' })
  const { requests, engineClient } = await firstTurn()
  expect(engineClient).toHaveBeenCalledWith(expect.objectContaining({ id: scenario === 'allowed' ? engine.id : fallback.id, kind: 'codex' }))
  expect(requests[0]?.model).toBe(response.codexModel)
  expect(await db.settings.getSettings(U)).toEqual(stored)
})

it.each([
  ['codex', 'gpt-5.6-terra', 'gpt-5.6-terra'],
  ['codex', 'gpt-6-astra', 'gpt-5.6-luna'],
  ['claude', 'sonnet', 'gpt-5.6-sol']
] as const)('keeps conversation override %s/%s independent of the effective account default', async (provider, requested, expected) => {
  const { db, inj, U } = harness
  await db.settings.saveSettings(U, { ...await db.settings.getSettings(U), llmProvider: 'codex', codexModel: 'gpt-5.6-sol' })
  const conversation = await db.chat.createConversation(U, 'Override')
  await db.chat.setConversationExecTarget(U, conversation.id, null, undefined, undefined, provider, requested)
  const account = (await inj({ method: 'GET', url: '/api/settings' })).json()
  expect(account).toMatchObject({ llmProvider: 'codex', codexModel: 'gpt-5.6-sol' })
  const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${conversation.id}/context-snapshot` })).json()
  expect(snapshot.summary).toMatchObject({ provider: 'codex', model: expected })
  expect((await firstTurn(conversation.id)).requests[0]?.model).toBe(expected)
  expect(await db.chat.getConversation(U, conversation.id)).toMatchObject({ llmProvider: provider, llmModel: requested })
  expect(await db.settings.getSettings(U)).toEqual(account)
})

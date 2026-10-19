import { expect, it } from 'vitest'
import { allowedModels } from '@voicechat/shared'
import { setupRestHarness } from './restHarness.js'

const harness = setupRestHarness({ env: { VC_CHAT_MODELS: 'codex:gpt-5.6-luna,codex:gpt-5.6-terra,codex:gpt-5.6-sol' } })

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

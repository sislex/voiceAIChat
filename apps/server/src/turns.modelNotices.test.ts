import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LlmProvider, ServerMessage } from '@voicechat/shared'
import type { LlmClient } from './claude/types.js'
import { VoiceChatDb } from './db/database.js'
import { createTurnManager, type TurnManagerDeps } from './turns.js'

const user = 'model-notices'
const policy = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'].map(model => ({ provider: 'codex' as const, model }))
let db: VoiceChatDb
let conversationId: string
beforeEach(async () => {
  db = new VoiceChatDb(':memory:')
  await db.identity.createUser(user, '', 'admin')
  conversationId = (await db.chat.createConversation(user, 'Model policy')).id
})
afterEach(async () => { await db.close() })

async function reply(options: Partial<TurnManagerDeps> = {}) {
  const completions: Promise<void>[] = []
  const send = vi.fn<LlmClient['send']>((_request, handlers) => {
    handlers.onDelta('Synthetic answer')
    completions.push(Promise.resolve(handlers.onDone('Synthetic answer')))
    return { cancel() {} }
  })
  const turns = createTurnManager({ db, claude: { send }, codex: { send }, chatModels: policy, ...options })
  const frames: ServerMessage[] = []
  turns.subscribe(frame => { frames.push(frame) })
  await turns.start({ userId: user, conversationId, segments: [{ speakerId: 1, text: 'Hello' }] })
  await Promise.all(completions)
  await turns.idle()
  expect(frames.filter(frame => frame.t === 'claude.error')).toEqual([])
  expect(frames.filter(frame => frame.t === 'claude.done')).toHaveLength(1)
  expect(send).toHaveBeenCalledOnce()
  const answers = (await db.chat.listMessages(user, conversationId)).filter(message => message.role === 'ai')
  expect(answers).toHaveLength(1)
  return { request: send.mock.calls[0]![0], text: answers[0]!.text }
}

async function select(provider: LlmProvider, model: string | null) {
  await db.chat.setConversationExecTarget(user, conversationId, null, undefined, undefined, provider, model)
}

it.each(['claude', 'codex'] as const)('projects an inherited %s account default without adding a warning to the answer', async llmProvider => {
  const settings = { ...await db.settings.getSettings(user), llmProvider, codexModel: 'gpt-6-astra' }
  await db.settings.saveSettings(user, settings)
  const result = await reply()
  expect(result.request.model).toBe('gpt-5.6-luna')
  expect(result.text).toBe('Synthetic answer')
  expect(await db.settings.getSettings(user)).toMatchObject(settings)
  expect(await db.chat.getConversation(user, conversationId)).toMatchObject({ llmProvider: null, llmModel: null })
})

it('does not warn about an inherited model when only the conversation provider was selected', async () => {
  await select('codex', null)
  const result = await reply()
  expect(result.request.model).toBe('gpt-5.6-luna')
  expect(result.text).toBe('Synthetic answer')
})

it('retains a warning for a substituted explicit conversation model', async () => {
  await select('codex', 'gpt-6-astra')
  const result = await reply()
  expect(result.request.model).toBe('gpt-5.6-luna')
  expect(result.text).toContain('Модель «gpt-6-astra» недоступна')
  expect(await db.chat.getConversation(user, conversationId)).toMatchObject({ llmProvider: 'codex', llmModel: 'gpt-6-astra' })
})

it('retains a warning for a substituted explicit provider without warning about the inherited fallback model', async () => {
  await select('claude', 'sonnet')
  const result = await reply()
  expect(result.request.model).toBe('gpt-5.6-luna')
  expect(result.text).toContain('Движок «claude» недоступен')
  expect(result.text).not.toContain('Модель «')
})

it.each(['claude', 'codex'] as const)('retains the explicit %s project substitution warning', async provider => {
  const project = await db.projects.createProject(user, { name: 'Project choice', gitUrl: 'https://example.invalid/project.git' })
  await db.chat.setConversationProject(user, conversationId, project.id)
  await db.ci.setCiLlmConfig('project', project.id, { provider, model: provider === 'codex' ? 'gpt-6-astra' : 'sonnet',
    mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
  const result = await reply({ chatTextOnly: true })
  expect(result.request.model).toBe('gpt-5.6-luna')
  expect(result.text).toContain(provider === 'codex' ? 'Модель «gpt-6-astra» недоступна' : 'Движок «claude» недоступен')
})

it.each([undefined, true])('preserves ordinary account model revocation warnings without an explicit model policy (textOnly=%s)', async chatTextOnly => {
  await db.settings.saveSettings(user, { ...await db.settings.getSettings(user), llmProvider: 'codex', codexModel: 'gpt-6-astra' })
  await db.identity.setUserLlmAccess(user, [{ provider: 'codex', modelId: 'gpt-6-astra' }])
  const result = await reply({ chatModels: undefined, chatTextOnly })
  expect(result.request.model).not.toBe('gpt-6-astra')
  expect(result.text).toContain('Модель «gpt-6-astra» недоступна')
})

it('retains transport substitution warnings under the deployment model policy', async () => {
  await db.settings.saveSettings(user, { ...await db.settings.getSettings(user), llmEngineId: 'removed-transport' })
  const result = await reply()
  expect(result.text).toContain('Исполнитель «removed-transport» недоступен')
  expect(result.text).not.toContain('Модель «')
  expect(result.text).not.toContain('Движок «')
})

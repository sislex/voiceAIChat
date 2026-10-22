import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_POLICY } from '@sislexa/agent-contracts'
import type { ServerMessage, UserRole } from '@voicechat/shared'
import type { LlmClient } from './claude/types.js'
import { VoiceChatDb } from './db/database.js'
import { createTurnManager, type StartTurnRequest, type TurnManagerDeps } from './turns.js'

const userId = 'public-user'
let db: VoiceChatDb
beforeEach(() => { db = new VoiceChatDb(':memory:') })
afterEach(async () => { await db.close() })

async function conversation(role: UserRole = 'developer') {
  await db.identity.createUser(userId, '', role)
  return db.chat.createConversation(userId, 'Public text chat')
}

async function projectTarget(conversationId: string) {
  const project = await db.projects.createProject(userId, { name: 'Saved project', gitUrl: 'https://example.invalid/project.git' })
  const machine = await db.machines.createAgent(userId, 'Saved machine')
  await db.machines.linkMachine(userId, project.id, machine.id)
  await db.machines.setProjectMachinePath(userId, project.id, machine.id, '/saved/project')
  await db.chat.setConversationProject(userId, conversationId, project.id)
  await db.chat.setConversationExecTarget(userId, conversationId, machine.id, '/saved/project')
  return { project, machine }
}

function manager(options: Partial<Omit<TurnManagerDeps, 'db' | 'claude'>> = {}) {
  const completions: Promise<void>[] = []
  const send = vi.fn<LlmClient['send']>((_request, handlers) => {
    handlers.onDelta('Synthetic answer')
    completions.push(Promise.resolve(handlers.onDone('Synthetic answer')))
    return { cancel() {} }
  })
  const agents = { isOnline: vi.fn(() => false), nameOf: () => 'Saved machine', policyOf: () => DEFAULT_AGENT_POLICY }
  const turns = createTurnManager({ db, claude: { send }, agents, mcpBaseUrl: 'http://synthetic.invalid/mcp', ...options })
  const frames: ServerMessage[] = []
  turns.subscribe(frame => { frames.push(frame) })
  return { send, agents, frames, async start(conversationId: string, overrides: Partial<StartTurnRequest> = {}) {
    await turns.start({ userId, conversationId, segments: [{ speakerId: 1, text: 'Hello' }], ...overrides })
    await Promise.all(completions)
    await turns.idle()
  } }
}

it.each(['developer', 'admin'] as const)('answers a text-only %s with no machine and no preliminary error', async role => {
  const chat = await conversation(role)
  const resolve = vi.spyOn(db.chat, 'resolveConversationMachine')
  const run = manager({ chatTextOnly: true })
  await run.start(chat.id)
  expect(run.frames.filter(frame => frame.t === 'claude.error')).toEqual([])
  expect(run.frames.filter(frame => frame.t === 'claude.start')).toEqual([expect.objectContaining({ execTarget: null })])
  expect(run.frames.filter(frame => frame.t === 'claude.done')).toHaveLength(1)
  expect(run.send).toHaveBeenCalledOnce()
  expect(run.send.mock.calls[0]?.[0]).toMatchObject({ textOnly: true, executionDisabled: true, permissionMode: 'plan' })
  expect(run.send.mock.calls[0]?.[0].remote).toBeUndefined()
  expect(resolve).not.toHaveBeenCalled()
  expect((await db.chat.listMessages(userId, chat.id)).filter(message => message.role === 'ai')).toHaveLength(1)
})

it('ignores a saved offline target for text-only chat without rewriting that preference', async () => {
  const chat = await conversation()
  const { machine } = await projectTarget(chat.id)
  const preflight = vi.fn(async () => { throw Error('Remote preflight must not run') })
  const run = manager({ chatTextOnly: true, ensureProjectMainCurrent: preflight })
  await run.start(chat.id)
  expect(run.frames.filter(frame => frame.t === 'claude.error')).toEqual([])
  expect(run.frames.filter(frame => frame.t === 'claude.done')).toHaveLength(1)
  expect(run.send.mock.calls[0]?.[0]).toMatchObject({ textOnly: true, executionDisabled: true })
  expect(run.send.mock.calls[0]?.[0].remote).toBeUndefined()
  expect(preflight).not.toHaveBeenCalled()
  expect(run.agents.isOnline).not.toHaveBeenCalled()
  expect(await db.chat.getConversation(userId, chat.id)).toMatchObject({ execTarget: machine.id, workdir: '/saved/project' })
})

it('skips Git preflight and remote preparation even when a request selects an online machine', async () => {
  const chat = await conversation()
  const { machine } = await projectTarget(chat.id)
  const preflight = vi.fn(async () => { throw Error('Remote preflight must not run') })
  const run = manager({ chatTextOnly: true, ensureProjectMainCurrent: preflight })
  run.agents.isOnline.mockReturnValue(true)
  await run.start(chat.id, { execTarget: machine.id })
  expect(run.frames.filter(frame => frame.t === 'claude.error')).toEqual([])
  expect(run.frames.filter(frame => frame.t === 'claude.start')).toEqual([expect.objectContaining({ execTarget: null })])
  expect(run.send.mock.calls[0]?.[0]).toMatchObject({ textOnly: true, executionDisabled: true, readOnlyRemote: false })
  expect(run.send.mock.calls[0]?.[0].remote).toBeUndefined()
  expect(preflight).not.toHaveBeenCalled()
  expect(run.agents.isOnline).not.toHaveBeenCalled()
})

it('preserves the ordinary non-admin warning without a machine', async () => {
  const chat = await conversation()
  const run = manager()
  await run.start(chat.id)
  const error = run.frames.findIndex(frame => frame.t === 'claude.error')
  expect(run.frames[error]).toMatchObject({ message: 'Нет доступной online-машины: remote-команды заблокированы' })
  expect(error).toBeLessThan(run.frames.findIndex(frame => frame.t === 'claude.start'))
  expect(run.send).toHaveBeenCalledOnce()
  expect(run.send.mock.calls[0]?.[0].textOnly).toBeUndefined()
})

it.each([undefined, false])('preserves offline denial with server policy %s despite forged request flags', async chatTextOnly => {
  const chat = await conversation()
  await projectTarget(chat.id)
  const run = manager({ chatTextOnly })
  // Unknown request fields cannot opt into a trusted deployment policy.
  const forged = { textOnly: true, chatTextOnly: true } as unknown as Partial<StartTurnRequest>
  await run.start(chat.id, forged)
  expect(run.frames.filter(frame => frame.t === 'claude.error')).toEqual([expect.objectContaining({ message: expect.stringContaining('offline') })])
  expect(run.frames.filter(frame => frame.t === 'claude.start')).toEqual([])
  expect(run.send).not.toHaveBeenCalled()
})

it('preserves ordinary project preflight refusal before model dispatch', async () => {
  const chat = await conversation()
  await projectTarget(chat.id)
  const preflight = vi.fn(async () => { throw Error('Synthetic dirty checkout') })
  const run = manager({ ensureProjectMainCurrent: preflight })
  run.agents.isOnline.mockReturnValue(true)
  await run.start(chat.id)
  expect(preflight).toHaveBeenCalledOnce()
  expect(run.frames.filter(frame => frame.t === 'claude.error')).toEqual([expect.objectContaining({ message: expect.stringContaining('Synthetic dirty checkout') })])
  expect(run.send).not.toHaveBeenCalled()
})

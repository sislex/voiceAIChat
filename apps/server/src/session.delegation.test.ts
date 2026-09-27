import { expect, it, vi } from 'vitest'
import type { ServerMessage } from '@voicechat/shared'
import { createSession, type SessionDeps } from './session.js'

it('delegated sockets subscribe only to conversation turns and never resume user queues', async () => {
  let turnSink: ((message: ServerMessage, ownerUserId: string) => void) | undefined
  const resumeQueues = vi.fn()
  const accountSubscribe = vi.fn(() => () => {})
  const handlers = createSession({
    delegation: { id: 'opaque', userId: 'alice', tenantId: 'tenant', applicationId: 'app', grantId: 'grant' },
    user: { name: 'alice', role: 'developer' },
    turns: {
      subscribe: vi.fn((sink: (message: ServerMessage, ownerUserId: string) => void) => { turnSink = sink; return () => {} }),
      resumeQueues
    },
    authStatus: { subscribe: accountSubscribe },
    agentsFeed: { list: vi.fn(), subscribe: accountSubscribe },
    frames: { subscribe: accountSubscribe },
    preview: { subscribe: accountSubscribe },
    make: { subscribe: accountSubscribe }
  } as unknown as SessionDeps)
  const send = vi.fn()

  await handlers.onOpen?.({ send, sendBinary: vi.fn() })
  expect(resumeQueues).not.toHaveBeenCalled()
  expect(accountSubscribe).not.toHaveBeenCalled()

  turnSink?.({ t: 'claude.token', conversationId: 'allowed', delta: 'ok' }, 'alice')
  turnSink?.({ t: 'claude.token', conversationId: 'other-user', delta: 'no' }, 'bob')
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'allowed' }))
})

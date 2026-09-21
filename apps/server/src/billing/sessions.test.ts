import { expect, it } from 'vitest'
import type { SessionUser } from '@voicechat/shared'
import { BillingSessions } from './sessions.js'

it('restores only the initiating session and keeps subject/tenant separate from login', () => {
  const sessions = new BillingSessions()
  const user: SessionUser = { name: 'login', role: 'developer', account: { userId: 'subject', tenantId: 'tenant', tariffId: 'standard', tariffRevision: 1, capabilities: ['chat.use'] } }
  const ref = sessions.register(user, 'sid', 'secret')!
  expect(ref).toEqual({ sid: 'sid', userId: 'subject', tenantId: 'tenant' })
  expect(sessions.authorization('login', ref)).toBe('Bearer secret')
  expect(sessions.authorization('other', ref)).toBeUndefined()
  expect(sessions.authorization('login', { ...ref, tenantId: 'foreign' })).toBeUndefined()
  sessions.revoke('login', 'sid')
  sessions.register(user, 'new-sid', 'new-secret')
  expect(sessions.authorization('login', ref)).toBeUndefined()
  sessions.register(user, 'sid', 'reconnected')
  expect(sessions.authorization('login', ref)).toBe('Bearer reconnected')
  expect(sessions.register({ name: 'login', role: 'developer' }, 'sid', 'invalid')).toBeUndefined()
})

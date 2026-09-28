import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CHAT_CONTRACT_ARTIFACT,
  CHAT_CONTRACT_ARTIFACT_SHA256,
  applyChatSettingsPatch,
  canonicalChatContractArtifact,
  createVerifiedChatApplicationContext,
  decideChatAccess,
  resolveChatReconnect
} from './chatContract'

function context() {
  return createVerifiedChatApplicationContext({
    version: 1,
    application: {
      version: 1,
      originApplicationId: 'app-origin',
      executorApplicationId: 'app-runtime',
      tokenId: 'token-audit',
      delegationId: 'delegation-1'
    },
    principal: { identityIssuer: 'identity', userId: 'user-1', tenantId: 'tenant-1', environmentId: 'prod' },
    sessionId: 'session-1',
    verifiedAt: 100,
    expiresAt: 200,
    permissions: ['chat:conversations:read', 'chat:turns:run'],
    capabilities: [{ id: 'chat.text', available: true }, { id: 'chat.tools', available: false, reason: 'not-granted' }],
    resources: { kind: 'application-owned' }
  }, 100)
}

describe('verified chat application context', () => {
  it('creates an immutable detached context from trusted verification output', () => {
    const value = context()
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.application)).toBe(true)
    expect(value.permissions).toEqual(['chat:conversations:read', 'chat:turns:run'])
  })

  it('rejects expired, spoofed cross-application and duplicate capability evidence', () => {
    expect(() => createVerifiedChatApplicationContext({ ...context(), expiresAt: 100 }, 100)).toThrow()
    expect(() => createVerifiedChatApplicationContext({
      ...context(), application: { ...context().application, delegationId: null }
    }, 100)).toThrow('requires delegation')
    expect(() => createVerifiedChatApplicationContext({
      ...context(), capabilities: [{ id: 'chat.text', available: true }, { id: 'chat.text', available: true }]
    }, 100)).toThrow('Invalid chat capabilities')
  })

  it('keeps permission, capability and resource denials independent', () => {
    const verified = context()
    expect(decideChatAccess({ context: verified, permission: 'chat:turns:run', capability: 'chat.text',
      conversation: { id: 'c1', originApplicationId: 'app-origin' }, now: 150 })).toEqual({ allowed: true })
    expect(decideChatAccess({ context: verified, permission: 'chat:turns:run', capability: 'chat.tools', now: 150 }))
      .toEqual({ allowed: false, reason: 'capability' })
    expect(decideChatAccess({ context: verified, permission: 'chat:settings:write', capability: 'chat.text', now: 150 }))
      .toEqual({ allowed: false, reason: 'permission' })
    expect(decideChatAccess({ context: verified, permission: 'chat:turns:run',
      conversation: { id: 'c2', originApplicationId: 'another-app' }, now: 150 }))
      .toEqual({ allowed: false, reason: 'resource' })
  })
})

describe('chat reconnect contract', () => {
  it('resumes only an available cursor under the newly verified scope', () => {
    expect(resolveChatReconnect({ requestedCursor: '002', replayableCursors: ['001', '002'], currentCursor: '005',
      scopeChanged: false, serverRestarted: false })).toEqual({ status: 'resumed', cursor: '005' })
    expect(resolveChatReconnect({ requestedCursor: '000', replayableCursors: ['001', '002'], currentCursor: '005',
      scopeChanged: false, serverRestarted: false })).toEqual({ status: 'resync-required', reason: 'cursor-expired' })
    expect(resolveChatReconnect({ requestedCursor: '002', currentCursor: '005', scopeChanged: true,
      serverRestarted: false })).toEqual({ status: 'resync-required', reason: 'scope-changed' })
  })
})

describe('chat settings adapter', () => {
  it('rejects device owners and malformed values received over an untyped transport', () => {
    const current = { version: 1 as const, revision: 0, account: {}, conversation: {}, device: {} }
    for (const invalid of [
      { owner: 'device', values: { micDeviceId: 'local' } },
      { owner: 'unknown', values: {} },
      { owner: 'account', values: null },
      { owner: 'account', values: [] }
    ]) {
      expect(() => applyChatSettingsPatch(current, { version: 1, expectedRevision: 0, ...invalid } as never)).toThrow()
    }
  })
  it('applies the owning scope atomically and returns the current snapshot on conflict', () => {
    const current = { version: 1 as const, revision: 4, account: { theme: 'dark' },
      conversation: { model: 'default' }, device: { micDeviceId: null } }
    expect(applyChatSettingsPatch(current, { version: 1, expectedRevision: 4, owner: 'conversation',
      values: { model: 'fast' } })).toMatchObject({ revision: 5, account: { theme: 'dark' }, conversation: { model: 'fast' } })
    expect(applyChatSettingsPatch(current, { version: 1, expectedRevision: 3, owner: 'account',
      values: { theme: 'light' } })).toEqual({ code: 'settings_revision_conflict', current })
    expect(() => applyChatSettingsPatch(current, { version: 1, expectedRevision: 4, owner: 'account',
      values: { micDeviceId: 'microphone' } })).toThrow('does not belong')
    expect(applyChatSettingsPatch(current, { version: 1, expectedRevision: 4, owner: 'account',
      values: { llmEngineId: 'core', chatInstructions: 'Be concise', voice: 'default' } }))
      .toMatchObject({ account: { llmEngineId: 'core', chatInstructions: 'Be concise', voice: 'default' } })
    expect(applyChatSettingsPatch(current, { version: 1, expectedRevision: 4, owner: 'conversation',
      values: { previewUrl: null, kbMode: 'project' } }))
      .toMatchObject({ conversation: { previewUrl: null, kbMode: 'project' } })
  })
})

// @testCase TC-REG-08
describe('immutable chat contract artifact', () => {
  it('publishes conversation groups, membership and archive-compatible version', () => {
    expect(CHAT_CONTRACT_ARTIFACT.contractVersion).toBe('1.1.0')
    expect(CHAT_CONTRACT_ARTIFACT.rest).toMatchObject({
      conversationGroups: '/api/conversation-groups',
      conversationGroup: '/api/conversation-groups/:groupId',
      conversationMembership: '/api/conversations/:conversationId/membership'
    })
  })
  it('is frozen and matches its published digest', () => {
    expect(Object.isFrozen(CHAT_CONTRACT_ARTIFACT)).toBe(true)
    expect(createHash('sha256').update(canonicalChatContractArtifact()).digest('hex')).toBe(CHAT_CONTRACT_ARTIFACT_SHA256)
  })
})

import { describe, expect, it } from 'vitest'
import { createChildPlatformOperationContext, createPlatformOperationContext, parsePlatformOperationContext } from './platformOperation'

const root = () => createPlatformOperationContext({
  userId: 'usr_123', identityIssuer: 'https://identity.example', actorClientId: 'make-local',
  billingAccountId: 'account_123', environmentId: 'development', originModuleId: 'make',
  projectId: 'project_123', operationId: 'op_1',
})

describe('platform operation attribution', () => {
  it('retains the user, payer, environment, and product through multiple service hops', () => {
    const make = root()
    const runtime = createChildPlatformOperationContext(make, 'op_2', 'runtime-local')
    const files = createChildPlatformOperationContext(runtime, 'op_3', 'files-local')
    expect(files).toEqual({
      ...make, actorClientId: 'files-local', operationId: 'op_3', parentOperationId: 'op_2',
    })
    expect(runtime).toMatchObject({ rootOperationId: 'op_1', parentOperationId: 'op_1' })
    expect(make).toMatchObject({ operationId: 'op_1', parentOperationId: null })
  })

  it('returns a defensive immutable copy of structurally valid metadata', () => {
    const input = { ...root() }
    const context = parsePlatformOperationContext(input)
    input.userId = 'another-user'
    expect(context.userId).toBe('usr_123')
    expect(Object.isFrozen(context)).toBe(true)
  })

  it('allows project-independent operations with an explicit null project', () => {
    expect(parsePlatformOperationContext({ ...root(), projectId: null }).projectId).toBeNull()
  })

  it.each([
    { version: 2 }, { userId: '' }, { userId: ' user ' }, { userId: 'a\nb' },
    { identityIssuer: null }, { actorClientId: 'x'.repeat(257) }, { billingAccountId: 42 },
    { environmentId: undefined }, { originModuleId: [] }, { projectId: undefined },
    { accessToken: 'must-not-travel-as-metadata' },
    { rootOperationId: 'different-root' }, { parentOperationId: 'op_1' },
  ])('rejects incomplete, unsupported, or inconsistent context: %j', (patch) => {
    expect(() => parsePlatformOperationContext({ ...root(), ...patch })).toThrow()
  })

  it.each([null, [], 'user'])('rejects non-object contexts: %j', (value) => {
    expect(() => parsePlatformOperationContext(value)).toThrow()
  })

  it('rejects reuse of the current or root operation ID for a child', () => {
    const child = createChildPlatformOperationContext(root(), 'op_2', 'runtime')
    expect(() => createChildPlatformOperationContext(child, 'op_2', 'files')).toThrow(/ancestry/)
    expect(() => createChildPlatformOperationContext(child, 'op_1', 'files')).toThrow(/ancestry/)
  })
})

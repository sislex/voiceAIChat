import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { parseLlmAccountingContext } from './llmAccounting'

it('requires complete safe accounting identifiers and copies trusted context', () => {
  const context = { operationId: 'op-1', reservationId: 'reservation-1', userId: 'subject-1',
    tenantId: 'tenant-1', environmentId: 'production', originModuleId: 'chat' }
  expect(parseLlmAccountingContext(context)).toEqual(context)
  expect(parseLlmAccountingContext(context)).not.toBe(context)
  for (const value of [null, [], {}, { ...context, userId: 'subject\n' },
    { ...context, tenantId: '../other' }, { ...context, token: 'secret' }]) {
    expect(() => parseLlmAccountingContext(value)).toThrow()
  }
})

it('retains application attribution in the executor context and rejects relabeling fields', () => {
  const context = { operationId: 'op', reservationId: 'reservation', userId: 'subject',
    tenantId: 'tenant', environmentId: 'production', originModuleId: 'chat' }
  const application = { version: 1, originApplicationId: 'external-editor', executorApplicationId: 'core',
    tokenId: null, delegationId: 'grant' }
  expect(parseLlmAccountingContext({ ...context, application })).toEqual({ ...context, application })
  for (const value of [{ ...application, delegationId: null }, { ...application, accessToken: randomUUID() },
    { ...application, tokenId: undefined }]) {
    expect(() => parseLlmAccountingContext({ ...context, application: value })).toThrow()
  }
})

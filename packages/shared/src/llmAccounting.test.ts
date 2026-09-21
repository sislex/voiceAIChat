import { expect, it } from 'vitest'
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

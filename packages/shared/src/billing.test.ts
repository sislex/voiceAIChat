import { expect, it } from 'vitest'
import { billingAmount, parseBillingPolicy, parseBillingPrincipal, BILLING_MAX_AMOUNT } from './billing'

it('distinguishes unlimited, zero and integer limits without accepting ambiguous money values', () => {
  expect(parseBillingPolicy({ monthlyMicroUsd: null, monthlyRequests: 0, maxConcurrent: 2 })).toEqual({ monthlyMicroUsd: null, monthlyRequests: 0, maxConcurrent: 2 })
  for (const n of [NaN, Infinity, -1, 0.1, '10', BILLING_MAX_AMOUNT + 1]) expect(billingAmount(n)).toBe(false)
  expect(billingAmount(BILLING_MAX_AMOUNT)).toBe(true)
  for (const p of [{}, { monthlyMicroUsd: 10, monthlyRequests: 1 }, { monthlyMicroUsd: null, monthlyRequests: null, maxConcurrent: null, role: 'admin' }]) expect(() => parseBillingPolicy(p)).toThrow()
})

it('copies a complete principal and rejects missing, forged-shape or extra authority fields', () => {
  const p = { userId: 'subject', tenantId: 'tenant', environmentId: 'production', actorClientId: 'core', originModuleId: 'chat' }
  expect(parseBillingPrincipal(p)).toEqual(p)
  expect(parseBillingPrincipal(p)).not.toBe(p)
  for (const v of [{ ...p, userId: '' }, { ...p, tenantId: undefined }, { ...p, admin: true }, { ...p, actorClientId: 'core\n' }]) expect(() => parseBillingPrincipal(v)).toThrow()
})

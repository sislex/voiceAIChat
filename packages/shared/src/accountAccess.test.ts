import { describe, expect, it } from 'vitest'
import { hasProductCapability, isProductCapability, PRODUCT_CAPABILITIES, validTariffPlanInput } from './accountAccess'

describe('tariff and system privilege boundaries', () => {
  it('allows only known product capabilities, never admin or component scopes', () => {
    for (const capability of PRODUCT_CAPABILITIES) expect(isProductCapability(capability)).toBe(true)
    for (const value of ['admin', 'users:manage', 'identity.store', 'make.service', {}, null]) expect(isProductCapability(value)).toBe(false)
    expect(hasProductCapability(undefined, 'make.use')).toBe(false)
    expect(hasProductCapability({ tenantId: 't', tariffId: 'p', tariffRevision: 1, capabilities: ['chat.use'] }, 'make.use')).toBe(false)
  })

  it('rejects privilege fields, duplicate capabilities and invalid revisions', () => {
    const input = { id: 'standard', name: 'Standard', capabilities: ['chat.use'] }
    expect(validTariffPlanInput(input)).toBe(true)
    expect(validTariffPlanInput({ ...input, capabilities: [] })).toBe(true)
    expect(validTariffPlanInput({ ...input, expectedRevision: 2 })).toBe(true)
    for (const extra of [{ role: 'admin' }, { capabilities: ['identity.store'] }, { capabilities: ['chat.use', 'chat.use'] }, { expectedRevision: 0 }, { expectedRevision: 1.5 }, { id: '../admin' }, { name: '   ' }]) {
      expect(validTariffPlanInput({ ...input, ...extra })).toBe(false)
    }
  })
})

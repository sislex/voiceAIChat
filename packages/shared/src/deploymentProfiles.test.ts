import { describe, it, expect } from 'vitest'
import { isEnterTicketRedeemResponse, isTicketDelegationToken, parseApplications, serializeApplications, validateCoreId } from './deploymentProfiles.js'
describe('deployment profiles', () => {
  it('defaults to all local, disables missing ids and round trips external applications', () => {
    expect(parseApplications().every(a => a.enabled && a.location === 'local')).toBe(true)
    expect(parseApplications('').every(a => !a.enabled)).toBe(true)
    const value = 'chat,make=https://make.example.org'
    expect(serializeApplications(parseApplications(value))).toBe(value)
    expect(parseApplications(value).find(a => a.id === 'projects')?.enabled).toBe(false)
    expect(parseApplications('storage=https://storage.example.org').find(a => a.id === 'storage')).toMatchObject({
      enabled: true, location: 'external', openUrl: '/applications/storage/open'
    })
  })
  it.each(['make,make', 'unknown', 'chat,', 'make=http://example.org', 'make=https://user:secret@example.org', 'make='])('rejects %s', value => expect(() => parseApplications(value)).toThrow())
  it.each(['a', '../core', 'UPPER', '-core', 'a'.repeat(64)])('rejects core %s', value => expect(() => validateCoreId(value)).toThrow())
  it('accepts the exact coreId boundaries', () => { expect(validateCoreId('ab')).toBe('ab'); expect(validateCoreId('a'.repeat(63))).toHaveLength(63) })
  it('validates the redeem response delegation against the session lifetime', () => {
    const token = 'sxd_' + 'a'.repeat(43)
    const response = { user: { name: 'alice', role: 'admin' }, tenantId: 't1', capabilities: ['chat.use'], expiresAt: 2000, delegation: { token, expiresAt: 2000 } }
    expect(isTicketDelegationToken(token)).toBe(true)
    expect(isTicketDelegationToken('sxd_short')).toBe(false)
    expect(isEnterTicketRedeemResponse(response, 1000)).toBe(true)
    expect(isEnterTicketRedeemResponse({ ...response, delegation: undefined }, 1000)).toBe(false)
    expect(isEnterTicketRedeemResponse({ ...response, delegation: { token, expiresAt: 3000 } }, 1000)).toBe(false)
    expect(isEnterTicketRedeemResponse({ ...response, delegation: { token: 'grant', expiresAt: 2000 } }, 1000)).toBe(false)
    expect(isEnterTicketRedeemResponse(response, 2000)).toBe(false)
  })
})

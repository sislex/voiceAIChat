import { describe, expect, it } from 'vitest'
import { initialVpnState, isVpnFresh, parseVpnChange, sanitizeVpnObservation, VPN_STALE_MS } from './vpn'
describe('VPN contract', () => {
  // @testCase TC-STATE
  it('validates modes, operation correlation, revisions and explicit LAN policy', () => {
    const change = { mode: 'client', gatewayId: 'gateway-1', allowLan: false, operationId: 'operation-1234', expectedRevision: 0 }
    expect(parseVpnChange(change)).toEqual(change)
    for (const patch of [{ mode: 'auto' }, { gatewayId: '../other' }, { expectedRevision: -1 }, { expectedRevision: 1.5 }, { allowLan: 1 }, { operationId: '' }]) {
      expect(parseVpnChange({ ...change, ...patch })).toBeNull()
    }
    expect(parseVpnChange({ ...change, mode: 'off' })).toBeNull()
    expect(initialVpnState().observed).toBeNull()
  })
  // @testCase TC-SECRETS
  it('drops raw diagnostics, credentials and authorization links', () => {
    const value = { observedAt: 1000, mode: 'unknown', error: 'https://login.tailscale.com/secret',
      raw: 'tskey-secret', authKey: 'tskey-secret', externalIp: 'tskey-secret', deviceId: 'https://login/secret' }
    const sanitized = sanitizeVpnObservation(value)
    expect(sanitized?.error).toBe('apply')
    expect(JSON.stringify(sanitized)).not.toContain('secret')
    expect(sanitizeVpnObservation({ ...value, mode: 'connected' })).toBeNull()
  })
  // @testCase TC-STATE
  it('does not treat absent, old or future observations as current', () => {
    const o = sanitizeVpnObservation({ observedAt: 1000, mode: 'off' })!
    expect(isVpnFresh(o, 1001)).toBe(true)
    expect(isVpnFresh(o, 1000 + VPN_STALE_MS)).toBe(false)
    expect(isVpnFresh(o, -10_000)).toBe(false)
    expect(isVpnFresh(null, 1000)).toBe(false)
  })
})

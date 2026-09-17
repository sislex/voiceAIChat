import { describe, expect, it } from 'vitest'
import { nftVpnRules, pfVpnRules, validateGuardConfig, type GuardConfig } from './firewall.js'
const config: GuardConfig = {
  interface: 'eth0', tunnelInterface: 'tailscale0', control: { hostname: 'chat.example.test', ip: '203.0.113.7', port: 443 },
  transport: [{ ip: '203.0.113.8', protocol: 'udp', port: 41641 }],
  lanCidrs: ['192.168.1.0/24'], gateway: '192.168.1.1'
}
describe('system firewall policy', () => {
  // @testCase TC-LINUX-SERVICES
  // Covers the narrow management exception only; inbound service routing needs a real-host test.
  it.each([false, true])('keeps management limited to its configured endpoint with LAN=%s', allowLan => {
    const rules = nftVpnRules(config, allowLan)
    const control = 'ip daddr 203.0.113.7 tcp dport 443 accept'
    expect(rules).toContain(control)
    expect(rules.indexOf('udp dport 53 drop')).toBeLessThan(rules.indexOf(control))
    expect(rules.indexOf('tcp dport { 53, 853 } drop')).toBeLessThan(rules.indexOf(control))
    expect(rules).not.toMatch(/ct state (established|related)/)
    expect(rules).not.toMatch(/oifname "eth0" accept/)
    expect(rules).not.toMatch(/(?:^|\n)\s*tcp dport 443 accept/)
    expect(rules).toContain('policy drop')
    expect(() => nftVpnRules({ ...config, control: { ...config.control, port: 53 } }, allowLan)).toThrow()
    expect(() => nftVpnRules({ ...config, control: { ...config.control, port: 853 } }, allowLan)).toThrow()
  })

  // @testCase TC-LINUX-SERVICES
  it.each([false, true])('restricts an IPv6 management endpoint without adding an inbound hook with LAN=%s', allowLan => {
    const rules = nftVpnRules({ ...config, control: { ...config.control, ip: '2001:db8::7', port: 8443 } }, allowLan)
    const control = 'ip6 daddr 2001:db8::7 tcp dport 8443 accept'
    expect(rules).toContain(control)
    expect(rules).not.toContain('ip daddr 2001:db8::7')
    expect(rules).not.toMatch(/hook (input|forward|prerouting)/)
    expect(rules).toContain('hook output priority -300; policy drop')
    expect(rules).not.toContain('flush ruleset')
    expect(rules.indexOf('tcp dport { 53, 853 } drop')).toBeLessThan(rules.indexOf(control))
    expect(rules.includes('oifname "eth0" ip daddr 192.168.1.0/24 accept')).toBe(allowLan)
  })
  // @testCase TC-STATE
  it('drops both address families and blocks direct DNS before any LAN exemption on Linux', () => {
    const rules = nftVpnRules(config, true)
    expect(rules).toContain('table inet chatai_vpn')
    expect(rules).toContain('policy drop')
    expect(rules.indexOf('udp dport 53 drop')).toBeLessThan(rules.indexOf('ip daddr 192.168.1.0/24'))
    expect(nftVpnRules(config, false)).not.toContain('192.168.1.0/24')
    expect(rules).not.toContain('ct state established')
    expect(rules).toContain('ip daddr 255.255.255.255 udp sport 68 udp dport 67')
  })
  // @testCase TC-STATE
  it('restricts macOS underlay exceptions and preserves protection without a reachable exit', () => {
    const rules = pfVpnRules({ ...config, interface: 'en0', tunnelInterface: 'utun5' }, false)
    expect(rules).toContain('to 203.0.113.7 port 443 no state')
    expect(rules).toContain('block drop out quick all')
    expect(rules).not.toContain('192.168.1.0/24')
    expect(rules).not.toContain('pass out quick on en0 all')
  })
  // @testCase TC-STATE
  it('rejects shell syntax, wildcard endpoints, direct DNS exemptions and public LAN ranges', () => {
    for (const change of [{ interface: 'eth0;reboot' }, { control: { ...config.control, ip: '0.0.0.0/0' } },
      { transport: [{ ip: '8.8.8.8', protocol: 'udp', port: 53 }] }, { lanCidrs: ['0.0.0.0/0'] }, { lanCidrs: ['8.8.8.0/24'] }]) {
      expect(() => validateGuardConfig({ ...config, ...change } as GuardConfig)).toThrow()
    }
  })
})

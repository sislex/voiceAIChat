import { describe, expect, it } from 'vitest'
import { nftVpnRules, pfVpnRules, validateGuardConfig, type GuardConfig } from './firewall.js'
const config: GuardConfig = {
  interface: 'eth0', tunnelInterface: 'tailscale0', control: { hostname: 'chat.example.test', ip: '203.0.113.7', port: 443 },
  transport: [{ ip: '203.0.113.8', protocol: 'udp', port: 41641 }],
  lanCidrs: ['192.168.1.0/24'], gateway: '192.168.1.1'
}
describe('system firewall policy', () => {
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

import { isIP } from 'node:net'
export interface GuardConfig {
  interface: string
  tunnelInterface: string
  control: { ip: string; hostname: string; port: number }
  transport: Array<{ ip: string; protocol: 'tcp' | 'udp'; port: number }>
  lanCidrs: string[]
  gateway: string
}
export function validateGuardConfig(config: GuardConfig): void {
  if (!config || !/^[a-zA-Z0-9]{1,20}$/.test(config.interface) || !/^(tailscale[0-9]+|utun[0-9]+)$/.test(config.tunnelInterface) ||
    config.interface === config.tunnelInterface || /^(lo|utun|tun|tap|tailscale)/.test(config.interface) ||
    !isIP(config.gateway) || !config.control || !isIP(config.control.ip) ||
    !/^[a-zA-Z0-9.-]{1,253}$/.test(config.control.hostname) ||
    !Number.isInteger(config.control.port) || config.control.port < 1 || config.control.port > 65535 ||
    !Array.isArray(config.transport) || config.transport.length > 64 ||
    config.transport.some(e => !isIP(e.ip) || !['tcp', 'udp'].includes(e.protocol) || !Number.isInteger(e.port) ||
      e.port < 1 || e.port > 65535 || [53, 853].includes(e.port)) ||
    !Array.isArray(config.lanCidrs) || config.lanCidrs.some(cidr => {
      const [address, prefix] = cidr.split('/')
      const n = Number(prefix)
      return isIP(address) !== 4 || !/^\d+$/.test(prefix ?? '') || n < 16 || n > 32 ||
        !(address.startsWith('10.') || address.startsWith('192.168.') || (address.startsWith('172.') && Number(address.split('.')[1]) >= 16 && Number(address.split('.')[1]) <= 31))
    })) throw new Error('invalid guard configuration')
  if ([53, 853].includes(config.control.port)) throw new Error('invalid control port')
}
/** Both address families default to drop. LAN permission never exempts DNS. */
export function nftVpnRules(config: GuardConfig, allowLan: boolean): string {
  validateGuardConfig(config)
  const family = isIP(config.control.ip) === 6 ? 'ip6' : 'ip'
  return [
    'table inet chatai_vpn {',
    ' chain output { type filter hook output priority -300; policy drop;',
    '  oifname "lo" accept',
    '  oifname "' + config.tunnelInterface + '" accept',
    '  udp dport 53 drop',
    '  tcp dport { 53, 853 } drop',
    '  ' + family + ' daddr ' + config.control.ip + ' tcp dport ' + config.control.port + ' accept',
    // Tailscaled marks only its underlay sockets; unprivileged applications cannot set SO_MARK.
    '  meta mark & 0xff0000 == 0x80000 accept',
    '  ip daddr 255.255.255.255 udp sport 68 udp dport 67 accept',
    '  ip6 daddr { fe80::/10, ff02::/16 } meta l4proto ipv6-icmp icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert, nd-router-solicit, nd-router-advert } ip6 hoplimit 255 accept',
    ...(allowLan ? config.lanCidrs.map(cidr => '  oifname "' + config.interface + '" ip daddr ' + cidr + ' accept') : []),
    ' }',
    '}'
  ].join('\n') + '\n'
}
export function pfVpnRules(config: GuardConfig, allowLan: boolean): string {
  validateGuardConfig(config)
  const control = { ...config.control, protocol: 'tcp' as const }
  return [
    'pass out quick on lo0 all',
    ...[control, ...config.transport].map(e => 'pass out quick route-to (' + config.interface + ' ' + config.gateway + ') ' +
      (isIP(e.ip) === 6 ? 'inet6' : 'inet') + ' proto ' + e.protocol + ' to ' + e.ip + ' port ' + e.port + ' no state'),
    'pass out quick on ' + config.tunnelInterface + ' all',
    'block drop out quick proto { tcp udp } to any port { 53 853 }',
    'pass out quick on ' + config.interface + ' inet proto udp from any port 68 to 255.255.255.255 port 67 no state',
    'pass out quick on ' + config.interface + ' inet6 proto icmp6 to { fe80::/10 ff02::/16 } icmp6-type { neighbrsol neighbradv routersol routeradv } no state',
    ...(allowLan ? config.lanCidrs.map(cidr => 'pass out quick on ' + config.interface + ' inet to ' + cidr + ' no state') : []),
    'block drop out quick all'
  ].join('\n') + '\n'
}

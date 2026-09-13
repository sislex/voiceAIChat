import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { VpnMode, VpnView } from '@voicechat/shared'
/**
 * Opt-in destructive network matrix. The default gate explicitly skips it.
 * VC_VPN_NETWORK_TESTS=1 requires a dedicated lab, SSH keys and passwordless
 * capture permissions. Tokens are read only from the environment.
 */
interface Host { id: string; ssh: string; interface: string; os: 'linux' | 'darwin'; lanUrl: string }
interface Lab { api: string; linux: Host; mac: Host; dnsName: string }
const enabled = process.env.VC_VPN_NETWORK_TESTS === '1'
const quote = (s: string): string => "'" + s.replace(/'/g, "'\"'\"'") + "'"
function ssh(host: Host, command: string): Promise<{ code: number | string | null; out: string }> {
  if (!/^[a-zA-Z0-9_.@-]+$/.test(host.ssh) || !/^[a-zA-Z0-9]+$/.test(host.interface)) throw new Error('Invalid lab host')
  return new Promise(resolve => execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host.ssh, command],
    { timeout: 25_000, maxBuffer: 64_000 }, (error, stdout) => resolve({ code: error?.code ?? 0, out: stdout.trim() })))
}
describe.skipIf(!enabled)('real Linux ↔ macOS VPN lab', () => {
  // @testCase TC-NETWORK
  it.each(['linux', 'mac'] as const)('routes and blocks direct IPv4, IPv6, DNS and LAN from %s', async clientName => {
    const lab = JSON.parse(process.env.VC_VPN_TEST_LAB ?? '{}') as Lab
    const token = process.env.VC_VPN_TEST_TOKEN
    if (!token || !lab.api?.startsWith('https://') || !lab.linux || !lab.mac || !/^[a-zA-Z0-9.-]+$/.test(lab.dnsName)) {
      throw new Error('Dedicated VPN lab configuration is required; see docs/kb/machines.md')
    }
    const client = lab[clientName], gateway = lab[clientName === 'linux' ? 'mac' : 'linux']
    async function api(id: string, body?: unknown): Promise<VpnView> {
      const response = await fetch(lab.api + '/api/agents/' + encodeURIComponent(id) + '/vpn', {
        method: body ? 'PUT' : 'GET', signal: AbortSignal.timeout(70_000),
        headers: { Authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (!response.ok) throw new Error('Lab VPN request rejected: ' + response.status)
      return response.json() as Promise<VpnView>
    }
    async function change(host: Host, mode: VpnMode, allowLan = false): Promise<void> {
      const before = await api(host.id)
      const after = await api(host.id, { mode, allowLan, gatewayId: mode === 'client' ? gateway.id : null,
        operationId: randomUUID(), expectedRevision: before.state.revision })
      expect(after.state.phase).toBe('idle')
      expect(after.state.error).toBeNull()
      expect(after.state.observed?.mode).toBe(mode)
    }
    const probe = (host: Host, family: 4 | 6, direct = false) => ssh(host,
      'curl --silent --fail --max-time 8 -' + family + (direct ? ' --interface ' + quote(host.interface) : '') +
      ' ' + quote(family === 4 ? 'https://api.ipify.org' : 'https://api6.ipify.org'))
    // Refuse to disturb machines already serving a user's active VPN session.
    for (const host of [client, gateway]) {
      const view = await api(host.id)
      expect(view.state.desired.mode).toBe('off')
      expect(view.state.observed?.mode).toBe('off')
    }
    await change(gateway, 'server')
    try {
      await change(client, 'client')
      for (const family of [4, 6] as const) {
        const exit = await probe(gateway, family), through = await probe(client, family)
        if (exit.code === 0) { expect(through.code).toBe(0); expect(through.out).toBe(exit.out) }
        else expect(through.code).not.toBe(0)
        expect((await probe(client, family, true)).code).not.toBe(0)
      }
      // Physical-interface capture distinguishes working DNS from DNS routed directly.
      const capture = ssh(client, 'sudo -n ' + (client.os === 'darwin' ? 'gtimeout' : 'timeout') +
        " 8 tcpdump -n -i " + quote(client.interface) + " -c 1 'port 53 or port 853'")
      await new Promise(resolve => setTimeout(resolve, 1000))
      const dns = await ssh(client, 'dig +tries=1 +time=3 ' + quote(randomUUID() + '.' + lab.dnsName))
      expect(dns.code).toBe(0)
      const captured = await capture
      expect(captured.code).toBe(124)
      expect(captured.out).toBe('')
      expect((await ssh(client, 'curl --silent --fail --max-time 5 ' + quote(client.lanUrl))).code).not.toBe(0)
      await change(client, 'client', true)
      expect((await ssh(client, 'curl --silent --fail --max-time 5 ' + quote(client.lanUrl))).code).toBe(0)
    } finally {
      // Explicit test teardown uses the same limited management channel.
      await change(client, 'off')
      await change(gateway, 'off')
    }
  }, 240_000)
})

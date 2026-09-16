import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { connect, isIP } from 'node:net'
import { compareVersions, sanitizeVpnObservation, type VpnAgentRequest, type VpnObservation } from '@voicechat/shared'
import { VpnController, unknownVpn, type VpnJournal, type VpnSystem } from './controller.js'

export type RunVpnCli = (args: string[]) => Promise<string>
interface GuardStatus { protected: boolean; recoveryReady: boolean; allowLan: boolean }
export interface VpnGuard {
  status(): Promise<GuardStatus>
  arm(allowLan: boolean): Promise<void>
  release(): Promise<void>
}
/** Privileged protection is isolated from exec and only accepts three operations.
 * An absent guard is a blocking preparation state, never an assumed kill switch.
 */
export class SocketVpnGuard implements VpnGuard {
  constructor(private readonly socketPath: string | undefined, private readonly serverUrl?: string, private readonly controlIp = process.env.VC_VPN_CONTROL_IP) {}
  private async call(action: 'status' | 'arm' | 'release', allowLan = false): Promise<GuardStatus> {
    if (!this.socketPath) throw new Error('guard')
    const info = await stat(this.socketPath)
    const directory = await stat(dirname(this.socketPath))
    if (!info.isSocket() || info.uid !== 0 || directory.uid !== 0 || (directory.mode & 0o022) !== 0) throw new Error('guard')
    return new Promise((resolve, reject) => {
      const socket = connect(this.socketPath!)
      let buffer = ''
      const fail = (): void => { socket.destroy(); reject(new Error('guard')) }
      socket.setTimeout(5_000, fail)
      socket.on('error', fail)
      socket.on('connect', () => socket.write(JSON.stringify({ version: 1, action, allowLan }) + '\n'))
      socket.on('data', chunk => {
        buffer += chunk.toString('utf8')
        if (buffer.length > 8192) { fail(); return }
        if (!buffer.includes('\n')) return
        try {
          const result = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))) as Record<string, unknown>
          if (result.version !== 1 || result.ok !== true || typeof result.protected !== 'boolean' ||
            typeof result.recoveryReady !== 'boolean' || typeof result.allowLan !== 'boolean') { fail(); return }
          socket.destroy()
          const control = result.control as { ip?: string; hostname?: string; port?: number } | undefined
          const server = this.serverUrl ? new URL(this.serverUrl) : null
          const matches = server?.protocol === 'wss:' && !process.env.VC_AGENT_INSECURE_TLS &&
            control?.ip === this.controlIp && control?.hostname === server.hostname &&
            control?.port === Number(server.port || 443)
          resolve({ protected: result.protected, recoveryReady: result.recoveryReady && !!matches, allowLan: result.allowLan })
        } catch { fail() }
      })
      socket.on('end', () => { if (!buffer.includes('\n')) fail() })
    })
  }
  status(): Promise<GuardStatus> { return this.call('status') }
  async arm(allowLan: boolean): Promise<void> {
    const status = await this.call('arm', allowLan)
    if (!status.protected || !status.recoveryReady || status.allowLan !== allowLan) throw new Error('guard')
  }
  async release(): Promise<void> {
    const status = await this.call('release')
    if (status.protected) throw new Error('guard')
  }
}
interface TailStatus {
  Version?: string; BackendState?: string; TUN?: boolean
  Self?: { ID?: string; TailscaleIPs?: string[]; ExitNodeOption?: boolean }
  CurrentTailnet?: { Name?: string }
  ExitNodeStatus?: { ID?: string; Online?: boolean }
  Peer?: Record<string, { ID?: string; Online?: boolean }>
}
interface TailPrefs { ExitNodeID?: string; ExitNodeAllowLANAccess?: boolean; AdvertiseRoutes?: string[]; CorpDNS?: boolean }
export interface VpnDnsBaseline { read(): Promise<boolean | null>; write(value: boolean | null): Promise<void> }
export class TailscaleSystem implements VpnSystem {
  constructor(private readonly run: RunVpnCli, private readonly guard: VpnGuard,
    private readonly platform = process.platform, private readonly externalIp: () => Promise<string | null> = async () => {
      try {
        const response = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(3_000), redirect: 'error' })
        const ip = (await response.text()).trim()
        return response.ok && /^[0-9.]{7,15}$/.test(ip) ? ip : null
      } catch { return null }
    }, private readonly dnsBaseline?: VpnDnsBaseline) {}
  async inspect(): Promise<VpnObservation> {
    if (!['linux', 'darwin'].includes(this.platform) || process.env.TERMUX_VERSION) return unknownVpn('unsupported')
    let status: TailStatus
    try { status = JSON.parse(await this.run(['status', '--json'])) as TailStatus }
    catch (e) { return unknownVpn((e as { code?: string }).code === 'ENOENT' ? 'not_installed' : 'service') }
    if (status.BackendState !== 'Running') return unknownVpn(status.BackendState === 'NeedsLogin' ? 'login' : 'service')
    if (!status.Version || compareVersions(status.Version, '1.88.0') < 0 || status.TUN === false) return unknownVpn('unsupported')
    let prefs: TailPrefs
    try { prefs = JSON.parse(await this.run(['debug', 'prefs'])) as TailPrefs } catch { return unknownVpn('permission') }
    let guard: GuardStatus = { protected: false, recoveryReady: false, allowLan: false }
    try { guard = await this.guard.status() } catch { /* Preparation remains explicit. */ }
    const client = !!prefs.ExitNodeID
    const server = prefs.AdvertiseRoutes?.includes('0.0.0.0/0') === true && prefs.AdvertiseRoutes.includes('::/0')
    let forwarding = true
    if (server && this.platform === 'linux') {
      try { forwarding = (await readFile('/proc/sys/net/ipv4/ip_forward', 'utf8')).trim() === '1' &&
        (await readFile('/proc/sys/net/ipv6/conf/all/forwarding', 'utf8')).trim() === '1' }
      catch { forwarding = false }
    }
    const gateway = status.ExitNodeStatus ?? Object.values(status.Peer ?? {}).find(p => p.ID === prefs.ExitNodeID)
    const observation: VpnObservation = { observedAt: Date.now(),
      mode: client && server ? 'unknown' : client ? 'client' : server ? 'server' : 'off',
      deviceId: status.Self?.ID ?? null, tailnet: status.CurrentTailnet?.Name ?? null,
      addresses: status.Self?.TailscaleIPs ?? [], gatewayDeviceId: prefs.ExitNodeID || null,
      gatewayOnline: client ? gateway?.Online ?? false : null, allowLan: prefs.ExitNodeAllowLANAccess === true,
      externalIp: null, protected: guard.protected, recoveryReady: guard.recoveryReady,
      error: !forwarding ? 'forwarding' : client && server ? 'conflict' : client && (!guard.protected || !guard.recoveryReady) ? 'guard' : null }
    // Never report a direct address as a successfully connected client's external IP.
    if (!client || (guard.protected && observation.gatewayOnline)) observation.externalIp = await this.externalIp()
    return sanitizeVpnObservation(observation) ?? unknownVpn('apply')
  }
  protect(allowLan: boolean): Promise<void> { return this.guard.arm(allowLan) }
  async set(request: Extract<VpnAgentRequest, { action: 'apply' }>): Promise<void> {
    const { desired, gatewayAddress } = request
    if (desired.mode === 'client' && (!gatewayAddress || !isIP(gatewayAddress))) throw new Error('invalid')
    let baseline = await this.dnsBaseline?.read() ?? null
    if (desired.mode === 'client' && baseline === null && this.dnsBaseline) {
      const prefs = JSON.parse(await this.run(['debug', 'prefs'])) as TailPrefs
      if (typeof prefs.CorpDNS !== 'boolean') throw new Error('permission')
      baseline = prefs.CorpDNS
      await this.dnsBaseline.write(baseline)
    }
    await this.run(['set', '--advertise-exit-node=' + String(desired.mode === 'server'),
      '--exit-node=' + (desired.mode === 'client' ? gatewayAddress : ''),
      '--exit-node-allow-lan-access=' + String(desired.mode === 'client' && desired.allowLan),
      ...(desired.mode === 'client' ? ['--accept-dns=true'] : baseline === null ? [] : ['--accept-dns=' + String(baseline)])])
  }
  async release(): Promise<void> {
    try {
      const status = await this.guard.status()
      if (status.protected) await this.guard.release()
    } catch (e) {
      // A missing helper is acceptable only when it was never installed.
      if (process.env.VC_VPN_GUARD_SOCKET) throw e
    }
    await this.dnsBaseline?.write(null)
  }
}
export function createSystemVpn(rootDir: string, serverUrl?: string): VpnController {
  const binary = process.platform === 'darwin' && existsSync('/Applications/Tailscale.app/Contents/MacOS/Tailscale')
    ? '/Applications/Tailscale.app/Contents/MacOS/Tailscale' : 'tailscale'
  const run: RunVpnCli = args => new Promise((resolve, reject) => {
    // Argument arrays intentionally avoid the general shell and its command logging.
    execFile(binary, args, { timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject({ code: error.code }) : resolve(stdout))
  })
  const path = join(rootDir, '.voicechat', 'vpn-operation.json')
  const journal: VpnJournal = {
    async read() { try { return JSON.parse(await readFile(path, 'utf8')) as Awaited<ReturnType<VpnJournal['read']>> }
      catch (e) { if ((e as { code?: string }).code === 'ENOENT') return null; throw new Error('journal') } },
    async write(entry) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeFile(path + '.tmp', JSON.stringify(entry), { mode: 0o600 })
      await rename(path + '.tmp', path)
    }
  }
  const dnsBaseline: VpnDnsBaseline = {
    async read() {
      try {
        const value: unknown = JSON.parse(await readFile(path + '.dns', 'utf8'))
        if (value !== null && typeof value !== 'boolean') throw new Error('invalid DNS baseline')
        return value
      } catch (e) { if ((e as { code?: string }).code === 'ENOENT') return null; throw e }
    },
    async write(value) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeFile(path + '.dns.tmp', JSON.stringify(value), { mode: 0o600 })
      await rename(path + '.dns.tmp', path + '.dns')
    }
  }
  return new VpnController(new TailscaleSystem(run, new SocketVpnGuard(process.env.VC_VPN_GUARD_SOCKET, serverUrl),
    process.platform, undefined, dnsBaseline), journal)
}

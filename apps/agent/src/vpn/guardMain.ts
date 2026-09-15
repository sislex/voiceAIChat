/**
 * Standalone privileged helper. Build separately and install as an OS service;
 * the regular agent never installs it or escalates privileges interactively.
 */
import { execFile, spawn } from 'node:child_process'
import { createServer, connect as connectSocket, isIP } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { readFile, writeFile, rename, mkdir, stat, chmod, chown, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { networkInterfaces } from 'node:os'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { nftVpnRules, pfVpnRules, validateGuardConfig, type GuardConfig } from './firewall.js'

interface Saved { active: boolean; allowLan: boolean; fingerprint: string | null }
const run = (binary: string, args: string[]): Promise<string> => new Promise((resolve, reject) =>
  execFile(binary, args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(new Error('system operation failed')) : resolve(stdout)))
const input = (binary: string, args: string[], data: string): Promise<void> => new Promise((resolve, reject) => {
  // Dedicated system binaries receive validated rules over stdin, never through a shell.
  const child = spawn(binary, args, { stdio: ['pipe', 'ignore', 'ignore'], timeout: 5000 })
  child.on('error', () => reject(new Error('system operation failed')))
  child.on('close', code => code === 0 ? resolve() : reject(new Error('system operation failed')))
  child.stdin.on('error', () => reject(new Error('system operation failed')))
  child.stdin.end(data)
})
export async function startVpnGuard(configPath: string): Promise<import('node:net').Server> {
  if (process.getuid?.() !== 0 || !['linux', 'darwin'].includes(process.platform)) throw new Error('root on Linux or macOS is required')
  const configStat = await stat(configPath)
  const parent = await stat(dirname(configPath))
  if (configStat.uid !== 0 || !configStat.isFile() || (configStat.mode & 0o022) || parent.uid !== 0 || (parent.mode & 0o022)) throw new Error('root-owned protected configuration is required')
  const config = JSON.parse(await readFile(configPath, 'utf8')) as GuardConfig
  validateGuardConfig(config)
  const linux = process.platform === 'linux'
  if (!linux && [config.control, ...config.transport].some(e => isIP(e.ip) !== isIP(config.gateway))) throw new Error('transport address family requires a matching gateway')
  const directory = join(dirname(configPath), 'runtime')
  await mkdir(directory, { recursive: true, mode: 0o750 })
  await chown(directory, 0, configStat.gid)
  const statePath = join(directory, 'state.json')
  const socketPath = join(directory, 'guard.sock')
  let state: Saved = { active: false, allowLan: false, fingerprint: null }
  try { state = JSON.parse(await readFile(statePath, 'utf8')) as Saved }
  catch (e) { if ((e as { code?: string }).code !== 'ENOENT') throw new Error('guard journal unavailable') }
  async function save(): Promise<void> {
    await writeFile(statePath + '.tmp', JSON.stringify(state), { mode: 0o600 })
    await rename(statePath + '.tmp', statePath)
  }
  async function prerequisites(): Promise<void> {
    const binary = !linux && existsSync('/Applications/Tailscale.app/Contents/MacOS/Tailscale')
      ? '/Applications/Tailscale.app/Contents/MacOS/Tailscale' : 'tailscale'
    const tail = JSON.parse(await run(binary, ['status', '--json'])) as { BackendState?: string; TUN?: boolean; Self?: { TailscaleIPs?: string[] } }
    const addresses = networkInterfaces()[config.tunnelInterface] ?? []
    if (tail.BackendState !== 'Running' || tail.TUN === false ||
      !tail.Self?.TailscaleIPs?.some(ip => addresses.some(a => a.address === ip))) throw new Error('configured tunnel is not the authenticated Tailscale interface')
    if (linux) {
      const family = isIP(config.control.ip) === 6 ? '-6' : '-4'
      const rules = JSON.parse(await run('ip', [family, '-json', 'rule', 'show'])) as Array<{ priority: number; dst?: string; table?: string | number }>
      const current = rules.filter(r => r.priority === 5100)
      const cidr = config.control.ip + (family === '-6' ? '/128' : '/32')
      if (current.length && !current.every(r => (r.dst === config.control.ip || r.dst === cidr) && (r.table === 'main' || r.table === 254))) throw new Error('control routing priority is occupied')
      if (!current.length) await run('ip', [family, 'rule', 'add', 'priority', '5100', 'to', cidr, 'lookup', 'main'])
      const routes = JSON.parse(await run('ip', [family, '-json', 'route', 'get', config.control.ip])) as Array<{ dev?: string }>
      if (routes[0]?.dev !== config.interface) throw new Error('control channel has no physical route')
    } else {
      const rootRules = await run('pfctl', ['-sr'])
      const conf = await readFile('/etc/pf.conf', 'utf8')
      if (!/^anchor "chatai-vpn"/.test(rootRules.trim()) || conf.split('\n').some(line =>
        /^\s*set\s+skip\s+on\s+/.test(line) && !/^\s*set\s+skip\s+on\s+lo0\s*(#.*)?$/.test(line))) {
        throw new Error('first PF filter rule must be the chatai-vpn anchor; only lo0 may skip filtering')
      }
      if (!(await run('pfctl', ['-si'])).includes('Status: Enabled')) throw new Error('enable system packet filtering first')
    }
  }
  async function snapshot(): Promise<string> {
    return linux ? await run('nft', ['--stateless', 'list', 'table', 'inet', 'chatai_vpn']) :
      await run('pfctl', ['-a', 'chatai-vpn', '-sr'])
  }
  async function protectedNow(): Promise<boolean> {
    if (!state.active || !state.fingerprint) return false
    try { await prerequisites(); return (await snapshot()) === state.fingerprint } catch { return false }
  }
  async function probe(): Promise<boolean> {
    try { await prerequisites() } catch { return false }
    return new Promise(resolve => {
      const socket = tlsConnect({ host: config.control.ip, servername: config.control.hostname,
        port: config.control.port, rejectUnauthorized: true })
      socket.setTimeout(3000, () => { socket.destroy(); resolve(false) })
      socket.on('error', () => { socket.destroy(); resolve(false) })
      socket.on('secureConnect', () => { socket.destroy(); resolve(true) })
    })
  }
  async function arm(allowLan: boolean): Promise<void> {
    await prerequisites()
    state = { active: true, allowLan, fingerprint: null }
    await save()
    if (linux) {
      let present = false
      try { await snapshot(); present = true } catch { /* A first activation has no table. */ }
      const rules = (present ? 'delete table inet chatai_vpn\n' : '') + nftVpnRules(config, allowLan)
      await input('nft', ['--check', '-f', '-'], rules)
      await input('nft', ['-f', '-'], rules)
    } else {
      const rules = pfVpnRules(config, allowLan)
      await input('pfctl', ['-n', '-a', 'chatai-vpn', '-f', '-'], rules)
      await input('pfctl', ['-a', 'chatai-vpn', '-f', '-'], rules)
      // Existing PF states would bypass new filter rules. The UI warns of this disconnect.
      await run('pfctl', ['-k', '0.0.0.0/0'])
      await run('pfctl', ['-k', '::/0'])
    }
    state.fingerprint = await snapshot()
    await save()
  }
  async function release(): Promise<void> {
    // Only an explicit, locally authorized socket operation reaches this path.
    if (state.active) {
      if (linux) await run('nft', ['delete', 'table', 'inet', 'chatai_vpn'])
      else await run('pfctl', ['-a', 'chatai-vpn', '-F', 'rules'])
    }
    state = { active: false, allowLan: false, fingerprint: null }
    await save()
  }
  // Reapply intent before accepting management operations. Crashes never disarm.
  if (state.active) await arm(state.allowLan)
  await prerequisites()
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const task = queue.then(fn); queue = task.catch(() => undefined); return task
  }
  const server = createServer(socket => {
    let buffer = '', consumed = false
    socket.setTimeout(5000, () => socket.destroy())
    socket.on('error', () => socket.destroy())
    socket.on('data', chunk => {
      if (consumed) return
      buffer += chunk.toString('utf8')
      if (buffer.length > 1024) { socket.destroy(); return }
      if (!buffer.includes('\n')) return
      consumed = true
      void serial(async () => {
        const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))) as { version?: number; action?: string; allowLan?: boolean }
        if (request.version !== 1 || !['status', 'arm', 'release'].includes(request.action ?? '') || typeof request.allowLan !== 'boolean') throw new Error('invalid guard operation')
        if (request.action === 'arm') await arm(request.allowLan)
        if (request.action === 'release') await release()
        const protectedState = await protectedNow()
        return { version: 1, ok: true, protected: protectedState, recoveryReady: await probe(),
          allowLan: state.allowLan, control: config.control }
      }).then(result => socket.end(JSON.stringify(result) + '\n'), () => socket.end('{"version":1,"ok":false}\n'))
    })
  })
  // Recover a stale socket after a service crash without unlinking a live listener.
  try {
    const existing = await stat(socketPath)
    if (!existing.isSocket() || existing.uid !== 0) throw new Error('unsafe guard socket')
    const stale = await new Promise<boolean>(resolve => {
      const probe = connectSocket(socketPath)
      probe.setTimeout(1000, () => { probe.destroy(); resolve(false) })
      probe.on('connect', () => { probe.destroy(); resolve(false) })
      probe.on('error', e => { probe.destroy(); resolve((e as { code?: string }).code === 'ECONNREFUSED') })
    })
    if (!stale) throw new Error('guard already running')
    await unlink(socketPath)
  } catch (e) { if ((e as { code?: string }).code !== 'ENOENT') throw e }
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => resolve()) })
  await chmod(socketPath, 0o660); await chown(socketPath, 0, configStat.gid)
  const watchdog = setInterval(() => {
    void serial(async () => { if (state.active && !await protectedNow()) await arm(state.allowLan) }).catch(() => undefined)
  }, 15_000)
  watchdog.unref()
  server.on('close', () => { clearInterval(watchdog); void unlink(socketPath).catch(() => undefined) })
  return server
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = process.argv[2]
  if (!path) { process.stderr.write('A root-owned VPN guard configuration path is required.\n'); process.exitCode = 1 }
  else void startVpnGuard(path).catch(() => { process.stderr.write('VPN guard preparation failed; inspect local service configuration.\n'); process.exitCode = 1 })
}

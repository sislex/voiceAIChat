import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import type { VpnErrorCode } from '@sislexa/agent-contracts'

export class VpnError extends Error {
  constructor(readonly code: VpnErrorCode | 'vpn_untag_requires_reauth', detail?: string) {
    super(detail ? code + ': ' + detail : code)
  }
  get agentCode(): VpnErrorCode { return this.code === 'vpn_untag_requires_reauth' ? 'binding' : this.code }
  readonly status = 409
}
export interface TailDevice { id: string; nodeId: string; name?: string; hostname?: string; addresses: string[]; authorized: boolean; tags?: string[]; isExternal?: boolean; enabledRoutes?: string[] }
export interface TailPolicy { [key: string]: unknown; acls?: unknown[]; grants?: unknown[]; tagOwners?: Record<string, string[]> }
export const vpnTag = (machineId: string): string => 'tag:chatai-vpn-' + createHash('sha256').update(machineId).digest('hex').slice(0, 24)
export const environmentTag = (environment: { projectId: string; environmentId: string }): string =>
  'tag:chatai-env-' + createHash('sha256').update(environment.projectId + ':' + environment.environmentId).digest('hex').slice(0, 24)
export const isTailAddress = (address: string): boolean =>
  (isIP(address) === 4 && address.startsWith('100.') && Number(address.split('.')[1]) >= 64 && Number(address.split('.')[1]) <= 127) ||
  (isIP(address) === 6 && address.toLowerCase().startsWith('fd7a:115c:a1e0:'))

/** Reject ambiguous internet grants; never silently narrow somebody else's rules. */
export function managedPolicy(policy: TailPolicy, bindings: Record<string, { addresses: string[] }>, previous: unknown[]): TailPolicy {
  const isLocal = (selector: unknown): boolean => typeof selector === 'string' &&
    (/^tag:[a-zA-Z0-9-]+$/.test(selector) || selector === 'autogroup:member' || selector === 'autogroup:tagged' || isTailAddress(selector))
  // The owner's own exit-node permission stays as an explicit, separate grant: its only
  // destination is the internet, so it neither widens nor shadows environment grants.
  const ownerExit = (g: unknown): boolean => !!g && typeof g === 'object' &&
    JSON.stringify((g as { dst?: unknown }).dst) === JSON.stringify(['autogroup:internet'])
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) :
    v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, canonical(value)])) : v
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
  const retained = (policy.grants ?? []).filter(g => !previous.some(p => same(p, g)))
  if (retained.some(g => JSON.stringify(g)?.includes('tag:chatai-env-'))) throw new VpnError('policy')
  if ((policy.acls ?? []).some(a => JSON.stringify(a)?.includes('tag:chatai-env-'))) throw new VpnError('policy')
  if (retained.some(g => !ownerExit(g) && (!g || typeof g !== 'object' || !Array.isArray((g as { dst?: unknown }).dst) ||
    !(g as { dst: unknown[] }).dst.every(isLocal)))) throw new VpnError('policy')
  if ((policy.acls ?? []).some(a => !a || typeof a !== 'object' || !Array.isArray((a as { dst?: unknown }).dst) ||
    !(a as { dst: unknown[] }).dst.every(d => typeof d === 'string' && isLocal(d.replace(/:[^:]+$/, ''))))) throw new VpnError('policy')
  const owners = { ...policy.tagOwners }
  for (const id of Object.keys(bindings)) {
    const tag = vpnTag(id)
    if (owners[tag] && JSON.stringify(owners[tag]) !== JSON.stringify(['autogroup:admin'])) throw new VpnError('policy')
    owners[tag] = ['autogroup:admin']
  }
  return { ...policy, tagOwners: owners, grants: retained }
}
export function encryptVpnSecret(secret: string, key: string | undefined, userId: string): string {
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) throw new VpnError('secret_storage')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv)
  cipher.setAAD(Buffer.from(userId))
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.')
}
export function decryptVpnSecret(value: string, key: string | undefined, userId: string): string {
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) throw new VpnError('secret_storage')
  try {
    const [iv, tag, data] = value.split('.').map(v => Buffer.from(v, 'base64'))
    const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv!)
    cipher.setAAD(Buffer.from(userId)); cipher.setAuthTag(tag!)
    return Buffer.concat([cipher.update(data!), cipher.final()]).toString('utf8')
  } catch { throw new VpnError('secret_storage') }
}

export class TailscaleApi {
  constructor(private readonly secret: string, readonly tailnet: string, private readonly fetcher: typeof fetch = fetch) {}
  private async call(path: string, method = 'GET', body?: unknown, etag?: string): Promise<Response> {
    try {
      const response = await this.fetcher('https://api.tailscale.com/api/v2/' + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: 'Basic ' + Buffer.from(this.secret + ':').toString('base64'), Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(etag ? { 'If-Match': etag } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
      if (!response.ok) {
        // Upstream responses can echo credentials. Redact before retaining any diagnostic.
        const raw = await response.text()
        let message = ''
        try {
          const value = JSON.parse(raw) as { message?: unknown; error?: unknown }
          const detail = value.message ?? value.error
          if (typeof detail === 'string') message = detail
        } catch { /* Omit non-JSON proxy diagnostics. */ }
        for (const secret of [this.secret, Buffer.from(this.secret + ':').toString('base64'), encodeURIComponent(this.secret)]) {
          message = message.split(secret).join('[redacted]')
        }
        message = message.replace(/tskey-[a-zA-Z0-9-]+/g, '[redacted]').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 500)
        throw new VpnError([400, 409, 412, 422].includes(response.status) ? 'policy' : 'network', message || undefined)
      }
      return response
    } catch (error) { throw error instanceof VpnError ? error : new VpnError('network') }
  }
  async devices(): Promise<TailDevice[]> {
    try {
      const data = await (await this.call('tailnet/' + encodeURIComponent(this.tailnet) + '/devices?fields=all')).json() as { devices: TailDevice[] }
      if (!Array.isArray(data.devices)) throw new Error()
      return data.devices.filter(d => d.isExternal !== true && d.authorized === true && typeof d.id === 'string' && typeof d.nodeId === 'string' &&
        Array.isArray(d.addresses) && d.addresses.length > 0 && d.addresses.every(isTailAddress))
    } catch (e) { throw e instanceof VpnError ? e : new VpnError('network') }
  }
  async policy(): Promise<{ value: TailPolicy; etag: string }> {
    try {
      const response = await this.call('tailnet/' + encodeURIComponent(this.tailnet) + '/acl')
      const etag = response.headers.get('etag')
      const value = await response.json() as TailPolicy
      if (!etag || !value || typeof value !== 'object' || Array.isArray(value)) throw new VpnError('policy')
      return { value, etag }
    } catch (e) { throw e instanceof VpnError ? e : new VpnError('policy') }
  }
  async setPolicy(value: TailPolicy, etag: string): Promise<void> {
    if (!etag || etag === '*' || /[\r\n]/.test(etag)) throw new VpnError('policy')
    etag = etag.startsWith('"') ? etag : JSON.stringify(etag)
    await this.call('tailnet/' + encodeURIComponent(this.tailnet) + '/acl', 'POST', value, etag)
  }
  async setDeviceTags(device: TailDevice, tags: string[]): Promise<void> {
    await this.call('device/' + encodeURIComponent(device.id) + '/tags', 'POST', { tags })
  }
  async prepareExit(device: TailDevice, tag: string): Promise<void> {
    await this.call('device/' + encodeURIComponent(device.id) + '/tags', 'POST', { tags: [...new Set([...(device.tags ?? []), tag])] })
    const response = await this.call('device/' + encodeURIComponent(device.id) + '/routes')
    const routes = await response.json() as { advertisedRoutes?: string[]; enabledRoutes?: string[] }
    if (!['0.0.0.0/0', '::/0'].every(r => routes.advertisedRoutes?.includes(r))) throw new VpnError('gateway')
    await this.call('device/' + encodeURIComponent(device.id) + '/routes', 'POST',
      { routes: [...new Set([...(routes.enabledRoutes ?? []), '0.0.0.0/0', '::/0'])] })
    const check = await (await this.call('device/' + encodeURIComponent(device.id) + '/routes')).json() as { enabledRoutes?: string[] }
    if (!['0.0.0.0/0', '::/0'].every(r => check.enabledRoutes?.includes(r))) throw new VpnError('gateway')
  }
}

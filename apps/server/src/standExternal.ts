import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/** External stand upstream (`https://host[:port]`) pinned to the address validated by `resolveExternalStand`. */
export type ExternalStandTarget = { kind: 'external'; origin: string; address: string; family: 4 | 6 }
export type StandLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>

const forbidden = new BlockList()
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) forbidden.addSubnet(net, prefix, 'ipv4')
// BlockList matches IPv4 rules against IPv4-mapped IPv6 itself; NAT64 forms are refused outright.
for (const [net, prefix] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) forbidden.addSubnet(net, prefix, 'ipv6')

function refuse(): never { throw Object.assign(new Error('stand_url_forbidden'), { statusCode: 403 }) }

/** True for loopback, private, CGNAT, link-local (incl. cloud metadata), ULA, multicast and unspecified addresses. */
export function isForbiddenStandAddress(address: string): boolean {
  const family = isIP(address)
  if (!family) return true
  return forbidden.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

/** Parses an external stand URL: http(s) only, no credentials. Returns the normalized URL or `stand_url_forbidden`. */
export function externalStandUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { refuse() }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || !url.hostname) refuse()
  return url
}

/**
 * SSRF guard for external stands: resolves the host and refuses non-public addresses unless
 * `VC_STAND_PROXY_ALLOW_PRIVATE=1`. Every resolved address must be public; the first one is pinned
 * so the proxied connection cannot be rebound to another address after validation.
 */
export async function resolveExternalStand(value: string, options: { lookup?: StandLookup; allowPrivate?: boolean } = {}): Promise<ExternalStandTarget> {
  const url = externalStandUrl(value)
  const allowPrivate = options.allowPrivate ?? process.env.VC_STAND_PROXY_ALLOW_PRIVATE === '1'
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (/^(metadata|metadata\.google\.internal|localhost)$/i.test(hostname) && !allowPrivate) refuse()
  let addresses: Array<{ address: string; family: number }>
  try { addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await (options.lookup ?? (h => dnsLookup(h, { all: true, verbatim: true })))(hostname) }
  catch { refuse() }
  if (!addresses.length || addresses.some(a => !isIP(a.address) || (!allowPrivate && isForbiddenStandAddress(a.address)))) refuse()
  const pinned = addresses[0]!
  return { kind: 'external', origin: url.origin, address: pinned.address, family: isIP(pinned.address) === 6 ? 6 : 4 }
}

import type { AgentTelemetry } from '@sislexa/agent-contracts'
import { isTailAddress } from './tailscale.js'

export interface MachineVpnView { addresses: string[]; hostName?: string }
/** Exit-node problems (no leak guard, no forwarding, client and server at once) concern the
 * machine's internet route, not its tailnet address: environment links still reach the
 * node on 100.x. A Mac using an exit node reports 'guard' without the privileged helper. */
const ADDRESS_SAFE_ERRORS = new Set(['guard', 'forwarding', 'conflict'])
/** True when an observation's error still leaves its tailnet address usable. */
export function vpnErrorKeepsAddress(error: unknown): boolean {
  return !error || ADDRESS_SAFE_ERRORS.has(String(error))
}
/** Read optional newer Agent fields without requiring a contract package upgrade. */
export function vpnMachineView(telemetry: AgentTelemetry | undefined): MachineVpnView | undefined {
  const vpn = telemetry?.vpn as { addresses?: unknown; hostName?: unknown; error?: unknown } | undefined
  if (!vpn || !vpnErrorKeepsAddress(vpn.error) || !Array.isArray(vpn.addresses)) return undefined
  const addresses = vpn.addresses.filter((a): a is string => typeof a === 'string' && isTailAddress(a))
  return { addresses, ...(typeof vpn.hostName === 'string' ? { hostName: vpn.hostName } : {}) }
}
export function vpnAddress(telemetry: AgentTelemetry | undefined): string | undefined {
  const addresses = vpnMachineView(telemetry)?.addresses
  return addresses?.find(a => !a.includes(':')) ?? addresses?.[0]
}

import type { AgentTelemetry } from '@sislexa/agent-contracts'
import { isTailAddress } from './tailscale.js'

export interface MachineVpnView { addresses: string[]; hostName?: string }
/** Read optional newer Agent fields without requiring a contract package upgrade. */
export function vpnMachineView(telemetry: AgentTelemetry | undefined): MachineVpnView | undefined {
  const vpn = telemetry?.vpn as { addresses?: unknown; hostName?: unknown; error?: unknown } | undefined
  if (!vpn || vpn.error || !Array.isArray(vpn.addresses)) return undefined
  const addresses = vpn.addresses.filter((a): a is string => typeof a === 'string' && isTailAddress(a))
  return { addresses, ...(typeof vpn.hostName === 'string' ? { hostName: vpn.hostName } : {}) }
}
export function vpnAddress(telemetry: AgentTelemetry | undefined): string | undefined {
  const addresses = vpnMachineView(telemetry)?.addresses
  return addresses?.find(a => !a.includes(':')) ?? addresses?.[0]
}

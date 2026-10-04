import { describe, expect, it } from 'vitest'
import type { AgentTelemetry } from '@sislexa/agent-contracts'
import { AgentRegistry } from '../../agents/registry.js'
import { machineStates } from '../internal.js'
import { machinesSnapshot } from '../../kanbanBridge/internal.js'
import { vpnAddress, vpnMachineView } from './telemetry.js'

describe('machine VPN telemetry views', () => {
  const telemetry = { vpn: { addresses: ['fd7a:115c:a1e0::1', '100.64.0.1', '192.168.1.1'], hostName: 'worker.tailnet.ts.net' } } as unknown as AgentTelemetry
  it('extracts VPN addresses and hostName, preferring IPv4 for callers', () => {
    expect(vpnAddress(telemetry)).toBe('100.64.0.1')
    expect(vpnMachineView(telemetry)).toEqual({ addresses: ['fd7a:115c:a1e0::1', '100.64.0.1'], hostName: 'worker.tailnet.ts.net' })
    expect(vpnAddress(undefined)).toBeUndefined()
    expect(vpnAddress({ vpn: { addresses: ['192.168.1.1'] } } as AgentTelemetry)).toBeUndefined()
    // Exit-node errors keep the tailnet address; errors without a valid observation drop it.
    for (const error of ['guard', 'forwarding', 'conflict'])
      expect(vpnAddress({ vpn: { addresses: ['100.64.0.2'], error } } as unknown as AgentTelemetry)).toBe('100.64.0.2')
    for (const error of ['not_installed', 'apply', 'unknown'])
      expect(vpnAddress({ vpn: { addresses: ['100.64.0.2'], error } } as unknown as AgentTelemetry)).toBeUndefined()
  })
  it('includes the view in machines and Kanban snapshots', () => {
    const machines = { onlineIds: () => new Set(['worker']), nameOf: () => 'worker', versionOf: () => '1',
      platformOf: () => undefined, policyOf: () => undefined, telemetryOf: () => telemetry, imageHostOf: () => undefined }
    expect(machineStates(machines)[0].vpn).toEqual(vpnMachineView(telemetry))
    expect(machinesSnapshot(machines)[0].vpn).toEqual(vpnMachineView(telemetry))
    const registry = new AgentRegistry()
    expect(registry.vpnAddressOf('offline')).toBeUndefined()
  })
})

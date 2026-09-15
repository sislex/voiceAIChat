import { initialVpnState, type VpnObservation, type VpnView, type VpnBridge } from '@shared/vpn'
import { T0 } from './chat'
import { AGENT_VERSION } from '@shared/version'
import type { AgentInfo } from '@shared/agentProtocol'
import { makeAgent } from './machines'
export const makeVpnAgent = (over: Partial<AgentInfo> = {}): AgentInfo => makeAgent({ version: AGENT_VERSION, ...over })
export { T0 as VPN_TIME }
export function makeVpnObservation(over: Partial<VpnObservation> = {}): VpnObservation {
  return { observedAt: T0, mode: 'off', deviceId: 'node1', tailnet: 'test.ts.net',
    addresses: ['100.64.0.1'], gatewayDeviceId: null, gatewayOnline: null,
    allowLan: false, externalIp: '203.0.113.1', protected: false, recoveryReady: true, error: null, ...over }
}
export function makeVpnView(over: Partial<VpnView> = {}): VpnView {
  return { state: { ...initialVpnState(), observed: makeVpnObservation() },
    selectedGateway: { id: 'gateway', name: 'My Linux' },
    network: { tailnet: 'test.ts.net', verifiedAt: T0 }, gateways: [{ id: 'gateway', name: 'My Linux' }], ...over }
}
export const vpnFixtureBridge = (view: VpnView): VpnBridge => ({
  read: async () => structuredClone(view),
  change: async (_id, change) => ({ ...view, state: { ...view.state,
    desired: { mode: change.mode, gatewayId: change.gatewayId, allowLan: change.allowLan }, revision: view.state.revision + 1, phase: 'applying' } }),
  connect: async () => undefined
})

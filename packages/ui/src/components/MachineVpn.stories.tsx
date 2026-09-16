import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from '@storybook/test'
import { MachineVpn } from './MachineVpn'
import { makeVpnAgent as makeAgent } from '../test/fixtures/vpn'
import { makeVpnObservation, makeVpnView, VPN_TIME, vpnFixtureBridge } from '../test/fixtures/vpn'
import { initialVpnState, type VpnErrorCode } from '@shared/vpn'
const meta: Meta<typeof MachineVpn> = {
  title: 'Machines/VPN', component: MachineVpn,
  args: { agent: makeAgent(), bridge: vpnFixtureBridge(makeVpnView()), clock: () => VPN_TIME }
}
export default meta
type Story = StoryObj<typeof MachineVpn>
export const Off: Story = {}
export const ConnectNetwork: Story = { args: { bridge: vpnFixtureBridge(makeVpnView({ network: null })) } }
export const Loading: Story = { args: { bridge: { ...vpnFixtureBridge(makeVpnView()), read: () => new Promise(() => undefined) } } }
export const OldAgent: Story = { args: { agent: makeAgent({ version: '0.1.0' }) } }
export const Offline: Story = { args: { agent: makeAgent({ online: false }) } }
export const Stale: Story = { args: { clock: () => VPN_TIME + 100_000 } }
export const NoGateways: Story = { args: { bridge: vpnFixtureBridge(makeVpnView({ gateways: [] })) },
  play: async ({ canvasElement }) => { await userEvent.selectOptions(await within(canvasElement).findByLabelText('Режим VPN'), 'client') } }
export const Server: Story = { args: { bridge: vpnFixtureBridge(makeVpnView({ state: {
  ...initialVpnState(), desired: { mode: 'server', gatewayId: null, allowLan: false }, observed: makeVpnObservation({ mode: 'server' })
} })) } }
export const Connected: Story = { args: { bridge: vpnFixtureBridge(makeVpnView({ state: {
  ...initialVpnState(), desired: { mode: 'client', gatewayId: 'gateway', allowLan: false },
  observed: makeVpnObservation({ mode: 'client', gatewayDeviceId: 'node2', gatewayOnline: true, protected: true })
} })) } }
export const GatewayDown: Story = { args: { bridge: vpnFixtureBridge(makeVpnView({ state: {
  ...initialVpnState(), desired: { mode: 'client', gatewayId: 'gateway', allowLan: false },
  observed: makeVpnObservation({ mode: 'client', gatewayOnline: false, protected: true, externalIp: null })
} })) } }
export const Applying: Story = { args: { bridge: vpnFixtureBridge(makeVpnView({ state: { ...initialVpnState(), phase: 'applying', observed: makeVpnObservation() } })) } }
const preparation = (error: VpnErrorCode): Story => ({ args: { bridge: vpnFixtureBridge(makeVpnView({
  state: { ...initialVpnState(), error, observed: makeVpnObservation() }
})) } })
export const MissingTailscale = preparation('not_installed')
export const StoppedService = preparation('service')
export const LoginRequired = preparation('login')
export const PermissionRequired = preparation('permission')
export const ProtectionRequired = preparation('guard')
export const PolicyConflict = preparation('policy')
export const ApplyError = preparation('apply')
export const ChangeRole: Story = {
  // @testCase TC-UI
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.selectOptions(await canvas.findByLabelText('Режим VPN'), 'client')
    await userEvent.selectOptions(canvas.getByLabelText('VPN-шлюз'), 'gateway')
    await userEvent.click(canvas.getByLabelText('Разрешить доступ к локальной сети'))
    await userEvent.click(canvas.getByText('Применить режим'))
    await expect(canvas.getByText(/разорвёт текущие сетевые соединения/)).toBeVisible()
    await userEvent.click(canvas.getByText('Подтвердить изменение VPN'))
    await expect(await canvas.findByText('Запрошено: Подключиться к VPN')).toBeVisible()
  }
}

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MachineVpn } from './MachineVpn'
import { MachineStatus } from './MachineStatus'
import { makeVpnAgent as makeAgent } from '../test/fixtures/vpn'
import { makeVpnObservation, makeVpnView, VPN_TIME, vpnFixtureBridge } from '../test/fixtures/vpn'
import { initialVpnState, VPN_ERRORS } from '@shared/vpn'
describe('machine VPN flow', () => {
  // @testCase TC-UI
  it('selects its gateway and LAN policy, warns before dispatch, and keeps observed mode distinct', async () => {
    const view = makeVpnView(), bridge = vpnFixtureBridge(view)
    const change = vi.spyOn(bridge, 'change')
    render(<MachineVpn agent={makeAgent()} bridge={bridge} clock={() => VPN_TIME} />)
    await screen.findByText('Сеть: test.ts.net')
    fireEvent.change(screen.getByLabelText('Режим VPN'), { target: { value: 'client' } })
    fireEvent.change(screen.getByLabelText('VPN-шлюз'), { target: { value: 'gateway' } })
    fireEvent.click(screen.getByLabelText('Разрешить доступ к локальной сети'))
    fireEvent.click(screen.getByText('Применить режим'))
    expect(change).not.toHaveBeenCalled()
    expect(screen.getByText(/разорвёт текущие сетевые соединения/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Подтвердить изменение VPN'))
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1))
    expect(change.mock.calls[0][1]).toMatchObject({ mode: 'client', gatewayId: 'gateway', allowLan: true, expectedRevision: 0 })
    await screen.findByText('Запрошено: Подключиться к VPN')
    expect(screen.getByText('Фактически: Выключен')).toBeInTheDocument()
  })
  // @testCase TC-UI
  it('keeps explicit disconnect available when the gateway is down', async () => {
    const view = makeVpnView({ state: { ...initialVpnState(),
      desired: { mode: 'client', gatewayId: 'gateway', allowLan: false },
      observed: makeVpnObservation({ mode: 'client', gatewayOnline: false, protected: true, externalIp: null }) } })
    render(<MachineVpn agent={makeAgent()} bridge={vpnFixtureBridge(view)} clock={() => VPN_TIME} />)
    await screen.findByText(/Шлюз недоступен./)
    expect(screen.getByText(/Прямой интернет заблокирован./)).toBeInTheDocument()
    expect(screen.getByText('Применить режим')).toBeEnabled()
    expect(screen.getByText('Внешний IP: неизвестен')).toBeInTheDocument()
  })
  // @testCase TC-UI
  // @testCase TC-SECRETS
  it('clears administrative input and does not render untrusted errors', async () => {
    const bridge = vpnFixtureBridge(makeVpnView({ network: null }))
    vi.spyOn(bridge, 'connect').mockRejectedValue(new Error('tskey-test-secret'))
    render(<MachineVpn agent={makeAgent()} bridge={bridge} clock={() => VPN_TIME} />)
    await screen.findByText('Сеть: не подключена')
    fireEvent.change(screen.getByLabelText('Имя сети'), { target: { value: 'test.ts.net' } })
    fireEvent.change(screen.getByLabelText('Административный API-ключ'), { target: { value: 'tskey-test-secret' } })
    fireEvent.click(screen.getByText('Проверить доступ и подключить'))
    await waitFor(() => expect(screen.getByLabelText('Административный API-ключ')).toHaveValue(''))
    expect(document.body.textContent).not.toContain('tskey-test-secret')
  })
  // @testCase TC-UI
  it('shows concrete unsupported and stale states without a successful VPN claim', async () => {
    const view = render(<MachineVpn agent={makeAgent({ version: '0.1.0' })} bridge={vpnFixtureBridge(makeVpnView())} />)
    expect(screen.getByText(VPN_ERRORS.unsupported)).toBeInTheDocument()
    view.unmount()
    render(<MachineVpn agent={makeAgent()} bridge={vpnFixtureBridge(makeVpnView())} clock={() => VPN_TIME + 100_000} />)
    await screen.findByText(/Фактически: Выключен · состояние устарело/)
    expect(screen.getByText('Внешний IP: неизвестен')).toBeInTheDocument()
  })
  // @testCase TC-UI
  it.each(['expired', 'offline'] as const)('does not claim current protection for an %s observation', async reason => {
    const observed = makeVpnObservation({ mode: 'client', gatewayOnline: true, protected: true })
    const view = makeVpnView({ state: { ...initialVpnState(),
      desired: { mode: 'client', gatewayId: 'gateway', allowLan: false }, observed } })
    const bridge = vpnFixtureBridge(view)
    const change = vi.spyOn(bridge, 'change')
    render(<MachineVpn agent={makeAgent({ online: reason !== 'offline' })} bridge={bridge}
      clock={() => VPN_TIME + (reason === 'expired' ? 100_000 : 0)} />)
    await screen.findByText('Защита не подтверждена.', { exact: false })
    expect(screen.queryByText('Прямой интернет заблокирован.', { exact: false })).not.toBeInTheDocument()
    expect(screen.queryByText('Шлюз доступен.', { exact: false })).not.toBeInTheDocument()
    expect(screen.getByText('Внешний IP: неизвестен')).toBeInTheDocument()
    expect(change).not.toHaveBeenCalled()
  })
  // @testCase TC-REGRESSION
  it('opens VPN inside the fleet without changing existing machine permissions', async () => {
    const setPolicy = vi.fn()
    render(<MachineStatus agents={[makeAgent()]} vpn={vpnFixtureBridge(makeVpnView())} onSetPolicy={setPolicy} onClose={vi.fn()} />)
    expect(screen.getByText('агент запущен')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Сеть'))
    expect(setPolicy).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /^VPN / }))
    await screen.findByText('VPN · Tailscale')
    expect(screen.getByLabelText('Запись файлов')).toBeInTheDocument()
  })
})

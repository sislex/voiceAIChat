import { useEffect, useRef, useState } from 'react'
import './MachineVpn.css'
import { Button, EmptyState, ErrorState, Skeleton } from '@voicechat/ui-kit'
import type { AgentInfo } from '@shared/agentProtocol'
import { isToolAllowed } from '@shared/version'
import { VPN_ERRORS, isVpnFresh, type VpnBridge, type VpnChange, type VpnMode, type VpnView } from '@shared/vpn'

export const VPN_MODE_LABELS = { off: 'Выключен', server: 'Использовать как VPN-сервер', client: 'Подключиться к VPN', unknown: 'Неизвестно' }
/** No administrative input is persisted in a store, URL, notice, or command history. */
export function MachineVpn({ agent, bridge, clock = Date.now }: { agent: AgentInfo; bridge?: VpnBridge; clock?: () => number }): JSX.Element {
  const [view, setView] = useState<VpnView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<VpnMode>('off')
  const [gatewayId, setGatewayId] = useState('')
  const [allowLan, setAllowLan] = useState(false)
  const [tailnet, setTailnet] = useState('')
  const [secret, setSecret] = useState('')
  const [confirmation, setConfirmation] = useState<VpnChange | null>(null)
  const generation = useRef(0)
  const locked = useRef(false)
  const supported = !!bridge && isToolAllowed(agent.version ?? '0.1.0', 'vpn') &&
    !agent.telemetry?.os.isAndroid && ['linux', 'darwin'].includes(agent.telemetry?.os.platform ?? '')
  const [now, setNow] = useState(clock)
  const safeError = (e: unknown): string => {
    const code = e instanceof Error ? e.message : ''
    return Object.hasOwn(VPN_ERRORS, code) ? VPN_ERRORS[code as keyof typeof VPN_ERRORS] : VPN_ERRORS.apply
  }
  async function refresh(): Promise<void> {
    if (!bridge || locked.current) return
    const epoch = ++generation.current
    try {
      const result = await bridge.read(agent.id)
      if (epoch !== generation.current) return
      setView(result); setError(null)
    } catch (e) { if (epoch === generation.current) setError(safeError(e)) }
  }
  useEffect(() => {
    if (supported) void refresh()
    const timer = setInterval(() => { setNow(clock()); if (supported) void refresh() }, 30_000)
    return () => { ++generation.current; clearInterval(timer) }
  }, [agent.id, bridge, supported])
  const observed = agent.telemetry?.vpn && (!view?.state.observed || agent.telemetry.vpn.observedAt > view.state.observed.observedAt)
    ? agent.telemetry.vpn : view?.state.observed ?? null
  const stale = !agent.online || !isVpnFresh(observed, now)
  const state = view?.state
  async function connectNetwork(): Promise<void> {
    if (!bridge || locked.current) return
    locked.current = true; setBusy(true); ++generation.current
    const credential = secret
    setSecret('')
    let connected = false
    try { await bridge.connect(tailnet.trim(), credential); setError(null); connected = true }
    catch (e) { setError(safeError(e)) }
    finally { locked.current = false; setBusy(false) }
    if (connected) await refresh()
  }
  async function apply(): Promise<void> {
    if (!bridge || !confirmation || locked.current) return
    const change = confirmation
    locked.current = true; setBusy(true); ++generation.current; setConfirmation(null)
    try { setView(await bridge.change(agent.id, change)); setError(null) }
    catch (e) { setError(safeError(e)) }
    finally { locked.current = false; setBusy(false) }
  }
  return <section aria-label={'VPN ' + agent.name} className="ac-section machine-vpn">
    <h3>VPN · Tailscale</h3>
    {!supported ? <ErrorState compact message={VPN_ERRORS.unsupported} /> : <>
      {!view && !error && <Skeleton height={100} />}
      {error && <ErrorState compact message={error} onRetry={() => void refresh()} />}
      {view && <>
        <p>Сеть: {view.network?.tailnet ?? 'не подключена'}</p>
        <details open={!view.network}>
          <summary>{view.network ? 'Восстановить административный доступ' : 'Подключить свою сеть Tailscale'}</summary>
          <p>Укажите полное имя своей сети и административный API-ключ Tailscale с правами управления политикой и устройствами. Секрет вводится только здесь.</p>
          <label>Имя сети<input className="sel" value={tailnet} onChange={e => setTailnet(e.target.value)} autoComplete="off" /></label>
          <label>Административный API-ключ<input className="sel" type="password" value={secret} onChange={e => setSecret(e.target.value)} autoComplete="new-password" /></label>
          <Button loading={busy} disabled={!tailnet.trim() || !secret} onClick={() => void connectNetwork()}>Проверить доступ и подключить</Button>
        </details>
        <p>Запрошено: {VPN_MODE_LABELS[state!.desired.mode]}</p>
        <p>Фактически: {{ off: 'Выключен', server: 'VPN-сервер', client: 'VPN-клиент', unknown: 'Неизвестно' }[observed?.mode ?? 'unknown']}{stale ? ' · состояние устарело' : ''}</p>
        {state?.desired.gatewayId && <p>Выбранный шлюз: {view.selectedGateway?.name ?? state.desired.gatewayId}</p>}
        <p>Последняя проверка: {observed ? new Date(observed.observedAt).toLocaleString('ru-RU') : 'ещё не выполнена'}</p>
        <p>Внешний IP: {!stale && observed?.externalIp ? observed.externalIp : 'неизвестен'}</p>
        {observed?.mode === 'client' && <p role="status">
          {stale ? 'Доступность шлюза неизвестна.' : observed.gatewayOnline ? 'Шлюз доступен.' : 'Шлюз недоступен.'} {!stale && observed.protected ? 'Прямой интернет заблокирован.' : 'Защита не подтверждена.'}
        </p>}
        {(state?.error || observed?.error) && <ErrorState compact message={VPN_ERRORS[(state?.error ?? observed?.error)!]} />}
        {state?.phase === 'applying' && <p role="status">Изменение режима: ожидается фактическое подтверждение агента. Если переход не завершается, проверьте состояние или явно выберите «Выключен».</p>}
        {agent.pinIp && <p>Для VPN сначала отключите привязку токена агента к IP в настройках машины.</p>}
        <label htmlFor={'vpn-mode-' + agent.id}>Режим VPN</label><select id={'vpn-mode-' + agent.id} className="sel" value={mode} disabled={busy} onChange={e => { setMode(e.target.value as VpnMode); setConfirmation(null) }}>
          <option value="off">{VPN_MODE_LABELS.off}</option>
          <option value="server">{VPN_MODE_LABELS.server}</option>
          <option value="client">{VPN_MODE_LABELS.client}</option>
        </select>
        {mode === 'client' && <>
          {view.gateways.length === 0 ? <EmptyState title="Нет подготовленных собственных шлюзов" description="На другой своей машине включите режим VPN-сервера и повторите проверку." /> :
            <><label htmlFor={'vpn-gateway-' + agent.id}>VPN-шлюз</label><select id={'vpn-gateway-' + agent.id} className="sel" value={gatewayId} onChange={e => { setGatewayId(e.target.value); setConfirmation(null) }}>
              <option value="">Выберите свою машину</option>
              {view.gateways.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select></>}
          {!observed?.recoveryReady && <><ErrorState compact message={VPN_ERRORS.guard} /><p><a href="#/kb/machines">Инструкция подготовки системной службы защиты VPN</a></p></>}
        </>}
        <label><input type="checkbox" checked={allowLan} disabled={busy} onChange={e => { setAllowLan(e.target.checked); setConfirmation(null) }} />Разрешить доступ к локальной сети</label>
        <Button loading={busy} disabled={!agent.online || (state?.phase === 'applying' && mode !== 'off') || !view.network ||
          (mode !== 'off' && (stale || agent.pinIp)) ||
          (mode === 'client' && (!view.gateways.some(g => g.id === gatewayId) || !observed?.recoveryReady))}
          onClick={() => setConfirmation({ mode, gatewayId: mode === 'client' ? gatewayId : null, allowLan,
            operationId: crypto.randomUUID(), expectedRevision: state!.revision })}>Применить режим</Button>
        <Button disabled={busy} onClick={() => void refresh()}>Проверить состояние</Button>
        {confirmation && <div role="alert">
          <p>Изменение роли VPN разорвёт текущие сетевые соединения. Продолжить?</p>
          <Button variant="primary" loading={busy} onClick={() => void apply()}>Подтвердить изменение VPN</Button>
          <Button onClick={() => setConfirmation(null)}>Отмена</Button>
        </div>}
      </>}
    </>}
  </section>
}

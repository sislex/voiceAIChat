import { initialVpnState, isVpnFresh, type VpnAgentRequest, type VpnChange, type VpnObservation, type VpnState, type VpnView } from '@voicechat/shared'
import { decryptVpnSecret, encryptVpnSecret, managedPolicy, TailscaleApi, vpnTag, VpnError, type TailDevice } from './tailscale.js'

type Row = { tailnet: string; encryptedSecret: string; generation: number; state: string }
export interface VpnRepository {
  agentOwnerId(id: string): Promise<string | null>
  listAgents(userId: string): Promise<Array<{ id: string; name: string; pinIp: boolean }>>
  readVpnNetwork(userId: string): Promise<Row | null>
  saveVpnNetwork(userId: string, row: Row, expected: number | null): Promise<boolean>
}
interface Binding { deviceId: string; apiId: string; addresses: string[]; approved: boolean }
interface NetworkData { verifiedAt: number; states: Record<string, VpnState>; bindings: Record<string, Binding>; grants: unknown[] }
export interface VpnAgentPort {
  isOnline(id: string): boolean
  vpn(id: string, request: VpnAgentRequest): Promise<VpnObservation>
}
export class VpnService {
  private readonly busy = new Set<string>()
  constructor(private readonly repo: VpnRepository, private readonly agents: VpnAgentPort,
    private readonly key: () => string | undefined,
    private readonly apiFactory = (secret: string, tailnet: string) => new TailscaleApi(secret, tailnet),
    private readonly now = Date.now) {}
  private async exclusive<T>(user: string, run: () => Promise<T>): Promise<T> {
    if (this.busy.has(user)) throw new VpnError('conflict')
    this.busy.add(user)
    try { return await run() } finally { this.busy.delete(user) }
  }
  private async owned(user: string, id: string): Promise<void> {
    if (await this.repo.agentOwnerId(id) !== user) throw new VpnError('invalid')
  }
  private data(row: Row): NetworkData { return JSON.parse(row.state) as NetworkData }
  private api(user: string, row: Row): TailscaleApi { return this.apiFactory(decryptVpnSecret(row.encryptedSecret, this.key(), user), row.tailnet) }
  private async save(user: string, row: Row, data: NetworkData): Promise<Row> {
    const next = { ...row, generation: row.generation + 1, state: JSON.stringify(data) }
    if (!await this.repo.saveVpnNetwork(user, next, row.generation)) throw new VpnError('conflict')
    return next
  }
  async connect(user: string, tailnet: string, secret: string): Promise<void> {
    return this.exclusive(user, async () => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9.@-]{1,252}$/.test(tailnet) || secret.length < 16 || secret.length > 4096 || /[\r\n]/.test(secret)) throw new VpnError('invalid')
      const existing = await this.repo.readVpnNetwork(user)
      const data: NetworkData = existing ? this.data(existing) : { verifiedAt: 0, states: {}, bindings: {}, grants: [] }
      if (existing && existing.tailnet !== tailnet && Object.values(data.states).some(s => s.desired.mode !== 'off' || s.phase === 'applying' || (s.observed && s.observed.mode !== 'off'))) throw new VpnError('conflict')
      const encryptedSecret = encryptVpnSecret(secret, this.key(), user)
      const api = this.apiFactory(secret, tailnet)
      await api.devices()
      const policy = await api.policy()
      // A successful write with an ETag verifies policy administration, not just read access.
      managedPolicy(policy.value, {}, existing?.tailnet === tailnet ? data.grants : [])
      await api.setPolicy(policy.value, policy.etag)
      const nextData = existing?.tailnet === tailnet ? data : { verifiedAt: 0, states: {}, bindings: {}, grants: [] }
      nextData.verifiedAt = this.now()
      if (!await this.repo.saveVpnNetwork(user, { tailnet, encryptedSecret, generation: (existing?.generation ?? -1) + 1, state: JSON.stringify(nextData) }, existing?.generation ?? null)) throw new VpnError('conflict')
    })
  }
  private matches(state: VpnState, binding: Binding | undefined, data: NetworkData): boolean {
    const o = state.observed
    return !!o && isVpnFresh(o, this.now()) && !o.error && (state.revision === 0 || (o.revision === state.revision && o.operationId === state.operationId)) &&
      (state.desired.mode === 'client' || !o.protected) && o.mode === state.desired.mode && (state.desired.mode !== 'client' || o.allowLan === state.desired.allowLan) &&
      (state.desired.mode !== 'server' || binding?.approved === true) &&
      (state.desired.mode !== 'client' || (o.protected && o.recoveryReady &&
        o.gatewayDeviceId === data.bindings[state.desired.gatewayId ?? '']?.deviceId))
  }
  private async inspect(user: string, id: string, row: Row, data: NetworkData, devices: TailDevice[]): Promise<void> {
    await this.owned(user, id)
    const state = data.states[id] ??= initialVpnState()
    if (!this.agents.isOnline(id)) { state.error = 'offline'; return }
    const observation = await this.agents.vpn(id, { action: 'inspect' })
    state.observed = observation
    if (!isVpnFresh(observation, this.now())) { state.error = 'apply'; return }
    state.error = observation.error
    const device = devices.find(d => d.nodeId === observation.deviceId &&
      observation.addresses.length > 0 && observation.addresses.every(a => d.addresses.includes(a)))
    if (observation.tailnet !== row.tailnet || !device) { state.error = 'binding'; return }
    const prior = data.bindings[id]
    if (Object.entries(data.bindings).some(([other, b]) => other !== id && b.deviceId === device.nodeId)) throw new VpnError('binding')
    if (prior && prior.deviceId !== device.nodeId && state.desired.mode !== 'off') { state.error = 'binding'; return }
    data.bindings[id] = { deviceId: device.nodeId, apiId: device.id, addresses: device.addresses,
      approved: state.desired.mode === 'server' && observation.mode === 'server' && device.tags?.includes(vpnTag(id)) === true &&
        ['0.0.0.0/0', '::/0'].every(route => device.enabledRoutes?.includes(route)) }
    if (this.matches(state, data.bindings[id], data)) state.phase = 'idle'
    else if (state.phase === 'applying' && observation.revision === state.revision && observation.operationId === state.operationId) {
      state.phase = 'error'; state.error = state.error ?? 'apply'
    }
  }
  private async view(user: string, id: string, row: Row | null, data?: NetworkData): Promise<VpnView> {
    await this.owned(user, id)
    if (!row || !data) return { state: { ...initialVpnState(), error: 'network' }, gateways: [], network: null }
    const machines = await this.repo.listAgents(user)
    const gateways = machines.filter(a => a.id !== id && this.agents.isOnline(a.id) &&
      data.bindings[a.id]?.approved && data.states[a.id]?.phase === 'idle' &&
      data.states[a.id]?.desired.mode === 'server' && data.states[a.id]?.observed?.mode === 'server' &&
      !data.states[a.id]?.error && isVpnFresh(data.states[a.id]?.observed ?? null, this.now()))
      .map(a => ({ id: a.id, name: a.name }))
    const selected = machines.find(m => m.id === data.states[id]?.desired.gatewayId)
    return { state: data.states[id] ?? initialVpnState(), gateways, selectedGateway: selected ? { id: selected.id, name: selected.name } : null, network: { tailnet: row.tailnet, verifiedAt: data.verifiedAt } }
  }
  async read(user: string, id: string): Promise<VpnView> {
    return this.exclusive(user, async () => {
      await this.owned(user, id)
      let row = await this.repo.readVpnNetwork(user)
      if (!row) return this.view(user, id, null)
      const data = this.data(row)
      try {
        const devices = await this.api(user, row).devices()
        await this.inspect(user, id, row, data, devices)
        const owned = await this.repo.listAgents(user)
        await Promise.all(owned.filter(m => m.id !== id && data.states[m.id]?.desired.mode === 'server').map(async m => {
          try { await this.inspect(user, m.id, row!, data, devices) }
          catch { data.states[m.id].error = 'gateway' }
        }))
      } catch (e) {
        const state = data.states[id] ??= initialVpnState()
        state.error = e instanceof VpnError ? e.code : 'apply'
      }
      row = await this.save(user, row, data)
      return this.view(user, id, row, data)
    })
  }
  async change(user: string, id: string, change: VpnChange): Promise<VpnView> {
    return this.exclusive(user, async () => {
      await this.owned(user, id)
      if (change.gatewayId) await this.owned(user, change.gatewayId)
      if (change.gatewayId === id) throw new VpnError('invalid')
      let row = await this.repo.readVpnNetwork(user)
      if (!row) throw new VpnError('network')
      const data = this.data(row)
      const current = data.states[id] ??= initialVpnState()
      if (current.operationId === change.operationId) {
        if (JSON.stringify(current.desired) !== JSON.stringify({ mode: change.mode, gatewayId: change.gatewayId, allowLan: change.allowLan })) throw new VpnError('conflict')
        return this.view(user, id, row, data)
      }
      if (change.expectedRevision !== current.revision || (current.phase === 'applying' && change.mode !== 'off')) throw new VpnError('conflict')
      // Reserve the owner before any awaited external mutation. A crash leaves an explicit unresolved operation.
      if (Object.entries(data.states).some(([other, s]) => other !== id &&
        ((s.phase === 'applying' && change.mode !== 'off') || s.desired.gatewayId === id ||
          (data.bindings[id] && s.observed?.gatewayDeviceId === data.bindings[id].deviceId)))) throw new VpnError('conflict')
      if (!this.agents.isOnline(id)) throw new VpnError('offline')
      const machine = (await this.repo.listAgents(user)).find(m => m.id === id)
      if (change.mode !== 'off' && machine?.pinIp) throw new VpnError('guard')
      const api = change.mode === 'off' ? null : this.api(user, row)
      const devices = api ? await api.devices() : []
      if (change.mode !== 'off') {
        await this.inspect(user, id, row, data, devices)
        if (current.error && current.error !== 'guard') throw new VpnError(current.error)
      }
      const binding = data.bindings[id]
      if (!binding) throw new VpnError('binding')
      let gateway: Binding | undefined
      if (change.mode === 'client') {
        await this.inspect(user, change.gatewayId!, row, data, devices)
        const available = await this.view(user, id, row, data)
        if (!available.gateways.some(g => g.id === change.gatewayId)) throw new VpnError('gateway')
        gateway = data.bindings[change.gatewayId!]
        if (!current.observed?.recoveryReady) throw new VpnError('guard')
      }
      current.desired = { mode: change.mode, gatewayId: change.gatewayId, allowLan: change.allowLan }
      current.revision++
      current.operationId = change.operationId
      current.phase = 'applying'; current.error = null
      row = await this.save(user, row, data)
      try {
        if (change.mode !== 'off') {
          const policy = await api!.policy()
          const updated = managedPolicy(policy.value, data.bindings, data.grants)
          const grants = Object.entries(data.states).filter(([, s]) => s.desired.mode === 'client')
            .map(([client, s]) => ({ src: data.bindings[client]!.addresses, dst: ['autogroup:internet'], ip: ['*'], via: [vpnTag(s.desired.gatewayId!)] }))
          updated.grants = [...(updated.grants ?? []), ...grants]
          // Journal both versions before the remote write to recognize either outcome after a crash.
          data.grants = [...data.grants, ...grants]
          row = await this.save(user, row, data)
          await api!.setPolicy(updated, policy.etag)
          data.grants = grants
          // Persist the exact managed rules before proceeding, so a restart can recognize them.
          row = await this.save(user, row, data)
        }
        const observation = await this.agents.vpn(id, { action: 'apply', operationId: change.operationId,
          revision: current.revision, desired: current.desired, deviceId: binding.deviceId, gatewayDeviceId: gateway?.deviceId ?? null, gatewayAddress: gateway?.addresses[0] })
        current.observed = observation
        if (observation.error) throw new VpnError(observation.error)
        if (change.mode === 'server') {
          const device = devices.find(d => d.nodeId === binding.deviceId)
          if (!device || observation.mode !== 'server') throw new VpnError('gateway')
          await api!.prepareExit(device, vpnTag(id))
          binding.approved = true
        } else binding.approved = false
        if (!this.matches(current, binding, data)) throw new VpnError('apply')
        current.phase = 'idle'
      } catch (e) {
        current.phase = 'error'
        current.error = e instanceof VpnError ? e.code : 'apply'
      }
      row = await this.save(user, row, data)
      return this.view(user, id, row, data)
    })
  }
}

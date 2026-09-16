import { type VpnAgentRequest, type VpnObservation, type VpnErrorCode } from '@voicechat/shared'
export interface VpnSystem {
  inspect(): Promise<VpnObservation>
  protect(allowLan: boolean): Promise<void>
  set(request: Extract<VpnAgentRequest, { action: 'apply' }>): Promise<void>
  release(): Promise<void>
}
export interface VpnJournal {
  read(): Promise<{ revision: number; operationId: string; request: string } | null>
  write(entry: { revision: number; operationId: string; request: string }): Promise<void>
}
export const unknownVpn = (error: VpnErrorCode): VpnObservation => ({
  observedAt: Date.now(), mode: 'unknown', deviceId: null, tailnet: null, addresses: [],
  gatewayDeviceId: null, gatewayOnline: null, allowLan: false, externalIp: null,
  protected: false, recoveryReady: false, error
})
export class VpnController {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly system: VpnSystem, private readonly journal: VpnJournal) {}
  handle(request: VpnAgentRequest): Promise<VpnObservation> {
    const task = this.queue.then(() => this.run(request)).then(async observation => {
      try {
        const entry = await this.journal.read()
        return entry ? { ...observation, revision: entry.revision, operationId: entry.operationId } : observation
      } catch { return { ...observation, error: 'apply' as const } }
    })
    this.queue = task.catch(() => undefined)
    return task
  }
  private async run(request: VpnAgentRequest): Promise<VpnObservation> {
    let observed = unknownVpn('apply')
    try {
      observed = await this.system.inspect()
      if (request.action === 'inspect') return observed
      if (!Number.isSafeInteger(request.revision) || request.revision < 1 ||
        !/^[a-zA-Z0-9-]{8,80}$/.test(request.operationId) ||
        !['off', 'server', 'client'].includes(request.desired.mode) ||
        typeof request.desired.allowLan !== 'boolean') return { ...observed, error: 'invalid' }
      const previous = await this.journal.read()
      const serialized = JSON.stringify(request)
      if (previous && (request.revision < previous.revision ||
        (request.revision === previous.revision && (request.operationId !== previous.operationId || previous.request !== serialized)))) {
        return { ...observed, error: 'conflict' }
      }
      // A repeated command is reconciled by observation, never blindly applied again.
      if (previous?.revision === request.revision) return observed
      if (request.desired.mode !== 'off' && observed.deviceId !== request.deviceId) return { ...observed, error: 'binding' }
      if (request.desired.mode !== 'off' && observed.error && observed.error !== 'guard') return observed
      if (request.desired.mode === 'client' && (!observed.recoveryReady || !request.gatewayDeviceId ||
        request.gatewayDeviceId === request.deviceId)) return { ...observed, error: 'guard' }
      await this.journal.write({ revision: request.revision, operationId: request.operationId, request: serialized })
      if (request.desired.mode === 'client') await this.system.protect(request.desired.allowLan)
      // Switching directly away from a protected client must not remove its guard.
      await this.system.set(request)
      observed = await this.system.inspect()
      if (observed.error || observed.mode !== request.desired.mode ||
        (request.desired.mode === 'client' && (observed.gatewayDeviceId !== request.gatewayDeviceId || !observed.protected))) {
        return { ...observed, error: observed.error ?? 'apply' }
      }
      if (request.desired.mode !== 'client') {
        await this.system.release()
        observed = await this.system.inspect()
      }
      return observed
    } catch {
      // Re-inspection may reveal partial application, but errors never release protection.
      try { observed = await this.system.inspect() } catch { /* Preserve the last verified observation. */ }
      return { ...observed, externalIp: null, error: observed.error ?? 'apply' }
    }
  }
}

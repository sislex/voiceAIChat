import { UI_PERFORMANCE_POLICY as P, type UiMetric, type UiRoute, type UiPerformanceSample, type UiPerformanceBatch } from '@shared/uiPerformance'

type Span = { start: number; lifecycle: 'cold' | 'warm'; values: Map<UiMetric, number> }
export class UiPerformance {
  private seen = new Set<string>()
  private spans = new Map<string, Span>()
  private queue: Array<{ sample: UiPerformanceSample; at: number }> = []
  private busy = false
  private messageSequence = 0
  private activeMessage: string | null = null
  private queuedMessages: string[] = []
  constructor(private ports: {
    now(): number; visible(): boolean; online(): boolean
    platform: UiPerformanceSample['platform']; version: string
    send(batch: UiPerformanceBatch): Promise<void>; id(): string
  }) {}
  beginMessage(queued: boolean, operationId?: string): void {
    const key = operationId ?? 'message:' + (++this.messageSequence)
    if (queued) {
      if (this.queuedMessages.length >= 32) return
      this.queuedMessages.push(key)
    } else {
      if (this.activeMessage) this.spans.delete(this.activeMessage)
      this.activeMessage = key
    }
    this.begin(key, 'message')
  }
  cancelMessage(operationId?: string): void {
    if (!operationId) { this.cancel('message'); return }
    this.spans.delete(operationId)
    this.queuedMessages = this.queuedMessages.filter(key => key !== operationId)
    if (this.activeMessage === operationId) this.activeMessage = null
  }
  cancelMessages(): void {
    this.cancel('message')
    for (const key of this.queuedMessages) this.spans.delete(key)
    this.queuedMessages = []
  }
  activateMessage(): void { if (!this.activeMessage) this.activeMessage = this.queuedMessages.shift() ?? null }
  messageGeneration(): string | null { return this.activeMessage }
  private resolve(key: string): string { return key === 'message' ? this.activeMessage ?? key : key }
  setVersion(version: string): void {
    if (/^(unknown|[0-9]+[.][0-9]+[.][0-9]+|[a-f0-9]{7,40})$/.test(version)) {
      this.ports.version = version
      for (const entry of this.queue) if (entry.sample.version === 'unknown') entry.sample.version = version
    }
  }
  begin(key: string, lifecycleKey = key): void {
    this.spans.delete(key)
    if (!this.ports.visible()) return
    this.spans.set(key, { start: this.ports.now(), lifecycle: this.seen.has(lifecycleKey) ? 'warm' : 'cold', values: new Map() })
    this.seen.add(lifecycleKey)
  }
  mark(key: string, metric: UiMetric): void {
    key = this.resolve(key)
    const span = this.spans.get(key)
    if (!span) return
    if (!this.ports.visible()) { this.cancel(key); return }
    const elapsed = this.ports.now() - span.start
    if (elapsed < 0 || elapsed > P.maxDurationMs) { this.cancel(key); return }
    if (!span.values.has(metric)) span.values.set(metric, elapsed)
  }
  finish(key: string, route: UiRoute): void {
    if (key === 'message' && this.activeMessage) { key = this.activeMessage; this.activeMessage = null }
    const span = this.spans.get(key)
    this.spans.delete(key)
    if (!span || !this.ports.visible()) return
    const at = this.ports.now()
    if (at - span.start > P.maxDurationMs || at < span.start) return
    for (const [metric, duration] of span.values) this.queue.push({
      at: span.start + duration, sample: { metric, duration, route, lifecycle: span.lifecycle, platform: this.ports.platform, version: this.ports.version, age: 0 }
    })
    this.queue = this.queue.slice(-P.maxBatch)
  }
  cancel(key: string): void {
    if (key === 'message' && this.activeMessage) { this.spans.delete(this.activeMessage); this.activeMessage = null }
    this.spans.delete(key)
  }
  hidden(): void { this.spans.clear(); this.activeMessage = null; this.queuedMessages = [] }
  async flush(): Promise<void> {
    if (this.busy || !this.ports.online() || !this.queue.length) return
    this.busy = true
    const now = this.ports.now()
    const entries = this.queue.splice(0).filter(v => now-v.at <= P.maxAgeMs)
    try {
      if (entries.length) await this.ports.send({ schemaVersion: 1, batchId: this.ports.id(),
        samples: entries.map(v => ({ ...v.sample, age: now-v.at })) })
    } catch { /* Best effort: no retries, identity, payload or transport-error logging. */ }
    finally { this.busy = false }
  }
}

let collector: UiPerformance | undefined
export function uiPerformance(): UiPerformance {
  return collector ??= new UiPerformance({
    now: () => performance.now(), visible: () => document.visibilityState !== 'hidden',
    online: () => navigator.onLine,
    platform: (window as Window & { desktopHost?: { kind: string } }).desktopHost?.kind === 'desktop' ? 'desktop' : /Android|iPhone|iPad/.test(navigator.userAgent) ? 'mobile' : 'web',
    version: 'unknown',
    id: () => Array.from(crypto.getRandomValues(new Uint8Array(16)), v => v.toString(16).padStart(2,'0')).join(''),
    send: async batch => { await window.api?.['uiPerformance:send']?.(batch) }
  })
}

import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  browserEvidenceComplete, developmentPreviewPrompt, type CiBrowserCheck, type DevelopmentBrowserEvidence,
  type DevelopmentPreviewOperation, type DevelopmentPreviewSettings, type DevelopmentPreviewStatus,
  type DevelopmentPreviewErrorCode
} from '@voicechat/shared'

export interface PreviewRuntimeInput {
  projectId: string; taskId: string; runId: string; userId: string; agentId: string; workspace: string
  kind: 'claude' | 'codex'; model: string
  settings: DevelopmentPreviewSettings; check: CiBrowserCheck
}
export interface PreviewRuntimeHandle {
  resourceName: string
  grantId: string | null
  /** Credentials never enter the persisted handle. */
  runnerId: string | null
  resourcesCreated?: boolean
}
export interface DevelopmentPreviewRuntime {
  prepare(input: PreviewRuntimeInput, handle: PreviewRuntimeHandle, signal: AbortSignal, log: (text: string) => Promise<void>): Promise<{
    sha: string; configDigest: string; url: string; healthAttempts: number
  }>
  stop(input: PreviewRuntimeInput, handle: PreviewRuntimeHandle): Promise<void>
  logs(input: PreviewRuntimeInput, handle: PreviewRuntimeHandle): Promise<string>
  check?(input: PreviewRuntimeInput, status: Pick<DevelopmentPreviewStatus, 'url' | 'sha' | 'configDigest'>, signal: AbortSignal): Promise<DevelopmentBrowserEvidence>
}
interface Entry { input: PreviewRuntimeInput; handle: PreviewRuntimeHandle; status: DevelopmentPreviewStatus; log: string; active: boolean }
export class DevelopmentPreviewError extends Error {
  constructor(readonly code: DevelopmentPreviewErrorCode, message: string) { super(message) }
}
export function previewResourceName(projectId: string, taskId: string, runId: string): string {
  return 'vc-dev-' + createHash('sha256').update(JSON.stringify([projectId, taskId, runId])).digest('hex').slice(0, 32)
}
export function redactPreviewLog(value: string, secrets: string[] = []): string {
  let text = value
  for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]')
  return text.replace(/(?:postgres(?:ql)?|mysql):\/\/[^\s"'<>]+/gi, '[REDACTED_DSN]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/((?:token|password|secret|api[_-]?key|authorization)\s*["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED_KEY]')
    .slice(-50000)
}
/** Lifecycle is owned by the CI run, not by an LLM tool connection. */
export class DevelopmentPreviewManager {
  private entries = new Map<string, Entry>()
  private locks = new Map<string, Promise<unknown>>()
  private aborts = new Map<string, AbortController>()
  private listeners = new Map<string, (status: DevelopmentPreviewStatus) => Promise<void>>()
  constructor(private readonly runtime: DevelopmentPreviewRuntime, private readonly storePath?: string, private readonly now = Date.now) {
    if (storePath) try {
      const data = JSON.parse(readFileSync(storePath, 'utf8')) as Entry[]
      for (const entry of data) this.entries.set(entry.input.runId, entry)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  private save(): void {
    if (!this.storePath) return
    mkdirSync(dirname(this.storePath), { recursive: true })
    const tmp = this.storePath + '.' + randomUUID() + '.tmp'
    writeFileSync(tmp, JSON.stringify([...this.entries.values()]), { mode: 0o600 })
    renameSync(tmp, this.storePath)
  }
  private async publish(entry: Entry): Promise<void> {
    this.save()
    await this.listeners.get(entry.input.runId)?.(structuredClone(entry.status))
  }
  register(input: PreviewRuntimeInput, listener?: (status: DevelopmentPreviewStatus) => Promise<void>): DevelopmentPreviewStatus {
    const existing = this.entries.get(input.runId)
    if (existing) {
      if (existing.input.agentId !== input.agentId || existing.input.workspace !== input.workspace) throw new DevelopmentPreviewError('isolation_rejected', 'Run identity changed; old preview must be cleaned first')
      if (listener) this.listeners.set(input.runId, listener)
      return structuredClone(existing.status)
    }
    const now = this.now()
    const status: DevelopmentPreviewStatus = {
      projectId: input.projectId, taskId: input.taskId, runId: input.runId, agentId: input.agentId,
      application: input.settings.application, state: input.settings.enabled ? 'prepare' : 'off',
      browserResult: input.check.mode === 'off' ? 'off' : 'pending',
      failurePolicy: input.check.failurePolicy ?? 'continue', attempt: 0, maxAttempts: input.settings.maxAttempts,
      sha: null, configDigest: null, url: null, createdAt: now, expiresAt: now + input.settings.ttlMs,
      durationMs: null, healthAttempts: 0, database: 'pending', diagnostic: null, evidence: null
    }
    this.entries.set(input.runId, { input: structuredClone(input), status, log: '', active: false,
      handle: { resourceName: previewResourceName(input.projectId, input.taskId, input.runId), grantId: null, runnerId: null } })
    if (listener) this.listeners.set(input.runId, listener)
    this.save()
    return structuredClone(status)
  }
  status(runId: string): DevelopmentPreviewStatus | null { return structuredClone(this.entries.get(runId)?.status ?? null) }
  prompt(runId: string): string {
    const entry = this.entries.get(runId)
    return entry ? developmentPreviewPrompt(entry.status, entry.input.check.startPath) : ''
  }
  private failure(entry: Entry, error: unknown): void {
    entry.status.diagnostic = {
      code: error instanceof DevelopmentPreviewError ? error.code : 'application_failed',
      message: redactPreviewLog(error instanceof Error ? error.message : String(error))
    }
    entry.status.browserResult = entry.input.check.mode === 'off' ? 'off' : entry.status.failurePolicy === 'block' ? 'blocked' : 'warning'
    entry.status.state = 'failed'
  }
  async invoke(runId: string, operation: DevelopmentPreviewOperation, signal?: AbortSignal): Promise<DevelopmentPreviewStatus | { status: DevelopmentPreviewStatus; logs: string }> {
    const entry = this.entries.get(runId)
    if (!entry) throw new Error('preview_run_not_found')
    if (operation === 'status') return structuredClone(entry.status)
    if (operation === 'logs') {
      const logs = await this.runtime.logs(entry.input, entry.handle).catch(() => '')
      return { status: structuredClone(entry.status), logs: redactPreviewLog(entry.log + logs) }
    }
    if (operation === 'stop') this.aborts.get(runId)?.abort()
    const prior = this.locks.get(runId) ?? Promise.resolve()
    const next = prior.catch(() => {}).then(async () => {
      if (operation === 'stop') { await this.stopEntry(entry, 'stopped'); return structuredClone(entry.status) }
      if (operation === 'start' && entry.status.state === 'ready') return structuredClone(entry.status)
      if (this.now() >= entry.status.expiresAt) { await this.stopEntry(entry, 'expired'); return structuredClone(entry.status) }
      if (entry.status.attempt >= entry.status.maxAttempts) return structuredClone(entry.status)
      if (operation === 'restart' || entry.active) {
        await this.stopEntry(entry, 'stopped')
        if (entry.active) return structuredClone(entry.status)
      }
      if (signal?.aborted) return structuredClone(entry.status)
      const abort = new AbortController()
      const onAbort = (): void => abort.abort()
      signal?.addEventListener('abort', onAbort, { once: true })
      this.aborts.set(runId, abort)
      const timer = setTimeout(onAbort, entry.input.settings.startupTimeoutMs)
      entry.status.state = 'starting'; entry.status.attempt++; entry.status.diagnostic = null
      entry.status.evidence = null; entry.status.url = null
      entry.status.browserResult = entry.input.check.mode === 'off' ? 'off' : 'pending'
      entry.status.database = 'creating'; entry.active = true
      await this.publish(entry)
      const started = this.now()
      try {
        const result = await this.runtime.prepare(entry.input, entry.handle, abort.signal, async (text) => {
          entry.log = redactPreviewLog(entry.log + text)
          await this.publish(entry)
        })
        if (abort.signal.aborted) throw new DevelopmentPreviewError('health_timeout', 'Preview startup deadline reached')
        Object.assign(entry.status, result, { state: 'ready', database: 'ready' })
      } catch (error) {
        this.failure(entry, error)
        entry.log = redactPreviewLog(entry.log + await this.runtime.logs(entry.input, entry.handle).catch(() => ''))
        try { await this.runtime.stop(entry.input, entry.handle); entry.active = false; entry.status.database = 'removed' }
        catch { entry.log = redactPreviewLog(entry.log + '\nCleanup pending; garbage collector will retry.\n') }
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', onAbort); this.aborts.delete(runId)
        entry.status.durationMs = this.now() - started
        await this.publish(entry)
      }
      return structuredClone(entry.status)
    })
    this.locks.set(runId, next)
    try { return await next } finally { if (this.locks.get(runId) === next) this.locks.delete(runId) }
  }
  /** A separate trusted browser adapter supplies evidence; model prose cannot pass the gate. */
  async finalize(runId: string, signal: AbortSignal): Promise<boolean> {
    const entry = this.entries.get(runId)
    if (!entry) return true
    if (entry.input.check.mode === 'off') return true
    if (entry.status.state === 'ready') {
      entry.status.state = 'checking'; await this.publish(entry)
      try {
        if (!this.runtime.check) throw new DevelopmentPreviewError('browser_unavailable', 'Browser adapter unavailable')
        const evidence = await this.runtime.check(entry.input, structuredClone(entry.status), signal)
        if (!browserEvidenceComplete(evidence, entry.status.url, entry.status.sha, entry.status.configDigest)) throw new DevelopmentPreviewError('evidence_missing', 'Required browser calls or target identity are missing')
        entry.status.evidence = evidence
        const errors = [...evidence.findings.console, ...evidence.findings.runtime, ...evidence.findings.network]
        if (errors.length) throw new DevelopmentPreviewError('application_failed', 'Browser observed application errors')
        entry.status.browserResult = 'passed'; entry.status.state = 'ready'
      } catch (error) { this.failure(entry, error) }
    } else if (entry.status.browserResult === 'pending') {
      this.failure(entry, new DevelopmentPreviewError('evidence_missing', 'Preview was not started or never became ready'))
    }
    await this.publish(entry)
    return entry.status.browserResult === 'passed' || entry.status.failurePolicy === 'continue'
  }
  private async stopEntry(entry: Entry, state: 'stopped' | 'expired'): Promise<void> {
    try {
      await this.runtime.stop(entry.input, entry.handle)
      entry.active = false; entry.status.state = state; entry.status.database = 'removed'; entry.status.url = null
    } catch (error) { this.failure(entry, new DevelopmentPreviewError('cleanup_failed', 'Cleanup pending; retry after machine reconnects')) }
    await this.publish(entry)
  }
  async sweep(restart = false): Promise<void> {
    for (const entry of this.entries.values()) {
      if ((entry.active && restart) || (entry.active && this.now() >= entry.status.expiresAt) || entry.status.diagnostic?.code === 'cleanup_failed') {
        await this.invoke(entry.input.runId, 'stop')
        if (!entry.active && this.now() >= entry.status.expiresAt) { entry.status.state = 'expired'; await this.publish(entry) }
      }
    }
  }
  async finish(runId: string): Promise<void> {
    await this.invoke(runId, 'stop')
    this.listeners.delete(runId)
  }
}

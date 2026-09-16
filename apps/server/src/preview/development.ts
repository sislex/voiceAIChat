import { createHash, randomBytes } from 'node:crypto'
import type { BrowserCheckResult, CiBrowserEvidence, CiFailurePolicy, DevelopmentPreviewSettings, PreviewDiagnosticCode, PreviewStatus } from '@voicechat/shared'

export interface PreviewRuntime {
  prepare(input: { projectName: string; worktree: string; sha: string; env: Record<string, string>; databaseId: string }): Promise<{ url: string }>
  stop(projectName: string, volumes: boolean): Promise<void>
  logs(projectName: string, limit: number): Promise<string>
}
export interface PreviewStore { load(): Promise<PreviewStatus[]>; save(statuses: PreviewStatus[]): Promise<void> }
export interface ScopedGateway { issue(scope: GatewayScope): Promise<string>; revoke(tokenHash: string): Promise<void> }
export interface GatewayScope {
  projectId: string; taskId: string; runId: string; model: 'claude' | 'codex'
  allowedOperations: Array<'claude' | 'codex'>; expiresAt: number
}
export interface StartPreviewInput {
  projectId: string; taskId: string; runId: string; worktree: string; sha: string
  settings: DevelopmentPreviewSettings; environment?: Record<string, string>; productionDatabaseHosts?: string[]
}
type TokenRecord = GatewayScope & { hash: string; revoked: boolean }
const SAFE_ENV = new Set(['NODE_ENV', 'PORT', 'HOST', 'TZ', 'CI', 'VC_PREVIEW_GATEWAY_URL'])
const secretName = /(?:token|secret|password|cookie|api[_-]?key|private|ssh|home)/i
const productionResource = /(?:prod(?:uction)?|backup|\.sqlite|\.db)(?:$|[/:._-])/i

function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'run' }
function redact(value: string): string { return value.replace(/(?:postgres(?:ql)?|mysql):\/\/[^\s]+/gi, '[REDACTED_DSN]').replace(/((?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED]').replace(/(Bearer\s+)[\w.~+\/-]+/gi, '$1[REDACTED]') }
export function safePreviewEnvironment(source: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => SAFE_ENV.has(key) && !secretName.test(key)))
}
export function assertPreviewIsolation(input: StartPreviewInput): void {
  for (const [key, value] of Object.entries(input.environment ?? {})) {
    if (secretName.test(key)) throw Object.assign(new Error('Секретная переменная не разрешена в preview'), { code: 'production_resource_denied' })
    if (/database|dsn|volume|mount|backup/i.test(key) && (productionResource.test(value) || input.productionDatabaseHosts?.some(host => value.includes(host)))) {
      throw Object.assign(new Error('Production database или data resource запрещён'), { code: 'production_resource_denied' })
    }
  }
  if (!input.worktree || !/^[0-9a-f]{7,64}$/i.test(input.sha)) throw Object.assign(new Error('Точный worktree/SHA обязателен'), { code: 'configuration_error' })
}

export class DevelopmentPreviewManager {
  private statuses: PreviewStatus[] = []
  private tokens = new Map<string, TokenRecord>()
  constructor(private readonly deps: { runtime: PreviewRuntime; store: PreviewStore; gateway: ScopedGateway; now?: () => number; ttlMs?: number }) {}
  private now(): number { return (this.deps.now ?? Date.now)() }
  async restore(): Promise<void> { this.statuses = await this.deps.store.load() }
  list(): PreviewStatus[] { return structuredClone(this.statuses) }
  status(runId: string): PreviewStatus | null { return structuredClone(this.statuses.find(item => item.runId === runId) ?? null) }
  private async persist(): Promise<void> { await this.deps.store.save(this.statuses) }
  private projectName(input: Pick<StartPreviewInput, 'taskId' | 'runId'>): string { return `vc-${slug(input.taskId)}-${slug(input.runId)}` }
  async start(input: StartPreviewInput): Promise<{ status: PreviewStatus; gatewayToken?: string }> {
    const existing = this.statuses.find(item => item.runId === input.runId && !['stopped', 'expired', 'failed'].includes(item.state))
    if (existing) return { status: structuredClone(existing) }
    assertPreviewIsolation(input)
    const now = this.now(); const projectName = this.projectName(input)
    const status: PreviewStatus = {
      id: projectName, projectId: input.projectId, taskId: input.taskId, runId: input.runId, worktree: input.worktree, sha: input.sha,
      state: 'prepare', diagnosticCode: null, warning: null, attempt: 1, url: null,
      testDatabase: input.settings.database.mode === 'isolated-test' ? { id: `${projectName}-db`, ready: false } : null,
      createdAt: now, expiresAt: now + (this.deps.ttlMs ?? 60 * 60_000), stoppedAt: null, artifacts: []
    }
    this.statuses.push(status); await this.persist()
    let gatewayToken: string | undefined
    try {
      status.state = 'starting'
      const env = safePreviewEnvironment(input.environment ?? {}); env.NODE_ENV = 'test'; env.PORT = String(input.settings.containerPort)
      if (status.testDatabase) env.VC_TEST_DATABASE_ID = status.testDatabase.id
      if (input.settings.cli.enabled && input.settings.cli.allowedOperations.length) {
        const model = input.settings.cli.allowedOperations[0]
        const scope: GatewayScope = { projectId: input.projectId, taskId: input.taskId, runId: input.runId, model, allowedOperations: [...input.settings.cli.allowedOperations], expiresAt: now + input.settings.cli.tokenTtlMs }
        gatewayToken = await this.deps.gateway.issue(scope)
        const hash = createHash('sha256').update(gatewayToken).digest('hex')
        this.tokens.set(input.runId, { ...scope, hash, revoked: false })
        env.VC_PREVIEW_GATEWAY_TOKEN = gatewayToken
      }
      const prepared = await this.deps.runtime.prepare({ projectName, worktree: input.worktree, sha: input.sha, env, databaseId: status.testDatabase?.id ?? '' })
      if (status.testDatabase) status.testDatabase.ready = true
      status.url = prepared.url; status.state = 'ready'; await this.persist()
      return { status: structuredClone(status), gatewayToken }
    } catch (error) {
      status.state = 'failed'; status.diagnosticCode = ((error as { code?: PreviewDiagnosticCode }).code ?? 'docker_unavailable')
      status.warning = redact(error instanceof Error ? error.message : String(error)); await this.cleanup(input.runId, 'failed')
      return { status: structuredClone(status) }
    }
  }
  async restart(input: StartPreviewInput): Promise<{ status: PreviewStatus; gatewayToken?: string }> { await this.stop(input.runId); return this.start(input) }
  async logs(runId: string, limit = 64_000): Promise<string> {
    const status = this.statuses.find(item => item.runId === runId); if (!status) return ''
    return redact((await this.deps.runtime.logs(status.id, Math.min(limit, 64_000))).slice(-64_000))
  }
  async stop(runId: string): Promise<PreviewStatus | null> { return this.cleanup(runId, 'stopped') }
  async cleanup(runId: string, state: 'stopped' | 'expired' | 'failed' = 'stopped'): Promise<PreviewStatus | null> {
    const status = this.statuses.find(item => item.runId === runId); if (!status) return null
    if (status.stoppedAt !== null) return structuredClone(status)
    status.state = 'cleanup'; await this.persist(); await this.deps.runtime.stop(status.id, true)
    const token = this.tokens.get(runId)
    if (token && !token.revoked) { await this.deps.gateway.revoke(token.hash); token.revoked = true }
    status.state = state; status.url = null; status.stoppedAt = this.now(); await this.persist()
    return structuredClone(status)
  }
  async collectExpired(): Promise<string[]> {
    const expired: string[] = []
    for (const status of this.statuses) if (status.stoppedAt === null && status.expiresAt <= this.now()) { await this.cleanup(status.runId, 'expired'); expired.push(status.runId) }
    return expired
  }
  async reconcile(activeResources: string[]): Promise<string[]> {
    const cleaned: string[] = []; const known = new Set(this.statuses.filter(item => item.stoppedAt === null).map(item => item.id))
    for (const resource of activeResources) if (!known.has(resource)) { await this.deps.runtime.stop(resource, true); cleaned.push(resource) }
    for (const status of this.statuses) if (status.stoppedAt === null && !activeResources.includes(status.id)) { status.state = 'failed'; status.diagnosticCode = 'docker_unavailable'; status.warning = 'Preview resource disappeared' }
    await this.persist(); return cleaned
  }
  authorize(token: string, request: Omit<GatewayScope, 'expiresAt' | 'allowedOperations'> & { operation: 'claude' | 'codex' }): boolean {
    const hash = createHash('sha256').update(token).digest('hex'); const record = [...this.tokens.values()].find(item => item.hash === hash)
    return !!record && !record.revoked && record.expiresAt > this.now() && record.projectId === request.projectId && record.taskId === request.taskId && record.runId === request.runId && record.model === request.model && record.allowedOperations.includes(request.operation)
  }
}

export function browserCheckOutcome(evidence: CiBrowserEvidence | null, failurePolicy: CiFailurePolicy, infrastructureCode: PreviewDiagnosticCode | null = null): BrowserCheckResult {
  if (evidence?.status === 'passed') return { status: 'passed', failurePolicy, diagnosticCode: null, evidence }
  const diagnosticCode = infrastructureCode ?? (evidence?.status === 'infrastructure_error' ? 'browser_infrastructure' : 'browser_evidence_incomplete')
  if (failurePolicy === 'block') return { status: 'blocked', failurePolicy, diagnosticCode, evidence }
  return { status: infrastructureCode ? 'skipped' : 'warning', failurePolicy, diagnosticCode, evidence }
}
export function createEphemeralToken(): string { return randomBytes(32).toString('base64url') }


/** Opt-in settings; legacy records never enable an environment. */
export interface DevelopmentPreviewSettings {
  enabled: boolean
  runtime: 'docker'
  application: string
  startCommand: string
  containerPort: number
  healthPath: string
  startupTimeoutMs: number
  ttlMs: number
  maxAttempts: number
  database: { mode: 'isolated-test'; seed: 'default' | 'none' }
  cli: { source: 'production-gateway' }
}
export interface PreviewCliGrantScope {
  projectId: string
  taskId: string
  runId: string
  userId: string
  kind: 'claude' | 'codex'
  model: string
  ttlMs: number
  operations: ['generate']
}
export const PREVIEW_CLI_GRANTS_PATH = '/v1/preview-grants'
export type BrowserFailurePolicy = 'continue' | 'block'
export const DEFAULT_DEVELOPMENT_PREVIEW: DevelopmentPreviewSettings = {
  enabled: false, runtime: 'docker', application: 'auto', startCommand: 'auto',
  containerPort: 5173, healthPath: '/', startupTimeoutMs: 120000,
  ttlMs: 1800000, maxAttempts: 2,
  database: { mode: 'isolated-test', seed: 'default' },
  cli: { source: 'production-gateway' }
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const integer = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback
export function normalizeDevelopmentPreview(value: unknown): DevelopmentPreviewSettings {
  const raw = record(value), d = DEFAULT_DEVELOPMENT_PREVIEW
  return {
    enabled: raw.enabled === true, runtime: 'docker',
    application: typeof raw.application === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(raw.application) ? raw.application : d.application,
    startCommand: typeof raw.startCommand === 'string' && raw.startCommand.trim() && raw.startCommand.length <= 2000 && !/[\x00\r]/.test(raw.startCommand) ? raw.startCommand.trim() : d.startCommand,
    containerPort: raw.containerPort === 8790 ? d.containerPort : integer(raw.containerPort, d.containerPort, 1024, 65535),
    healthPath: typeof raw.healthPath === 'string' && /^\/(?!\/)[^\s\\]*$/.test(raw.healthPath) && raw.healthPath.length <= 200 ? raw.healthPath : d.healthPath,
    startupTimeoutMs: integer(raw.startupTimeoutMs, d.startupTimeoutMs, 1000, 300000),
    ttlMs: integer(raw.ttlMs, d.ttlMs, 60000, 7200000),
    maxAttempts: integer(raw.maxAttempts, d.maxAttempts, 1, 3),
    database: { mode: 'isolated-test', seed: record(raw.database).seed === 'none' ? 'none' : 'default' },
    cli: { source: 'production-gateway' }
  }
}
/** Unsafe intent is rejected rather than silently accepted. */
export function developmentPreviewValidationError(value: unknown): string | null {
  const raw = record(value)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'preview_config_invalid'
  if (Object.keys(raw).some((key) => !Object.keys(DEFAULT_DEVELOPMENT_PREVIEW).includes(key))) return 'preview_config_unknown_field'
  if (raw.runtime !== undefined && raw.runtime !== 'docker') return 'preview_runtime_forbidden'
  const db = record(raw.database), cli = record(raw.cli)
  if (Object.keys(db).some((key) => !['mode', 'seed'].includes(key)) || (db.mode !== undefined && db.mode !== 'isolated-test')) return 'production_database_forbidden'
  if (db.seed !== undefined && !['default', 'none'].includes(String(db.seed))) return 'preview_seed_invalid'
  if (Object.keys(cli).some((key) => key !== 'source') || (cli.source !== undefined && cli.source !== 'production-gateway')) return 'preview_cli_forbidden'
  const normalized = normalizeDevelopmentPreview(raw)
  for (const key of ['enabled', 'application', 'startCommand', 'containerPort', 'healthPath', 'startupTimeoutMs', 'ttlMs', 'maxAttempts'] as const) {
    if (raw[key] !== undefined && raw[key] !== normalized[key]) return 'preview_config_invalid_' + key
  }
  return null
}
export type DevelopmentPreviewState = 'off' | 'prepare' | 'starting' | 'ready' | 'checking' | 'stopped' | 'expired' | 'failed' | 'skipped'
export type DevelopmentBrowserResult = 'off' | 'pending' | 'passed' | 'warning' | 'skipped' | 'blocked'
export type DevelopmentPreviewErrorCode =
  | 'feature_disabled' | 'docker_missing' | 'docker_unavailable' | 'machine_unavailable'
  | 'build_failed' | 'dependency_failed' | 'migration_failed' | 'seed_failed'
  | 'health_timeout' | 'network_unavailable' | 'gateway_unavailable' | 'browser_unavailable'
  | 'browser_navigation_failed' | 'evidence_missing' | 'isolation_rejected' | 'application_failed' | 'cleanup_failed'
export interface DevelopmentBrowserEvidence {
  url: string
  sha: string
  configDigest: string
  viewport: { width: number; height: number }
  /** Written by the browser adapter after successful calls, never accepted from model text. */
  calls: Array<{ tool: string; at: number; ok: boolean }>
  screenshots: string[]
  findings: { console: string[]; runtime: string[]; network: string[]; a11y: string[]; styles: string[] }
}
export interface DevelopmentPreviewStatus {
  projectId: string
  taskId: string
  runId: string
  agentId: string
  application: string
  state: DevelopmentPreviewState
  browserResult: DevelopmentBrowserResult
  failurePolicy: BrowserFailurePolicy
  attempt: number
  maxAttempts: number
  sha: string | null
  configDigest: string | null
  url: string | null
  createdAt: number
  expiresAt: number
  durationMs: number | null
  healthAttempts: number
  database: 'pending' | 'creating' | 'migrating' | 'seeding' | 'ready' | 'removed'
  diagnostic: { code: DevelopmentPreviewErrorCode; message: string } | null
  evidence: DevelopmentBrowserEvidence | null
}
export const PREVIEW_OPERATIONS = ['start', 'status', 'logs', 'restart', 'stop'] as const
export type DevelopmentPreviewOperation = typeof PREVIEW_OPERATIONS[number]
export function browserEvidenceComplete(e: DevelopmentBrowserEvidence | null, url: string | null, sha: string | null, digest: string | null): boolean {
  if (!e || !url || !sha || !digest || e.url !== url || e.sha !== sha || e.configDigest !== digest || e.viewport.width <= 0 || e.viewport.height <= 0 || !e.screenshots.length) return false
  return ['open', 'read', 'screenshot', 'errors', 'network', 'a11y', 'styles'].every((tool) => e.calls.some((call) => call.tool === tool && call.ok))
}
export function developmentPreviewPrompt(status: DevelopmentPreviewStatus, startPath: string): string {
  return [
    'Managed development preview: use preview_start after editing, preview_status, preview_logs, preview_restart after fixes, preview_stop.',
    'Do not start an unmanaged background dev server. Tool results contain the exact URL; never guess the port.',
    'Application: ' + status.application + '; readiness: ' + status.state + '; URL: ' + (status.url ?? 'pending preview_start') + '; startPath: ' + startPath,
    'Browser failure policy: ' + status.failurePolicy + '; maximum startup attempts: ' + status.maxAttempts + '.',
    status.failurePolicy === 'continue'
      ? 'After bounded diagnosis, unavailable Docker, dependencies, health or browser are warning/skipped. Continue implementation, typecheck and tests.'
      : 'Browser checking is required. Diagnose and retry within the attempt limit; missing verified browser evidence blocks success.',
    'Open the exact URL in Chromium, exercise the feature, inspect read/errors/network/a11y/styles and take a screenshot. Never claim passed without actual browser evidence.'
  ].join('\n')
}

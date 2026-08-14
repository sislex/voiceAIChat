export const PREVIEW_STATES = [
  'not_created', 'queued', 'building', 'starting', 'seeding', 'health_checking',
  'running', 'stale', 'stopping', 'stopped', 'rebuilding', 'failed', 'cleaning', 'removed'
] as const

export type PreviewState = (typeof PREVIEW_STATES)[number]
export type PreviewOperation = 'start' | 'rebuild' | 'stop' | 'seed' | 'reset' | 'health_check' | 'remove' | 'reconcile' | 'docker_start' | 'docker_install'
export type PreviewRunStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'
export type PreviewErrorType =
  | 'configuration' | 'build' | 'docker' | 'port_allocation' | 'startup'
  | 'health_check' | 'seed' | 'storybook' | 'machine_unavailable'
  | 'resource_limit' | 'cleanup' | 'cancelled' | 'unknown'

export interface PreviewConfig {
  composeFile: string
  appService: string
  appInternalPort: number
  healthPath: string
  storybook: 'required' | 'optional' | 'disabled'
  storybookService?: string
  storybookInternalPort?: number
  seedScenarios: Array<{ id: string; name: string; version: string; command: string }>
  resetCommand?: string
  buildTimeoutMs: number
  startTimeoutMs: number
  healthTimeoutMs: number
  healthIntervalMs: number
  healthAttempts: number
  portRange: { from: number; to: number }
  cpuLimit?: string
  memoryLimit?: string
}

export type PreviewTunnelState = 'checking' | 'creating' | 'connected' | 'failed' | 'closed' | 'agent_required'
export type PreviewConnectionType = 'direct' | 'tunnel' | 'manual'
export type PreviewServiceKind = 'app' | 'storybook'

export interface PreviewAccessResult {
  connectionType: PreviewConnectionType
  state: PreviewTunnelState
  url: string | null
  tunnelId: string | null
  manualCommand: string | null
  internalUrl: string
  localAgentId: string | null
  error: string | null
}

export interface PreviewService {
  name: string
  internalPort: number
  hostPort: number
  url: string
  containerId: string | null
  state: string
  healthStatus: 'unknown' | 'checking' | 'healthy' | 'unhealthy'
}

export interface PreviewRun {
  id: string
  environmentId: string
  operation: PreviewOperation
  status: PreviewRunStatus
  initiator: string
  commitSha: string | null
  startedAt: number | null
  finishedAt: number | null
  errorType: PreviewErrorType | null
  errorMessage: string | null
  log: string
}

export interface PreviewEnvironment {
  id: string
  projectId: string
  taskId: string
  agentId: string
  workspacePath: string
  branch: string
  expectedCommitSha: string | null
  builtCommitSha: string | null
  currentCommitSha: string | null
  gitStatus: 'unknown' | 'verified' | 'uncommitted' | 'not_pushed' | 'remote_branch_missing' | 'sha_mismatch'
  state: PreviewState
  staleReason: string | null
  composeProject: string
  appUrl: string | null
  storybookUrl: string | null
  storybookStatus: 'pending' | 'building' | 'ready' | 'failed' | 'not_applicable'
  storybookCommitSha: string | null
  selectedSeedScenario: string | null
  seedVersion: string | null
  dataReady: boolean
  healthStatus: 'unknown' | 'checking' | 'healthy' | 'unhealthy'
  services: PreviewService[]
  runs: PreviewRun[]
  createdBy: string
  createdAt: number
  updatedAt: number
  startedAt: number | null
  stoppedAt: number | null
  lastError: { type: PreviewErrorType; message: string } | null
}

const ACTIVE = new Set<PreviewState>(['queued','building','starting','seeding','health_checking','stopping','rebuilding','cleaning'])
export function isPreviewBusy(state: PreviewState): boolean { return ACTIVE.has(state) }
export function previewIsCurrent(env: PreviewEnvironment): boolean {
  return env.state === 'running' && env.healthStatus === 'healthy' && !!env.builtCommitSha && env.builtCommitSha === env.currentCommitSha
}
export function canRunPlaywright(env: PreviewEnvironment, sha: string): { ok: true; url: string; seedScenario: string | null } | { ok: false; reason: string } {
  if (env.state === 'stale' || env.builtCommitSha !== sha || env.currentCommitSha !== sha) return { ok: false, reason: 'Окружение устарело: требуется пересборка для текущего SHA' }
  if (!previewIsCurrent(env) || !env.appUrl) return { ok: false, reason: 'Feature-preview не запущен или health-check не пройден' }
  if (!env.dataReady) return { ok: false, reason: 'Тестовые данные не подготовлены' }
  return { ok: true, url: env.appUrl, seedScenario: env.selectedSeedScenario }
}
export function previewActions(state: PreviewState): PreviewOperation[] {
  if (isPreviewBusy(state)) return []
  switch (state) {
    case 'not_created': case 'removed': return ['start']
    case 'running': case 'stale': return ['rebuild','stop','seed','reset','health_check','remove']
    case 'stopped': return ['start','rebuild','remove']
    case 'failed': return ['rebuild','stop','health_check','remove']
    default: return []
  }
}
export function safePreviewResourceName(projectId: string, taskId: string): string {
  const safe = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
  return `vc-preview-${safe(projectId)}-${safe(taskId)}`
}

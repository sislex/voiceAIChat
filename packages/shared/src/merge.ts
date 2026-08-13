import type { KanbanColumnSemanticType } from './projects'

export type MergeStage = 'queued' | 'checking' | 'fetching' | 'merging' | 'resolving_conflicts' | 'kb_update' | 'testing' | 'pushing' | 'success' | 'failed' | 'cancelled' | 'decision_required'
export type MergeRunStatus = MergeStage | 'deploying' | 'production_checks' | 'rolling_back' | 'timeout'
export type MergeStageStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped'

export const ACTIVE_MERGE_STATUSES: readonly MergeRunStatus[] = [
  'queued', 'checking', 'fetching', 'merging', 'resolving_conflicts', 'kb_update', 'testing', 'pushing', 'deploying', 'production_checks', 'rolling_back'
]

export interface MergeConflict { path: string; kind?: string }
export interface MergeCheck {
  name: string; command: string; status: MergeStageStatus
  startedAt: number; finishedAt: number | null; durationMs: number | null
  exitCode: number | null; timedOut: boolean; output: string
}
export interface MergeStageRecord {
  stage: MergeStage; status: MergeStageStatus; startedAt: number | null
  finishedAt: number | null; durationMs: number | null; exitCode: number | null
  timedOut: boolean; message: string | null; log: string
}

export interface MergeRun {
  id: string
  projectId: string
  taskId: string
  status: MergeRunStatus
  triggeredBy: string
  sourceBranch: string
  targetBranch: 'main'
  sourceSha: string | null
  targetSha: string | null
  mergeSha: string | null
  revertSha: string | null
  agentId: string
  machineName?: string | null
  llmEngineId: string | null
  llmProvider: 'claude' | 'codex'
  llmModel: string
  stage: MergeStage
  stages: MergeStageRecord[]
  conflicts: string[]
  conflictDetails: MergeConflict[]
  checks: MergeCheck[]
  deployId: string | null
  deployVersion: string | null
  productionStatus: string | null
  error: string | null
  recommendedAction: string | null
  log: string
  canCancel: boolean
  canRetry: boolean
  pushStartedAt: number | null
  startedAt: number | null
  finishedAt: number | null
  createdAt: number
}

export interface MergeAvailability {
  semanticType: KanbanColumnSemanticType
  sourceBranch?: string | null
  alreadyMerged?: boolean
  hasActiveRun?: boolean
  permitted?: boolean
  machineBound?: boolean
}

/** Единое правило UI; сервер независимо проверяет каждый инвариант при старте. */
export function canStartMerge(input: MergeAvailability): boolean {
  return input.semanticType === 'awaiting_merge'
    && Boolean(input.sourceBranch?.trim())
    && !input.alreadyMerged
    && !input.hasActiveRun
    && input.permitted !== false
    && input.machineBound !== false
}

export function isActiveMergeStatus(status: MergeRunStatus): boolean {
  return ACTIVE_MERGE_STATUSES.includes(status)
}

/** Копия репозитория задачи на машине: dev-workspace или merge-клон.
 *  Запись живёт до подтверждённого удаления каталога (state='deleted'). */
export interface TaskRepository {
  id: string
  projectId: string
  taskId: string
  agentId: string
  machineName: string | null
  path: string
  kind: 'dev-workspace' | 'merge-clone'
  state: 'active' | 'deleted'
  createdAt: number
  deletedAt: number | null
}

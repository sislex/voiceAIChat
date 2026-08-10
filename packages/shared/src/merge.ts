import type { KanbanColumnSemanticType } from './projects'

export type MergeRunStatus = 'queued' | 'checking' | 'resolving_conflicts' | 'testing' | 'pushing' | 'deploying' | 'production_checks' | 'rolling_back' | 'success' | 'failed' | 'cancelled' | 'timeout' | 'decision_required'

export const ACTIVE_MERGE_STATUSES: readonly MergeRunStatus[] = [
  'queued', 'checking', 'resolving_conflicts', 'testing', 'pushing', 'deploying', 'production_checks', 'rolling_back'
]

export interface MergeRun {
  id: string
  projectId: string
  taskId: string
  status: MergeRunStatus
  triggeredBy: string
  sourceBranch: string
  targetBranch: string
  sourceSha: string | null
  targetSha: string | null
  mergeSha: string | null
  revertSha: string | null
  agentId: string
  llmEngineId: string | null
  llmProvider: 'claude' | 'codex'
  llmModel: string
  stage: string
  conflicts: string[]
  deployId: string | null
  deployVersion: string | null
  productionStatus: string | null
  error: string | null
  log: string
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

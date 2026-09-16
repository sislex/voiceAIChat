/** Cleanup never accepts a client-supplied filesystem path. */
export type TemporaryCategory = 'process' | 'merge-worktree' | 'task-environment'
export type CleanupOutcome = 'deleted' | 'absent' | 'skipped' | 'deferred' | 'error' | 'partial'
export interface TemporaryResource {
  id: string
  projectId: string
  taskId: string
  runId: string | null
  userId: string
  machineId: string
  machineName: string
  path: string
  root: string
  category: TemporaryCategory
  generation: string
  identity: string | null
  gitCommonDir: string | null
  gitRegistration: string | null
  gitRegistrationIdentity?: string | null
  resultsPath?: string
  createdAt: number
  state: 'registered' | 'deleting' | 'deleted'
}
export interface CleanupCandidate {
  resource: TemporaryResource
  eligible: boolean
  reasons: string[]
  retainUntil: number | null
  bytes: number | null
  sizeReason: string | null
}
export interface CleanupAttempt {
  id: string
  resource: TemporaryResource
  at: number
  reason: string
  outcome: CleanupOutcome
  error: string | null
  freedBytes: number | null
}
export interface CleanupSnapshot {
  candidates: CleanupCandidate[]
  attempts: CleanupAttempt[]
}

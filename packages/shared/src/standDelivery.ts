/** Coordinator refusals safe to expose through Core stand delivery routes. */
export const STAND_DELIVERY_ERROR_CODES = [
  'branch_patch_empty_or_large',
  'branch_requires_secret_review',
  'branch_project_scope_required',
  'operator_scope_denied',
  'branch_resubmit_required',
  'branch_head_changed',
  'stand_delivery_paused',
  'stand_delivery_id_conflict',
  'branch_task_id_collision',
  'branch_source_not_configured'
] as const

/** Core REST delivery view; the coordinator is the source of truth. */
export interface StandDelivery {
  runId: string
  taskId: string
  repository: string
  branch: string
  targetBranch: 'dev'
  headSha: string
  title: string
  author: string
  state: 'submitted' | 'gating' | 'integrated' | 'rejected'
  createdAt: string
  gateLogTail?: string
}
export interface StandSyncResult {
  merged: boolean
  /** Commits still missing after the merge attempt. */
  behind: number
  conflicts: string[]
}

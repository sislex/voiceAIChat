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

/**
 * Stand failures Core reports with a specific code instead of a generic one, so
 * Make can show a precise RU/EN text. `stand_agent_timeout` is 504, the machine
 * codes and `stand_worktree_dirty` are 409; Storybook routes keep the stand proxy
 * status (`stand_not_found` 404, `stand_proxy_unavailable` 503,
 * `invalid_stand_response` 502).
 */
export const STAND_ERROR_CODES = [
  'stand_fetch_failed',
  'stand_git_timeout',
  'stand_worktree_dirty',
  'stand_agent_timeout',
  'machine_unavailable',
  'machine_offline',
  'stand_not_found',
  'stand_proxy_unavailable',
  'invalid_stand_response',
  'storybook_port_busy',
  'storybook_no_free_port'
] as const
export type StandErrorCode = typeof STAND_ERROR_CODES[number]

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

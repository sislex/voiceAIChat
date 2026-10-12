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

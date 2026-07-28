import type { KanbanColumnSemanticType } from './projects'

export type CommitPolicy = 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'
export type MergeTransport = 'local' | 'github_pull_request'
export type AgentPlanApprovalMode = 'manual' | 'automatic'
export type FeatureStatus = 'preparing' | 'planning' | 'awaiting_plan_approval' | 'development' | 'awaiting_commit' | 'testing' | 'awaiting_merge' | 'merging' | 'completed' | 'failed' | 'cancelled'
export type FeatureDeployStatus = 'not_requested' | 'awaiting_confirmation' | 'queued' | 'deploying' | 'succeeded' | 'failed'
export type AgentTaskStatus = 'planned' | 'ready' | 'running' | 'blocked' | 'succeeded' | 'failed' | 'cancelled'

export type RepositorySlotStatus = 'available' | 'reserved' | 'busy' | 'cleaning' | 'blocked' | 'repair_required' | 'disabled'
export interface RepositorySlot {
  id: string
  projectId: string
  agentId: string
  path: string
  status: RepositorySlotStatus
  featureId: string | null
  currentBranch: string | null
  reservedAt: number | null
  heartbeatAt: number | null
  blockReason: string | null
  lastError: string | null
}

export type AgentTaskKind = 'research' | 'implementation' | 'test' | 'bugfix' | 'review' | 'documentation' | 'git' | 'custom'

export interface FeatureRun {
  id: string
  projectId: string
  sourceTaskId: string
  attempt: number
  previousFeatureId: string | null
  conversationId: string | null
  repositorySlotId: string | null
  title: string
  description: string
  status: FeatureStatus
  deployStatus: FeatureDeployStatus
  baseBranch: string
  featureBranch: string
  baseCommitSha: string | null
  testedCommitSha: string | null
  mergedCommitSha: string | null
  commitPolicy: CommitPolicy
  mergeTransport: MergeTransport
  agentPlanApprovalMode: AgentPlanApprovalMode
  autoMerge: boolean
  autoDeployProduction: boolean
  createdAt: number
  updatedAt: number
  completedAt: number | null
  lastError: string | null
  version: number
}

export interface FeatureRunSummary {
  id: string
  sourceTaskId: string
  attempt: number
  status: FeatureStatus
  deployStatus: FeatureDeployStatus
  featureBranch: string
  agentActive: boolean
}

export interface FeatureDeployment {
  id: string
  featureId: string
  requestedMainSha: string
  deployedMainSha: string | null
  trigger: 'manual' | 'automatic'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

export interface AgentTask {
  id: string
  featureId: string
  title: string
  description: string
  kind: AgentTaskKind
  status: AgentTaskStatus
  createdBy: 'user' | 'agent' | 'system'
  dependsOn: string[]
  attempt: number
  resultSummary: string | null
  error: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

const TRANSITIONS: Record<FeatureStatus, readonly FeatureStatus[]> = {
  preparing: ['planning', 'failed', 'cancelled'],
  planning: ['awaiting_plan_approval', 'development', 'failed', 'cancelled'],
  awaiting_plan_approval: ['development', 'planning', 'cancelled'],
  development: ['awaiting_commit', 'testing', 'failed', 'cancelled'],
  awaiting_commit: ['testing', 'development', 'cancelled'],
  testing: ['development', 'awaiting_merge', 'failed', 'cancelled'],
  awaiting_merge: ['development', 'merging', 'cancelled'],
  merging: ['development', 'awaiting_merge', 'completed', 'failed'],
  completed: [],
  failed: ['preparing', 'development', 'testing', 'awaiting_merge', 'cancelled'],
  cancelled: []
}

export function canTransitionFeature(from: FeatureStatus, to: FeatureStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function featureColumnSemantic(status: FeatureStatus): KanbanColumnSemanticType {
  if (status === 'testing') return 'testing'
  if (status === 'awaiting_merge' || status === 'merging') return 'awaiting_merge'
  if (status === 'completed') return 'done'
  if (status === 'cancelled' || status === 'failed') return 'ready'
  return 'development'
}

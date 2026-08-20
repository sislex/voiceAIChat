export const AUTOMATION_PROTOCOL_VERSION = 1 as const
export const AUTOMATION_JOB_TYPES = ['task_preparation','development','component_qa','integration_tests','automated_qa','merge'] as const
export type AutomationJobType = typeof AUTOMATION_JOB_TYPES[number]
export const AUTOMATION_JOB_STATES = ['pending_dispatch','queued','running','waiting_for_questions','waiting_for_plan_approval','cancelling','cancelled','succeeded','failed','decision_required'] as const
export type AutomationJobState = typeof AUTOMATION_JOB_STATES[number]
export interface AutomationJobSnapshot {
  projectId: string; taskId: string; userId: string; machineId: string
  repository: string; workspace: string; sourceBranch: string; sourceSha: string
  targetBranch: string; stages: readonly string[]; readiness: unknown
  acceptanceCriteria: readonly string[]; model: { provider: string; model: string }
}
export interface AutomationJobRequest {
  protocolVersion: typeof AUTOMATION_PROTOCOL_VERSION
  idempotencyKey: string; type: AutomationJobType; snapshot: AutomationJobSnapshot
}
export interface AutomationJob {
  id: string; idempotencyKey: string; type: AutomationJobType; state: AutomationJobState
  snapshot: AutomationJobSnapshot; createdAt: string; updatedAt: string
  result: AutomationTerminalResult | null
}
export interface AutomationEvent {
  eventId: string; jobId: string; position: number; timestamp: string; type: string; payload: unknown
}
export interface AutomationPause {
  id: string; jobId: string; kind: 'questions' | 'plan_approval'; prompt: unknown
  sessionId: string; createdAt: string; answeredAt: string | null
}
export type MergeOutcome = 'success'|'conflict'|'stale_source'|'push_uncertain'|'failed'|'cancelled'
export interface AutomationTerminalResult {
  resultId: string; jobId: string
  outcome: 'succeeded'|'failed'|'cancelled'|MergeOutcome
  details: unknown; createdAt: string
}
export interface AutomationCapabilities {
  protocolVersions: readonly number[]; jobTypes: readonly AutomationJobType[]
  states: readonly AutomationJobState[]; durable: true
}
export interface AutomationHealth {
  ok: boolean; protocolVersion: number; queued: number; active: number; paused: number
  oldestQueuedAt: string | null
  dependencies: { machineExecution: boolean; llmRunner: boolean }
}
export const AUTOMATION_RUNNER = { jobs: '/v1/jobs', health: '/v1/health', capabilities: '/v1/capabilities' } as const

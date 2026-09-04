import type { KanbanColumnSemanticType, TaskRunResultOutcome } from '@shared/projects'

export type TaskCardVersion = 'new' | 'legacy'
export type TaskCardTab = 'overview' | 'workflow' | 'runs' | 'files' | 'history'
export type TaskCardRunStatus = 'queued' | 'running' | 'waiting_for_answer' | 'success' | 'failed' | 'cancelled'
export type TaskCardLoadState = 'loading' | 'ready' | 'empty' | 'error'
export type TaskCardMakeMode = 'whole_project' | 'files'

export interface TaskCardFileViewModel {
  id: string
  name: string
  size?: number
  mimeType?: string
  status: 'ready' | 'uploading' | 'error' | 'missing'
  error?: string
}

export interface TaskCardMakeSourceViewModel {
  id: string
  title: string
  conversationId: string
  mode: TaskCardMakeMode
  paths: Array<{ path: string; available: boolean; error?: string }>
}

export interface TaskCardRunViewModel {
  id: string
  title: string
  status: TaskCardRunStatus
  outcome: TaskRunResultOutcome
  createdAt: number
  finishedAt: number | null
  canOpen: boolean
  canCancel: boolean
  canAnswer: boolean
}

export interface TaskCardWorkflowStepViewModel {
  id: string
  semanticType: KanbanColumnSemanticType
  label: string
  state: 'passed' | 'current' | 'upcoming' | 'failed'
}

export interface TaskReworkCycleViewModel {
  id: string
  sequence: number
  description: string
  criteria: string[]
  makeSources: TaskCardMakeSourceViewModel[]
  attachments: TaskCardFileViewModel[]
  implementedResult?: string
  createdBy: string
  createdAt: number
  preparationRunId: string | null
}

export interface TaskCardViewModel {
  projectId?: string
  taskId: string
  taskKey: string
  projectName: string
  title: string
  stage: { semanticType: KanbanColumnSemanticType; label: string; fallback: boolean }
  priority: string
  assignee: string | null
  description: string
  acceptanceCriteria: string
  labels: string[]
  workflow: TaskCardWorkflowStepViewModel[]
  runs: TaskCardRunViewModel[]
  source: { description: string; acceptanceCriteria: string; attachments: TaskCardFileViewModel[] }
  makeSources: TaskCardMakeSourceViewModel[]
  cycles: TaskReworkCycleViewModel[]
  loadState: TaskCardLoadState
  error?: string
  actions: {
    canRework: boolean
    reworkBlockedReason?: string
    hasActiveRun: boolean
    safeActiveRunActions: Array<'keep_running' | 'open_run' | 'cancel_explicitly'>
  }
}

export interface TaskReworkDraft {
  description: string
  criteria: string[]
  makeSources?: Array<{ conversationId: string; title: string; mode: TaskCardMakeMode; paths: string[]; files?: string[]; filesState?: TaskCardLoadState; error?: string }>
  /** Legacy fields retained for story/test compatibility. */
  makeMode?: TaskCardMakeMode
  makePaths?: string[]
  attachments: TaskCardFileViewModel[]
}

export interface TaskCardCallbacks {
  onClose(): void
  onChangeTab(tab: TaskCardTab): void
  onOpenRun(runId: string): void
  onOpenMake(conversationId: string): void
  onStartRework(): void
  onChangeReworkDraft(draft: TaskReworkDraft): void
  onSubmitRework(draft: TaskReworkDraft, idempotencyKey: string): void | Promise<void>
  onUploadAttachment?(file: File, target: 'task' | 'rework'): void | Promise<void>
  onDeleteAttachment?(attachmentId: string, target: 'task' | 'rework'): void | Promise<void>
  onCancelRework(): void
}

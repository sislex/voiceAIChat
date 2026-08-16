import type { Board, KanbanColumn, ProjectDetail, ProjectSummary, Task } from '@shared/projects'
import type { ReactNode } from 'react'

export interface CreateProjectInput {
  name: string
  description?: string
  gitUrl?: string
  technologies?: string[]
  skills?: string[]
  defaultSkills?: Partial<ProjectSummary['defaultSkills']>
  commitPolicy?: ProjectSummary['commitPolicy']
  mergeTransport?: ProjectSummary['mergeTransport']
  agentPlanApprovalMode?: ProjectSummary['agentPlanApprovalMode']
  testCommand?: string
  productionDeployCommand?: string
  productionAgentId?: string | null
  productionCheckoutPath?: string
  productionHealthCheckCommand?: string
}
export type UpdateProjectInput = Partial<Omit<ProjectSummary, 'id' | 'createdBy' | 'createdAt' | 'updatedAt' | 'role'>>
export type CreateTaskInput = Pick<Task, 'title'> & Partial<Omit<Task, 'id' | 'projectId' | 'title' | 'createdAt' | 'updatedAt' | 'seq' | 'position'>>
export type TaskPatch = Partial<Omit<Task, 'id' | 'projectId' | 'createdAt' | 'seq'>>
export interface BoardUpdate { projectId: string; board: Board; revision?: string }
export interface TaskChatReference { conversationId: string }

export interface ProjectsClient {
  listProjects(): Promise<ProjectSummary[]>
  getProject(projectId: string): Promise<ProjectDetail | null>
  createProject(input: CreateProjectInput): Promise<ProjectDetail>
  updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectDetail>
  deleteProject(projectId: string): Promise<void>
  getBoard(projectId: string, options?: { includeCompleted?: boolean }): Promise<Board>
  subscribeBoard(projectId: string, listener: (event: BoardUpdate) => void, options?: { includeCompleted?: boolean }): () => void
  createColumn(projectId: string, input: Pick<KanbanColumn, 'name'> & Partial<Pick<KanbanColumn, 'wipLimit'>>): Promise<KanbanColumn>
  updateColumn(projectId: string, columnId: string, patch: Partial<Pick<KanbanColumn, 'name' | 'hidden' | 'wipLimit'>>): Promise<void>
  deleteColumn(projectId: string, columnId: string): Promise<void>
  reorderColumns(projectId: string, order: string[]): Promise<void>
  createTask(projectId: string, input: CreateTaskInput): Promise<Task>
  updateTask(projectId: string, taskId: string, patch: TaskPatch): Promise<Task>
  deleteTask(projectId: string, taskId: string): Promise<void>
  moveTask(projectId: string, taskId: string, columnId: string, afterId?: string | null, beforeId?: string | null): Promise<void>
  ensureTaskChat(projectId: string, taskId: string): Promise<TaskChatReference | null>
  openTaskChat(projectId: string, taskId: string): Promise<TaskChatReference>
}

export interface ProjectsChatPort {
  openConversation(conversationId: string): void
  renderEmbeddedChat(input: { conversationId: string; projectId: string; assistantKind?: string }): ReactNode
  createProjectConversation?(projectId: string): Promise<string>
}

export interface ProjectsHost {
  navigate(path: string, options?: { replace?: boolean }): void
  chat: ProjectsChatPort
  renderSidebarToggle?(input: { expanded: boolean; onToggle(): void }): ReactNode
}

export interface ProjectsNavigationModel {
  projects: ProjectSummary[]
  activeProjectId: string | null
  loaded: boolean
  createProject(): void
  openProject(projectId: string): void
}

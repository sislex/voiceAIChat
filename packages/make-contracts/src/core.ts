// Port describing what Make needs from core. Make owns workshop files, not database tables, but
// needs conversation ownership, project membership, linked kanban cards, and repository machine
// information. Access these only through MakeCore. Core's makeBridge/localCore.ts implements it
// over db.*, while standalone Make uses HTTP; see docs/plans/make-standalone.md.

import type { Conversation, FsResult, MakeLinkableTask, MakeTaskLink, ProjectDetail, TaskDesignLink } from '@voicechat/shared'

/** Read-only project machine filesystem: Make copies files into its workshop without writing to the shared project copy. */
export interface MakeMachineFs {
  list(agentId: string, path: string): Promise<FsResult>
  read(agentId: string, path: string): Promise<FsResult>
  /** Asynchronous by design: only core knows machine availability when Make runs separately. */
  isOnline(agentId: string): Promise<boolean>
}

export interface MakeTaskDesignArgs {
  conversationId: string
  mode?: 'whole_project' | 'files'
  paths?: string[]
  path?: string
  label?: string
}

export interface MakeCore {
  /** Conversation as visible to the user; null represents both inaccessible and nonexistent conversations. */
  conversation(userId: string, id: string): Promise<Conversation | null>
  conversationOwner(id: string): Promise<string | null>
  /** Project linked to the Make conversation; null means a personal project without kanban. */
  conversationProject(id: string): Promise<string | null>
  /** Conversation project members can view its Make design through task-card links. */
  isProjectViewer(userId: string, conversationId: string): Promise<boolean>
  /** All Make conversations owned by the user for per-user quotas. */
  makeConversationIdsOf(owner: string): Promise<string[]>
  taskLinks(conversationId: string, path?: string): Promise<MakeTaskLink[]>
  linkableTasks(userId: string, conversationId: string): Promise<MakeLinkableTask[]>
  linkTaskDesign(userId: string, projectId: string, taskId: string, args: MakeTaskDesignArgs): Promise<void>
  unlinkTaskDesign(userId: string, projectId: string, taskId: string, linkId: string): Promise<void>
  /** Task designs used to validate run-scope tokens; null means the task is absent or inaccessible to the user. */
  taskDesigns(userId: string, projectId: string, taskId: string): Promise<TaskDesignLink[] | null>
  project(userId: string, id: string): Promise<ProjectDetail | null>
  userExists(name: string): Promise<boolean>
  /** Live board update: design-to-card links change the card for everyone viewing the project. */
  boardChanged(projectId: string): void
  machineFs: MakeMachineFs | null
}

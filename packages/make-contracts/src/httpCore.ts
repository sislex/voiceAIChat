// `MakeCore` для отдельного процесса Make: каждый метод — RPC к ядру (`/internal/make/core`).
// Горячий путь Make (файлы, превью, снимки) сюда не ходит: ядро нужно на открытии панели,
// проверке доступа и связи с карточкой. `boardChanged` — без ожидания ответа: живая доска не
// должна задерживать ответ редактору, а потерянный кадр обновится следующим.

import type { Conversation, FsResult, MakeLinkableTask, MakeTaskLink, ProjectDetail, TaskDesignLink } from '@voicechat/shared'
import type { MakeCore, MakeMachineFs, MakeTaskDesignArgs } from './core.js'
import { INTERNAL_MAKE_CORE_PATH, createRpcClient } from './internal.js'

export interface HttpMakeCoreOptions {
  coreUrl: string
  token: string
  fetchImpl?: typeof fetch
  /** Куда писать об ошибке фонового `boardChanged`. */
  onError?: (error: unknown) => void
}

export class HttpMakeCore implements MakeCore {
  private readonly rpc: <T>(method: string, ...args: unknown[]) => Promise<T>
  readonly machineFs: MakeMachineFs

  constructor(private readonly opts: HttpMakeCoreOptions) {
    this.rpc = createRpcClient({ baseUrl: opts.coreUrl, token: opts.token, path: INTERNAL_MAKE_CORE_PATH, fetchImpl: opts.fetchImpl })
    this.machineFs = {
      list: (agentId, path) => this.rpc<FsResult>('machineFs.list', agentId, path),
      read: (agentId, path) => this.rpc<FsResult>('machineFs.read', agentId, path),
      isOnline: (agentId) => this.rpc<boolean>('machineFs.isOnline', agentId)
    }
  }

  conversation(userId: string, id: string) { return this.rpc<Conversation | null>('conversation', userId, id) }
  conversationOwner(id: string) { return this.rpc<string | null>('conversationOwner', id) }
  conversationProject(id: string) { return this.rpc<string | null>('conversationProject', id) }
  isProjectViewer(userId: string, conversationId: string) { return this.rpc<boolean>('isProjectViewer', userId, conversationId) }
  makeConversationIdsOf(owner: string) { return this.rpc<string[]>('makeConversationIdsOf', owner) }
  taskLinks(conversationId: string, path?: string) { return this.rpc<MakeTaskLink[]>('taskLinks', conversationId, ...(path === undefined ? [] : [path])) }
  linkableTasks(userId: string, conversationId: string) { return this.rpc<MakeLinkableTask[]>('linkableTasks', userId, conversationId) }
  async linkTaskDesign(userId: string, projectId: string, taskId: string, args: MakeTaskDesignArgs): Promise<void> { await this.rpc('linkTaskDesign', userId, projectId, taskId, args) }
  async unlinkTaskDesign(userId: string, projectId: string, taskId: string, linkId: string): Promise<void> { await this.rpc('unlinkTaskDesign', userId, projectId, taskId, linkId) }
  taskDesigns(userId: string, projectId: string, taskId: string) { return this.rpc<TaskDesignLink[] | null>('taskDesigns', userId, projectId, taskId) }
  project(userId: string, id: string) { return this.rpc<ProjectDetail | null>('project', userId, id) }
  userExists(name: string) { return this.rpc<boolean>('userExists', name) }
  boardChanged(projectId: string): void { void this.rpc('boardChanged', projectId).catch((error) => this.opts.onError?.(error)) }
}

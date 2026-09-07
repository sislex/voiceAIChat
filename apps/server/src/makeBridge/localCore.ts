// Реализация порта `MakeCore` в процессе ядра: те же `db.*`-порты, реестр машин и живая доска,
// что у остальных роутов. Единственное место, где Make и слой данных встречаются напрямую;
// отдельный сервис Make заменит этот файл HTTP-клиентом к `/internal/*` ядра.

import type { VoiceChatDb } from '../db/database.js'
import type { MakeCore, MakeMachineFs, MakeTaskDesignArgs } from '@voicechat/make'

export interface LocalMakeCoreDeps {
  db: VoiceChatDb
  /** Файловый мост реестра машин; `isOnline` здесь синхронный — порт оборачивает его в Promise. */
  machineFs?: Omit<MakeMachineFs, 'isOnline'> & { isOnline(agentId: string): boolean }
  boardChanged?: (projectId: string) => void
}

export class LocalMakeCore implements MakeCore {
  readonly machineFs: MakeMachineFs | null

  constructor(private readonly deps: LocalMakeCoreDeps) {
    const fs = deps.machineFs
    // Реестр отвечает синхронно, порт — обещанием: так же его читает отдельный процесс Make через RPC.
    this.machineFs = fs ? { list: fs.list, read: fs.read, isOnline: async (agentId) => fs.isOnline(agentId) } : null
  }

  conversation(userId: string, id: string) { return this.deps.db.chat.getConversation(userId, id) }
  conversationOwner(id: string) { return this.deps.db.chat.conversationOwner(id) }
  conversationProject(id: string) { return this.deps.db.chat.makeConversationProject(id) }
  isProjectViewer(userId: string, conversationId: string) { return this.deps.db.chat.isMakeProjectViewer(userId, conversationId) }
  async makeConversationIdsOf(owner: string): Promise<string[]> {
    // Make-разговоры живут в scope `make`: без явного scope список по умолчанию отдаёт только `chat`,
    // и квота на пользователя считалась по пустому списку (так было в server.ts до выделения порта).
    return (await this.deps.db.chat.listConversations(owner, { scope: 'make', includeCompleted: true })).filter((c) => c.assistantKind === 'make').map((c) => c.id)
  }
  taskLinks(conversationId: string, path?: string) { return this.deps.db.tasks.makeTaskLinks(conversationId, path) }
  linkableTasks(userId: string, conversationId: string) { return this.deps.db.tasks.makeLinkableTasks(userId, conversationId) }
  async linkTaskDesign(userId: string, projectId: string, taskId: string, args: MakeTaskDesignArgs): Promise<void> {
    await this.deps.db.tasks.linkTaskDesign(userId, projectId, taskId, args)
  }
  async unlinkTaskDesign(userId: string, projectId: string, taskId: string, linkId: string): Promise<void> {
    await this.deps.db.tasks.unlinkTaskDesign(userId, projectId, taskId, linkId)
  }
  async taskDesigns(userId: string, projectId: string, taskId: string) {
    const task = await this.deps.db.tasks.getCiTask(userId, projectId, taskId)
    return task ? task.designs ?? [] : null
  }
  project(userId: string, id: string) { return this.deps.db.projects.getProject(userId, id) }
  async userExists(name: string): Promise<boolean> { return Boolean(await this.deps.db.identity.getUser(name)) }
  boardChanged(projectId: string): void { this.deps.boardChanged?.(projectId) }
}

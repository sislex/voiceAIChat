// Порт «что Make нужно от ядра». Make не владеет ни одной таблицей — его состояние лежит в
// файлах мастерской, — но ему нужно знать, чей разговор, к какому проекту он привязан, кто
// участник, какие карточки канбана связаны с дизайном и есть ли у проекта машина с
// репозиторием. Всё это — данные чата, канбана и машин; Make получает их только через этот
// интерфейс. Сегодня реализация — `makeBridge/localCore.ts` поверх `db.*` в том же процессе,
// завтра — HTTP к ядру из отдельного сервиса (`docs/plans/make-standalone.md`).

import type { Conversation, FsResult, MakeLinkableTask, MakeTaskLink, ProjectDetail, TaskDesignLink } from '@voicechat/shared'

/** Файловая система машины проекта — только чтение: Make копирует файлы к себе, но в общую копию проекта не пишет. */
export interface MakeMachineFs {
  list(agentId: string, path: string): Promise<FsResult>
  read(agentId: string, path: string): Promise<FsResult>
  /** Асинхронно намеренно: в отдельном процессе Make статус машины знает только ядро. */
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
  /** Разговор глазами пользователя: null — чужой или несуществующий (для клиента они неотличимы). */
  conversation(userId: string, id: string): Promise<Conversation | null>
  conversationOwner(id: string): Promise<string | null>
  /** Проект, к которому привязан Make-разговор; null — личный проект без канбана. */
  conversationProject(id: string): Promise<string | null>
  /** Участник проекта разговора видит его Make-проект: карточка задачи ссылается на дизайн. */
  isProjectViewer(userId: string, conversationId: string): Promise<boolean>
  /** Все Make-разговоры владельца — для квоты на пользователя. */
  makeConversationIdsOf(owner: string): Promise<string[]>
  taskLinks(conversationId: string, path?: string): Promise<MakeTaskLink[]>
  linkableTasks(userId: string, conversationId: string): Promise<MakeLinkableTask[]>
  linkTaskDesign(userId: string, projectId: string, taskId: string, args: MakeTaskDesignArgs): Promise<void>
  unlinkTaskDesign(userId: string, projectId: string, taskId: string, linkId: string): Promise<void>
  /** Дизайны задачи для проверки scope-токена рана; null — задачи нет или она недоступна пользователю. */
  taskDesigns(userId: string, projectId: string, taskId: string): Promise<TaskDesignLink[] | null>
  project(userId: string, id: string): Promise<ProjectDetail | null>
  userExists(name: string): Promise<boolean>
  /** Живая доска: связь «дизайн ↔ карточка» меняет карточку у всех, кто смотрит проект. */
  boardChanged(projectId: string): void
  machineFs: MakeMachineFs | null
}

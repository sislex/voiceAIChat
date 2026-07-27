// Типы домена «Проекты» + канбан-доска. Разделяются server/web/desktop.

/** Приоритет задачи. */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

/** Все приоритеты (порядок = порядок в меню, по возрастанию важности). */
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

/** Роль пользователя в проекте. */
export type ProjectRole = 'owner' | 'member'

/** Участник проекта. */
export interface ProjectMember {
  /** Логин (он же id владельца данных в системе). */
  username: string
  role: ProjectRole
  addedAt: number
}

/**
 * Проект в списке. `role` — роль текущего пользователя (запрос знает uid),
 * технологии/навыки — свободные теги.
 */
export interface ProjectSummary {
  id: string
  name: string
  description: string
  gitUrl: string | null
  technologies: string[]
  skills: string[]
  /** Логин создателя проекта. */
  createdBy: string
  createdAt: number
  updatedAt: number
  /** Роль текущего пользователя в этом проекте. */
  role: ProjectRole
}

/** Машина проекта: агент + рабочая папка проекта на этой машине. */
export interface ProjectMachine {
  agentId: string
  /** Папка проекта на этой машине (рабочий каталог). '' — не задана. */
  path: string
}

/** Проект со всем составом (ответ get/create/update). */
export interface ProjectDetail extends ProjectSummary {
  members: ProjectMember[]
  /** Машины проекта с папками. */
  machines: ProjectMachine[]
  /** Машина по умолчанию (agentId ∈ machines) или null. */
  defaultAgentId: string | null
}

/** Колонка канбан-доски. Колонка = статус задачи. */
export interface KanbanColumn {
  id: string
  projectId: string
  name: string
  /** Дробный ранг для порядка колонок. */
  position: number
  /** Скрыта из основного вида доски (задачи сохраняют статус). */
  hidden: boolean
  createdAt: number
}

/** Задача канбан-доски. Статус задачи = её колонка (columnId). */
export interface Task {
  id: string
  projectId: string
  columnId: string
  title: string
  description: string
  priority: TaskPriority
  /** Логин исполнителя (участник проекта) или null. */
  assignee: string | null
  /** Дробный ранг для порядка внутри колонки. */
  position: number
  createdAt: number
  updatedAt: number
}

/** Снапшот доски проекта. */
export interface Board {
  columns: KanbanColumn[]
  tasks: Task[]
}

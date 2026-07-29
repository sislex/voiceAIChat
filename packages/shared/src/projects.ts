import type { FeatureRunSummary } from './features'

// Типы домена «Проекты» + канбан-доска. Разделяются server/web/desktop.

/** Приоритет задачи. */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

/** Все приоритеты (порядок = порядок в меню, по возрастанию важности). */
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

/** Тип элемента планирования. В БД исторически все элементы лежат в tasks. */
export type WorkItemType = 'epic' | 'story' | 'task'
export const WORK_ITEM_TYPES: WorkItemType[] = ['epic', 'story', 'task']

/**
 * Навыки по умолчанию, задаваемые в настройках проекта отдельно для каждого
 * типа элемента. При создании эпика/стори/таска эти навыки автоматически
 * копируются в его карточку (`Task.skills`), где их можно править.
 */
export interface WorkItemDefaultSkills {
  epic: string[]
  story: string[]
  task: string[]
}

/** Пустой набор навыков по умолчанию (все типы — []). */
export const EMPTY_DEFAULT_SKILLS: WorkItemDefaultSkills = { epic: [], story: [], task: [] }


/** Стабильное назначение колонки, не зависящее от отображаемого имени. */
export type KanbanColumnSemanticType =
  | 'backlog'
  | 'ready'
  | 'development'
  | 'testing'
  | 'awaiting_merge'
  | 'done'
  | 'custom'

export const KANBAN_COLUMN_SEMANTIC_TYPES: KanbanColumnSemanticType[] = [
  'backlog', 'ready', 'development', 'testing', 'awaiting_merge', 'done', 'custom'
]

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
  /** Навыки по умолчанию для новых элементов, отдельно по типу. */
  defaultSkills: WorkItemDefaultSkills
  /** Логин создателя проекта. */

  createdBy: string
  createdAt: number
  updatedAt: number
  /** Роль текущего пользователя в этом проекте. */
  role: ProjectRole
  commitPolicy: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'
  mergeTransport: 'local' | 'github_pull_request'
  agentPlanApprovalMode: 'manual' | 'automatic'
  testCommand?: string
  productionDeployCommand?: string
}

/** Машина проекта: агент + рабочая папка проекта на этой машине. */
export interface ProjectMachine {
  agentId: string
  /** Папка проекта на этой машине (рабочий каталог). '' — не задана. */
  path: string
  /** Корень пула изолированных копий Feature Run на этой машине. */
  featureReposRoot: string
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
  semanticType: KanbanColumnSemanticType
  /** Дробный ранг для порядка колонок. */
  position: number
  /** Скрыта из основного вида доски (задачи сохраняют статус). */
  hidden: boolean
  /** WIP-лимит (макс. карточек в колонке) или null — без лимита. */
  wipLimit: number | null
  createdAt: number
}

/** Задача канбан-доски. Статус задачи = её колонка (columnId). */
export interface Task {
  id: string
  projectId: string
  columnId: string
  type: WorkItemType
  parentId: string | null
  title: string
  description: string
  acceptanceCriteria: string
  priority: TaskPriority
  /** Логин исполнителя (участник проекта) или null. */
  assignee: string | null
  /** Метки (свободные строки), как labels в Jira. */
  labels: string[]
  /**
   * Навыки карточки. При создании заполняются навыками по умолчанию из настроек
   * проекта (по типу), дальше правятся вручную в карточке.
   */
  skills: string[]

  /** Оценка в стори-поинтах или null. */
  storyPoints: number | null
  /** Срок (unix ms) или null. */
  dueDate: number | null
  /** Помечена флагом «внимание» (Jira flag). */
  flagged: boolean
  /** Порядковый номер задачи в проекте — основа ключа «PRJ-42». */
  seq: number
  /** Дробный ранг для порядка внутри колонки. */
  position: number
  createdAt: number
  updatedAt: number
  /**
   * Id связанного с задачей чата текущего пользователя (или null, если чат ещё
   * не создан). Заполняется только в снапшоте доски; в ответах create/update — null.
   */
  chatId?: string | null
}

/** Новое доменное имя; Task остаётся alias для совместимости. */

export type WorkItem = Task

/** Снапшот доски проекта. */
export interface Board {
  columns: KanbanColumn[]
  tasks: Task[]
  features?: FeatureRunSummary[]
}

// Нормализация данных доски: KanbanBoard — переиспользуемый компонент и обязан
// переживать некорректные данные (битый импорт, старые записи, чужой бэкенд).
// Чистые функции без React; неизвестные значения заменяются безопасными.

import type { Board, KanbanColumn, Task, TaskPriority, WorkItemType } from '@shared/projects'
import { TASK_PRIORITIES, WORK_ITEM_TYPES } from '@shared/projects'

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

/** Задача с гарантированно валидными полями. */
export function normalizeTask(raw: Task): Task {
  const priority = TASK_PRIORITIES.includes(raw.priority) ? raw.priority : ('medium' as TaskPriority)
  const type = WORK_ITEM_TYPES.includes(raw.type) ? raw.type : ('task' as WorkItemType)
  return {
    ...raw,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : '(без названия)',
    description: typeof raw.description === 'string' ? raw.description : '',
    acceptanceCriteria: typeof raw.acceptanceCriteria === 'string' ? raw.acceptanceCriteria : '',
    type,
    priority,
    parentId: strOrNull(raw.parentId),
    assignee: strOrNull(raw.assignee),
    labels: Array.isArray(raw.labels) ? raw.labels.filter((l): l is string => typeof l === 'string') : [],
    skills: Array.isArray(raw.skills) ? raw.skills.filter((s): s is string => typeof s === 'string') : [],
    storyPoints:
 raw.storyPoints != null && num(raw.storyPoints, -1) >= 0 ? raw.storyPoints : null,
    dueDate: raw.dueDate != null && num(raw.dueDate, 0) > 0 ? raw.dueDate : null,
    flagged: raw.flagged === true,
    seq: Math.max(0, Math.floor(num(raw.seq))),
    position: num(raw.position),
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt)
  }
}

/** Колонка с гарантированно валидными полями. */
export function normalizeColumn(raw: KanbanColumn): KanbanColumn {
  const wip = raw.wipLimit != null ? Math.floor(num(raw.wipLimit, 0)) : null
  return {
    ...raw,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : '(колонка)',
    position: num(raw.position),
    hidden: raw.hidden === true,
    wipLimit: wip != null && wip > 0 ? wip : null
  }
}

/** Снапшот доски, безопасный для рендера (null проходит насквозь). */
export function normalizeBoard(board: Board | null): Board | null {
  if (!board) return null
  return {
    ...board,
    columns: Array.isArray(board.columns) ? board.columns.map(normalizeColumn) : [],
    tasks: Array.isArray(board.tasks) ? board.tasks.map(normalizeTask) : []
  }
}

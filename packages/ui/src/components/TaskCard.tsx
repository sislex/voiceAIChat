// Карточка задачи канбан-доски: заголовок, бейдж приоритета, исполнитель.
// Клик раскрывает инлайн-редактор (title/description/priority/assignee).
// Статус задачи отображается колонкой, отдельного селекта статуса нет.

import { useState } from 'react'
import type { ProjectMember, Task, TaskPriority } from '@shared/projects'
import { TASK_PRIORITIES } from '@shared/projects'

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  urgent: 'Срочно'
}

export interface TaskCardProps {
  task: Task
  members: ProjectMember[]
  onUpdate: (taskId: string, fields: { title?: string; description?: string; priority?: TaskPriority; assignee?: string | null }) => void
  onDelete: (taskId: string) => void
  onDragStart: (taskId: string) => void
  onDragEnd: () => void
  dragging: boolean
}

export function TaskCard({ task, members, onUpdate, onDelete, onDragStart, onDragEnd, dragging }: TaskCardProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [priority, setPriority] = useState<TaskPriority>(task.priority)
  const [assignee, setAssignee] = useState<string>(task.assignee ?? '')

  const save = (): void => {
    onUpdate(task.id, {
      title: title.trim() || task.title,
      description,
      priority,
      assignee: assignee || null
    })
    setOpen(false)
  }

  return (
    <div
      className={`kanban-card${dragging ? ' dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-task', task.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(task.id)
      }}
      onDragEnd={onDragEnd}
      data-testid="task-card"
    >
      <div className="kanban-card-head" onClick={() => setOpen((v) => !v)}>
        <span className={`kanban-prio kanban-prio--${task.priority}`} title={`Приоритет: ${PRIORITY_LABEL[task.priority]}`} />
        <span className="kanban-card-title">{task.title}</span>
      </div>
      {task.assignee && !open && <span className="kanban-assignee">👤 {task.assignee}</span>}
      {open && (
        <div className="kanban-card-edit" onClick={(e) => e.stopPropagation()}>
          <input
            className="login-input"
            aria-label="Заголовок задачи"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="login-input kanban-desc"
            aria-label="Описание задачи"
            placeholder="Описание"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <label className="kanban-field">
            Приоритет
            <select className="sel" aria-label="Приоритет" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="kanban-field">
            Исполнитель
            <select className="sel" aria-label="Исполнитель" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">— не назначен —</option>
              {members.map((m) => (
                <option key={m.username} value={m.username}>
                  {m.username}
                </option>
              ))}
            </select>
          </label>
          <div className="kanban-card-actions">
            <button className="login-submit" onClick={save}>
              Сохранить
            </button>
            <button className="delbtn" aria-label="Удалить задачу" title="Удалить задачу" onClick={() => onDelete(task.id)}>
              Удалить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

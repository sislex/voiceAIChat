import { useState } from 'react'
import type { ProjectMember, Task, TaskPriority, WorkItemType } from '@shared/projects'
import { TASK_PRIORITIES } from '@shared/projects'
import type { FeatureRun } from '@shared/features'

const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', urgent: 'Срочно' }
const TYPE_LABEL: Record<WorkItemType, string> = { epic: 'Эпик', story: 'История', task: 'Задача' }

export interface TaskCardProps {
  task: Task
  members: ProjectMember[]
  children?: Task[]
  parents?: Task[]
  feature?: FeatureRun
  onUpdate: (taskId: string, fields: { title?: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null }) => void
  onDelete: (taskId: string) => void
  onStartFeature?: (taskId: string) => void
  onOpenFeature?: (featureId: string) => void
  onDragStart: (taskId: string) => void
  onDragEnd: () => void
  dragging: boolean
}

export function TaskCard({ task, members, children = [], parents = [], feature, onUpdate, onDelete, onStartFeature, onOpenFeature, onDragStart, onDragEnd, dragging }: TaskCardProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [childrenOpen, setChildrenOpen] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(task.acceptanceCriteria)
  const [priority, setPriority] = useState<TaskPriority>(task.priority)
  const [assignee, setAssignee] = useState(task.assignee ?? '')
  const [parentId, setParentId] = useState(task.parentId ?? '')
  const save = (): void => {
    onUpdate(task.id, { title: title.trim() || task.title, description, acceptanceCriteria, parentId: parentId || null, priority, assignee: assignee || null })
    setOpen(false)
  }
  return (
    <div className={`kanban-card kanban-card--${task.type}${dragging ? ' dragging' : ''}`} draggable
      onDragStart={(e) => { e.dataTransfer.setData('application/x-task', task.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(task.id) }}
      onDragEnd={onDragEnd} data-testid="task-card">
      <div className="kanban-card-head" onClick={() => setOpen((v) => !v)}>
        <span className="kanban-type">{TYPE_LABEL[task.type]}</span>
        <span className={`kanban-prio kanban-prio--${task.priority}`} title={`Приоритет: ${PRIORITY_LABEL[task.priority]}`} />
        <span className="kanban-card-title">{task.title}</span>
      </div>
      {feature && <button className="feature-link" onClick={(e) => { e.stopPropagation(); onOpenFeature?.(feature.id) }}>Фича #{feature.attempt} · {feature.status}</button>}
      {feature && task.type === 'task' && ['completed', 'cancelled', 'failed'].includes(feature.status) && <button className="feature-start" onClick={(e) => { e.stopPropagation(); onStartFeature?.(task.id) }}>{feature.status === 'failed' ? 'Повторить фичу' : 'Новая фича'}</button>}
      {!feature && task.type === 'task' && <button className="feature-start" onClick={(e) => { e.stopPropagation(); onStartFeature?.(task.id) }}>Запустить фичу</button>}
      {!feature && task.type === 'story' && children.length === 0 && <button className="feature-start" onClick={(e) => { e.stopPropagation(); onStartFeature?.(task.id) }}>Создать задачу и запустить фичу</button>}
      {task.assignee && !open && <span className="kanban-assignee">👤 {task.assignee}</span>}
      {children.length > 0 && <div className="work-children"><button className="work-children-toggle" onClick={(e) => { e.stopPropagation(); setChildrenOpen((v) => !v) }}>{childrenOpen ? '▼' : '▶'} {children.length} дочерних</button>{childrenOpen && <ul>{children.map((child) => <li key={child.id}><span className="kanban-type">{TYPE_LABEL[child.type]}</span> {child.title}</li>)}</ul>}</div>}
      {open && <div className="kanban-card-edit" onClick={(e) => e.stopPropagation()}>
        <input className="login-input" aria-label="Заголовок задачи" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="login-input kanban-desc" aria-label="Описание задачи" placeholder="Описание" value={description} onChange={(e) => setDescription(e.target.value)} />
        <textarea className="login-input kanban-desc" aria-label="Критерии приёмки" placeholder="Критерии приёмки" value={acceptanceCriteria} onChange={(e) => setAcceptanceCriteria(e.target.value)} />
        {task.type !== 'epic' && <label className="kanban-field">Родитель<select className="sel" aria-label="Родитель" value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">— без родителя —</option>{parents.filter((p) => task.type === 'story' ? p.type === 'epic' : p.type === 'epic' || p.type === 'story').map((p) => <option key={p.id} value={p.id}>{p.type === 'epic' ? 'Эпик' : 'История'} · {p.title}</option>)}</select></label>}
        <label className="kanban-field">Приоритет<select className="sel" aria-label="Приоритет" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>{TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
        <label className="kanban-field">Исполнитель<select className="sel" aria-label="Исполнитель" value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">— не назначен —</option>{members.map((m) => <option key={m.username} value={m.username}>{m.username}</option>)}</select></label>
        <div className="kanban-card-actions"><button className="login-submit" onClick={save}>Сохранить</button><button className="delbtn" aria-label="Удалить задачу" title="Удалить задачу" onClick={() => onDelete(task.id)}>Удалить</button></div>
      </div>}
    </div>
  )
}

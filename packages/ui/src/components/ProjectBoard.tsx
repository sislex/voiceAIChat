// Канбан-доска проекта: горизонтальный ряд колонок с карточками задач.
// Перетаскивание — нативный HTML5 DnD: карточки (MIME application/x-task) и
// колонки (MIME application/x-column) с раздельными типами, чтобы не пересекались.
// Колонка = статус; скрытые колонки (hidden) не показываются, если не включён показ.

import { useState } from 'react'
import type { Board, KanbanColumn, ProjectMember, TaskPriority, WorkItemType } from '@shared/projects'
import { ToolFrame } from './ToolFrame'
import type { FeatureRun } from '@shared/features'
import { TaskCard } from './TaskCard'

export interface ProjectBoardProps {
  projectName: string
  board: Board | null
  loading: boolean
  members: ProjectMember[]
  features?: FeatureRun[]
  onCreateColumn: (name: string) => void
  onRenameColumn: (columnId: string, name: string) => void
  onSetColumnHidden: (columnId: string, hidden: boolean) => void
  onReorderColumns: (order: string[]) => void
  onDeleteColumn: (columnId: string) => void
  onCreateTask: (columnId: string, input: { title: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority }) => void
  onUpdateTask: (taskId: string, fields: { title?: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null }) => void
  onMoveTask: (taskId: string, columnId: string, afterId?: string | null, beforeId?: string | null) => void
  onDeleteTask: (taskId: string) => void
  onStartFeature?: (itemId: string, type: WorkItemType) => void
  onOpenFeature?: (featureId: string) => void
  onOpenSettings?: () => void
  onClose: () => void
}

export function ProjectBoard(props: ProjectBoardProps): JSX.Element {
  const { board, loading, members } = props
  const [newColumn, setNewColumn] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [dragTask, setDragTask] = useState<string | null>(null)
  const [dragColumn, setDragColumn] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [newTask, setNewTask] = useState<Record<string, string>>({})
  const [newType, setNewType] = useState<Record<string, WorkItemType>>({})
  const [newParent, setNewParent] = useState<Record<string, string>>({})

  const columns = (board?.columns ?? []).filter((c) => showHidden || !c.hidden)
  const tasksOf = (columnId: string) =>
    (board?.tasks ?? []).filter((t) => t.columnId === columnId).sort((a, b) => a.position - b.position)

  const addColumn = (): void => {
    const name = newColumn.trim()
    if (!name) return
    props.onCreateColumn(name)
    setNewColumn('')
  }

  const addTask = (columnId: string): void => {
    const title = (newTask[columnId] ?? '').trim()
    const type = newType[columnId] ?? 'task'
    const parentId = newParent[columnId] || null
    if (!title || (type === 'story' && !parentId)) return
    props.onCreateTask(columnId, { title, type, ...(type === 'story' ? { parentId } : {}) })
    setNewTask((m) => ({ ...m, [columnId]: '' }))
    setNewParent((m) => ({ ...m, [columnId]: '' }))
  }

  // Перенос колонки dragColumn перед target.
  const reorderTo = (targetId: string): void => {
    if (!board || !dragColumn || dragColumn === targetId) return
    const ids = board.columns.map((c) => c.id).filter((id) => id !== dragColumn)
    const at = ids.indexOf(targetId)
    ids.splice(at < 0 ? ids.length : at, 0, dragColumn)
    props.onReorderColumns(ids)
    setDragColumn(null)
  }

  // Зона вставки задачи между соседями after (сверху) и before (снизу).
  const dropZone = (columnId: string, after: string | null, before: string | null, key: string): JSX.Element => (
    <div
      key={key}
      className="kanban-dropzone"
      onDragOver={(e) => {
        if (dragTask) {
          e.preventDefault()
          e.currentTarget.classList.add('over')
        }
      }}
      onDragLeave={(e) => e.currentTarget.classList.remove('over')}
      onDrop={(e) => {
        e.currentTarget.classList.remove('over')
        const id = e.dataTransfer.getData('application/x-task') || dragTask
        if (id) props.onMoveTask(id, columnId, after, before)
        setDragTask(null)
      }}
    />
  )

  const renderColumn = (col: KanbanColumn): JSX.Element => {
    const tasks = tasksOf(col.id)
    return (
      <section
        key={col.id}
        className={`kanban-col${col.hidden ? ' kanban-col--hidden' : ''}`}
        data-testid="kanban-column"
        onDragOver={(e) => {
          if (dragColumn) e.preventDefault()
        }}
        onDrop={() => reorderTo(col.id)}
      >
        <header
          className="kanban-col-head"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-column', col.id)
            e.dataTransfer.effectAllowed = 'move'
            setDragColumn(col.id)
          }}
          onDragEnd={() => setDragColumn(null)}
        >
          {renaming === col.id ? (
            <input
              className="ctitle-edit"
              autoFocus
              aria-label="Название колонки"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => {
                if (renameDraft.trim()) props.onRenameColumn(col.id, renameDraft.trim())
                setRenaming(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (renameDraft.trim()) props.onRenameColumn(col.id, renameDraft.trim())
                  setRenaming(null)
                } else if (e.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <span
              className="kanban-col-name"
              onDoubleClick={() => {
                setRenaming(col.id)
                setRenameDraft(col.name)
              }}
            >
              {col.name} <span className="kanban-col-count">{tasks.length}</span>
            </span>
          )}
          <span className="kanban-col-btns">
            <button
              className="renbtn"
              aria-label={col.hidden ? 'Показать колонку' : 'Скрыть колонку'}
              title={col.hidden ? 'Показать колонку' : 'Скрыть колонку'}
              onClick={() => props.onSetColumnHidden(col.id, !col.hidden)}
            >
              {col.hidden ? '🙈' : '👁'}
            </button>
            {col.semanticType === 'custom' && <button
              className="delbtn"
              aria-label={`Удалить колонку «${col.name}»`}
              title="Удалить колонку"
              onClick={() => {
                if (window.confirm(`Удалить колонку «${col.name}» со всеми задачами?`)) props.onDeleteColumn(col.id)
              }}
            >
              ✕
            </button>}
          </span>
        </header>

        <div className="kanban-col-body">
          {dropZone(col.id, null, tasks[0]?.id ?? null, `${col.id}-top`)}
          {tasks.map((t, i) => (
            <div key={t.id}>
              <TaskCard
                task={t}
                members={members}
                children={(board?.tasks ?? []).filter((x) => x.parentId === t.id)}
                parents={(board?.tasks ?? []).filter((x) => x.id !== t.id)}
                feature={props.features?.filter((f) => f.sourceTaskId === t.id).sort((a, b) => b.attempt - a.attempt)[0]}
                onStartFeature={(id) => props.onStartFeature?.(id, t.type)}
                onOpenFeature={props.onOpenFeature}
                onUpdate={props.onUpdateTask}
                onDelete={props.onDeleteTask}
                onDragStart={setDragTask}
                onDragEnd={() => setDragTask(null)}
                dragging={dragTask === t.id}
              />
              {dropZone(col.id, t.id, tasks[i + 1]?.id ?? null, `${col.id}-${t.id}`)}
            </div>
          ))}
        </div>

        <div className="kanban-add-task">
          <select
            className="sel"
            aria-label={`Тип нового элемента в «${col.name}»`}
            value={newType[col.id] ?? 'task'}
            onChange={(e) => {
              const type = e.target.value as WorkItemType
              setNewType((m) => ({ ...m, [col.id]: type }))
              if (type !== 'story') setNewParent((m) => ({ ...m, [col.id]: '' }))
            }}
          >
            <option value="epic">Эпик</option><option value="story">История</option><option value="task">Задача</option>
          </select>
          {(newType[col.id] ?? 'task') === 'story' && (
            <select
              className="sel"
              aria-label={`Родительский эпик для истории в «${col.name}»`}
              value={newParent[col.id] ?? ''}
              onChange={(e) => setNewParent((m) => ({ ...m, [col.id]: e.target.value }))}
              required
            >
              <option value="">{(board?.tasks ?? []).some((t) => t.type === 'epic') ? 'Выберите эпик' : 'Сначала создайте эпик'}</option>
              {(board?.tasks ?? []).filter((t) => t.type === 'epic').map((epic) => <option key={epic.id} value={epic.id}>{epic.title}</option>)}
            </select>
          )}
          <input
            className="login-input"
            placeholder="+ задача"
            aria-label={`Новая задача в «${col.name}»`}
            value={newTask[col.id] ?? ''}
            onChange={(e) => setNewTask((m) => ({ ...m, [col.id]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTask(col.id)
            }}
          />
        </div>
      </section>
    )
  }

  return (
    <ToolFrame
      title={props.projectName}
      onClose={props.onClose}
      testId="project-board"
      variant="page"
      className="kanban-frame"
      actions={
        <>
          {props.onOpenSettings && (
            <button className="renbtn kanban-settings" title="Настройки проекта" onClick={props.onOpenSettings}>
              ⚙ Настройки
            </button>
          )}
          <label className="kanban-showhidden">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> скрытые
          </label>
        </>
      }
    >
      {loading && <p className="kanban-empty">Загрузка доски…</p>}
      {!loading && board && (
        <div className="kanban-board" data-testid="kanban-board">
          {columns.map(renderColumn)}
          <div className="kanban-col kanban-col--add">
            <input
              className="login-input"
              placeholder="+ колонка"
              aria-label="Новая колонка"
              value={newColumn}
              onChange={(e) => setNewColumn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addColumn()
              }}
            />
            <button className="login-submit" onClick={addColumn} disabled={!newColumn.trim()}>
              Добавить
            </button>
          </div>
        </div>
      )}
    </ToolFrame>
  )
}

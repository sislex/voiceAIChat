// Самодостаточная канбан-доска в стиле Jira: панель фильтров (поиск, аватары,
// быстрые фильтры, тип/приоритет/метка/эпик, «скрытые»), свимлейны (нет/по
// эпикам/по исполнителям), колонки со счётчиком и WIP-лимитом, карточки,
// модалка задачи. Никакого стора/роутинга/глобального состояния — все данные и
// колбэки только через пропсы; входные данные нормализуются (normalize.ts).
// Перетаскивание — нативный HTML5 DnD: карточки (MIME application/x-task) и
// колонки (application/x-column) с раздельными типами. Колонка = статус.

import { useMemo, useRef, useState } from 'react'
import type { Board, KanbanColumn, ProjectMember, Task, TaskPriority, WorkItemType } from '@shared/projects'
import { TASK_PRIORITIES, WORK_ITEM_TYPES } from '@shared/projects'
import type { FeatureRun } from '@shared/features'
import type { ModifierPrompt } from '@shared/types'
import type { GenerateParams, Suggestion } from '../prompt-builder/PromptBuilder'
import { TaskCard, epicOf } from './TaskCard'
import { TaskModal, type TaskUpdateFields } from './TaskModal'
import { Avatar, PRIORITY_LABEL, TYPE_LABEL, epicColor, issueKey } from './kanbanMeta'
import { normalizeBoard } from './normalize'

export type Swimlane = 'none' | 'epic' | 'assignee'

export interface KanbanBoardProps {
  projectName: string
  board: Board | null
  loading: boolean
  /** Текст ошибки загрузки/операции: баннер вместо доски (board=null) или над ней. */
  error?: string | null
  members: ProjectMember[]
  features?: FeatureRun[]
  /** Логин текущего пользователя — для быстрого фильтра «Только мои». */
  currentUser?: string | null
  /** Управляемая открытая задача (обёртке-странице нужен перехват Esc);
      не задано — состояние внутреннее (Storybook, встраивание). */
  openTaskId?: string | null
  onOpenTaskChange?: (taskId: string | null) => void
  /** Стартовое значение селекта «Свимлейны». */
  defaultSwimlane?: Swimlane
  onCreateColumn: (name: string) => void
  onUpdateColumn: (columnId: string, fields: { name?: string; wipLimit?: number | null }) => void
  onSetColumnHidden: (columnId: string, hidden: boolean) => void
  onReorderColumns: (order: string[]) => void
  onDeleteColumn: (columnId: string) => void
  onCreateTask: (columnId: string, input: { title: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority }) => void
  onUpdateTask: (taskId: string, fields: TaskUpdateFields) => void
  onMoveTask: (taskId: string, columnId: string, afterId?: string | null, beforeId?: string | null) => void
  onDeleteTask: (taskId: string) => void
  /** Открыть связанный с задачей чат (кнопка на карточке и в модалке). */
  onOpenChat?: (taskId: string) => void
  onStartFeature?: (itemId: string, type: WorkItemType) => void

  onOpenFeature?: (featureId: string) => void
  aiAssistPrompts?: ModifierPrompt[]
  onAiAssistPromptsChange?: (next: ModifierPrompt[]) => void
  generateAiAssist?: (params: GenerateParams) => Promise<Suggestion[]>
}

const RECENT_MS = 24 * 60 * 60 * 1000

/** Мультивыбор в выпадашке фильтра (details/summary — без своего позиционирования). */
function FilterDropdown({ label, active, children }: { label: string; active: number; children: JSX.Element }): JSX.Element {
  return (
    <details className="jfilter">
      <summary>
        {label}
        {active > 0 && <span className="jfilter-count">{active}</span>}
      </summary>
      <div className="jfilter-menu">{children}</div>
    </details>
  )
}

export function KanbanBoard(props: KanbanBoardProps): JSX.Element {
  const { loading, members } = props
  const [showHidden, setShowHidden] = useState(false)
  const [search, setSearch] = useState('')
  const [assignees, setAssignees] = useState<ReadonlySet<string>>(new Set())
  const [types, setTypes] = useState<ReadonlySet<WorkItemType>>(new Set())
  const [priorities, setPriorities] = useState<ReadonlySet<TaskPriority>>(new Set())
  const [labels, setLabels] = useState<ReadonlySet<string>>(new Set())
  const [epics, setEpics] = useState<ReadonlySet<string>>(new Set())
  const [onlyMine, setOnlyMine] = useState(false)
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [recentOnly, setRecentOnly] = useState(false)
  const [swimlane, setSwimlane] = useState<Swimlane>(props.defaultSwimlane ?? 'none')
  const [collapsedLanes, setCollapsedLanes] = useState<ReadonlySet<string>>(new Set())
  const [dragTask, setDragTask] = useState<string | null>(null)
  const [dragColumn, setDragColumn] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [colMenu, setColMenu] = useState<string | null>(null)
  const [wipEditing, setWipEditing] = useState<string | null>(null)
  const [wipDraft, setWipDraft] = useState('')
  const [composerCol, setComposerCol] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState<WorkItemType>('task')
  const [newParent, setNewParent] = useState('')
  const [newColumn, setNewColumn] = useState('')
  // Модалка задачи: управляемая пропсами или внутренняя.
  const [internalOpenTask, setInternalOpenTask] = useState<string | null>(null)
  const openTaskId = props.openTaskId !== undefined ? props.openTaskId : internalOpenTask
  const setOpenTaskId = props.onOpenTaskChange ?? setInternalOpenTask
  const composerRef = useRef<HTMLInputElement | null>(null)

  const board = useMemo(() => normalizeBoard(props.board), [props.board])
  const allTasks = useMemo(() => board?.tasks ?? [], [board])
  const columns = (board?.columns ?? []).filter((c) => showHidden || !c.hidden)
  const doneColumnIds = useMemo(
    () => new Set((board?.columns ?? []).filter((c) => c.semanticType === 'done').map((c) => c.id)),
    [board]
  )
  const allEpics = allTasks.filter((t) => t.type === 'epic')
  const allLabels = useMemo(() => [...new Set(allTasks.flatMap((t) => t.labels))].sort(), [allTasks])

  const toggle = <T,>(set: ReadonlySet<T>, v: T): ReadonlySet<T> => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  }

  const filtersActive =
    search.trim() !== '' || assignees.size > 0 || types.size > 0 || priorities.size > 0 ||
    labels.size > 0 || epics.size > 0 || onlyMine || flaggedOnly || recentOnly

  const resetFilters = (): void => {
    setSearch('')
    setAssignees(new Set())
    setTypes(new Set())
    setPriorities(new Set())
    setLabels(new Set())
    setEpics(new Set())
    setOnlyMine(false)
    setFlaggedOnly(false)
    setRecentOnly(false)
  }

  const matches = (t: Task): boolean => {
    const q = search.trim().toLowerCase()
    if (q && !t.title.toLowerCase().includes(q) && !issueKey(props.projectName, t).toLowerCase().includes(q)) return false
    if (assignees.size > 0 && !assignees.has(t.assignee ?? '')) return false
    if (types.size > 0 && !types.has(t.type)) return false
    if (priorities.size > 0 && !priorities.has(t.priority)) return false
    if (labels.size > 0 && !t.labels.some((l) => labels.has(l))) return false
    if (epics.size > 0) {
      const epic = epicOf(t, allTasks)
      if (!(epic && epics.has(epic.id)) && !(t.type === 'epic' && epics.has(t.id))) return false
    }
    if (onlyMine && t.assignee !== (props.currentUser ?? null)) return false
    if (flaggedOnly && !t.flagged) return false
    if (recentOnly && Date.now() - t.updatedAt > RECENT_MS) return false
    return true
  }

  const tasksOf = (columnId: string, lane?: { kind: Swimlane; id: string }): Task[] =>
    allTasks
      .filter((t) => t.columnId === columnId && matches(t))
      .filter((t) => {
        if (!lane || lane.kind === 'none') return true
        if (lane.kind === 'epic') {
          if (t.type === 'epic') return false
          const epic = epicOf(t, allTasks)
          return (epic?.id ?? '') === lane.id
        }
        return (t.assignee ?? '') === lane.id
      })
      .sort((a, b) => a.position - b.position)

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

  const moveTop = (taskId: string): void => {
    const t = allTasks.find((x) => x.id === taskId)
    if (!t) return
    const list = allTasks.filter((x) => x.columnId === t.columnId && x.id !== taskId).sort((a, b) => a.position - b.position)
    props.onMoveTask(taskId, t.columnId, null, list[0]?.id ?? null)
  }
  const moveBottom = (taskId: string): void => {
    const t = allTasks.find((x) => x.id === taskId)
    if (!t) return
    const list = allTasks.filter((x) => x.columnId === t.columnId && x.id !== taskId).sort((a, b) => a.position - b.position)
    props.onMoveTask(taskId, t.columnId, list[list.length - 1]?.id ?? null, null)
  }

  const submitComposer = (columnId: string): void => {
    const title = newTitle.trim()
    if (!title || (newType === 'story' && !newParent)) return
    props.onCreateTask(columnId, { title, type: newType, ...(newType === 'story' ? { parentId: newParent } : {}) })
    setNewTitle('')
    if (newType !== 'story') setNewParent('')
  }

  const openComposer = (columnId: string): void => {
    setComposerCol(columnId)
    setNewTitle('')
    setTimeout(() => composerRef.current?.focus(), 0)
  }

  const cardOf = (t: Task): JSX.Element => (
    <TaskCard
      task={t}
      projectName={props.projectName}
      allTasks={allTasks}
      doneColumnIds={doneColumnIds}
      feature={props.features?.filter((f) => f.sourceTaskId === t.id).sort((a, b) => b.attempt - a.attempt)[0]}
      onOpen={setOpenTaskId}
      onUpdate={props.onUpdateTask}
      onDelete={props.onDeleteTask}
      onMoveTop={moveTop}
      onMoveBottom={moveBottom}
      onStartFeature={(id) => props.onStartFeature?.(id, t.type)}
      onOpenFeature={props.onOpenFeature}
      onOpenChat={props.onOpenChat}
      onDragStart={setDragTask}

      onDragEnd={() => setDragTask(null)}
      dragging={dragTask === t.id}
    />
  )

  const columnHead = (col: KanbanColumn): JSX.Element => {
    const visible = tasksOf(col.id).length
    const total = allTasks.filter((t) => t.columnId === col.id).length
    const overWip = col.wipLimit != null && total > col.wipLimit
    return (
      <header
        className={`jcol-head${overWip ? ' jcol-head--over' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-column', col.id)
          e.dataTransfer.effectAllowed = 'move'
          setDragColumn(col.id)
        }}
        onDragEnd={() => setDragColumn(null)}
        onDragOver={(e) => {
          if (dragColumn) e.preventDefault()
        }}
        onDrop={() => reorderTo(col.id)}
      >
        {renaming === col.id ? (
          <input
            className="ctitle-edit"
            autoFocus
            aria-label="Название колонки"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => {
              if (renameDraft.trim()) props.onUpdateColumn(col.id, { name: renameDraft.trim() })
              setRenaming(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (renameDraft.trim()) props.onUpdateColumn(col.id, { name: renameDraft.trim() })
                setRenaming(null)
              } else if (e.key === 'Escape') setRenaming(null)
            }}
          />
        ) : (
          <span
            className="jcol-name"
            onDoubleClick={() => {
              setRenaming(col.id)
              setRenameDraft(col.name)
            }}
          >
            {col.name}
            <span className="jcol-count">{filtersActive ? `${visible} из ${total}` : total}</span>
            {col.wipLimit != null && (
              <span className={`jcol-wip${overWip ? ' jcol-wip--over' : ''}`} title={`WIP-лимит: ${col.wipLimit}`}>
                {total}/{col.wipLimit}
              </span>
            )}
            {col.hidden && <span className="jcol-hidden-mark" title="Колонка скрыта">🙈</span>}
          </span>
        )}
        <span className="jcard-menuwrap">
          <button
            className="jcard-menubtn"
            aria-label={`Меню колонки «${col.name}»`}
            title="Меню колонки"
            aria-expanded={colMenu === col.id}
            onClick={() => setColMenu((v) => (v === col.id ? null : col.id))}
          >
            ⋯
          </button>
          {colMenu === col.id && (
            <div className="jcard-menu">
              <button
                onClick={() => {
                  setColMenu(null)
                  setRenaming(col.id)
                  setRenameDraft(col.name)
                }}
              >
                Переименовать
              </button>
              {wipEditing === col.id ? (
                <input
                  className="login-input jwip-input"
                  autoFocus
                  aria-label="WIP-лимит"
                  type="number"
                  min="0"
                  placeholder="без лимита"
                  value={wipDraft}
                  onChange={(e) => setWipDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      props.onUpdateColumn(col.id, { wipLimit: wipDraft === '' || Number(wipDraft) <= 0 ? null : Number(wipDraft) })
                      setWipEditing(null)
                      setColMenu(null)
                    } else if (e.key === 'Escape') setWipEditing(null)
                  }}
                />
              ) : (
                <button
                  onClick={() => {
                    setWipEditing(col.id)
                    setWipDraft(col.wipLimit != null ? String(col.wipLimit) : '')
                  }}
                >
                  WIP-лимит…
                </button>
              )}
              <button
                onClick={() => {
                  setColMenu(null)
                  props.onSetColumnHidden(col.id, !col.hidden)
                }}
              >
                {col.hidden ? 'Показать колонку' : 'Скрыть колонку'}
              </button>
              {col.semanticType === 'custom' && (
                <button
                  className="jcard-menu-danger"
                  onClick={() => {
                    setColMenu(null)
                    if (window.confirm(`Удалить колонку «${col.name}» со всеми задачами?`)) props.onDeleteColumn(col.id)
                  }}
                >
                  Удалить
                </button>
              )}
            </div>
          )}
        </span>
      </header>
    )
  }

  const composer = (col: KanbanColumn): JSX.Element =>
    composerCol === col.id ? (
      <div className="jcompose" onKeyDown={(e) => { if (e.key === 'Escape') setComposerCol(null) }}>
        <div className="jcompose-row">
          <select
            className="sel"
            aria-label={`Тип нового элемента в «${col.name}»`}
            value={newType}
            onChange={(e) => {
              const t = e.target.value as WorkItemType
              setNewType(t)
              if (t !== 'story') setNewParent('')
            }}
          >
            {WORK_ITEM_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
          {newType === 'story' && (
            <select
              className="sel"
              aria-label={`Родительский эпик для истории в «${col.name}»`}
              value={newParent}
              onChange={(e) => setNewParent(e.target.value)}
              required
            >
              <option value="">{allEpics.length ? 'Выберите эпик' : 'Сначала создайте эпик'}</option>
              {allEpics.map((epic) => (
                <option key={epic.id} value={epic.id}>{epic.title}</option>
              ))}
            </select>
          )}
        </div>
        <input
          ref={composerRef}
          className="login-input"
          placeholder="Что нужно сделать?"
          aria-label={`Новая задача в «${col.name}»`}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitComposer(col.id)
          }}
        />
      </div>
    ) : (
      <button className="jcompose-open" aria-label={`Создать элемент в «${col.name}»`} onClick={() => openComposer(col.id)}>
        + Создать
      </button>
    )

  const columnBody = (col: KanbanColumn, lane?: { kind: Swimlane; id: string }): JSX.Element => {
    const tasks = tasksOf(col.id, lane)
    const overWip = col.wipLimit != null && allTasks.filter((t) => t.columnId === col.id).length > col.wipLimit
    return (
      <div className={`jcol-body${overWip ? ' jcol-body--over' : ''}`}>
        {dropZone(col.id, null, tasks[0]?.id ?? null, `${lane?.id ?? ''}-${col.id}-top`)}
        {tasks.map((t, i) => (
          <div key={t.id}>
            {cardOf(t)}
            {dropZone(col.id, t.id, tasks[i + 1]?.id ?? null, `${lane?.id ?? ''}-${col.id}-${t.id}`)}
          </div>
        ))}
      </div>
    )
  }

  // Свимлейны: по эпикам (эпики-карточки скрыты, «Без эпика» — последний) или
  // по исполнителям («Не назначено» — последний).
  const lanes: Array<{ id: string; title: JSX.Element; count: number }> =
    swimlane === 'epic'
      ? [
          ...allEpics.map((e) => ({
            id: e.id,
            title: (
              <span className="jlane-title">
                <span className="jcard-epic-dot" style={{ background: epicColor(e.id) }} />
                {e.title}
              </span>
            ),
            count: columns.reduce((n, c) => n + tasksOf(c.id, { kind: 'epic', id: e.id }).length, 0)
          })),
          {
            id: '',
            title: <span className="jlane-title">Без эпика</span>,
            count: columns.reduce((n, c) => n + tasksOf(c.id, { kind: 'epic', id: '' }).length, 0)
          }
        ]
      : swimlane === 'assignee'
        ? [
            ...members.map((m) => ({
              id: m.username,
              title: (
                <span className="jlane-title">
                  <Avatar username={m.username} size={20} /> {m.username}
                </span>
              ),
              count: columns.reduce((n, c) => n + tasksOf(c.id, { kind: 'assignee', id: m.username }).length, 0)
            })),
            {
              id: '',
              title: <span className="jlane-title">Не назначено</span>,
              count: columns.reduce((n, c) => n + tasksOf(c.id, { kind: 'assignee', id: '' }).length, 0)
            }
          ]
        : []

  const openTask = openTaskId ? allTasks.find((t) => t.id === openTaskId) : undefined

  const addColumnBox = (
    <div className="jcol jcol--add">
      <input
        className="login-input"
        placeholder="+ колонка"
        aria-label="Новая колонка"
        value={newColumn}
        onChange={(e) => setNewColumn(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && newColumn.trim()) {
            props.onCreateColumn(newColumn.trim())
            setNewColumn('')
          }
        }}
      />
      <button
        className="login-submit"
        onClick={() => {
          if (newColumn.trim()) {
            props.onCreateColumn(newColumn.trim())
            setNewColumn('')
          }
        }}
        disabled={!newColumn.trim()}
      >
        Добавить
      </button>
    </div>
  )

  return (
    <>
      {loading && <p className="kanban-empty">Загрузка доски…</p>}
      {!loading && props.error && (
        <p className="kanban-error" role="alert">{props.error}</p>
      )}
      {!loading && board && (
        <div className="jboard-wrap">
          <div className="jboard-filters" data-testid="board-filters">
            <input
              className="login-input jsearch"
              type="search"
              placeholder="Поиск на доске"
              aria-label="Поиск на доске"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="javatars" role="group" aria-label="Фильтр по исполнителям">
              {members.map((m) => (
                <button
                  key={m.username}
                  className={`javatar-btn${assignees.has(m.username) ? ' on' : ''}`}
                  aria-label={`Фильтр: ${m.username}`}
                  aria-pressed={assignees.has(m.username)}
                  title={m.username}
                  onClick={() => setAssignees(toggle(assignees, m.username))}
                >
                  <Avatar username={m.username} size={28} />
                </button>
              ))}
              <button
                className={`javatar-btn${assignees.has('') ? ' on' : ''}`}
                aria-label="Фильтр: не назначено"
                aria-pressed={assignees.has('')}
                title="Не назначено"
                onClick={() => setAssignees(toggle(assignees, ''))}
              >
                <span className="javatar javatar--none">?</span>
              </button>
            </span>
            {props.currentUser && (
              <button className={`jquick${onlyMine ? ' on' : ''}`} aria-pressed={onlyMine} onClick={() => setOnlyMine((v) => !v)}>
                Только мои
              </button>
            )}
            <button className={`jquick${flaggedOnly ? ' on' : ''}`} aria-pressed={flaggedOnly} onClick={() => setFlaggedOnly((v) => !v)}>
              С флагом
            </button>
            <button className={`jquick${recentOnly ? ' on' : ''}`} aria-pressed={recentOnly} onClick={() => setRecentOnly((v) => !v)}>
              Обновлены за сутки
            </button>
            <FilterDropdown label="Тип" active={types.size}>
              <>
                {WORK_ITEM_TYPES.map((t) => (
                  <label key={t}>
                    <input type="checkbox" checked={types.has(t)} onChange={() => setTypes(toggle(types, t))} /> {TYPE_LABEL[t]}
                  </label>
                ))}
              </>
            </FilterDropdown>
            <FilterDropdown label="Приоритет" active={priorities.size}>
              <>
                {TASK_PRIORITIES.map((p) => (
                  <label key={p}>
                    <input type="checkbox" checked={priorities.has(p)} onChange={() => setPriorities(toggle(priorities, p))} /> {PRIORITY_LABEL[p]}
                  </label>
                ))}
              </>
            </FilterDropdown>
            {allLabels.length > 0 && (
              <FilterDropdown label="Метка" active={labels.size}>
                <>
                  {allLabels.map((l) => (
                    <label key={l}>
                      <input type="checkbox" checked={labels.has(l)} onChange={() => setLabels(toggle(labels, l))} /> {l}
                    </label>
                  ))}
                </>
              </FilterDropdown>
            )}
            {allEpics.length > 0 && (
              <FilterDropdown label="Эпик" active={epics.size}>
                <>
                  {allEpics.map((e) => (
                    <label key={e.id}>
                      <input type="checkbox" checked={epics.has(e.id)} onChange={() => setEpics(toggle(epics, e.id))} /> {e.title}
                    </label>
                  ))}
                </>
              </FilterDropdown>
            )}
            <label className="jswimlane">
              Свимлейны
              <select className="sel" aria-label="Свимлейны" value={swimlane} onChange={(e) => setSwimlane(e.target.value as Swimlane)}>
                <option value="none">Нет</option>
                <option value="epic">По эпикам</option>
                <option value="assignee">По исполнителям</option>
              </select>
            </label>
            <label className="kanban-showhidden">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> скрытые
            </label>
            {filtersActive && (
              <button className="jquick jquick--clear" onClick={resetFilters}>
                Сбросить
              </button>
            )}
          </div>

          {swimlane === 'none' ? (
            <div className="kanban-board jboard" data-testid="kanban-board">
              {columns.map((col) => (
                <section
                  key={col.id}
                  className={`jcol${col.hidden ? ' jcol--hidden' : ''}`}
                  data-testid="kanban-column"
                  onDragOver={(e) => {
                    if (dragColumn) e.preventDefault()
                  }}
                  onDrop={() => reorderTo(col.id)}
                >
                  {columnHead(col)}
                  {columnBody(col)}
                  {composer(col)}
                </section>
              ))}
              {addColumnBox}
            </div>
          ) : (
            <div className="kanban-board jboard jboard--lanes" data-testid="kanban-board">
              <div className="jlane-heads">
                {columns.map((col) => (
                  <section
                    key={col.id}
                    className={`jcol jcol--headonly${col.hidden ? ' jcol--hidden' : ''}`}
                    data-testid="kanban-column"
                    onDragOver={(e) => {
                      if (dragColumn) e.preventDefault()
                    }}
                    onDrop={() => reorderTo(col.id)}
                  >
                    {columnHead(col)}
                  </section>
                ))}
                {addColumnBox}
              </div>
              {lanes.map((lane) => (
                <section key={lane.id || '·'} className="jlane" data-testid="swimlane">
                  <button
                    className="jlane-head"
                    aria-expanded={!collapsedLanes.has(lane.id)}
                    onClick={() => setCollapsedLanes(toggle(collapsedLanes, lane.id))}
                  >
                    <span className="jlane-arrow">{collapsedLanes.has(lane.id) ? '▶' : '▼'}</span>
                    {lane.title}
                    <span className="jcol-count">{lane.count}</span>
                  </button>
                  {!collapsedLanes.has(lane.id) && (
                    <div className="jlane-cols">
                      {columns.map((col) => (
                        <div key={col.id} className="jcol jcol--incell">
                          {columnBody(col, { kind: swimlane, id: lane.id })}
                          {lane.id === '' ? composer(col) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      )}
      {openTask && board && (
        <TaskModal
          task={openTask}
          board={board}
          projectName={props.projectName}
          members={members}
          feature={props.features?.filter((f) => f.sourceTaskId === openTask.id).sort((a, b) => b.attempt - a.attempt)[0]}
          onUpdate={props.onUpdateTask}
          onDelete={props.onDeleteTask}
          onMoveToColumn={(taskId, columnId) => props.onMoveTask(taskId, columnId, null, null)}
          onStartFeature={props.onStartFeature}
          onOpenFeature={props.onOpenFeature}
          onOpenChat={props.onOpenChat}

          aiAssistPrompts={props.aiAssistPrompts}
          onAiAssistPromptsChange={props.onAiAssistPromptsChange}
          generateAiAssist={props.generateAiAssist}
          onOpenTask={setOpenTaskId}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </>
  )
}

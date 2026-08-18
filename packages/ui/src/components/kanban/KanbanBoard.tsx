// Самодостаточная канбан-доска в стиле Jira: панель фильтров (поиск, аватары,
// быстрые фильтры, тип/приоритет/метка/эпик, «скрытые»), свимлейны (нет/по
// эпикам/по исполнителям), колонки со счётчиком и WIP-лимитом, карточки,
// модалка задачи. Никакого стора/роутинга/глобального состояния — все данные и
// колбэки только через пропсы; входные данные нормализуются (normalize.ts).
// Перетаскивание — на pointer-событиях (lib/dnd.ts), одинаково мышью, пальцем и
// стилусом: HTML5 DnD мобильные браузеры не поддерживают, и доска была на
// телефоне нередактируемой. Доска владеет жестом целиком — карточка только
// сообщает о захвате, а место вставки считается по зонам между карточками
// (data-dropzone → afterId/beforeId). Плюс перенос с клавиатуры: Space — взять,
// стрелки — выбрать место, Enter — положить, Esc — отмена; каждый шаг
// проговаривается в aria-live. Колонка = статус.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Board, KanbanColumn, ProjectMember, Task, TaskPriority, WorkItemType } from '@shared/projects'
import { compareTasksInColumn, TASK_PRIORITIES, WORK_ITEM_TYPES } from '@shared/projects'
import type { CiRunSummary } from '@shared/ci'
import type { ModifierPrompt } from '@shared/types'
import type { TaskPreparationLlmSelection, TaskPreparationRun } from '@shared/qa'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { LlmEngineOption } from '@shared/admin'
import type { GenerateParams, Suggestion } from '../prompt-builder/PromptBuilder'
import { TaskCard, epicOf } from './TaskCard'
import { TaskModal, type TaskUpdateFields } from './TaskModal'
import { Avatar, PRIORITY_LABEL, TYPE_LABEL, columnRegionLabel, epicColor, issueKey } from './kanbanMeta'
import { normalizeBoard } from './normalize'
import { Button } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { useConfirm } from '@voicechat/ui-kit'
import { Skeleton, RefreshIndicator } from '@voicechat/ui-kit'
import { EmptyState } from '@voicechat/ui-kit'
import { ErrorState } from '@voicechat/ui-kit'
import { loadView, type LoadStatus } from '../../lib/loadState'
import { useCommandSource } from '../../lib/useCommands'
import {
  autoScroll,
  nearestByCenterY,
  nearestElement,
  pointInRect,
  usePointerDrag,
  type DragPoint
} from '../../lib/dnd'

export type Swimlane = 'none' | 'epic' | 'assignee'

/** Место вставки: ячейка колонки (в свимлейнах их несколько) и соседи задачи. */
interface DropAt {
  bodyKey: string
  columnId: string
  afterId: string | null
  beforeId: string | null
  /** Щель в отрисованном списке ячейки (0 — над первой карточкой) — где рисуем
      плейсхолдер. Отдельно от afterId/beforeId: при клавиатурном переносе
      карточка остаётся на месте, и позиции «между соседями» смещены на неё. */
  slot: number
}

/** Клавиатурный перенос: выбранное стрелками место и исходное — чтобы «положил
    туда же» не уходило на сервер. */
interface KeyboardGrab {
  taskId: string
  title: string
  columnId: string
  index: number
  /** Дорожка свимлейна, внутри которой идёт перенос (null — свимлейнов нет). */
  laneId: string | null
  from: { columnId: string; index: number }
}

/** Ключ ячейки: пара «дорожка + колонка» — в свимлейнах колонка встречается много раз. */
function bodyKey(laneId: string | null, columnId: string): string {
  return `${laneId ?? ''}|${columnId}`
}

export interface KanbanBoardProps {
  projectName: string
  board: Board | null
  loading: boolean
  /** Текст ошибки загрузки/операции: экран ошибки вместо доски (board=null) или баннер над ней. */
  error?: string | null
  /** Повторить загрузку доски (кнопка «Повторить» на экране ошибки). */
  onRetry?: () => void
  members: ProjectMember[]
  /** Устойчивый идентификатор текущего пользователя (в текущем API это login/name). */
  currentUserId?: string | null
  /** Legacy alias: логин текущего пользователя. */
  currentUser?: string | null
  /** Управляемая открытая задача (обёртке-странице нужен перехват Esc);
      не задано — состояние внутреннее (Storybook, встраивание). */
  openTaskId?: string | null
  onOpenTaskChange?: (taskId: string | null, tab?: 'preparation') => void
  initialOpenTaskTab?: 'preparation'
  onSelectedFieldChange?: (field: keyof TaskUpdateFields | null) => void
  /** Стартовое значение селекта «Свимлейны». */
  defaultSwimlane?: Swimlane
  /**
   * Приходят ли с сервера давно завершённые задачи. Фильтрация серверная, так
   * что переключатель — это запрос доски заново (onShowCompletedChange); без
   * колбэка чекбокс живёт своим состоянием и ни на что не влияет (Storybook).
   */
  showCompleted?: boolean
  onShowCompletedChange?: (show: boolean) => void
  /**
   * Показывать ли в списке бесед чаты завершённых задач. К самой доске
   * отношения не имеет, но живёт рядом с «Показать завершённые»: это одна пара
   * настроек «что делать с завершённым». Без колбэка галки нет.
   */
  showDoneTaskChats?: boolean
  onShowDoneTaskChatsChange?: (show: boolean) => void
  onCreateColumn: (name: string) => void
  onUpdateColumn: (columnId: string, fields: { name?: string; wipLimit?: number | null }) => void
  onSetColumnHidden: (columnId: string, hidden: boolean) => void
  onReorderColumns: (order: string[]) => void
  onDeleteColumn: (columnId: string) => void
  onCreateTask: (columnId: string, input: { title: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority }) => void
  onUpdateTask: (taskId: string, fields: TaskUpdateFields) => void
  onMoveTask: (taskId: string, columnId: string, afterId?: string | null, beforeId?: string | null) => void | boolean | Promise<void | boolean>
  onDeleteTask: (taskId: string) => void
  /** Открыть связанный с задачей чат (кнопка на карточке и в модалке). */
  onOpenChat?: (taskId: string) => void
  /** Создать связанный чат при первом открытии карточки, не уходя с доски. */
  onEnsureChat?: (taskId: string) => void
  /** Сводки CI-ранов по taskId. */
  ciSummaries?: Record<string, CiRunSummary>
  /** Запустить CI-воркфлоу для задачи (в общую очередь). */
  onStartCi?: (taskId: string) => void | Promise<void>
  /** Запустить CI-воркфлоу сразу, мимо очереди (машина подбирается автоматически). */
  onStartCiParallel?: (taskId: string) => void | Promise<void>
  /** Открыть ленту CI-рана. */
  onOpenCiRun?: (runId: string) => void
  /** Убрать ожидающий ран из очереди CI. */
  onDequeueCiRun?: (runId: string) => void
  onStartMerge?: (taskId: string, agentId?: string | null) => void
  loadPreparationRuns?: (taskId: string) => Promise<TaskPreparationRun[]>
  onStartPreparation?: (taskId: string, selection: TaskPreparationLlmSelection) => Promise<TaskPreparationRun | void>
  onRetryPreparation?: (runId: string, selection: TaskPreparationLlmSelection) => Promise<TaskPreparationRun | void>
  llmAccess?: UserLlmAccess[]
  llmEngines?: LlmEngineOption[]
  onCancelPreparation?: (runId: string) => Promise<TaskPreparationRun | void>
  onAnswerPreparation?: (questionId: string, answer: string) => Promise<unknown>
  onExportPreparation?: (runId: string, format: 'md' | 'json') => Promise<void>
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
  const confirm = useConfirm()
  const [showHidden, setShowHidden] = useState(false)
  const [internalShowCompleted, setInternalShowCompleted] = useState(false)
  const showCompleted = props.showCompleted ?? internalShowCompleted
  const setShowCompleted = props.onShowCompletedChange ?? setInternalShowCompleted
  const [search, setSearch] = useState('')
  const [assignees, setAssignees] = useState<ReadonlySet<string>>(new Set())
  const [types, setTypes] = useState<ReadonlySet<WorkItemType>>(new Set())
  const [priorities, setPriorities] = useState<ReadonlySet<TaskPriority>>(new Set())
  const [labels, setLabels] = useState<ReadonlySet<string>>(new Set())
  const [epics, setEpics] = useState<ReadonlySet<string>>(new Set())
  const [onlyMine, setOnlyMine] = useState(false)
  /** Локальные фильтры исполнителя: all | '' (без исполнителя) | username. */
  const [columnAssignees, setColumnAssignees] = useState<Record<string, string>>({})
  const [filtersHydrated, setFiltersHydrated] = useState(false)
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [recentOnly, setRecentOnly] = useState(false)
  const [swimlane, setSwimlane] = useState<Swimlane>(props.defaultSwimlane ?? 'none')
  const [collapsedLanes, setCollapsedLanes] = useState<ReadonlySet<string>>(new Set())
  const [dragTask, setDragTask] = useState<string | null>(null)
  const [dragColumn, setDragColumn] = useState<string | null>(null)
  // Перенос: место вставки (общее для указателя и клавиатуры), высота
  // приподнятой карточки (её занимает плейсхолдер), колонка-цель при переносе
  // колонки, состояние клавиатурного переноса и текст для скринридера.
  const [dropAt, setDropAt] = useState<DropAt | null>(null)
  const [liftHeight, setLiftHeight] = useState(0)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [grab, setGrab] = useState<KeyboardGrab | null>(null)
  const [announce, setAnnounce] = useState('')
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
  const [openTaskTab, setOpenTaskTab] = useState<'preparation' | undefined>(props.initialOpenTaskTab)
  const openTaskId = props.openTaskId !== undefined ? props.openTaskId : internalOpenTask
  const setOpenTaskId = (taskId: string | null, tab?: 'preparation'): void => {
    setOpenTaskTab(tab)
    if (props.onOpenTaskChange) props.onOpenTaskChange(taskId, tab)
    else setInternalOpenTask(taskId)
  }
  const composerRef = useRef<HTMLInputElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const colMenuRef = useRef<HTMLSpanElement | null>(null)
  const drag = usePointerDrag()

  useEffect(() => {
    if (!colMenu) return
    const closeOnOutsidePress = (event: PointerEvent): void => {
      if (!colMenuRef.current?.contains(event.target as Node)) setColMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setColMenu(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [colMenu])
  // Esc клавиатурного переноса нужно поймать раньше Esc страницы-обёртки
  // (useDialogStack слушает тот же window в фазе перехвата): иначе доска
  // закрывалась бы вместо отмены переноса. Поэтому именно useLayoutEffect —
  // layout-эффекты детей выполняются раньше родительских, и наш слушатель
  // оказывается первым в очереди.
  const grabRef = useRef<KeyboardGrab | null>(null)
  grabRef.current = grab
  const cancelGrabRef = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !grabRef.current) return
      e.preventDefault()
      e.stopImmediatePropagation()
      cancelGrabRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const board = useMemo(() => normalizeBoard(props.board), [props.board])
  const allTasks = useMemo(() => board?.tasks ?? [], [board])
  const currentUserId = props.currentUserId ?? props.currentUser ?? null
  const filterStorageKey = useMemo(() => {
    const projectId = board?.columns[0]?.projectId ?? allTasks[0]?.projectId ?? props.projectName
    return currentUserId ? `voicechat.kanban.filters.v2.${encodeURIComponent(currentUserId)}.${encodeURIComponent(projectId)}` : null
  }, [allTasks, board, currentUserId, props.projectName])
  useEffect(() => {
    setFiltersHydrated(false)
    // Сначала очищаем предыдущий контекст: состояние другого пользователя,
    // проекта или доски не должно пережить смену ключа.
    setSearch('')
    setAssignees(new Set())
    setTypes(new Set())
    setPriorities(new Set())
    setLabels(new Set())
    setEpics(new Set())
    setOnlyMine(false)
    setColumnAssignees({})
    setFlaggedOnly(false)
    setRecentOnly(false)
    if (!filterStorageKey) {
      setFiltersHydrated(true)
      return
    }
    try {
      const raw = localStorage.getItem(filterStorageKey)
      if (raw) {
        const saved = JSON.parse(raw) as { search?: string; assignees?: string[]; types?: WorkItemType[]; priorities?: TaskPriority[]; labels?: string[]; epics?: string[]; onlyMine?: boolean; flaggedOnly?: boolean; recentOnly?: boolean; columnAssignees?: Record<string, string> }
        if (typeof saved.search === 'string') setSearch(saved.search)
        if (Array.isArray(saved.assignees)) setAssignees(new Set(saved.assignees))
        if (Array.isArray(saved.types)) setTypes(new Set(saved.types))
        if (Array.isArray(saved.priorities)) setPriorities(new Set(saved.priorities))
        if (Array.isArray(saved.labels)) setLabels(new Set(saved.labels))
        if (Array.isArray(saved.epics)) setEpics(new Set(saved.epics))
        if (typeof saved.onlyMine === 'boolean') setOnlyMine(saved.onlyMine)
        if (typeof saved.flaggedOnly === 'boolean') setFlaggedOnly(saved.flaggedOnly)
        if (typeof saved.recentOnly === 'boolean') setRecentOnly(saved.recentOnly)
        if (saved.columnAssignees && typeof saved.columnAssignees === 'object') setColumnAssignees(saved.columnAssignees)
      }
    } catch { /* localStorage/старое состояние недоступны */ }
    setFiltersHydrated(true)
  }, [filterStorageKey])
  useEffect(() => {
    if (!filtersHydrated || !filterStorageKey) return
    try {
      localStorage.setItem(filterStorageKey, JSON.stringify({ search, assignees: [...assignees], types: [...types], priorities: [...priorities], labels: [...labels], epics: [...epics], onlyMine, flaggedOnly, recentOnly, columnAssignees }))
    } catch { /* localStorage недоступен */ }
  }, [assignees, columnAssignees, epics, filterStorageKey, filtersHydrated, flaggedOnly, labels, onlyMine, priorities, recentOnly, search, types])
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

  const hasColumnAssigneeFilter = Object.values(columnAssignees).some((value) => value !== undefined && value !== 'all')
  const filtersActive =
    search.trim() !== '' || assignees.size > 0 || types.size > 0 || priorities.size > 0 ||
    labels.size > 0 || epics.size > 0 || onlyMine || flaggedOnly || recentOnly || hasColumnAssigneeFilter

  const resetFilters = (): void => {
    setSearch('')
    setAssignees(new Set())
    setTypes(new Set())
    setPriorities(new Set())
    setLabels(new Set())
    setEpics(new Set())
    setOnlyMine(false)
    setColumnAssignees({})
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
    if (onlyMine && t.assignee !== currentUserId) return false
    if (flaggedOnly && !t.flagged) return false
    if (recentOnly && Date.now() - t.updatedAt > RECENT_MS) return false
    return true
  }

  const tasksOf = (columnId: string, lane?: { kind: Swimlane; id: string }): Task[] =>
    allTasks
      .filter((t) => t.columnId === columnId && matches(t))
      .filter((t) => {
        if (onlyMine) return true // глобальный режим временно имеет приоритет
        const selected = columnAssignees[columnId] ?? 'all'
        return selected === 'all' || (selected === '' ? t.assignee == null : t.assignee === selected)
      })
      .filter((t) => {
        if (!lane || lane.kind === 'none') return true
        if (lane.kind === 'epic') {
          if (t.type === 'epic') return false
          const epic = epicOf(t, allTasks)
          return (epic?.id ?? '') === lane.id
        }
        return (t.assignee ?? '') === lane.id
      })
      .sort((a, b) => compareTasksInColumn(a, b, board?.columns.find((c) => c.id === columnId)?.semanticType ?? 'custom'))

  // Перенос колонки moving перед target.
  const reorderTo = (targetId: string, moving: string): void => {
    if (!board || moving === targetId) return
    const ids = board.columns.map((c) => c.id).filter((id) => id !== moving)
    const at = ids.indexOf(targetId)
    ids.splice(at < 0 ? ids.length : at, 0, moving)
    props.onReorderColumns(ids)
  }

  const columnName = (columnId: string): string =>
    (board?.columns ?? []).find((c) => c.id === columnId)?.name ?? 'без названия'

  const laneOf = (laneId: string | null): { kind: Swimlane; id: string } | undefined =>
    swimlane === 'none' || laneId == null ? undefined : { kind: swimlane, id: laneId }

  /** Полный порядок ячейки: скрытые фильтрами карточки сохраняют место в DnD. */
  const fullTasksOf = (columnId: string, lane?: { kind: Swimlane; id: string }): Task[] =>
    allTasks
      .filter((t) => t.columnId === columnId)
      .filter((t) => !lane || lane.kind === 'none' || (lane.kind === 'epic' ? (t.type !== 'epic' && (epicOf(t, allTasks)?.id ?? '') === lane.id) : (t.assignee ?? '') === lane.id))
      .sort((a, b) => compareTasksInColumn(a, b, board?.columns.find((c) => c.id === columnId)?.semanticType ?? 'custom'))

  const neighbours = (taskId: string, columnId: string, laneId: string | null): Task[] =>
    fullTasksOf(columnId, laneOf(laneId)).filter((t) => t.id !== taskId)

  // Ячейка (колонка × дорожка) под указателем. Указатель может уйти за пределы
  // доски (палец у кромки экрана), поэтому при промахе берём ближайшую ячейку.
  const bodyAt = (p: DragPoint): HTMLElement | null => {
    const root = boardRef.current
    if (!root) return null
    const bodies = Array.from(root.querySelectorAll<HTMLElement>('[data-drop-body]'))
    return bodies.find((body) => pointInRect(body.getBoundingClientRect(), p)) ?? nearestElement(bodies, p)
  }

  // Цель по точке указателя: внутри ячейки ближайшая по вертикали зона вставки.
  const findDropAt = (p: DragPoint): DropAt | null => {
    const body = bodyAt(p)
    if (!body) return null
    const zone = nearestByCenterY(Array.from(body.querySelectorAll<HTMLElement>('[data-dropzone]')), p.y)
    if (!zone) return null
    return {
      bodyKey: body.dataset.dropBody ?? '',
      columnId: body.dataset.dropColumn ?? '',
      afterId: zone.dataset.after || null,
      beforeId: zone.dataset.before || null,
      slot: Number(zone.dataset.slot ?? 0)
    }
  }

  const columnAt = (p: DragPoint): string | null => {
    const root = boardRef.current
    if (!root) return null
    const cols = Array.from(root.querySelectorAll<HTMLElement>('[data-column-id]'))
    const hit = cols.find((c) => pointInRect(c.getBoundingClientRect(), p)) ?? nearestElement(cols, p)
    return hit?.dataset.columnId ?? null
  }

  // Горизонтальная ось принадлежит общей поверхности, вертикальная — списку
  // карточек активной колонки. Так перенос у кромки не двигает соседние колонки
  // и их заголовки.
  const autoScrollTo = (p: DragPoint): void => {
    const root = boardRef.current
    if (!root) return
    autoScroll(root, p, 'x')
    const body = bodyAt(p)
    if (body) autoScroll(body, p, 'y')
  }

  /** Положить задачу в выбранное место. Обратно на своё — молча, без запроса. */
  const applyDrop = (taskId: string, at: DropAt): void => {
    if (at.afterId === taskId || at.beforeId === taskId) return
    props.onMoveTask(taskId, at.columnId, at.afterId, at.beforeId)
  }

  const endPointerDrag = (): void => {
    setDragTask(null)
    setDropAt(null)
  }

  const grabTask = (e: ReactPointerEvent<HTMLElement>, card: HTMLElement, taskId: string, immediate: boolean): void => {
    if (grab) return
    drag.begin(e, {
      lift: card,
      immediate,
      onStart: (p) => {
        setLiftHeight(Math.round(card.getBoundingClientRect().height))
        setDragTask(taskId)
        setDropAt(findDropAt(p))
      },
      onMove: (p) => setDropAt(findDropAt(p)),
      tick: autoScrollTo,
      onDrop: (p) => {
        const at = findDropAt(p)
        endPointerDrag()
        if (at) applyDrop(taskId, at)
      },
      onCancel: endPointerDrag
    })
  }

  const grabColumn = (e: ReactPointerEvent<HTMLElement>, handle: HTMLElement, columnId: string, immediate: boolean): void => {
    const section = handle.closest<HTMLElement>('[data-column-id]') ?? handle
    drag.begin(e, {
      lift: section,
      immediate,
      onStart: () => setDragColumn(columnId),
      onMove: (p) => setDragOverColumn(columnAt(p)),
      tick: (p) => {
        if (boardRef.current) autoScroll(boardRef.current, p, 'x')
      },
      onDrop: (p) => {
        const target = columnAt(p)
        setDragColumn(null)
        setDragOverColumn(null)
        if (target) reorderTo(target, columnId)
      },
      onCancel: () => {
        setDragColumn(null)
        setDragOverColumn(null)
      }
    })
  }

  // ---- Перенос с клавиатуры -------------------------------------------------
  // Мышью и пальцем место видно, клавиатурой — нет: поэтому каждый шаг и уходит
  // в aria-live («Задача X, колонка Y, позиция 2 из 5»).
  const dropOfGrab = (g: KeyboardGrab): DropAt => {
    const list = neighbours(g.taskId, g.columnId, g.laneId)
    // Взятая карточка из списка не исчезает (иначе с неё слетел бы фокус),
    // поэтому щель для плейсхолдера считается со сдвигом на неё саму.
    const own = fullTasksOf(g.columnId, laneOf(g.laneId)).findIndex((t) => t.id === g.taskId)
    return {
      bodyKey: bodyKey(g.laneId, g.columnId),
      columnId: g.columnId,
      afterId: list[g.index - 1]?.id ?? null,
      beforeId: list[g.index]?.id ?? null,
      slot: own >= 0 && g.index > own ? g.index + 1 : g.index
    }
  }

  const stepGrab = (next: KeyboardGrab): void => {
    setGrab(next)
    setDropAt(dropOfGrab(next))
    const total = neighbours(next.taskId, next.columnId, next.laneId).length + 1
    setAnnounce(`Задача «${next.title}», колонка «${columnName(next.columnId)}», позиция ${next.index + 1} из ${total}.`)
  }

  const cancelGrab = (): void => {
    const g = grabRef.current
    setGrab(null)
    setDropAt(null)
    if (g) setAnnounce(`Перенос задачи «${g.title}» отменён.`)
  }
  cancelGrabRef.current = cancelGrab

  const onCardKeys = (task: Task) => (e: ReactKeyboardEvent<HTMLElement>, card: HTMLElement): void => {
    // Клавиши кнопок внутри карточки (⋯, «Чат», CI) остаются их собственными.
    if (e.target !== e.currentTarget) return
    const take = e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter'
    if (!grab) {
      if (!take) return
      e.preventDefault()
      const laneId =
        swimlane === 'none' ? null : (card.closest<HTMLElement>('[data-drop-body]')?.dataset.dropBody?.split('|')[0] ?? '')
      const index = Math.max(0, fullTasksOf(task.columnId, laneOf(laneId)).findIndex((t) => t.id === task.id))
      const g: KeyboardGrab = {
        taskId: task.id,
        title: task.title,
        columnId: task.columnId,
        index,
        laneId,
        from: { columnId: task.columnId, index }
      }
      setLiftHeight(Math.round(card.getBoundingClientRect().height))
      setGrab(g)
      setDropAt(dropOfGrab(g))
      const total = neighbours(task.id, g.columnId, laneId).length + 1
      setAnnounce(
        `Задача «${task.title}» взята. Колонка «${columnName(g.columnId)}», позиция ${index + 1} из ${total}. ` +
          'Стрелки — выбрать место, Enter — положить, Esc — отмена.'
      )
      return
    }
    if (grab.taskId !== task.id) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const at = columns.findIndex((c) => c.id === grab.columnId)
      const next = columns[at + (e.key === 'ArrowRight' ? 1 : -1)]
      if (!next) return
      const index = Math.min(grab.index, neighbours(task.id, next.id, grab.laneId).length)
      stepGrab({ ...grab, columnId: next.id, index })
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const limit = neighbours(task.id, grab.columnId, grab.laneId).length
      const index = Math.min(Math.max(grab.index + (e.key === 'ArrowDown' ? 1 : -1), 0), limit)
      if (index === grab.index) return
      stepGrab({ ...grab, index })
      return
    }
    if (take) {
      e.preventDefault()
      const at = dropOfGrab(grab)
      const sameSpot = grab.columnId === grab.from.columnId && grab.index === grab.from.index
      const position = grab.index + 1
      setGrab(null)
      setDropAt(null)
      if (sameSpot) {
        setAnnounce(`Задача «${task.title}» осталась на месте.`)
        return
      }
      applyDrop(task.id, at)
      setAnnounce(`Задача «${task.title}» перенесена: колонка «${columnName(at.columnId)}», позиция ${position}.`)
    }
    // Esc сюда не доходит: его перехватывает оконный слушатель выше (иначе
    // страница-обёртка закрылась бы раньше отмены).
  }

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

  // Своя команда экрана в общем реестре (lib/commands.ts): пока доска открыта,
  // «Создать задачу» есть в палитре, а как только ушла — исчезает. Держать этот
  // пункт в App нельзя: он знал бы про колонки доски.
  useCommandSource(() => {
    const target = columns[0]
    if (!target) return []
    return [
      {
        id: 'kanban.create-task',
        title: 'Создать задачу',
        section: 'action',
        hint: `Проект «${props.projectName}» · ${target.name}`,
        keywords: ['новая задача', 'добавить', 'new task'],
        run: () => openComposer(target.id)
      }
    ]
  })

  const cardOf = (t: Task): JSX.Element => {
    const fullColumns = board?.columns ?? []
    const columnIndex = fullColumns.findIndex((column) => column.id === t.columnId)
    const previousColumn = columnIndex > 0 ? fullColumns[columnIndex - 1] ?? null : null
    const nextColumn = columnIndex >= 0 ? fullColumns[columnIndex + 1] ?? null : null
    return (
    <TaskCard
      task={t}
      projectName={props.projectName}
      allTasks={allTasks}
      doneColumnIds={doneColumnIds}
      columnSemanticType={board?.columns.find((column) => column.id === t.columnId)?.semanticType}
      onOpen={setOpenTaskId}
      onUpdate={props.onUpdateTask}
      onDelete={props.onDeleteTask}
      onMoveTop={moveTop}
      onMoveBottom={moveBottom}
      onOpenChat={props.onOpenChat}
      ciSummary={props.ciSummaries?.[t.id]}
      onStartCi={props.onStartCi}
      onStartPreparation={(taskId) => setOpenTaskId(taskId, 'preparation')}
      onStartCiParallel={props.onStartCiParallel}
      onOpenCiRun={props.onOpenCiRun}
      onDequeueCiRun={props.onDequeueCiRun}
      onStartMerge={props.onStartMerge}
      previousColumn={previousColumn ? { id: previousColumn.id, name: previousColumn.name } : null}
      nextColumn={nextColumn ? { id: nextColumn.id, name: nextColumn.name } : null}
      onMoveToColumn={async (taskId, fromColumnId, targetColumnId) => {
        const current = allTasks.find((task) => task.id === taskId)
        if (!current || current.columnId !== fromColumnId) return
        const targetTasks = allTasks
          .filter((task) => task.columnId === targetColumnId && task.id !== taskId)
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        const moved = await props.onMoveTask(taskId, targetColumnId, targetTasks[targetTasks.length - 1]?.id ?? null, null)
        if (moved === false) return
        setAnnounce(`Задача «${current.title}» перенесена в колонку «${columnName(targetColumnId)}».`)
      }}
      onGrab={(e, card, immediate) => grabTask(e, card, t.id, immediate)}
      onCardKeys={onCardKeys(t)}
      onCardBlur={() => {
        if (grab?.taskId === t.id) cancelGrab()
      }}
      dragging={dragTask === t.id}
      grabbed={grab?.taskId === t.id}
    />
    )
  }

  const columnHead = (col: KanbanColumn): JSX.Element => {
    const visible = tasksOf(col.id).length
    const total = allTasks.filter((t) => t.columnId === col.id).length
    const overWip = col.wipLimit != null && total > col.wipLimit
    return (
      <header
        className={`jcol-head${overWip ? ' jcol-head--over' : ''}${
          dragColumn && dragColumn !== col.id && dragOverColumn === col.id ? ' jcol-head--drop' : ''
        }${dragColumn === col.id ? ' jcol-head--lifted' : ''}`}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return
          grabColumn(e, e.currentTarget, col.id, false)
        }}
      >
        <span
          className="jcol-grip"
          aria-hidden="true"
          onPointerDown={(e) => {
            e.stopPropagation()
            grabColumn(e, e.currentTarget, col.id, true)
          }}
        >
          ⠿
        </span>
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
            <span className="jcol-count">{filtersActive || columnAssignees[col.id] !== undefined ? `${visible} из ${total}` : total}</span>
            {col.wipLimit != null && (
              <span className={`jcol-wip${overWip ? ' jcol-wip--over' : ''}`} title={`WIP-лимит: ${col.wipLimit}`}>
                {total}/{col.wipLimit}
              </span>
            )}
            {col.hidden && <span className="jcol-hidden-mark" title="Колонка скрыта">🙈</span>}
          </span>
        )}
        <label className="jcol-assignee-filter">
          <span className="vc-sr-only">Исполнитель колонки «{col.name}»</span>
          <select
            className="sel"
            aria-label={`Исполнитель колонки «${col.name}»`}
            value={columnAssignees[col.id] ?? 'all'}
            disabled={onlyMine}
            aria-describedby={onlyMine ? `column-filter-note-${col.id}` : undefined}
            onChange={(e) => setColumnAssignees((prev) => ({ ...prev, [col.id]: e.target.value }))}
          >
            <option value="all">Все исполнители</option>
            <option value="">Без исполнителя</option>
            {members.filter((m) => m.active !== false).map((m) => <option key={m.username} value={m.username}>{m.username}</option>)}
          </select>
          {onlyMine && <span id={`column-filter-note-${col.id}`} className="vc-sr-only">Временно не применяется: включён режим «Показывать только мои задачи».</span>}
        </label>
        <span className="jcard-menuwrap" ref={colMenu === col.id ? colMenuRef : undefined}>
          <IconButton
            className="jcard-reveal"
            size="sm"
            aria-label={`Меню колонки «${col.name}»`}
            title="Меню колонки"
            aria-expanded={colMenu === col.id}
            onClick={() => setColMenu((v) => (v === col.id ? null : col.id))}
          >
            ⋯
          </IconButton>
          {colMenu === col.id && (
            <div className="jcard-menu" data-testid="column-menu">
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
                    // Необратимо и уносит задачи с собой — включаем ввод названия.
                    void confirm({
                      title: `Удалить колонку «${col.name}» со всеми задачами?`,
                      variant: 'danger',
                      confirmLabel: 'Удалить колонку',
                      requireText: col.name
                    }).then((ok) => {
                      if (ok) props.onDeleteColumn(col.id)
                    })
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
    const ordered = fullTasksOf(col.id, lane)
    const overWip = col.wipLimit != null && allTasks.filter((t) => t.columnId === col.id).length > col.wipLimit
    const key = bodyKey(lane ? lane.id : null, col.id)
    // Зона вставки между соседями after (сверху) и before (снизу): по ней
    // считается место указателя, из неё же берутся afterId/beforeId. Активная
    // зона показывает плейсхолдер — карточку под пальцем видно отдельно.
    const zone = (slot: number, after: string | null, before: string | null): JSX.Element => {
      const active = dropAt != null && dropAt.bodyKey === key && dropAt.slot === slot
      return (
        <Fragment key={`zone-${slot}`}>
          <div
            className={`kanban-dropzone${active ? ' over' : ''}`}
            data-dropzone=""
            data-slot={slot}
            data-after={after ?? ''}
            data-before={before ?? ''}
          />
          {active && (
            <div
              className="jcard-placeholder"
              data-testid="drop-placeholder"
              aria-hidden="true"
              {...(liftHeight > 0 ? { style: { height: liftHeight } } : {})}
            />
          )}
        </Fragment>
      )
    }
    return (
      <div className={`jcol-body${overWip ? ' jcol-body--over' : ''}`} data-drop-body={key} data-drop-column={col.id}>
        {zone(0, ordered[ordered.findIndex((t) => t.id === tasks[0]?.id) - 1]?.id ?? null, tasks[0]?.id ?? null)}
        {tasks.map((t, i) => {
          const at = ordered.findIndex((item) => item.id === t.id)
          return (
            <div key={t.id}>
              {cardOf(t)}
              {zone(i + 1, t.id, ordered[at + 1]?.id ?? null)}
            </div>
          )
        })}
        {/* Пустая колонка объясняет, чем её наполнить. В свимлейнах подсказку не
            повторяем в каждой ячейке — там пустых пересечений много по природе. */}
        {tasks.length === 0 && !lane && (
          <EmptyState
            compact
            className="jcol-empty"
            icon="＋"
            title={filtersActive ? 'Нет задач под фильтром' : 'Здесь пока пусто'}
            description={filtersActive ? 'Измените или сбросьте фильтр этой колонки, чтобы увидеть остальные задачи.' : 'Перетащите карточку сюда или создайте задачу кнопкой ниже.'}
            {...(filtersActive ? { action: { label: 'Сбросить фильтр колонки', onClick: () => setColumnAssignees((prev) => ({ ...prev, [col.id]: 'all' })) } } : {})}
          />
        )}
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

  // Скелетон повторяет геометрию доски: колонки 272px, шапка, карточки 70px
  // (высота минимальной .jcard — измерена в сториз UI/Skeleton).
  // Иначе при подстановке данных вся доска прыгает.
  const boardSkeleton = (
    <div className="jboard-wrap" data-testid="kanban-skeleton" aria-busy="true">
      <div className="jboard-filters">
        <Skeleton variant="line" width={200} height={30} />
        <Skeleton variant="line" width={120} height={30} />
        <Skeleton variant="line" width={90} height={30} />
      </div>
      <div className="kanban-board jboard">
        {[0, 1, 2].map((i) => (
          <section className="jcol" key={i}>
            <header className="jcol-head">
              <Skeleton variant="line" width="55%" />
            </header>
            <div className="jcol-body jcol-body--skel">
              <Skeleton variant="list" count={3 - (i % 2)} height={70} lines={2} itemClassName="jcard-skel" />
            </div>
          </section>
        ))}
      </div>
    </div>
  )

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
      <Button
        variant="primary"
        onClick={() => {
          if (newColumn.trim()) {
            props.onCreateColumn(newColumn.trim())
            setNewColumn('')
          }
        }}
        disabled={!newColumn.trim()}
      >
        Добавить
      </Button>
    </div>
  )

  // Единое правило: скелетон только пока доски нет; загруженная доска при
  // повторном чтении остаётся на экране, а ошибка ложится баннером над ней.
  const status: LoadStatus = loading ? 'loading' : props.error ? 'error' : board ? 'ready' : 'idle'
  const view = loadView(status, board != null)

  return (
    <>
      {view.state === 'skeleton' && boardSkeleton}
      {view.state === 'error' && (
        <ErrorState
          className="kanban-state"
          message="Не удалось загрузить доску"
          detail={props.error}
          {...(props.onRetry ? { onRetry: props.onRetry } : {})}
        />
      )}
      {view.state === 'data' && board && (
        <div className="jboard-wrap">
          {/* Перенос с клавиатуры не видно фокусом — его проговаривает эта область. */}
          <div className="vc-sr-only" role="status" aria-live="polite" data-testid="kanban-live">
            {announce}
          </div>
          {view.staleError && (
            <ErrorState
              compact
              className="jboard-error"
              message="Последнее действие не сохранилось"
              detail={props.error}
              {...(props.onRetry ? { onRetry: props.onRetry } : {})}
            />
          )}
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
            {currentUserId && (
              <label className={`jquick jquick-checkbox${onlyMine ? ' on' : ''}`}>
                <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
                Показывать только мои задачи
              </label>
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
            {/* Завершённые прячет сервер (порог — в настройках проекта), поэтому
                галка не фильтрует загруженное, а просит доску целиком. */}
            <label className="kanban-showcompleted">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(e) => setShowCompleted(e.target.checked)}
              />{' '}
              Показать завершённые
            </label>
            {/* Чаты завершённых задач уходят из сайдбара сразу по done (порог
                дней тут не действует) — вернуть их в список можно отсюда и
                иконкой-фильтром над списком бесед. */}
            {props.onShowDoneTaskChatsChange && (
              <label className="kanban-showcompleted">
                <input
                  type="checkbox"
                  checked={props.showDoneTaskChats ?? false}
                  onChange={(e) => props.onShowDoneTaskChatsChange?.(e.target.checked)}
                />{' '}
                Показывать чаты завершённых задач
              </label>
            )}
            {filtersActive && (
              <button className="jquick jquick--clear" onClick={resetFilters}>
                Сбросить фильтры
              </button>
            )}
            {view.refreshing && <RefreshIndicator label="Обновляем доску…" />}
          </div>

          {/* Именно «колонок нет вообще»: при снятом чекбоксе «скрытые» видимых
              колонок тоже нет, но подсказка про создание там была бы неправдой. */}
          {board.columns.length === 0 && (
            <EmptyState
              className="kanban-state"
              icon="🗂"
              title="Колонок пока нет — создайте первую"
              description="Колонка на доске — это статус задачи: «Бэклог», «В работе», «Готово»."
            />
          )}

          {swimlane === 'none' ? (
            <div className="kanban-board jboard" data-testid="kanban-board" ref={boardRef}>
              {columns.map((col) => (
                <section
                  key={col.id}
                  className={`jcol${col.hidden ? ' jcol--hidden' : ''}${
                    dragColumn && dragColumn !== col.id && dragOverColumn === col.id ? ' jcol--drop' : ''
                  }`}
                  data-testid="kanban-column"
                  data-column-id={col.id}
                  /* Имя делает колонку регионом: скринридер объявляет «Колонка
                     «В работе», 3 задачи» и умеет прыгать по ним. Без имени
                     section для доступности — обычный div. */
                  aria-label={columnRegionLabel(col, tasksOf(col.id).length)}
                >
                  {columnHead(col)}
                  {columnBody(col)}
                  {composer(col)}
                </section>
              ))}
              {addColumnBox}
            </div>
          ) : (
            <div className="kanban-board jboard jboard--lanes" data-testid="kanban-board" ref={boardRef}>
              <div className="jlane-heads">
                {columns.map((col) => (
                  <section
                    key={col.id}
                    className={`jcol jcol--headonly${col.hidden ? ' jcol--hidden' : ''}${
                      dragColumn && dragColumn !== col.id && dragOverColumn === col.id ? ' jcol--drop' : ''
                    }`}
                    data-testid="kanban-column"
                    data-column-id={col.id}
                    aria-label={columnRegionLabel(col, tasksOf(col.id).length)}
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
          onUpdate={props.onUpdateTask}
          onDelete={props.onDeleteTask}
          onMoveToColumn={(taskId, columnId) => props.onMoveTask(taskId, columnId, null, null)}
          onOpenChat={props.onOpenChat}
          onEnsureChat={props.onEnsureChat}
          ciSummary={props.ciSummaries?.[openTask.id]}
          onStartCi={props.onStartCi}
          onStartPreparation={props.onStartPreparation}
          initialTab={openTaskTab}
          loadPreparationRuns={props.loadPreparationRuns}
          onRetryPreparation={props.onRetryPreparation}
          llmAccess={props.llmAccess}
          llmEngines={props.llmEngines}
          onCancelPreparation={props.onCancelPreparation}
          onAnswerPreparation={props.onAnswerPreparation}
          onExportPreparation={props.onExportPreparation}
          onStartCiParallel={props.onStartCiParallel}
          onOpenCiRun={props.onOpenCiRun}
          onStartMerge={props.onStartMerge}

          aiAssistPrompts={props.aiAssistPrompts}
          onAiAssistPromptsChange={props.onAiAssistPromptsChange}
          generateAiAssist={props.generateAiAssist}
          onOpenTask={setOpenTaskId}
          onSelectedFieldChange={props.onSelectedFieldChange}
          onClose={() => { props.onSelectedFieldChange?.(null); setOpenTaskId(null) }}
        />
      )}
    </>
  )
}

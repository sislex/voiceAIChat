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
import { TaskModal, type TaskModalTab, type TaskUpdateFields } from './TaskModal'
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

interface ColumnAssigneeFilter {
  assigneeIds: string[]
  includeUnassigned: boolean
}

const EMPTY_COLUMN_ASSIGNEE_FILTER: ColumnAssigneeFilter = { assigneeIds: [], includeUnassigned: false }

type AutomatedStage = 'preparation' | 'development' | 'component_qa' | 'integration_tests' | 'automated_qa' | 'merge'

interface AutomationInfo {
  title: string
  starts: string
  doesNotStart: string
  steps: string[]
  result: string
  storage: string
  next: string
}

const AUTOMATION_INFO: Record<AutomatedStage, AutomationInfo> = {
  preparation: {
    title: 'Подготовка к разработке',
    starts: 'При переводе задачи из Backlog в системную стадию подготовки или при явном запуске из карточки. Активная попытка переиспользуется.',
    doesNotStart: 'При сортировке внутри колонки, обычном переименовании колонки, неполных настройках модели или если задача уже находится на другой стадии. Ошибка, отмена и провал readiness-gate не двигают карточку дальше.',
    steps: ['Выбираются движок, модель и профиль пользователя из настроек задачи, проекта и пользователя.', 'Модель без инструментов формирует Development Readiness: требования, критерии, тест-кейсы, UI-impact и затронутые компоненты.', 'Система проверяет полноту обязательных требований, кейсов и Storybook-покрытия либо документированного исключения.'],
    result: 'Успешный gate обновляет описание и критерии задачи, сохраняет сценарии и переводит карточку в Ready for Development; неуспех сохраняет причины.',
    storage: 'SQLite: task_preparation_runs, связанные события, вопросы, ответы и снимок readiness.',
    next: 'Сохранённый readiness используется Component QA, созданием автотестов и последующими QA-gate; из Ready перенос в Development запускает development-run.'
  },
  development: {
    title: 'Development / In progress',
    starts: 'Автоматически только при переходе из системной Ready for Development в системную Development; явные действия запуска из карточки остаются отдельными.',
    doesNotStart: 'При сортировке внутри Development и переходе из любой иной стадии. Ошибка постановки в очередь оставляет задачу в Ready; активный ран задачи переиспользуется.',
    steps: ['Создаётся или восстанавливается workspace: клонируется базовая ветка и устанавливаются зависимости.', 'Модель выполняет задачу и системная проверка валидирует её результат.', 'Оставшиеся изменения коммитятся, ветка задачи отправляется в origin с защитой force-with-lease.'],
    result: 'Успех фиксирует опубликованные branch и commit SHA и переводит задачу в Component QA. Development не выполняет merge, production deploy или обязательный affected-check.',
    storage: 'SQLite: ci_runs, ci_run_steps, взаимодействия и ci_workspaces; файлы остаются в workspace машины, ветка и коммит — в origin.',
    next: 'Workspace, ветка и SHA становятся неизменяемым входом Component QA и позднее merge-workflow; workspace сохраняется для QA и доработок.'
  },
  component_qa: {
    title: 'Component QA',
    starts: 'Из системной Component QA при наличии QA-права, успешного pushed development-workspace и успешного readiness. Повторный старт возвращает существующий queued/running ран.',
    doesNotStart: 'Не запускается на другой стадии, без опубликованного SHA/readiness или при неполных component-сценариях и Storybook-данных. uiImpact=none создаёт аудируемый skipped-результат без команд.',
    steps: ['Фиксируются SHA, версия readiness, UI-impact, компоненты и component-сценарии.', 'Последовательно выполняются настроенные test stages (по умолчанию Storybook smoke) с общим 30-минутным бюджетом.', 'Проверяются exit codes, обязательные сценарии, Storybook coverage, актуальность SHA и снимка.'],
    result: 'Passed/skipped gate переводит задачу в Integration Tests. Ошибка, блокировка, отмена или stale оставляют её в Component QA и разрешают повтор/доработку.',
    storage: 'SQLite: component_qa_runs с командами, логом, артефактами, снимками и ссылкой на fix-run; исполняется сохранённый development-workspace.',
    next: 'Результаты видны во вкладке Component QA; провал можно передать в новый development-run как fixContext, успех открывает создание интеграционных автотестов.'
  },
  integration_tests: {
    title: 'Создание интеграционных автотестов',
    starts: 'Из системной Integration Tests после успешного Component QA, когда доступны актуальные pushed workspace/SHA и обязательные автоматизируемые сценарии.',
    doesNotStart: 'Не запускается на другой стадии, при активной попытке, устаревшем SHA, отсутствии пригодных сценариев или недоступном workspace. Невыполненный gate не переводит задачу дальше.',
    steps: ['Фиксируются сценарии и текущий commit SHA.', 'Модель создаёт интеграционные автотесты в development-workspace, затем команды проверяют их.', 'Ссылки на автоматизацию сопоставляются с обязательными кейсами и текущим SHA; результат проверяется gate.'],
    result: 'Успех сохраняет тесты и ссылки на них и переводит карточку в Automated QA; ошибка остаётся для повтора или отправки на доработку.',
    storage: 'SQLite: integration_test_runs, команды, лог, снимки кейсов и automation links; код тестов — в workspace/ветке задачи.',
    next: 'Automated QA использует созданные тесты и их привязку к текущему SHA; сведения также показываются в отдельной вкладке карточки.'
  },
  automated_qa: {
    title: 'Automated QA',
    starts: 'Из системной Automated QA явным запуском QA-рана, когда предыдущий gate передал задачу на эту стадию и нет активной попытки.',
    doesNotStart: 'Сам перенос, сортировка или переименование колонки запуск не создают. Ран отклоняется вне своей semantic stage; провал/отмена не двигают карточку.',
    steps: ['Создаётся попытка для стадии и фиксируется контекст задачи.', 'Выполняются автоматические проверки, а статус, лог, сводка и ошибки обновляются в ходе рана.', 'Сервер повторно проверяет успешный результат и допустимость автоматического перехода.'],
    result: 'Успешный gate переводит карточку в Manual QA; неуспешная попытка остаётся в Automated QA с доступной историей.',
    storage: 'SQLite: qa_stage_runs со stage=automated_qa, попытками, статусом, логом, сводкой и входным контекстом.',
    next: 'История доступна во вкладке Automated QA; успешный результат становится входом следующего ручного quality gate.'
  },
  merge: {
    title: 'Merge',
    starts: 'По явному запуску для задачи, допущенной в Awaiting Merge, с последним успешно отправленным workspace, source SHA, веткой, main и доступной машиной. Создание рана сразу переносит карточку в Merge.',
    doesNotStart: 'Отклоняется до создания рана без прав, workspace/SHA/машины, при активном merge или недоступных origin-ветках. Кнопка справки ничего не запускает.',
    steps: ['Проверяются origin/main и feature, фиксируются их SHA и строится merge-коммит в изолированном clone/worktree.', 'Параллельно выполняются обязательный affected-check и актуализация базы знаний; при изменениях БЗ создаётся отдельный docs(kb)-коммит и нужный gate повторяется.', 'Перед публикацией SHA сверяются повторно; итоговый SHA отправляется сначала в feature, затем тем же SHA в main с lease.'],
    result: 'Успех переводит задачу в Done и очищает task-копии. Обычная ошибка/отмена остаётся в Merge; конфликт, stale source или неопределённый push ведут в Decision Required.',
    storage: 'SQLite: merge_runs и шаги/лог/снимки SHA; Git-результат — в feature и main origin, временная работа — в постоянном .merge-клоне и worktree машины.',
    next: 'Успешный merge завершает workflow без production deploy. Ошибку можно безопасно повторить, а неоднозначный конфликт требует решения пользователя.'
  }
}

function automationInfoFor(column: KanbanColumn): AutomationInfo | null {
  return column.semanticType in AUTOMATION_INFO ? AUTOMATION_INFO[column.semanticType as AutomatedStage] : null
}

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
  /** Область сохранения прокрутки: не даёт применить позицию другой доски при навигации. */
  scrollScopeId?: string
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
  onOpenTaskChange?: (taskId: string | null, tab?: TaskModalTab) => void
  initialOpenTaskTab?: TaskModalTab
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
  const [improvementTasks, setImprovementTasks] = useState<Array<{ taskId: string; count: number; improvementId: string }>>([])
  useEffect(() => {
    const projectId = props.board?.tasks[0]?.projectId
    if (!projectId || !window.ci?.listProjectImprovementTasks) { setImprovementTasks([]); return }
    void window.ci.listProjectImprovementTasks(projectId).then(setImprovementTasks).catch(() => {})
  }, [props.board, props.ciSummaries])
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
  /** Независимые многозначные фильтры исполнителей по колонкам. */
  const [columnAssigneeFilters, setColumnAssigneeFilters] = useState<Record<string, ColumnAssigneeFilter>>({})
  const [openAssigneeFilter, setOpenAssigneeFilter] = useState<string | null>(null)
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
  const [automationInfoColumn, setAutomationInfoColumn] = useState<KanbanColumn | null>(null)
  const automationInfoButtonRef = useRef<HTMLButtonElement | null>(null)
  const automationInfoCloseRef = useRef<HTMLButtonElement | null>(null)
  const [wipEditing, setWipEditing] = useState<string | null>(null)
  const [wipDraft, setWipDraft] = useState('')
  const [composerCol, setComposerCol] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState<WorkItemType>('task')
  const [newParent, setNewParent] = useState('')
  const [newColumn, setNewColumn] = useState('')
  // Модалка задачи: управляемая пропсами или внутренняя.
  const [internalOpenTask, setInternalOpenTask] = useState<string | null>(null)
  const [openTaskTab, setOpenTaskTab] = useState<TaskModalTab | undefined>(props.initialOpenTaskTab)
  const openTaskId = props.openTaskId !== undefined ? props.openTaskId : internalOpenTask
  const setOpenTaskId = (taskId: string | null, tab?: TaskModalTab): void => {
    setOpenTaskTab(tab)
    if (props.onOpenTaskChange) props.onOpenTaskChange(taskId, tab)
    else setInternalOpenTask(taskId)
  }
  const composerRef = useRef<HTMLInputElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const boardScrollRef = useRef(new Map<string, { left: number; top: number }>())
  const colMenuRef = useRef<HTMLSpanElement | null>(null)
  const assigneeFilterRef = useRef<HTMLDivElement | null>(null)
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
  useEffect(() => {
    if (!openAssigneeFilter) return
    const closeOnOutsidePress = (event: PointerEvent): void => {
      if (!assigneeFilterRef.current?.contains(event.target as Node)) setOpenAssigneeFilter(null)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenAssigneeFilter(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openAssigneeFilter])
  useEffect(() => {
    if (!automationInfoColumn) return
    automationInfoCloseRef.current?.focus()
    const close = (): void => {
      setAutomationInfoColumn(null)
      requestAnimationFrame(() => automationInfoButtonRef.current?.focus())
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
    window.addEventListener('keydown', closeOnEscape, true)
    return () => window.removeEventListener('keydown', closeOnEscape, true)
  }, [automationInfoColumn])
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
  const scrollScopeId = props.scrollScopeId ?? board?.columns[0]?.projectId ?? allTasks[0]?.projectId ?? null

  // Блокирующие обновления (например, переключение завершённых задач) временно
  // заменяют доску скелетоном. Запоминаем обе оси до удаления scroll-контейнера
  // и возвращаем их только для той же проектной области после нового mount.
  useLayoutEffect(() => {
    const surface = boardRef.current
    if (!surface || !scrollScopeId) return
    const saved = boardScrollRef.current.get(scrollScopeId)
    surface.scrollLeft = saved?.left ?? 0
    surface.scrollTop = saved?.top ?? 0
    const remember = (): void => {
      boardScrollRef.current.set(scrollScopeId, { left: surface.scrollLeft, top: surface.scrollTop })
    }
    surface.addEventListener('scroll', remember, { passive: true })
    return () => {
      remember()
      surface.removeEventListener('scroll', remember)
    }
  }, [scrollScopeId, board != null, swimlane])
  const currentUserId = props.currentUserId ?? props.currentUser ?? null
  const filterStorageKey = useMemo(() => {
    const projectId = board?.columns[0]?.projectId ?? allTasks[0]?.projectId ?? props.projectName
    return currentUserId ? `voicechat.kanban.filters.v3.${encodeURIComponent(currentUserId)}.${encodeURIComponent(projectId)}` : null
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
    setColumnAssigneeFilters({})
    setFlaggedOnly(false)
    setRecentOnly(false)
    if (!filterStorageKey) {
      setFiltersHydrated(true)
      return
    }
    try {
      const raw = localStorage.getItem(filterStorageKey)
      if (raw) {
        const saved = JSON.parse(raw) as { search?: string; assignees?: string[]; types?: WorkItemType[]; priorities?: TaskPriority[]; labels?: string[]; epics?: string[]; onlyMine?: boolean; flaggedOnly?: boolean; recentOnly?: boolean; columnAssigneeFilters?: Record<string, ColumnAssigneeFilter> }
        if (typeof saved.search === 'string') setSearch(saved.search)
        if (Array.isArray(saved.assignees)) setAssignees(new Set(saved.assignees))
        if (Array.isArray(saved.types)) setTypes(new Set(saved.types))
        if (Array.isArray(saved.priorities)) setPriorities(new Set(saved.priorities))
        if (Array.isArray(saved.labels)) setLabels(new Set(saved.labels))
        if (Array.isArray(saved.epics)) setEpics(new Set(saved.epics))
        if (typeof saved.onlyMine === 'boolean') setOnlyMine(saved.onlyMine)
        if (typeof saved.flaggedOnly === 'boolean') setFlaggedOnly(saved.flaggedOnly)
        if (typeof saved.recentOnly === 'boolean') setRecentOnly(saved.recentOnly)
        if (saved.columnAssigneeFilters && typeof saved.columnAssigneeFilters === 'object') setColumnAssigneeFilters(saved.columnAssigneeFilters)
      }
    } catch { /* localStorage/старое состояние недоступны */ }
    setFiltersHydrated(true)
  }, [filterStorageKey])
  useEffect(() => {
    if (!filtersHydrated || !filterStorageKey) return
    try {
      localStorage.setItem(filterStorageKey, JSON.stringify({ search, assignees: [...assignees], types: [...types], priorities: [...priorities], labels: [...labels], epics: [...epics], onlyMine, flaggedOnly, recentOnly, columnAssigneeFilters }))
    } catch { /* localStorage недоступен */ }
  }, [assignees, columnAssigneeFilters, epics, filterStorageKey, filtersHydrated, flaggedOnly, labels, onlyMine, priorities, recentOnly, search, types])
  useEffect(() => {
    const allowed = new Set(members.filter((member) => member.active !== false).map((member) => member.username))
    setColumnAssigneeFilters((prev) => {
      let changed = false
      const next = Object.fromEntries(Object.entries(prev).map(([columnId, filter]) => {
        const assigneeIds = filter.assigneeIds.filter((id) => allowed.has(id))
        if (assigneeIds.length !== filter.assigneeIds.length) changed = true
        return [columnId, { ...filter, assigneeIds }]
      }))
      return changed ? next : prev
    })
  }, [members])
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

  const hasColumnAssigneeFilter = Object.values(columnAssigneeFilters).some((value) => value.assigneeIds.length > 0 || value.includeUnassigned)
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
    setColumnAssigneeFilters({})
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
        const selected = columnAssigneeFilters[columnId] ?? EMPTY_COLUMN_ASSIGNEE_FILTER
        if (selected.assigneeIds.length === 0 && !selected.includeUnassigned) return true
        return t.assignee == null ? selected.includeUnassigned : selected.assigneeIds.includes(t.assignee)
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

  // Обе оси принадлежат общей поверхности: горизонталь сохраняет доступ к
  // колонкам, вертикаль синхронно двигает все колонки вместе с их заголовками.
  const autoScrollTo = (p: DragPoint): void => {
    const root = boardRef.current
    if (!root) return
    autoScroll(root, p, 'x')
    autoScroll(root, p, 'y')
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
            <span className="jcol-count">{filtersActive || hasColumnAssigneeFilter ? `${visible} из ${total}` : total}</span>
            {col.wipLimit != null && (
              <span className={`jcol-wip${overWip ? ' jcol-wip--over' : ''}`} title={`WIP-лимит: ${col.wipLimit}`}>
                {total}/{col.wipLimit}
              </span>
            )}
            {col.hidden && <span className="jcol-hidden-mark" title="Колонка скрыта">🙈</span>}
          </span>
        )}
        {automationInfoFor(col) && (
          <button
            type="button"
            className="jcol-automation-info-button"
            aria-label={`Об автоматизации стадии «${automationInfoFor(col)!.title}»`}
            aria-haspopup="dialog"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              automationInfoButtonRef.current = event.currentTarget
              setAutomationInfoColumn(col)
            }}
          >
            i
          </button>
        )}
        {(() => {
          const activeMembers = members.filter((member) => member.active !== false)
          const filter = columnAssigneeFilters[col.id] ?? EMPTY_COLUMN_ASSIGNEE_FILTER
          const conditionCount = filter.assigneeIds.length + (filter.includeUnassigned ? 1 : 0)
          const selectedNames = filter.assigneeIds
          const summary = onlyMine
            ? 'Применяется общий режим «Только мои задачи»'
            : conditionCount === 0
              ? 'Все исполнители'
              : [...selectedNames, ...(filter.includeUnassigned ? ['Без исполнителя'] : [])].join(', ')
          const updateFilter = (next: ColumnAssigneeFilter): void =>
            setColumnAssigneeFilters((prev) => ({ ...prev, [col.id]: next }))
          const popoverId = `column-assignee-filter-${col.id}`
          return (
            <div
              className="jcol-assignee-filter"
              ref={openAssigneeFilter === col.id ? assigneeFilterRef : undefined}
            >
              <IconButton
                className={`jcol-filter-button${conditionCount > 0 ? ' is-active' : ''}`}
                size="sm"
                aria-label={`Фильтр исполнителей колонки «${col.name}»: ${summary}`}
                aria-expanded={openAssigneeFilter === col.id}
                aria-controls={popoverId}
                title={summary}
                onClick={() => setOpenAssigneeFilter((value) => value === col.id ? null : col.id)}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M2 3h12L9.5 8v4l-3 1V8L2 3Z" fill="currentColor" />
                </svg>
                {conditionCount > 0 && <span className="jcol-filter-badge" aria-hidden="true">{conditionCount}</span>}
              </IconButton>
              {openAssigneeFilter === col.id && (
                <div id={popoverId} className="jcol-filter-popover" role="dialog" aria-label={`Фильтр исполнителей колонки «${col.name}»`}>
                  <div className="jcol-filter-summary">{summary}</div>
                  {onlyMine && <div className="jcol-filter-global-note">Локальный выбор сохранён, но сейчас применяется общий режим.</div>}
                  {conditionCount > 0 && (
                    <div className="jcol-filter-chips" aria-label="Выбранные условия">
                      {selectedNames.map((username) => (
                        <button key={username} type="button" aria-label={`${username}, снять выбор`} onClick={() => updateFilter({ ...filter, assigneeIds: filter.assigneeIds.filter((id) => id !== username) })}>
                          {username}<span aria-hidden="true"> ×</span><span className="vc-sr-only">, снять выбор</span>
                        </button>
                      ))}
                      {filter.includeUnassigned && (
                        <button type="button" aria-label="Без исполнителя, снять выбор" onClick={() => updateFilter({ ...filter, includeUnassigned: false })}>
                          Без исполнителя<span aria-hidden="true"> ×</span><span className="vc-sr-only">, снять выбор</span>
                        </button>
                      )}
                    </div>
                  )}
                  <label className="jcol-filter-option">
                    <input type="checkbox" checked={conditionCount === 0} onChange={() => updateFilter(EMPTY_COLUMN_ASSIGNEE_FILTER)} />
                    Все исполнители
                  </label>
                  <label className="jcol-filter-option">
                    <input
                      type="checkbox"
                      checked={filter.includeUnassigned}
                      onChange={() => updateFilter({ ...filter, includeUnassigned: !filter.includeUnassigned })}
                    />
                    Без исполнителя
                  </label>
                  <div className="jcol-filter-members">
                    {activeMembers.map((member) => (
                      <label className="jcol-filter-option" key={member.username}>
                        <input
                          type="checkbox"
                          aria-label={member.username}
                          checked={filter.assigneeIds.includes(member.username)}
                          onChange={() => updateFilter({
                            ...filter,
                            assigneeIds: filter.assigneeIds.includes(member.username)
                              ? filter.assigneeIds.filter((id) => id !== member.username)
                              : [...filter.assigneeIds, member.username]
                          })}
                        />
                        <Avatar username={member.username} size={20} />
                        <span className="jcol-filter-member-name">{member.username}</span>
                        {member.username === currentUserId && <span className="jcol-filter-me">Вы</span>}
                      </label>
                    ))}
                  </div>
                  <div className="jcol-filter-actions">
                    <button type="button" onClick={() => updateFilter({ assigneeIds: activeMembers.map((member) => member.username), includeUnassigned: true })}>Выбрать всех</button>
                    <button type="button" onClick={() => updateFilter(EMPTY_COLUMN_ASSIGNEE_FILTER)}>Сбросить выбор</button>
                  </div>
                </div>
              )}
            </div>
          )
        })()}
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
            {...(filtersActive ? { action: { label: 'Сбросить фильтр колонки', onClick: () => setColumnAssigneeFilters((prev) => ({ ...prev, [col.id]: EMPTY_COLUMN_ASSIGNEE_FILTER })) } } : {})}
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
              {improvementTasks.length > 0 && <section className="jcol jcol--improvements" data-testid="kanban-improvements-column" aria-label={`Колонка «Улучшения», ${improvementTasks.length} задач`}>
                <header className="jcol-head"><h2>Улучшения</h2><span className="jcol-count">{improvementTasks.length}</span></header>
                <div className="jcol-body">{improvementTasks.map((entry) => { const task = allTasks.find((item) => item.id === entry.taskId); return task ? <button key={task.id} className="jcard" onClick={() => setOpenTaskId(task.id, 'improvements')}><strong>{issueKey(props.projectName, task)} · {task.title}</strong><span>{entry.count} актуальных предложений · исходный статус: {columnName(task.columnId)}</span></button> : null })}</div>
              </section>}
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
      {automationInfoColumn && automationInfoFor(automationInfoColumn) && (() => {
        const info = automationInfoFor(automationInfoColumn)!
        const close = (): void => {
          setAutomationInfoColumn(null)
          requestAnimationFrame(() => automationInfoButtonRef.current?.focus())
        }
        return (
          <div className="jautomation-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}>
            <section
              className="jautomation-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="jautomation-title"
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Tab') {
                  event.preventDefault()
                  automationInfoCloseRef.current?.focus()
                }
              }}
            >
              <header className="jautomation-dialog-head">
                <div>
                  <div className="jautomation-eyebrow">Автоматизация стадии</div>
                  <h2 id="jautomation-title">{info.title}</h2>
                </div>
                <button ref={automationInfoCloseRef} type="button" className="jautomation-close" aria-label="Закрыть справку об автоматизации" onClick={close}>×</button>
              </header>
              <div className="jautomation-dialog-body">
                <section><h3>Когда запускается</h3><p>{info.starts}</p></section>
                <section><h3>Когда не запускается</h3><p>{info.doesNotStart}</p></section>
                <section><h3>Последовательность и действия системы</h3><ol>{info.steps.map((step) => <li key={step}>{step}</li>)}</ol></section>
                <section><h3>Итоговый результат</h3><p>{info.result}</p></section>
                <section><h3>Где хранится</h3><p>{info.storage}</p></section>
                <section><h3>Дальнейшее использование</h3><p>{info.next}</p></section>
              </div>
            </section>
          </div>
        )
      })()}
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

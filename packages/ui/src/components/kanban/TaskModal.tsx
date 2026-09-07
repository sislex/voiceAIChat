// Модалка задачи в стиле Jira: слева заголовок/описание/критерии/подзадачи,
// справа панель деталей (статус, исполнитель, метки, родитель, приоритет,
// стори-поинты, срок, флаг). Поля сохраняются по blur/change — как в Jira.
//
// Описание — маркдаун: по умолчанию оно отрисовано (заголовки, списки, код), а
// правится по кнопке «Изменить» полем на 10 строк. Остальные поля правятся на
// месте, как и раньше.
//
// На телефоне раскладка — как в мобильной Jira: карточка на весь экран, статус и
// исполнитель сразу под заголовком, остальные поля — в свёрнутой секции
// «Подробности», а действия шапки (чат, флаг, удаление) — в ⋯-меню. Разметка
// разная, поэтому ширина проверяется через useMediaQuery, а не только в CSS.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { formatDateTime, formatDate } from '../../lib/dateFormat'
import { ALL_PROJECT_FEATURES, type ProjectFeatureSet } from '@shared/projectTypes'
import type { Board, ProjectMember, Task, TaskPriority, TaskRunResult, WorkItemType } from '@shared/projects'
import { normalizeAcceptanceCriteria, TASK_PRIORITIES } from '@shared/projects'
import type { ModifierPrompt } from '@shared/types'
import { Button } from '@voicechat/ui-kit'
import { Dialog } from '@voicechat/ui-kit'
import { EmptyState } from '@voicechat/ui-kit'
import { ErrorState } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { BranchFlow, ChipList, ProgressTrack, PropertyRow, SectionHeader } from '@voicechat/ui-kit'
import { LiveIndicator, PanelHeading, StatusPill, type StatusTone } from '@voicechat/ui-kit'
import { Markdown } from '../Markdown'
import { useConfirm } from '@voicechat/ui-kit'
import { ChatIcon, FlagIcon, TrashIcon, WandIcon } from '../icons'
import { PromptBuilder, type GenerateParams, type Suggestion } from '../prompt-builder/PromptBuilder'
import { applyNativeInputValue, useAiAssist } from '../prompt-builder/useAiAssist'
import { Avatar, PRIORITY_LABEL, TYPE_LABEL, TypeIcon, issueKey } from './kanbanMeta'
import { CiTaskSettings } from '../ci/CiTaskSettings'
import { FeaturePreviewSection } from '../preview/FeaturePreviewSection'
import { ManualQaPanel } from '../qa/ManualQaPanel'
import { QaStageRunPanel } from '../qa/QaStageRunPanel'
import type { AnyQaStageRun, QaRunStage } from '@shared/qa'
import { ComponentQaPanel } from '../qa/ComponentQaPanel'
import { KbUsageBrief } from '../kb/KbUsageBrief'
import { useDismissibleMenu } from '../../lib/useDismissibleMenu'
import { CiReport } from '../ci/CiReport'
import { MergePanel } from '../ci/MergePanel'
import { GitTargetPane } from '../git/GitTargetPane'
import { TaskRunFeed } from '../ci/TaskRunFeed'
import { TaskDesigns } from './TaskDesigns'
import { TaskPreparationTab } from './TaskPreparationTab'
import { TaskTimeline } from './TaskTimeline'
import { TaskActivityPanel } from './TaskActivityPanel'
import type { TaskPreparationLlmSelection, TaskPreparationRun } from '@shared/qa'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { LlmEngineOption } from '@shared/admin'
import { useRemoteReport } from '../../lib/useRemoteReport'
import { ciLlmLabel, ciStageLabel, ciStatusLabel, ciTone, fmtDuration } from '../ci/ciFormat'
import { canStartCiRun, canStartParallelCiRun, isActiveCiStatus, type AutomationProgress, type CiRunSummary, type CiTaskReport, type TaskImprovement, type ImprovementSource, type ImprovementStatus } from '@shared/ci'
import { AutomationProgressView } from './AutomationProgressView'
import { canStartMerge, isCurrentMergeSourceMerged } from '@shared/merge'
import { MOBILE_QUERY, useMediaQuery } from '../../lib/mediaQuery'
import { useAutoGrow } from '../../lib/autoGrow'
import { usePolling } from '../../lib/usePolling'

export interface TaskUpdateFields {
  title?: string
  description?: string
  acceptanceCriteria?: string
  type?: WorkItemType
  parentId?: string | null
  priority?: TaskPriority
  assignee?: string | null
  labels?: string[]
  skills?: string[]
  storyPoints?: number | null
  dueDate?: number | null
  flagged?: boolean
}


/** Перевод тона CI в тон лозенги ui-kit: имена у них исторически разные. */
function pillTone(tone: ReturnType<typeof ciTone>): StatusTone {
  return tone === 'success' ? 'success' : tone === 'removed' ? 'danger' : tone === 'progress' ? 'running' : 'neutral'
}

/** Подписи видов ранов и их исходов — только для компактной ленты «Активность». */
const RUN_KIND_LABEL: Record<TaskRunResult['kind'], string> = {
  preparation: 'Подготовка',
  development: 'Разработка',
  component_qa: 'Component QA',
  integration_tests: 'Интеграционные тесты',
  automated_qa: 'Automated QA',
  qa_preparation: 'Подготовка QA',
  manual_qa: 'Ручное QA',
  merge: 'Merge'
}
const RUN_OUTCOME_LABEL: Record<TaskRunResult['outcome'], string> = {
  active: 'выполняется',
  success: 'успешно',
  failure: 'ошибка',
  cancelled: 'отменён',
  skipped: 'пропущен'
}

export type TaskModalTab = 'preparation' | 'component_qa' | 'integration_tests' | 'automated_qa' | 'qa' | 'code' | 'merge' | 'feed' | 'improvements'

export interface TaskModalProps {
  task: Task
  board: Board
  projectName: string
  members: ProjectMember[]
  onUpdate: (taskId: string, fields: TaskUpdateFields) => void
  onDelete: (taskId: string) => void
  /** Открыть связанный с задачей чат (кнопка в шапке модалки). */
  onOpenChat?: (taskId: string) => void
  /**
   * Создать связанный чат, не уходя с доски. Зовётся при первом открытии
   * карточки задачи, чтобы у неё сразу был чат (идемпотентно на сервере).
   */
  onEnsureChat?: (taskId: string) => void
  /** Сводка последнего CI-рана задачи и переходы в его ленту. */
  ciSummary?: CiRunSummary
  onStartCi?: (taskId: string) => void | Promise<void>
  onStartPreparation?: (taskId: string, selection: TaskPreparationLlmSelection) => Promise<TaskPreparationRun | void>
  initialTab?: TaskModalTab
  /** Возможности типа проекта: CI/QA/merge-вкладки прячутся вместе с подсистемой. */
  projectFeatures?: ProjectFeatureSet
  loadPreparationRuns?: (taskId: string) => Promise<TaskPreparationRun[]>
  loadPreparationRun?: (runId: string) => Promise<TaskPreparationRun | null>
  onRetryPreparation?: (runId: string, selection: TaskPreparationLlmSelection) => Promise<TaskPreparationRun | void>
  llmAccess?: UserLlmAccess[]
  llmEngines?: LlmEngineOption[]
  onCancelPreparation?: (runId: string) => Promise<TaskPreparationRun | void>
  onAnswerPreparation?: (questionId: string, answer: string) => Promise<unknown>
  onExportPreparation?: (runId: string, format: 'md' | 'json') => Promise<void>
  /** Параллельный запуск: сразу в работу, мимо очереди сервера. */
  onStartCiParallel?: (taskId: string) => void | Promise<void>
  onOpenCiRun?: (runId: string) => void
  onStartMerge?: (taskId: string, agentId?: string | null) => void

  /** Смена статуса = перенос в конец выбранной колонки. */
  onMoveToColumn: (taskId: string, columnId: string) => void
  aiAssistPrompts?: ModifierPrompt[]
  onAiAssistPromptsChange?: (next: ModifierPrompt[]) => void
  generateAiAssist?: (params: GenerateParams) => Promise<Suggestion[]>
  /** Открыть Make-проект связанного дизайна (переход в режим Make). */
  onOpenMake?: (conversationId: string) => void
  /** Открыть другую задачу в этой же модалке (подзадача/родитель). */
  onOpenTask: (taskId: string) => void
  /**
   * Создание подзадачи прямо из карточки. Колонку и тип потомка карточка
   * выбирает сама, поэтому хосту остаётся тот же вызов, что и у композера
   * доски. Нет пропа — нет и кнопки: во вложенной карточке и черновике
   * создавать некуда.
   */
  onCreateSubtask?: (columnId: string, input: { title: string; type: WorkItemType; parentId: string }) => void
  onClose: () => void
  /** Focused editable field, for synchronized assistant context. */
  onSelectedFieldChange?: (field: keyof TaskUpdateFields | null) => void
  /** Черновик новой задачи: карточка ничего не сохраняет до выбора действия. */
  draft?: boolean
  /** Действия создания, показанные в стандартной нижней панели карточки. */
  footer?: ReactNode
  /** Дополнительные проектные настройки черновика (например, движок и модель). */
  detailsExtra?: ReactNode
  /** Нейтральные UI-действия в шапке, например переключатель new/legacy. */
  headerExtra?: ReactNode
}

function toDateInput(ms: number | null): string {
  if (ms == null) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function fromDateInput(v: string): number | null {
  if (!v) return null
  const [y, m, d] = v.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

// Улучшения — такая же лента, как временная шкала: русская подпись статуса с
// точкой того же тона и источник словами, а не машинным идентификатором.
const IMPROVEMENT_STATUS: Record<ImprovementStatus, string> = {
  new: 'Новое', accepted: 'Принято', rejected: 'Отклонено', implemented: 'Реализовано'
}
const IMPROVEMENT_TONE: Record<ImprovementStatus, string> = {
  new: 'progress', accepted: 'success', rejected: 'muted', implemented: 'success'
}
const IMPROVEMENT_SOURCE: Record<ImprovementSource, string> = {
  development: 'Разработка', preparation: 'Подготовка', component_qa: 'Component QA',
  integration_tests: 'Интеграционные тесты', automated_qa: 'Automated QA', merge: 'Merge',
  system: 'Системный сбой'
}

type ModelWorkStatus = AutomationProgress['status'] | 'timeout' | undefined

/** Тон точки статуса — общий с `.vc-feed-dot--*` во всех лентах карточки. */
function modelWorkTone(status: ModelWorkStatus): 'progress' | 'success' | 'danger' | 'muted' {
  if (status === 'running' || status === 'waiting' || status === 'queued') return 'progress'
  if (status === 'success') return 'success'
  if (status === 'failed' || status === 'timeout') return 'danger'
  return 'muted'
}

function modelWorkStatusLabel(status: ModelWorkStatus): string {
  if (status === 'running') return 'выполняется'
  if (status === 'waiting') return 'ожидает ответа'
  if (status === 'success') return 'завершена'
  if (status === 'failed' || status === 'timeout') return 'завершилась ошибкой'
  if (status === 'cancelled') return 'отменена'
  return 'ожидает запуска'
}

interface ModelWorkDisclosureProps {
  runId: string
  progress?: AutomationProgress
  fallbackStatus: ModelWorkStatus
  fallbackPercent: number | null
  fallbackDurationMs: number | null
  children: ReactNode
}

function ModelWorkDisclosure({
  runId,
  progress,
  fallbackStatus,
  fallbackPercent,
  fallbackDurationMs,
  children
}: ModelWorkDisclosureProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const status = progress?.status ?? fallbackStatus
  const percent = progress?.percent ?? fallbackPercent
  const active = status === 'running' || status === 'queued' || status === 'waiting'

  // Секундные часы «работает столько-то» — только на видимой вкладке браузера.
  usePolling(() => setTick((value) => value + 1), { enabled: active && progress?.startedAt != null, intervalMs: 1000 })

  void tick
  const durationMs = progress
    ? progress.startedAt == null
      ? progress.elapsedMs
      : active
        ? Math.max(progress.elapsedMs, Date.now() - progress.startedAt)
        : progress.elapsedMs
    : fallbackDurationMs
  const statusLabel = modelWorkStatusLabel(status)
  const detailId = `task-model-work-detail-${runId.replace(/[^a-zA-Z0-9_-]/g, '-')}`

  return (
    <section
      className={`task-model-work vc-feed-item${open ? ' task-model-work--open' : ''}`}
      data-testid="task-model-work"
      data-run-id={runId}
      data-status={status ?? 'queued'}
    >
      <button
        type="button"
        className="task-model-work__toggle"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((value) => !value)}
      >
        {/* Шеврон и точка статуса — те же, что у строк временной шкалы и
            улучшений: ход выполнения показывает то же событие со статусом. */}
        <span className="vc-feed-caret" aria-hidden="true" />
        <strong className="task-model-work__title">Работа модели</strong>
        <span className={`vc-feed-status task-model-work__status task-model-work__status--${status ?? 'queued'}`}>
          <span className={`vc-feed-dot vc-feed-dot--${modelWorkTone(status)}`} aria-hidden="true" />
          {statusLabel}
        </span>
        <span
          className={`task-model-work__bar${percent == null ? ' task-model-work__bar--indeterminate' : ''}`}
          role="progressbar"
          aria-label="Прогресс работы модели"
          aria-valuemin={percent == null ? undefined : 0}
          aria-valuemax={percent == null ? undefined : 100}
          aria-valuenow={percent ?? undefined}
          aria-valuetext={percent == null ? statusLabel : `${percent}% — ${statusLabel}`}
        >
          {percent != null && <span style={{ width: `${percent}%` }} />}
        </span>
        {percent != null && <span className="task-model-work__percent">{percent}%</span>}
        {(progress?.currentStep ?? progress?.stage) && <span className="task-model-work__stage" title={progress?.currentStep ?? progress?.stage}>{progress?.currentStep ?? progress?.stage}</span>}
        <span className="task-model-work__duration">
          {durationMs != null && durationMs > 0 ? fmtDuration(durationMs) : '—'}
        </span>
      </button>
      <div className="task-model-work__detail task-progress-detail" id={detailId} hidden={!open}>
        {children}
      </div>
    </section>
  )
}

export function TaskModal(props: TaskModalProps): JSX.Element {
  const { task, board } = props
  const confirm = useConfirm()
  const [launching, setLaunching] = useState<'queue' | 'parallel' | null>(null)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [criteria, setCriteria] = useState(() => normalizeAcceptanceCriteria(task.acceptanceCriteria))
  const currentTaskIdRef = useRef(task.id)
  const descriptionDirtyRef = useRef(false)
  const criteriaDirtyRef = useRef(false)
  const [subtaskOpen, setSubtaskOpen] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  useEffect(() => {
    if (!props.draft || task.assignee) return
    const current = props.members.find((member) => member.role === 'owner' && member.active !== false)?.username
    if (current) props.onUpdate(task.id, { assignee: current })
  }, [props.draft, props.members, task.id, task.assignee])
  type TaskTab = 'general' | 'timeline' | 'activity' | 'settings' | 'progress' | TaskModalTab
  const preparationVisible = task.type === 'task' && ['backlog', 'preparation', 'ready'].includes(board.columns.find((item) => item.id === task.columnId)?.semanticType ?? '')
  const defaultTab = (): TaskTab => {
    if (props.initialTab && props.initialTab !== 'preparation') return props.initialTab
    if (task.taskPreparationStatus === 'running' || (props.initialTab === 'preparation' && preparationVisible)) return 'preparation'
    const stage = board.columns.find((item) => item.id === task.columnId)?.semanticType
    if (stage === 'component_qa' || stage === 'integration_tests' || stage === 'automated_qa') return stage
    return (props.ciSummary && isActiveCiStatus(props.ciSummary.status)) || task.activeMergeRunId ? 'feed' : 'general'
  }
  // Возможности типа: не переданы — показываем всё (витрина, старые вызовы).
  const features = props.projectFeatures ?? ALL_PROJECT_FEATURES
  // Вкладка по умолчанию не должна оказаться скрытой.
  const [activeTab, setActiveTab] = useState<TaskTab>(() => {
    const wanted = defaultTab()
    const allowedByFeature: Partial<Record<TaskTab, keyof ProjectFeatureSet>> = {
      preparation: 'ci', improvements: 'ci', feed: 'ci',
      component_qa: 'qa', integration_tests: 'qa', automated_qa: 'qa', qa: 'qa', merge: 'git'
    }
    const need = allowedByFeature[wanted]
    return need && !features[need] ? 'general' : wanted
  })
  // Какие вкладки пользователь уже открывал. Нужен для панелей, которые раньше
  // грузили себя при самом открытии карточки (QA-этапы, ручное QA, превью,
  // отчёты «Хода выполнения»): теперь они молчат до первого показа, а после
  // остаются смонтированными — как и были. Панели merge, подготовки и ленты
  // рана намеренно живут по `activeTab`: у merge это свежий снимок машин при
  // возврате, у двух других — живые подписки, незачем держать их скрытыми.
  const [seenTabs, setSeenTabs] = useState<ReadonlySet<TaskTab>>(() => new Set([activeTab]))
  useEffect(() => {
    setSeenTabs((current) => current.has(activeTab) ? current : new Set([...current, activeTab]))
  }, [activeTab])
  const seen = (tab: TaskTab): boolean => seenTabs.has(tab)
  const progressSeen = seenTabs.has('progress')
  const [improvements, setImprovements] = useState<TaskImprovement[]>([])
  const [improvementsError, setImprovementsError] = useState<string | null>(null)
  const [improvementPending, setImprovementPending] = useState<string | null>(null)
  const [improvementDraft, setImprovementDraft] = useState<{ improvement: TaskImprovement; task: Task } | null>(null)
  const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Не удалось выполнить действие'
  // Улучшения появляются только после рана, поэтому у задачи без единого рана
  // запрос заведомо вернёт пустой список — и это был один лишний round-trip на
  // каждое открытие карточки в бэклоге.
  const hadRun = Boolean(props.ciSummary || task.latestRunResult)
  // Список тянем только когда открыли вкладку «Улучшения»: карточку открывают
  // ради описания и ранов, а этот запрос уходил при каждом её открытии.
  const improvementsSeen = seenTabs.has('improvements')
  const loadImprovements = (): void => {
    if (props.draft || !hadRun || !improvementsSeen || !window.ci?.listTaskImprovements) return
    setImprovementsError(null)
    void window.ci.listTaskImprovements(task.projectId, task.id).then(setImprovements).catch((error) => setImprovementsError(errorMessage(error)))
  }
  useEffect(loadImprovements, [task.id, props.ciSummary?.status, hadRun, improvementsSeen])
  const setImprovementStatus = (id: string, status: ImprovementStatus): void => {
    if (improvementPending) return
    setImprovementPending(id); setImprovementsError(null)
    void window.ci!.updateImprovementStatus(id, status)
      .then((next) => setImprovements((all) => all.map((item) => item.id === id ? next : item)))
      .catch((error) => setImprovementsError(errorMessage(error)))
      .finally(() => setImprovementPending(null))
  }
  const openImprovementDraft = (improvement: TaskImprovement): void => {
    const available = board.columns.filter((column) => !column.hidden)
    setImprovementsError(null)
    setImprovementDraft({ improvement, task: { ...task, id: `improvement-draft-${improvement.id}`, columnId: '', type: 'task', parentId: null, sourceTaskId: task.id, title: improvement.title, description: improvement.description, acceptanceCriteria: improvement.acceptanceCriteria || improvement.evidence.join('\n'), labels: [], skills: [], storyPoints: null, dueDate: null, flagged: false, seq: 0, position: 0, createdAt: Date.now(), updatedAt: Date.now(), assignee: null } })
    if (!available.length) setImprovementsError('В проекте нет доступных колонок')
  }
  const saveImprovementDraft = async (): Promise<void> => {
    if (!improvementDraft || improvementPending) return
    const { improvement, task: draftTask } = improvementDraft
    if (!draftTask.columnId) { setImprovementsError('Выберите исходную колонку'); return }
    setImprovementPending(improvement.id); setImprovementsError(null)
    try {
      const result = await window.ci!.createTaskFromImprovement(improvement.id, { columnId: draftTask.columnId, title: draftTask.title, description: draftTask.description, acceptanceCriteria: draftTask.acceptanceCriteria })
      setImprovements((all) => all.map((item) => item.id === improvement.id ? result.improvement : item))
      setImprovementDraft(null)
    } catch (error) { setImprovementsError(errorMessage(error)) }
    finally { setImprovementPending(null) }
  }
  const [qaStageRuns, setQaStageRuns] = useState<Partial<Record<QaRunStage, AnyQaStageRun[]>>>({})
  // Три запроса (по одному на QA-этап) уходили при каждом открытии любой задачи —
  // даже в проекте без QA и у карточки, которая ни разу не запускалась. QA-раны
  // создаёт сам этап, поэтому «не было ни одного рана» означает и «нет QA-ранов».
  useEffect(() => {
    if (props.draft || task.type !== 'task' || !features.qa || !hadRun || !window.qa?.listStageRuns) return
    let live = true
    void Promise.all((['component_qa','integration_tests','automated_qa'] as QaRunStage[]).map(async (stage) => [stage, await window.qa!.listStageRuns!(task.projectId, task.id, stage)] as const)).then((entries) => {
      if (!live) return
      const next = Object.fromEntries(entries) as Partial<Record<QaRunStage, AnyQaStageRun[]>>
      setQaStageRuns(next)
      const active = entries.find(([, runs]) => runs.some((run) => ['queued','running','awaiting_input'].includes(run.status)))
      if (active) setActiveTab(active[0])
    }).catch(() => {})
    return () => { live = false }
  }, [task.id, features.qa, hadRun])
  // Описание: просмотр (маркдаун) ↔ правка (textarea на 10 строк по кнопке).
  const [descEditing, setDescEditing] = useState(false)
  const [criteriaEditing, setCriteriaEditing] = useState(false)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const criteriaRef = useRef<HTMLTextAreaElement>(null)
  const descWrapRef = useRef<HTMLDivElement>(null)
  // Заголовок растёт под текст: на узком экране он занимает три-четыре строки, а
  // rows={1} со скроллом внутри поля прятал бы его конец.
  const titleGrow = useAutoGrow(title, 1, 6)

  async function launchCi(kind: 'queue' | 'parallel'): Promise<void> {
    if (launching) return
    setLaunching(kind)
    try {
      await (kind === 'queue' ? props.onStartCi?.(task.id) : props.onStartCiParallel?.(task.id))
    } finally {
      setLaunching(null)
    }
  }

  const mobile = useMediaQuery(MOBILE_QUERY)
  // «Подробности»: на телефоне свёрнуты, на десктопе это всегда открытая колонка.
  const [detailsOpen, setDetailsOpen] = useState(!mobile)
  useEffect(() => { setDetailsOpen(!mobile) }, [mobile])

  // Вкладок больше десятка, полоса скроллится. Активная вкладка по умолчанию
  // («Лента рана» у идущего рана) оказывалась за правым краем — её не видно и
  // непонятно, что открыто. Подтягиваем её в видимую часть полосы.
  const tabsRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const selected = tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeTab])

  // ⋯-меню действий в шапке (только на телефоне).
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLSpanElement | null>(null)
  useDismissibleMenu(menuOpen, menuRef, () => setMenuOpen(false))
  useEffect(() => { if (!mobile) setMenuOpen(false) }, [mobile])

  // Правка открылась — курсор в конец текста: описание обычно дописывают.
  useEffect(() => {
    if (!descEditing) return
    const el = descriptionRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [descEditing])

  const aiAssist = useAiAssist({
    value: description,
    onChange: (value) => {
      descriptionDirtyRef.current = true
      if (descriptionRef.current) applyNativeInputValue(descriptionRef.current, value)
      else setDescription(value)
      props.onUpdate(task.id, { description: value })
    },
    prompts: props.aiAssistPrompts ?? [],
    onPromptsChange: props.onAiAssistPromptsChange,
    generate: props.generateAiAssist ?? (async () => [])
  })
  const aiAssistEnabled = !!props.generateAiAssist

  // Полная задача может прийти позднее с тем же id. Каждое тяжёлое поле
  // синхронизируется независимо, пока пользователь не создал для него черновик.
  // Другой id всегда означает полную переинициализацию карточки.
  useEffect(() => {
    if (currentTaskIdRef.current !== task.id) {
      currentTaskIdRef.current = task.id
      descriptionDirtyRef.current = false
      criteriaDirtyRef.current = false
      setTitle(task.title)
      setDescription(task.description)
      setCriteria(normalizeAcceptanceCriteria(task.acceptanceCriteria))
      setDescEditing(false)
      setCriteriaEditing(false)
      setActiveTab(defaultTab())
      return
    }
    if (!descriptionDirtyRef.current) setDescription(task.description)
    if (!criteriaDirtyRef.current) setCriteria(normalizeAcceptanceCriteria(task.acceptanceCriteria))
  }, [task.id, task.description, task.acceptanceCriteria])


  // Чат к задаче создаётся сам при первом открытии карточки: дальше в него
  // дублируются вопросы модели из CI-рана.
  //
  // Колбэк — в ref, и просим ровно один раз на задачу: `App` передаёт его
  // inline-стрелкой, а `task.chatId` приезжает только со следующим снапшотом
  // доски, поэтому в зависимостях эффекта это давало по запросу на каждый
  // ререндер родителя.
  const ensureChatRef = useRef(props.onEnsureChat)
  ensureChatRef.current = props.onEnsureChat
  const ensuredChatForRef = useRef<string | null>(null)
  useEffect(() => {
    if (props.draft || task.type !== 'task' || task.chatId) return
    if (ensuredChatForRef.current === task.id) return
    ensuredChatForRef.current = task.id
    ensureChatRef.current?.(task.id)
  }, [task.id, task.type, task.chatId, props.draft])

  // Использование БЗ — агрегат по ВСЕМ ранам задачи. Перечитываем, когда
  // меняется статус последнего рана: только что закончившийся ран добавил свои
  // обращения, и цифры в карточке обязаны это показать.
  // Оба отчёта показывает только вкладка «Ход выполнения», поэтому и грузятся
  // они с её первого открытия: до этого карточка тратила на них по запросу,
  // даже если пользователь смотрел «Общее» и закрывал.
  const kbUsage = useRemoteReport(
    () => (!props.draft && progressSeen && task.type === 'task' ? window.ci?.getTaskKbUsage(task.projectId, task.id) : undefined),
    [task.id, task.projectId, task.type, props.ciSummary?.status, progressSeen]
  )
  // Отчёт по расходу — только когда ран задачи завершён: пока он идёт, цифры
  // меняются на глазах, и смотреть надо ленту, а не итог. Перечитываем по тому
  // же ключу, что и БЗ: закончившийся ран добавил свои ходы.
  const ciFinished = props.ciSummary != null && !isActiveCiStatus(props.ciSummary.status)
  const ciReport = useRemoteReport<CiTaskReport>(
    () => (!props.draft && progressSeen && task.type === 'task' && ciFinished ? window.ci?.getTaskReport(task.projectId, task.id) : undefined),
    [task.id, task.projectId, task.type, ciFinished, props.ciSummary?.status, progressSeen]
  )

  const column = board.columns.find((c) => c.id === task.columnId)
  const qaStageOrder: QaRunStage[] = ['component_qa','integration_tests','automated_qa']
  const workflowOrder = ['backlog','preparation','ready','development','component_qa','integration_tests','automated_qa','manual_qa','awaiting_merge','merge','done']
  const currentWorkflowIndex = workflowOrder.indexOf(column?.semanticType ?? '')
  const qaStageVisible = (stage: QaRunStage): boolean => qaStageRuns[stage]?.length ? true : currentWorkflowIndex >= workflowOrder.indexOf(stage)
  // Пока ран задачи идёт запуск недоступен; в семантическом «Готово» новый
  // запуск также запрещён — задача завершена, даже если старый ран терминальный.
  const ciLaunchStage = column?.semanticType !== 'done' && column?.semanticType !== 'backlog' && column?.semanticType !== 'preparation'
  const canStartCi = ciLaunchStage && canStartCiRun(props.ciSummary)
  const canStartParallelCi = ciLaunchStage && canStartParallelCiRun(props.ciSummary)
  const parent = task.parentId ? board.tasks.find((t) => t.id === task.parentId) : null
  const children = board.tasks.filter((t) => t.parentId === task.id)
  // Готовность подзадач считается по семантике колонки, а не по её названию:
  // «Готово» переименовывают, а semanticType остаётся.
  const doneColumnIds = new Set(board.columns.filter((c) => c.semanticType === 'done').map((c) => c.id))
  const doneChildren = children.filter((t) => doneColumnIds.has(t.columnId)).length
  // Подзадача заводится в первой видимой колонке — там же, где композер доски
  // создаёт обычную задачу. Тип потомка задан моделью: у эпика это стори, у
  // стори — задача, у задачи потомков не бывает.
  const subtaskColumn = board.columns.find((c) => !c.hidden && c.semanticType === 'backlog') ?? board.columns.find((c) => !c.hidden)
  const subtaskType: WorkItemType | null = task.type === 'epic' ? 'story' : task.type === 'story' ? 'task' : null
  const canAddSubtask = !props.draft && subtaskType != null && subtaskColumn != null && props.onCreateSubtask != null
  const submitSubtask = (): void => {
    const title = subtaskTitle.trim()
    if (!title || !subtaskColumn || !subtaskType) return
    props.onCreateSubtask?.(subtaskColumn.id, { title, type: subtaskType, parentId: task.id })
    setSubtaskTitle('')
    setSubtaskOpen(false)
  }
  const key = issueKey(props.projectName, task)
  const activeCi = props.ciSummary && isActiveCiStatus(props.ciSummary.status) ? props.ciSummary : null
  const terminalCi = props.ciSummary && !isActiveCiStatus(props.ciSummary.status) ? props.ciSummary : null
  const activeOperation = activeCi?.slotProgress.phase || (task.activeMergeRunId ? 'Мерж выполняется' : null)
  const terminalResult = terminalCi && ['failed', 'timeout', 'cancelled'].includes(terminalCi.status)
    ? terminalCi.slotProgress.phase || ciStatusLabel(terminalCi.status)
    : null
  const currentState = [column?.name ?? 'Без статуса', activeOperation ?? terminalResult].filter(Boolean).join(' · ')
  // Активность на «Общем» собирается из полей, которые уже пришли со снапшотом
  // доски и с детальной задачей: ещё один запрос при открытии карточки не нужен,
  // а подробности этапов живут во вкладке «Временная шкала».
  // Времени у сводки рана нет (`CiRunSummary` его не несёт), поэтому активный
  // ран стоит в ленте без отметки времени, а датированные события берутся из
  // полей задачи.
  const activity: Array<{ id: string; text: string; time?: string; dot: 'progress' | 'success' | 'danger' | 'muted' }> = []
  if (props.ciSummary && isActiveCiStatus(props.ciSummary.status)) {
    activity.push({ id: 'ci', text: `Ран: ${ciStatusLabel(props.ciSummary.status)}`, dot: 'progress' })
  }
  if (task.doneAt) activity.push({ id: 'done', text: 'Задача завершена', time: formatDateTime(task.doneAt), dot: 'success' })
  if (task.latestRunResult) {
    activity.push({
      id: 'run',
      text: `${RUN_KIND_LABEL[task.latestRunResult.kind]}: ${RUN_OUTCOME_LABEL[task.latestRunResult.outcome]}`,
      time: formatDateTime(task.latestRunResult.finishedAt ?? task.latestRunResult.createdAt),
      dot: task.latestRunResult.outcome === 'failure' ? 'danger' : task.latestRunResult.outcome === 'success' ? 'success' : 'progress'
    })
  }
  if (!props.draft) activity.push({ id: 'created', text: 'Задача создана', time: formatDateTime(task.createdAt), dot: 'muted' })

  // Точка состояния берёт тон у активного рана, а без рана — у самой колонки:
  // «Готово» зелёная, остальное нейтральное. Цвет здесь дублирует текст этапа,
  // а не заменяет его — цветом одним состояние сообщать нельзя.
  const headingTone = props.ciSummary
    ? ciTone(props.ciSummary.status)
    : column?.semanticType === 'done' ? 'success' : 'neutral'
  const parentOptions = board.tasks.filter((p) =>
    p.id !== task.id && (task.type === 'story' ? p.type === 'epic' : task.type === 'task' ? p.type === 'epic' || p.type === 'story' : false)
  )

  // Полоса вкладок и панели связаны id: у `role="tablist"` без `role="tabpanel"`
  // скринридер не знает, что именно открыла вкладка. Панель есть у каждой
  // вкладки, включая «Общее» — две его колонки лежат в `.jmodal-general`.
  const domId = useId()
  const tabDomId = (tab: TaskTab): string => `${domId}-tab-${tab}`
  const panelDomId = (tab: TaskTab): string => `${domId}-panel-${tab}`
  const newImprovements = improvements.filter((item) => item.status === 'new').length
  // Счётчик у вкладки — отдельное поле, а не скобки в подписи: в скобках он
  // попадал в доступное имя вкладки («Улучшения (3)») и зачитывался при каждом
  // переходе стрелками, а рядом с ним нельзя было поставить пилюлю.
  const tabItems: Array<{ id: TaskTab; label: string; count?: number }> = [
    { id: 'general', label: 'Общее' }, { id: 'timeline', label: 'Временная шкала' },
    // «Активность» — как в Jira: комментарии, история изменений, ворклог.
    { id: 'activity' as const, label: 'Активность' },
    ...(preparationVisible && features.ci ? [{ id: 'preparation' as const, label: 'Подготовка к разработке' }] : []),
    { id: 'settings', label: 'Настройки' }, { id: 'progress', label: 'Ход выполнения' },
    ...(features.ci ? [{ id: 'improvements' as const, label: 'Улучшения', count: newImprovements }] : []),
    ...(features.qa ? qaStageOrder.filter(qaStageVisible).map((stage) => ({ id: stage, label: stage === 'component_qa' ? 'Component QA' : stage === 'integration_tests' ? 'Интеграционные тесты' : 'Automated QA' })) : []),
    ...(features.qa ? [{ id: 'qa' as const, label: 'Ручное QA' }] : []),
    // «Код» — рабочая копия задачи: посмотреть, что наменяла модель, поправить,
    // закоммитить и отправить ветку. Merge остаётся отдельной вкладкой: он про main.
    ...(features.git ? [{ id: 'code' as const, label: 'Код' }] : []),
    ...(features.git ? [{ id: 'merge' as const, label: 'Merge' }] : []),
    ...(features.ci ? [{ id: 'feed' as const, label: 'Лента рана' }] : [])
  ]
  const tabIds = tabItems.map((item) => item.id)
  /** Общие атрибуты панели вкладки: роль, связь с кнопкой и скрытие. */
  // Настройки выполнения монтируются при первом заходе на вкладку и остаются.
  const [settingsMounted, setSettingsMounted] = useState(activeTab === 'settings')
  useEffect(() => { if (activeTab === 'settings') setSettingsMounted(true) }, [activeTab])

  const panelProps = (tab: TaskTab): { role: 'tabpanel'; id: string; 'aria-labelledby': string; hidden: boolean; tabIndex: number } => ({
    role: 'tabpanel', id: panelDomId(tab), 'aria-labelledby': tabDomId(tab), hidden: activeTab !== tab, tabIndex: 0
  })

  const commitTitle = (): void => {
    const t = title.trim()
    if (t && t !== task.title) props.onUpdate(task.id, { title: t })
    else setTitle(task.title)
  }

  const startDescEdit = (): void => setDescEditing(true)

  const commitDescription = (): void => {
    if (description !== task.description) props.onUpdate(task.id, { description })
    setDescEditing(false)
  }

  const cancelDescEdit = (): void => {
    descriptionDirtyRef.current = false
    setDescription(task.description)
    setDescEditing(false)
  }

  // Запрос на закрытие карточки (Esc, крестик, клик по фону). Esc своим
  // обработчиком в поле не поймать — стек окон гасит событие на window в фазе
  // перехвата, поэтому открытая правка описания отвечает на него здесь: Esc
  // возвращает её в просмотр, а карточку закроет уже следующий. Крестика и
  // клика по фону это не касается — они сперва уводят фокус из поля, и правка
  // успевает закрыться сохранением (onBlur описания) до этой проверки.
  const requestClose = (): void => {
    if (descEditing) {
      cancelDescEdit()
      return
    }
    props.onClose()
  }

  const toggleFlag = (): void => props.onUpdate(task.id, { flagged: !task.flagged })

  const confirmDelete = async (): Promise<void> => {
    if (!(await confirm({ title: `Удалить «${task.title}»?`, variant: 'danger', confirmLabel: 'Удалить' }))) return
    props.onDelete(task.id)
    props.onClose()
  }

  // Статус и исполнитель: на телефоне — строкой под заголовком (как в Jira),
  // на десктопе — первыми полями правой панели. Разметка одна, место разное.
  const statusField = (
    <PropertyRow as="label" label="Статус" className="jmodal-field--status">
      <select
        className="sel jmodal-status"
        aria-label="Статус"
        title={column?.name ?? undefined}
        value={task.columnId}
        onChange={(e) => props.onMoveToColumn(task.id, e.target.value)}
      >
        {props.draft && !task.columnId && <option value="">Выберите колонку</option>}
        {board.columns.filter((c) => !c.hidden).map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </PropertyRow>
  )

  const assigneeField = (
    <PropertyRow as="label" label="Исполнитель">
      <span className="jmodal-assignee">
        {task.assignee && <Avatar username={task.assignee} size={20} />}
        <select
          className="sel"
          aria-label="Исполнитель"
          value={task.assignee ?? ''}
          onChange={(e) => props.onUpdate(task.id, { assignee: e.target.value || null })}
        >
          <option value="">Не назначен</option>
          {task.assignee && !props.members.some((member) => member.username === task.assignee) && (
            <option value={task.assignee}>{task.assignee}</option>
          )}
          {props.members.filter((m) => m.active !== false).map((m) => (
            <option key={m.username} value={m.username}>{m.username}</option>
          ))}
        </select>
      </span>
      {props.draft && <small>Если не выбрать другого исполнителя, задача будет назначена на вас.</small>}
    </PropertyRow>
  )

  // Действия карточки живут в ⋯-меню на любой ширине: в шапке по макету стоят
  // только «ещё» и крестик. Раньше десктоп показывал три подписанные кнопки, и
  // шапка с длинным названием переносилась в три строки.
  const headActions = props.draft ? null : (
    <span className="jmodal-menuwrap" ref={menuRef}>
      <IconButton
        aria-label="Действия с задачей"
        title="Действия"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        ⋯
      </IconButton>
      {menuOpen && (
        <div className="jcard-menu jmodal-menu">
          {props.onOpenChat && (
            <button onClick={() => { setMenuOpen(false); props.onOpenChat?.(task.id) }}>
              <ChatIcon /> {task.chatId ? 'Открыть чат' : 'Создать чат'}
            </button>
          )}
          <button onClick={() => { setMenuOpen(false); toggleFlag() }}>
            <FlagIcon filled={task.flagged} /> {task.flagged ? 'Снять флаг' : 'Флаг'}
          </button>
          <button className="jcard-menu-danger" onClick={() => { setMenuOpen(false); void confirmDelete() }}>
            <TrashIcon /> Удалить задачу
          </button>
        </div>
      )}
    </span>
  )

  return (
    <>
    {/* Esc и клик по фону — забота Dialog. Пока сверху открыт AI-помощник, карточка
        их не получает: окна лежат в общем стеке (useDialogStack). Своего слушателя
        Esc у карточки нет — запрос на закрытие приходит в requestClose. */}
    <Dialog
      title={props.draft ? 'Создание задачи' : (
        <span className="task-modal-heading" data-testid="task-modal-heading" aria-live="polite" title={`${key} · ${task.title} (${currentState})`}>
          {/* Надстрочная строка: ключ, точка состояния и сам этап. Раньше всё
              это стояло в одну строку с названием, и на узкой карточке этап
              уезжал под заголовок оторванным куском текста в скобках. */}
          <span className="task-modal-heading__eyebrow">
            <span className="task-modal-heading__key">{key}</span>
            <span aria-hidden="true">·</span>
            <span className={`task-modal-heading__dot task-modal-heading__dot--${headingTone}`} aria-hidden="true" />
            <span className="task-modal-heading__state">{currentState}</span>
          </span>
          <textarea
            className="task-modal-heading__title"
            aria-label="Заголовок задачи"
            ref={titleGrow}
            value={title}
            rows={1}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitTitle()
              }
            }}
          />
        </span>
      )}
      ariaLabel={props.draft ? 'Создание задачи' : `${key} · ${task.title} (${currentState})`}
      size="lg"
      onClose={props.onClose}
      onEscape={requestClose}
      testId="task-modal"
      className="jmodal-frame"
      actions={<>{props.headerExtra}{headActions}</>}
      footer={props.footer}
    >
      {!props.draft && <nav
        className="task-tabs"
        role="tablist"
        aria-label="Разделы карточки"
        ref={tabsRef}
        // Стандартная клавиатура вкладок: внутрь полосы Tab заводит один раз (у
        // невыбранных tabIndex=-1), дальше по ним ходят стрелками. Иначе Tab
        // пришлось бы нажать одиннадцать раз, чтобы добраться до содержимого.
        onKeyDown={(event) => {
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (!step && event.key !== 'Home' && event.key !== 'End') return
          event.preventDefault()
          const index = tabIds.indexOf(activeTab)
          const next = event.key === 'Home' ? 0
            : event.key === 'End' ? tabIds.length - 1
              : (index + step + tabIds.length) % tabIds.length
          setActiveTab(tabIds[next])
          requestAnimationFrame(() => tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
        }}
      >
        {tabItems.map(({ id, label, count }) => (
          <button
            key={id}
            id={tabDomId(id)}
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={panelDomId(id)}
            tabIndex={activeTab === id ? 0 : -1}
            className={activeTab === id ? 'task-tab task-tab--active' : 'task-tab'}
            onClick={() => setActiveTab(id)}
          >
            {label}
            {/* Ноль не рисуем: пустая пилюля читается как «есть ноль новых». */}
            {count ? <span className="task-tab-count" aria-label={`новых: ${count}`}>{count}</span> : null}
          </button>
        ))}
      </nav>}
      <div className={`jmodal jmodal--tab-${activeTab}`} onFocusCapture={(event) => {
        const label = (event.target as HTMLElement).getAttribute('aria-label') ?? ''
        const field: keyof TaskUpdateFields | null = label.includes('Заголовок') ? 'title' : label.includes('Описание') ? 'description' : label.includes('Критерии') ? 'acceptanceCriteria' : label.includes('Приоритет') ? 'priority' : label.includes('Исполнитель') ? 'assignee' : label.includes('Стори') ? 'storyPoints' : label.includes('Срок') ? 'dueDate' : null
        props.onSelectedFieldChange?.(field)
      }}>
        {/* Панели вкладок — в своей обёртке, колонка свойств — её сосед: статус,
            исполнитель и срок нужны на любой вкладке, а раньше они лежали внутри
            панели «Общего» и исчезали, стоило открыть ход выполнения или QA. */}
        <div className="jmodal-panels">
        <div className="jmodal-general" {...panelProps('general')}>
        <div className="jmodal-main">
          {task.activeMergeRunId && <p className="task-merge-hint">Идёт merge-ран — прогресс во вкладке «Merge».</p>}
          {parent && (
            <button className="jmodal-breadcrumb" onClick={() => props.onOpenTask(parent.id)}>
              <TypeIcon type={parent.type} /> {issueKey(props.projectName, parent)} · {parent.title}
            </button>
          )}
          {props.draft && (
            <label className="jmodal-title-field">
              Название
              <textarea
              className="jmodal-title"
              aria-label="Заголовок задачи"
              placeholder="Например: оплата картой падает на 3-DS"
              ref={titleGrow}
              value={title}
              rows={1}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitTitle()
                }
              }}
              />
            </label>
          )}
          {mobile && (
            <div className="jmodal-quick" data-testid="task-modal-quick">
              {statusField}
              {assigneeField}
            </div>
          )}
          <section className="task-content-block" aria-label="Описание и критерии приёмки">
          <SectionHeader
            className="jmodal-desc-head"
            title="Описание"
            action={!descEditing && (
              <button
                type="button"
                className="task-section-action"
                aria-label="Редактировать описание"
                data-testid="task-desc-edit"
                onClick={startDescEdit}
              >
                Редактировать
              </button>
            )}
          />
          {descEditing ? (
            // Ровно 10 строк, без useAutoGrow: описание длинное, и поле, растущее
            // под текст, увозило бы критерии приёмки и подзадачи за экран.
            <div className="ai-assist-wrap jmodal-desc-wrap" ref={descWrapRef}>
              <textarea
                ref={descriptionRef}
                data-ai-assist={aiAssistEnabled ? '' : undefined}
                className="login-input jmodal-desc"
                aria-label="Описание задачи"
                placeholder="Добавьте описание…"
                rows={10}
                value={description}
                onChange={(e) => {
                  descriptionDirtyRef.current = true
                  setDescription(e.target.value)
                }}
                onBlur={(e) => {
                  // Уход на «Сохранить», «Отмена» или палочку AI — не уход из
                  // правки: иначе blur записал бы черновик раньше их клика (а по
                  // «Отмене» — вопреки ему).
                  if (e.relatedTarget && descWrapRef.current?.contains(e.relatedTarget)) return
                  commitDescription()
                }}
              />
              {aiAssistEnabled && (
                <button className="ai-assist-trigger jmodal-ai-trigger" {...aiAssist.triggerProps}>
                  <WandIcon />
                </button>
              )}
              <div className="jmodal-desc-actions">
                <Button size="sm" variant="primary" onClick={commitDescription}>Сохранить</Button>
                <Button size="sm" onClick={cancelDescEdit}>Отмена</Button>
              </div>
            </div>
          ) : description.trim() ? (
            <div className="jmodal-desc-view" data-testid="task-desc-view">
              <Markdown>{description}</Markdown>
            </div>
          ) : (
            <button className="jmodal-desc-empty" data-testid="task-desc-empty" onClick={startDescEdit}>
              Добавьте описание…
            </button>
          )}
          <SectionHeader
            className="jmodal-desc-head"
            title="Критерии приёмки"
            action={!criteriaEditing && <button type="button" className="task-section-action" aria-label="Редактировать критерии приёмки" data-testid="task-criteria-edit" onClick={() => setCriteriaEditing(true)}>Редактировать</button>}
          />
          {criteriaEditing ? <textarea
            ref={criteriaRef}
            className="login-input jmodal-desc"
            aria-label="Критерии приёмки"
            aria-describedby="task-criteria-help"
            placeholder="Что должно быть выполнено…"
            rows={10}
            value={criteria}
            onChange={(e) => {
              criteriaDirtyRef.current = true
              const raw = e.target.value
              const next = normalizeAcceptanceCriteria(raw)
              const start = e.target.selectionStart
              const end = e.target.selectionEnd
              criteriaDirtyRef.current = true
              setCriteria(next)
              requestAnimationFrame(() => {
                const el = criteriaRef.current
                if (!el) return
                const delta = next.length - raw.length
                el.setSelectionRange(Math.max(0, start + delta), Math.max(0, end + delta))
              })
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const el = e.currentTarget
              const start = el.selectionStart
              const end = el.selectionEnd
              const before = criteria.slice(0, start)
              const line = before.slice(before.lastIndexOf('\n') + 1)
              const emptyItem = /^\d+\.\s*$/.test(line)
              const prefix = emptyItem ? '\n' : e.shiftKey ? '\n   ' : `\n${(criteria.match(/^\d+\. /gm) ?? []).length + 1}. `
              const lineStart = emptyItem ? before.lastIndexOf('\n') + 1 : start
              const next = criteria.slice(0, lineStart) + prefix + criteria.slice(end)
              const cursor = lineStart + prefix.length
              criteriaDirtyRef.current = true
              setCriteria(next)
              requestAnimationFrame(() => criteriaRef.current?.setSelectionRange(cursor, cursor))
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text')
              if (!pasted.includes('\n')) return
              e.preventDefault()
              criteriaDirtyRef.current = true
              const el = e.currentTarget
              const merged = criteria.slice(0, el.selectionStart) + pasted + criteria.slice(el.selectionEnd)
              const next = normalizeAcceptanceCriteria(merged)
              criteriaDirtyRef.current = true
              setCriteria(next)
              requestAnimationFrame(() => criteriaRef.current?.setSelectionRange(next.length, next.length))
            }}
            onBlur={() => {
              const normalized = normalizeAcceptanceCriteria(criteria)
              setCriteria(normalized)
              if (normalized !== task.acceptanceCriteria) props.onUpdate(task.id, { acceptanceCriteria: normalized })
              setCriteriaEditing(false)
            }}
          /> : criteria.trim() ? <div className="jmodal-desc-view task-criteria-view" data-testid="task-criteria-view"><Markdown>{normalizeAcceptanceCriteria(criteria)}</Markdown></div> : <button className="jmodal-desc-empty" onClick={() => setCriteriaEditing(true)}>Добавьте критерии приёмки…</button>}
          <span id="task-criteria-help" className="vc-sr-only">Enter создаёт новый критерий, Shift+Enter — перенос внутри критерия.</span>
          </section>
          {!props.draft && activeTab === 'general' && <TaskDesigns projectId={task.projectId} taskId={task.id} onOpenMake={props.onOpenMake} />}
          {(children.length > 0 || canAddSubtask) && (
            <section className="task-section" aria-label="Подзадачи">
              <SectionHeader title="Подзадачи" meta={children.length > 0 ? `${doneChildren} из ${children.length}` : undefined} />
              {children.length > 0 && (
                <ProgressTrack
                  className="task-children-progress"
                  value={doneChildren}
                  max={children.length}
                  label="Готовность подзадач"
                  tone={doneChildren === children.length ? 'success' : 'running'}
                />
              )}
              <ul className="jmodal-children">
                {children.map((ch) => {
                  const chCol = board.columns.find((c) => c.id === ch.columnId)
                  return (
                    <li key={ch.id}>
                      <button className="jmodal-child" onClick={() => props.onOpenTask(ch.id)}>
                        <TypeIcon type={ch.type} />
                        <span className="jmodal-child-key">{issueKey(props.projectName, ch)}</span>
                        <span className="jmodal-child-title">{ch.title}</span>
                        <span className="jmodal-child-status" title={chCol?.name ?? undefined}>{chCol?.name ?? '—'}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {/* Подзадачу заводим только у эпика и стори: у обычной задачи
                  потомков в модели нет — `parentId` на неё указать нельзя. */}
              {canAddSubtask && (subtaskOpen ? (
                <form
                  className="task-subtask-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    submitSubtask()
                  }}
                >
                  <input
                    className="login-input"
                    aria-label="Название подзадачи"
                    placeholder="Что нужно сделать"
                    autoFocus
                    value={subtaskTitle}
                    onChange={(e) => setSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        setSubtaskOpen(false)
                        setSubtaskTitle('')
                      }
                    }}
                  />
                  <Button size="sm" variant="primary" type="submit" disabled={!subtaskTitle.trim()}>Добавить</Button>
                  <Button size="sm" type="button" onClick={() => { setSubtaskOpen(false); setSubtaskTitle('') }}>Отмена</Button>
                </form>
              ) : (
                <button type="button" className="task-section-action task-subtask-add" onClick={() => setSubtaskOpen(true)}>
                  ＋ Добавить подзадачу
                </button>
              ))}
            </section>
          )}
          {!props.draft && activity.length > 0 && (
            <section className="task-section" aria-label="Активность">
              <SectionHeader
                title="Активность"
                action={<button type="button" className="task-section-action" onClick={() => setActiveTab('timeline')}>Вся временная шкала</button>}
              />
              {/* Лента собрана из уже загруженных полей задачи — без ещё одного
                  запроса при открытии карточки. Подробности этапов лежат во
                  вкладке «Временная шкала», она и грузит их по требованию. */}
              <ul className="task-activity" data-testid="task-activity">
                {activity.map((event) => (
                  <li key={event.id} className="task-activity__item">
                    <span className={`vc-feed-dot vc-feed-dot--${event.dot}`} aria-hidden="true" />
                    <span className="task-activity__text">{event.text}</span>
                    {event.time && <time className="task-activity__time">{event.time}</time>}
                  </li>
                ))}
              </ul>
              {props.onOpenChat && (
                <button type="button" className="task-section-action" onClick={() => props.onOpenChat?.(task.id)}>
                  {task.chatId ? 'Открыть чат задачи' : 'Создать чат задачи'}
                </button>
              )}
            </section>
          )}
        </div>
        </div>

        {!props.draft && <section className="task-tab-panel" data-testid="task-settings-panel" {...panelProps('settings')}>
          <PanelHeading kicker="Конфигурация" title="Настройки выполнения" description="Изменения применятся к следующему запуску." />
          {/* Ленивый монтаж, как у временной шкалы: на «Подготовке» настройки
              не видны, а их запросы (команды, конфигурация задачи, движок,
              машины) уходили при каждом открытии карточки. Смонтировав один
              раз, панель не размонтируем — переключение вкладок туда-обратно
              не должно перечитывать то же самое. */}
          {settingsMounted && <div className="task-settings-stack">
            <CiTaskSettings section="machine" projectId={task.projectId} taskId={task.id} mergeMachineBound={task.mergeMachineBound} />
            <CiTaskSettings section="model" projectId={task.projectId} taskId={task.id} />
            <CiTaskSettings section="commands" projectId={task.projectId} taskId={task.id} />
          </div>}
        </section>}
        {!props.draft && <>
        <section className="task-tab-panel" data-testid="task-timeline-panel" {...panelProps('timeline')}>
          <PanelHeading title="Временная шкала" description="Этапы задачи, попытки внутри них и время, потраченное на каждую." />
          {activeTab === 'timeline' && <TaskTimeline projectId={task.projectId} taskId={task.id} />}
        </section>
        <section className="task-tab-panel" data-testid="task-activity-tab-panel" {...panelProps('activity')}>
          <PanelHeading title="Активность" description="Комментарии, история изменений и ворклог — как в Jira. Комментарии оставляют и участники, и модель ассистента." />
          {/* Условный монтаж, как у временной шкалы: сетевые панели грузятся
              только на своей активной вкладке. */}
          {activeTab === 'activity' && window.api && <TaskActivityPanel projectId={task.projectId} taskId={task.id} api={window.api} />}
        </section>
        <section className="task-tab-panel" data-testid="task-improvements-panel" {...panelProps('improvements')}>
          <PanelHeading
            title="Улучшения"
            description="Что авто-ран предложил изменить в процессе, чтобы следующий прошёл надёжнее."
            actions={newImprovements ? <StatusPill tone="running">{newImprovements} новых</StatusPill> : undefined}
          />
          {improvementsError && <ErrorState compact message="Не удалось загрузить улучшения" detail={improvementsError} onRetry={loadImprovements} testId="task-improvements-error" />}
          {!improvements.length ? <EmptyState compact icon="💡" title="Улучшений пока нет" description="После авто-рана здесь появятся найденные возможности сделать процесс надёжнее." testId="task-improvements-empty" /> : <div className="task-improvements vc-feed">
            {improvements.map((item) => {
              const pending = improvementPending === item.id
              const blocked = improvementPending !== null
              return <details key={item.id} className="task-improvement vc-feed-item" data-status={item.status}><summary>
                <span className="vc-feed-caret" aria-hidden="true" />
                <strong className="task-improvement__title">{item.title}</strong>
                <span className="vc-feed-status">
                  <span className={`vc-feed-dot vc-feed-dot--${IMPROVEMENT_TONE[item.status]}`} aria-hidden="true" />
                  {IMPROVEMENT_STATUS[item.status]}
                </span>
                {/* `isNew` на сервере — это ровно `status === 'new'`, поэтому
                    отдельной метки «Новое» рядом со статусом больше нет. */}
                <span className="task-improvement__origin">{IMPROVEMENT_SOURCE[item.source]} · {item.stepId ? `автошаг ${item.stepId}` : item.runId ? `ран ${item.runId}` : 'без рана'}</span>
              </summary><Markdown>{item.description}</Markdown><div className="task-improvement-actions">
                {item.status === 'new' && <><Button size="sm" variant="primary" loading={pending} disabled={blocked} onClick={() => setImprovementStatus(item.id, 'accepted')}>Принять</Button><Button size="sm" loading={pending} disabled={blocked} onClick={() => setImprovementStatus(item.id, 'rejected')}>Отклонить</Button></>}
                {item.suggestedAction === 'create_chatai_task' && (item.status === 'new' || item.status === 'accepted') && !item.createdTaskId && <Button size="sm" loading={pending} disabled={blocked} onClick={() => openImprovementDraft(item)}>Создать задачу ChatAI</Button>}
                {item.suggestedAction === 'reconfigure_commands' && item.status === 'new' && <Button size="sm" disabled={blocked} onClick={() => setImprovementStatus(item.id, 'accepted')}>Предложить перенастройку команд</Button>}
                {item.suggestedAction === 'support_ticket' && item.status === 'new' && <Button size="sm" disabled={blocked} onClick={() => setImprovementStatus(item.id, 'accepted')}>Подготовить тикет техподдержки</Button>}
                {item.status === 'accepted' && <Button size="sm" loading={pending} disabled={blocked} onClick={() => setImprovementStatus(item.id, 'implemented')}>Реализовано</Button>}
              </div></details>
            })}
          </div>}
        </section>
        <section className="task-tab-panel" data-testid="task-preparation-panel" {...panelProps('preparation')}>{preparationVisible && activeTab === 'preparation' && <TaskPreparationTab projectId={task.projectId} taskId={task.id} liveRunId={task.taskPreparationRunId} liveStatus={task.taskPreparationStatus} loadRuns={props.loadPreparationRuns} loadRun={props.loadPreparationRun} onStart={props.onStartPreparation} onRetry={props.onRetryPreparation} llmAccess={props.llmAccess} llmEngines={props.llmEngines} onCancel={props.onCancelPreparation} onAnswer={props.onAnswerPreparation} onExport={props.onExportPreparation} />}</section>
        {qaStageOrder.map((stage) => qaStageVisible(stage) && <section key={stage} className="task-tab-panel" {...panelProps(stage)}>{seen(stage) && (stage === 'component_qa'
          ? <ComponentQaPanel projectId={task.projectId} taskId={task.id} active={Boolean(props.ciSummary && isActiveCiStatus(props.ciSummary.status)) || Boolean(task.activeMergeRunId)} onFixStarted={(runId) => { setActiveTab('feed'); props.onOpenCiRun?.(runId) }} />
          : <QaStageRunPanel projectId={task.projectId} taskId={task.id} stage={stage} />)}</section>)}
        <section className="task-tab-panel" data-testid="task-manual-qa-panel" {...panelProps('qa')}>
          <PanelHeading kicker="Ручное QA" title="Проверка задачи" description="Сценарии проверяются руками на собранном превью." />
          {seen('qa') && <><FeaturePreviewSection projectId={task.projectId} taskId={task.id} />
          <ManualQaPanel projectId={task.projectId} taskId={task.id} activeRun={Boolean(props.ciSummary && isActiveCiStatus(props.ciSummary.status)) || Boolean(task.activeMergeRunId)} onFixStarted={(runId) => { setActiveTab('feed'); props.onOpenCiRun?.(runId) }} /></>}
        </section>
        <section className="task-tab-panel" {...panelProps('progress')}>
          <PanelHeading
            kicker={props.ciSummary ? `Ран ${props.ciSummary.id.slice(0, 8)}` : 'Ран не запускался'}
            title="Ход выполнения"
            description={props.ciSummary
              ? props.ciSummary.progress?.currentStep ?? props.ciSummary.progress?.stage ?? 'Подробности работы модели и отчёт по рану.'
              : 'Здесь появятся ход работы модели и отчёт, когда задача попадёт в работу.'}
            actions={props.ciSummary && <>
              {isActiveCiStatus(props.ciSummary.status) && <LiveIndicator />}
              <StatusPill tone={pillTone(ciTone(props.ciSummary.status))}>{ciStatusLabel(props.ciSummary.status)}</StatusPill>
            </>}
          />
          {props.ciSummary && (() => {
            const progress = props.ciSummary.progress
            const fallbackStatus: ModelWorkStatus = props.ciSummary.status === 'awaiting_input'
              ? 'waiting'
              : props.ciSummary.status === 'timeout'
                ? 'timeout'
                : props.ciSummary.status === 'interrupted'
                  ? 'failed'
                : props.ciSummary.status === 'skipped'
                  ? undefined
                  : props.ciSummary.status
            const fallbackPercent = fallbackStatus === 'success' ? 100 : fallbackStatus === 'queued' ? 0 : null
            const reportRun = ciReport.report?.runs.find((run) => run.runId === props.ciSummary!.id) ?? ciReport.report?.runs[0]
            const hasDetails = Boolean(progress || reportRun || kbUsage.report || ciReport.loading || ciReport.error)
            return (
              <ModelWorkDisclosure
                key={`${props.ciSummary.id}:model-work`}
                runId={props.ciSummary.id}
                progress={progress}
                fallbackStatus={fallbackStatus}
                fallbackPercent={fallbackPercent}
                fallbackDurationMs={props.ciSummary.durationMs}
              >
                {hasDetails ? <>
                  {progress && <AutomationProgressView progress={progress} />}
                  <CiReport report={ciReport.report} loading={ciReport.loading} error={ciReport.error} onOpenRun={props.onOpenCiRun} testId="task-modal-report" />
                  {kbUsage.report && <KbUsageBrief title="База знаний" note={kbUsage.report.runs ? `по ${kbUsage.report.runs} ранам задачи` : 'по ранам задачи'} totals={kbUsage.report.totals} sections={kbUsage.report.sections} loading={kbUsage.loading} error={kbUsage.error} testId="task-modal-kb-usage" />}
                  {reportRun && <dl className="task-progress-facts">
                    <dt>Provider</dt><dd>{reportRun.provider || '—'}</dd>
                    <dt>Модель</dt><dd>{reportRun.model || '—'}</dd>
                    <dt>Результат</dt><dd>{ciStatusLabel(reportRun.status)}</dd>
                    <dt>Начало</dt><dd>{reportRun.startedAt ? formatDateTime(reportRun.startedAt) : '—'}</dd>
                    <dt>Завершение</dt><dd>{reportRun.finishedAt ? formatDateTime(reportRun.finishedAt) : '—'}</dd>
                    <dt>Итоговая продолжительность</dt><dd>{reportRun.durationMs != null ? fmtDuration(reportRun.durationMs) : '—'}</dd>
                  </dl>}
                </> : <p className="task-tab-empty">Подробности работы модели пока не поступили.</p>}
              </ModelWorkDisclosure>
            )
          })()}
          {!props.ciSummary && kbUsage.report && <KbUsageBrief title="База знаний" note={kbUsage.report.runs ? `по ${kbUsage.report.runs} ранам задачи` : 'по ранам задачи'} totals={kbUsage.report.totals} sections={kbUsage.report.sections} loading={kbUsage.loading} error={kbUsage.error} testId="task-modal-kb-usage" />}
        </section>
        <section className="task-tab-panel" data-testid="task-merge-tab" {...panelProps('merge')}>
          <PanelHeading
            kicker={task.mergeSourceBranch ? `${task.mergeSourceBranch} → main` : 'Слияние'}
            title="Слияние изменений"
            description="Ветка задачи уезжает в main отдельным раном со своими проверками."
            actions={task.activeMergeRunId ? <StatusPill tone="running">Выполняется</StatusPill> : undefined}
          />
          {task.mergeSourceBranch && <BranchFlow
            className="task-merge-flow"
            from={task.mergeSourceBranch}
            note={task.mergeSourceSha ? `Ветка задачи на ${task.mergeSourceSha.slice(0, 8)}` : undefined}
          />}
          {activeTab === 'merge' && <MergePanel
            projectId={task.projectId}
            taskId={task.id}
            runId={(task.activeMergeRunId ?? task.latestMergeRunId) ?? null}
            canStart={Boolean(props.onStartMerge) && canStartMerge({ semanticType: board.columns.find((column) => column.id === task.columnId)?.semanticType ?? 'custom', sourceBranch: task.mergeSourceBranch, alreadyMerged: isCurrentMergeSourceMerged({ sourceSha: task.mergeSourceSha, mergedSourceSha: task.mergedSourceSha, mergedSha: task.mergedSha }), hasActiveRun: Boolean(task.activeMergeRunId), permitted: task.mergePermitted, machineBound: task.mergeMachineBound })}
            onStartMerge={(agentId) => props.onStartMerge?.(task.id, agentId)}
            onOpenCode={() => setActiveTab('code')}
          />}
        </section>
        <section className="task-tab-panel task-code-tab" data-testid="task-code-tab" {...panelProps('code')}>
          {activeTab === 'code' && (
            <GitTargetPane
              projectId={task.projectId}
              taskId={task.id}
              api={window.api}
              onOpenRun={(_kind, runId) => { window.location.hash = `#/ci/runs/${runId}` }}
            />
          )}
        </section>
        <section
          className="task-tab-panel task-run-feed-tab"
          data-testid="task-run-feed-tab"
          {...panelProps('feed')}
          style={{ flex: '1 1 100%', width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}
        >
          <PanelHeading
            kicker={props.ciSummary ? `Ран ${props.ciSummary.id.slice(0, 8)}` : undefined}
            title="Лента рана"
            description="Технические события текущего запуска."
            actions={props.ciSummary && isActiveCiStatus(props.ciSummary.status) ? <LiveIndicator /> : undefined}
          />
          {activeTab === 'feed' && <TaskRunFeed
            projectId={task.projectId}
            taskId={task.id}
            activeDevelopmentRunId={props.ciSummary && isActiveCiStatus(props.ciSummary.status) ? props.ciSummary.id : null}
            activeMergeRunId={task.activeMergeRunId}
          />}
        </section></>}
        </div>
        <aside className="jmodal-side" aria-label="Свойства задачи">
          {!mobile && <h3 className="jmodal-side-title">Свойства</h3>}
          {mobile && (
            <button
              className="jmodal-side-toggle"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((v) => !v)}
            >
              {/* Шеврон общий с лентами: раскрытие в карточке выглядит одинаково. */}
              <span className="vc-feed-caret" aria-hidden="true" />
              Подробности
            </button>
          )}
          {(!mobile || detailsOpen) && (
            <div className="jmodal-side-fields" data-testid="task-modal-details">
              {!mobile && statusField}
              <PropertyRow as="label" label="Приоритет">
                <select
                  className="sel"
                  aria-label="Приоритет"
                  value={task.priority}
                  onChange={(e) => props.onUpdate(task.id, { priority: e.target.value as TaskPriority })}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                  ))}
                </select>
              </PropertyRow>
              {!mobile && assigneeField}
              <PropertyRow as="label" label="Срок">
                <input
                  className="login-input"
                  aria-label="Срок"
                  type="date"
                  value={toDateInput(task.dueDate)}
                  onChange={(e) => props.onUpdate(task.id, { dueDate: fromDateInput(e.target.value) })}
                />
              </PropertyRow>
              {/* Проект — только для чтения: карточку между проектами не переносят,
                  а знать, к какому она относится, из вложенной карточки нужно. */}
              <PropertyRow label="Проект">
                <span className="jmodal-project" title={props.projectName}>
                  <span className="jmodal-project-mark" aria-hidden="true">{props.projectName.trim().slice(0, 1).toUpperCase() || '·'}</span>
                  {props.projectName}
                </span>
              </PropertyRow>
              {!props.draft && (
                <PropertyRow label="Автор">
                  {/* Пустое значение — приглушённое «—», как в остальных полях
                      карточки: жирное «Нет данных» читалось как настоящее имя. */}
                  {task.createdByName ?? task.createdBy
                    ? <span className="jmodal-assignee">
                      <Avatar username={task.createdBy ?? task.createdByName ?? ''} size={20} />
                      <strong>{task.createdByName ?? task.createdBy}</strong>
                    </span>
                    : <span className="jmodal-field-empty">—</span>}
                </PropertyRow>
              )}
              {task.type !== 'epic' && (
                <PropertyRow as="label" label="Родитель">
                  <select
                    className="sel"
                    aria-label="Родитель"
                    title={parent ? `${TYPE_LABEL[parent.type]} · ${parent.title}` : undefined}
                    value={task.parentId ?? ''}
                    onChange={(e) => props.onUpdate(task.id, { parentId: e.target.value || null })}
                  >
                    <option value="">Без родителя</option>
                    {parentOptions.map((p) => (
                      <option key={p.id} value={p.id}>{TYPE_LABEL[p.type]} · {p.title}</option>
                    ))}
                  </select>
                </PropertyRow>
              )}
              <PropertyRow as="label" label="Стори-поинты">
                <input
                  className="login-input"
                  aria-label="Стори-поинты"
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="—"
                  defaultValue={task.storyPoints ?? ''}
                  key={`pts-${task.id}-${task.storyPoints}`}
                  onBlur={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value)
                    if (v !== task.storyPoints) props.onUpdate(task.id, { storyPoints: v })
                  }}
                />
              </PropertyRow>
              <PropertyRow label="Метки" wide>
                <ChipList
                  key={`labels-${task.id}`}
                  items={task.labels}
                  itemLabel="метку"
                  placeholder="+ метка"
                  chipClassName="jcard-label"
                  onAdd={(value) => props.onUpdate(task.id, { labels: [...task.labels, value] })}
                  onRemove={(value) => props.onUpdate(task.id, { labels: task.labels.filter((x) => x !== value) })}
                />
              </PropertyRow>
              <PropertyRow label="Навыки" wide className="jmodal-skills">
                <ChipList
                  key={`skills-${task.id}`}
                  items={task.skills}
                  itemLabel="навык"
                  placeholder="+ навык"
                  chipClassName="jcard-skill"
                  onAdd={(value) => props.onUpdate(task.id, { skills: [...task.skills, value] })}
                  onRemove={(value) => props.onUpdate(task.id, { skills: task.skills.filter((x) => x !== value) })}
                />
              </PropertyRow>

              {props.detailsExtra}
              {/* Статус здесь не повторяем: он уже стоит селектом выше и в шапке
                  карточки — три одинаковых значения подряд только шумят. */}
              {!props.draft && <p className="jmodal-dates">
                Создано: {formatDate(task.createdAt)}
                <br />Обновлено: {formatDate(task.updatedAt)}
              </p>}
            </div>
          )}
          {/* В черновике панели рана нет: задача ещё не создана, запускать нечего. */}
          {!props.draft && task.type === 'task' && column?.semanticType !== 'backlog' && column?.semanticType !== 'preparation' && (props.onStartCi || props.ciSummary) && (
            <div className="jmodal-ci" data-testid="task-modal-ci">
              <div className="jmodal-ci-head">
                <span className="ci-task-title">CI-ран</span>
                {props.ciSummary && (
                  <span className={`lozenge ci-lozenge--${ciTone(props.ciSummary.status)}`}>{ciStatusLabel(props.ciSummary.status)}</span>
                )}
              </div>
              {props.ciSummary && !props.ciSummary.progress && (
                <p className="jcard-ci-phase">
                  {props.ciSummary.slotProgress.phase} {props.ciSummary.slotProgress.done}/{props.ciSummary.slotProgress.total}
                  {props.ciSummary.durationMs != null ? ` · ${fmtDuration(props.ciSummary.durationMs)}` : ''}
                </p>
              )}
              {props.ciSummary?.executionLlm && <div className="jcard-ci-model" data-testid="task-modal-ci-execution-llm">
                {props.ciSummary.executionLlm.source === 'stage' ? <>
                  <div>Текущий этап: {ciStageLabel(props.ciSummary.executionLlm.stage)}</div>
                  <div>Выполняется на: {ciLlmLabel(props.ciSummary.executionLlm)}</div>
                  {(props.ciSummary.executionLlm.provider !== props.ciSummary.executionLlm.base.provider || props.ciSummary.executionLlm.model !== props.ciSummary.executionLlm.base.model)
                    && <div>Базовая модель рана: {ciLlmLabel(props.ciSummary.executionLlm.base)}</div>}
                </> : <div>Базовая модель рана: {ciLlmLabel(props.ciSummary.executionLlm)}</div>}
              </div>}
              <div className="jmodal-ci-actions">
                {props.ciSummary && props.onOpenCiRun && (
                  <Button
                    size="sm"
                    className={props.ciSummary.awaitingInput ? 'jcard-ci-attention' : undefined}
                    onClick={() => props.onOpenCiRun?.(props.ciSummary!.id)}
                  >
                    {props.ciSummary.awaitingInput ? 'Ответить модели' : 'Лента рана'}
                  </Button>
                )}
                {/* Активный ран нельзя запустить второй раз — только смотреть ленту;
                    после завершения постановка в очередь снова доступна. */}
                {props.onStartCi && canStartCi && (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={launching === 'queue'}
                    disabled={launching !== null}
                    title="Добавить задачу в очередь выполнения. Если свободный слот есть, выполнение начнётся сразу"
                    onClick={() => void launchCi('queue')}
                  >{launching === 'queue' ? 'Добавляем в очередь…' : 'В очередь'}</Button>
                )}
                {props.onStartCiParallel && canStartParallelCi && (
                  <Button
                    size="sm"
                    loading={launching === 'parallel'}
                    disabled={launching !== null}
                    title="Запустить задачу сразу, минуя общую очередь. Машина будет выбрана автоматически с учётом загрузки"
                    onClick={() => void launchCi('parallel')}
                  >Параллельно</Button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </Dialog>
    {improvementDraft && <TaskModal
      task={improvementDraft.task}
      board={board}
      projectName={props.projectName}
      members={props.members}
      draft
      onUpdate={(_id, fields) => setImprovementDraft((current) => current ? { ...current, task: { ...current.task, ...fields } } : null)}
      onDelete={() => {}}
      onMoveToColumn={(_id, columnId) => setImprovementDraft((current) => current ? { ...current, task: { ...current.task, columnId } } : null)}
      onOpenTask={() => {}}
      onClose={() => { if (!improvementPending) setImprovementDraft(null) }}
      detailsExtra={<p>Выберите доступную исходную колонку и подтвердите создание.</p>}
      footer={<>
        {improvementsError && <span role="alert">{improvementsError}</span>}
        <Button onClick={() => setImprovementDraft(null)} disabled={improvementPending !== null}>Отмена</Button>
        <Button variant="primary" loading={improvementPending === improvementDraft.improvement.id} disabled={improvementPending !== null || !improvementDraft.task.columnId || !improvementDraft.task.title.trim()} onClick={() => void saveImprovementDraft()}>Создать задачу</Button>
      </>}
    />}
    <PromptBuilder {...aiAssist.popupProps} />
    </>
  )
}

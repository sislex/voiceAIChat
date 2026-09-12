import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, useConfirm } from '@voicechat/ui-kit'
import { TASK_CARD_VERSION_KEY } from '@voicechat/ui-foundation/persistence'
import { issueKey, QA_WORKFLOW, type KanbanColumnSemanticType, type TaskDesignLink, type TaskReworkCycle } from '@shared/projects'
import { ALL_PROJECT_FEATURES } from '@shared/projectTypes'
import { isActiveCiStatus } from '@shared/ci'
import { canStartMerge, isCurrentMergeSourceMerged } from '@shared/merge'
import type { TaskTimeline } from '@shared/timeline'
import type { TaskModalProps } from './TaskModal'
import { TaskModal, TaskChatPanel } from './TaskModal'
import { NewTaskCardView } from './NewTaskCardView'
import { NewTaskPreparationPanel } from './NewTaskPreparationPanel'
import { NewTaskProgressPanel } from './NewTaskProgressPanel'
import { NewTaskQaStagesPanel } from './NewTaskQaStagesPanel'
import { NewTaskManualQaPanel } from './NewTaskManualQaPanel'
import { NewTaskMergePanel } from './NewTaskMergePanel'
import { NewTaskSettingsPanel } from './NewTaskSettingsPanel'
import { NewTaskFeedPanel } from './NewTaskFeedPanel'
import type { TaskCardMakeLinkDraft, TaskCardRunStatus, TaskCardTab, TaskCardVersion, TaskCardViewModel, TaskReworkCycleViewModel, TaskReworkDraft, TaskReworkSourcesState } from './TaskCardViewModel'

const LABELS: Record<KanbanColumnSemanticType, string> = {
  backlog: 'Бэклог', preparation: 'Подготовка', ready: 'Готово к разработке',
  development: 'Разработка', component_qa: 'Component QA', integration_tests: 'Интеграционные тесты',
  automated_qa: 'Automated QA', testing: 'Тестирование', qa_preparation: 'Подготовка QA',
  manual_qa: 'Ручное QA', awaiting_merge: 'Ожидает merge', merge: 'Merge',
  decision_required: 'Требуется решение', done: 'Готово', cancelled: 'Отменено', custom: 'Пользовательский этап'
}
const POST_DEVELOPMENT = new Set<KanbanColumnSemanticType>(['component_qa', 'integration_tests', 'automated_qa', 'testing', 'qa_preparation', 'manual_qa', 'awaiting_merge', 'merge', 'decision_required', 'done'])
/** Timeline stage `type` for each workflow step: the timeline is keyed by run kind, not by column. */
const TIMELINE_TYPE: Partial<Record<KanbanColumnSemanticType, string>> = {
  preparation: 'task_preparation', development: 'development', component_qa: 'component_qa',
  integration_tests: 'integration_tests', automated_qa: 'automated_qa', manual_qa: 'manual_qa', merge: 'merge'
}
const EMPTY_DRAFT: TaskReworkDraft = { description: '', criteria: [], makeMode: 'whole_project', makePaths: [], makeSources: [], attachments: [] }
const fileView = (file: { id: string; name: string; size: number; mimeType: string; status: 'ready' | 'missing' }) => ({ ...file, status: file.status as 'ready' | 'missing' })

/** Доменный цикл доработки → модель представления карточки. */
function cycleView(cycle: TaskReworkCycle): TaskReworkCycleViewModel {
  return {
    ...cycle,
    makeSources: cycle.makeSources.map((source, index) => ({
      ...source,
      id: source.conversationId || `source-${index}`,
      paths: source.paths.map((path) => ({ path, available: source.fileStatuses?.find((item) => item.path === path)?.available ?? true }))
    })),
    attachments: cycle.attachments.map(fileView)
  }
}

/** The last version the user picked; the legacy card stays the default for newcomers. */
function storedVersion(): TaskCardVersion | null {
  try {
    const value = window.localStorage?.getItem(TASK_CARD_VERSION_KEY)
    return value === 'new' || value === 'legacy' ? value : null
  } catch { return null }
}
function rememberVersion(version: TaskCardVersion): void {
  try { window.localStorage?.setItem(TASK_CARD_VERSION_KEY, version) } catch { /* private mode: the choice lives for the session only */ }
}

export interface TaskCardContainerProps extends TaskModalProps {
  initialVersion?: TaskCardVersion
  reworkCycles?: TaskReworkCycleViewModel[]
  loadReworkCycles?: (taskId: string) => Promise<TaskReworkCycle[]>
  onCreateReworkCycle?: (taskId: string, draft: TaskReworkDraft, idempotencyKey: string) => Promise<TaskReworkCycle>
  uploadReworkAttachment?: (file: File) => Promise<{ id: string; name: string; mimeType: string; size: number }>
}

function runStatus(status: string | undefined, awaiting = false): TaskCardRunStatus {
  if (awaiting || status === 'waiting_for_answer' || status === 'awaiting_input') return 'waiting_for_answer'
  if (status === 'queued') return 'queued'
  if (status === 'success' || status === 'completed' || status === 'passed') return 'success'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'running' || status === 'validating' || status === 'active') return 'running'
  return 'failed'
}

export function buildTaskCardViewModel(props: TaskCardContainerProps, cycles: TaskReworkCycleViewModel[], timeline: TaskTimeline | null = null, designs: TaskDesignLink[] | null = null): TaskCardViewModel {
  const column = props.board.columns.find((item) => item.id === props.task.columnId)
  const semanticType = column?.semanticType ?? 'custom'
  const workflowIndex = QA_WORKFLOW.indexOf(semanticType)
  const activeRun = props.task.latestRunResult?.outcome === 'active' || props.ciSummary?.modelActive === true || props.ciSummary?.awaitingInput === true
  const developmentSucceeded = props.ciSummary?.status === 'success' || (props.task.latestRunResult?.kind === 'development' && props.task.latestRunResult.outcome === 'success')
  const canRework = Boolean(developmentSucceeded && POST_DEVELOPMENT.has(semanticType) && semanticType !== 'cancelled')
  // Board payloads carry no design links; the container loads them separately
  // and passes the fresh list, the task's own field is only a fallback.
  const makeSources = (designs ?? props.task.designs ?? []).map((design) => ({
    id: design.id,
    title: design.label || design.conversationTitle,
    conversationId: design.conversationId,
    mode: design.mode,
    paths: design.mode === 'whole_project'
      ? []
      : design.paths.map((path) => {
        const status = design.fileStatuses?.find((item) => item.path === path)
        return { path, available: status?.available ?? true, ...(status?.error ? { error: status.error } : {}) }
      })
  }))
  const runs = props.task.latestRunResult ? [{
    id: props.task.latestRunResult.id,
    title: LABELS[props.task.latestRunResult.kind === 'qa_preparation' ? 'qa_preparation' : props.task.latestRunResult.kind],
    status: runStatus(props.task.latestRunResult.status),
    outcome: props.task.latestRunResult.outcome,
    createdAt: props.task.latestRunResult.createdAt,
    finishedAt: props.task.latestRunResult.finishedAt,
    canOpen: true,
    canCancel: props.task.latestRunResult.outcome === 'active',
    canAnswer: runStatus(props.task.latestRunResult.status) === 'waiting_for_answer'
  }] : props.ciSummary ? [{
    id: props.ciSummary.id, title: 'Разработка', status: runStatus(props.ciSummary.status, props.ciSummary.awaitingInput),
    outcome: props.ciSummary.status === 'success' ? 'success' as const : activeRun ? 'active' as const : props.ciSummary.status === 'cancelled' ? 'cancelled' as const : 'failure' as const,
    createdAt: 0, finishedAt: null, canOpen: true, canCancel: activeRun, canAnswer: props.ciSummary.awaitingInput
  }] : []
  const submitted = cycles.filter((cycle) => cycle.status !== 'draft')
  const drafts = cycles.filter((cycle) => cycle.status === 'draft')
  const stageTiming = (step: KanbanColumnSemanticType, state: 'passed' | 'current' | 'upcoming'): { durationMs?: number; startedAt?: number | null } => {
    const type = TIMELINE_TYPE[step]
    const stage = type ? timeline?.stages.find((item) => item.type === type) : undefined
    if (!stage) return {}
    if (state === 'passed') {
      const duration = stage.calendarDuration ?? stage.activeDuration
      return duration == null ? {} : { durationMs: duration }
    }
    if (state === 'current' && stage.startedAt) return { startedAt: Date.parse(stage.startedAt) }
    return {}
  }
  return {
    taskId: props.task.id,
    taskKey: issueKey(props.projectName, props.task),
    projectName: props.projectName,
    title: props.task.title,
    stage: {
      semanticType, label: column?.name || LABELS.custom, fallback: !column || semanticType === 'custom',
      ...(stageStatus(props, activeRun) ? { statusLabel: stageStatus(props, activeRun)! } : {}),
      ...(stageNote(props, semanticType, activeRun) ? { note: stageNote(props, semanticType, activeRun)! } : {})
    },
    priority: props.task.priority,
    assignee: props.task.assignee,
    description: props.task.description,
    acceptanceCriteria: props.task.acceptanceCriteria,
    labels: props.task.labels,
    // Цикл 1 — первоначальная постановка; каждая отправленная доработка добавляет свой.
    cycleNumber: submitted.length + 1,
    nextCycleNumber: submitted.length + 2,
    branch: props.task.mergeSourceBranch ?? null,
    commit: props.task.mergeSourceSha ?? null,
    workflow: QA_WORKFLOW.map((step, index) => {
      const state = step === semanticType ? 'current' as const : workflowIndex >= 0 && index < workflowIndex ? 'passed' as const : 'upcoming' as const
      return { id: step, semanticType: step, label: LABELS[step], state, ...stageTiming(step, state) }
    }),
    tabs: cardTabs(props, semanticType, drafts.length, activeRun),
    runs,
    source: { description: props.task.description, acceptanceCriteria: props.task.acceptanceCriteria, attachments: [] },
    makeSources,
    cycles: submitted,
    drafts,
    loadState: 'ready',
    actions: {
      canRework,
      ...(activeRun ? { reworkBlockedReason: 'Остановите его или дождитесь завершения.' } : {}),
      hasActiveRun: activeRun,
      canStopRun: activeRun && Boolean(props.ciSummary || props.task.activeMergeRunId),
      safeActiveRunActions: activeRun ? ['keep_running', 'open_run', 'cancel_explicitly'] : []
    }
  }
}

/** Состояние задачи внутри этапа — то, что в макете стоит рядом с названием колонки. */
function stageStatus(props: TaskCardContainerProps, activeRun: boolean): string | null {
  if (props.ciSummary?.awaitingInput || props.task.taskPreparationStatus === 'waiting_for_answer') return 'Пауза'
  if (activeRun) return 'Выполняется'
  if (props.task.latestRunResult?.outcome === 'failure') return 'Ошибка'
  return 'Ожидает'
}

/** Подзаголовок карточки: одна фраза о том, что происходит с задачей сейчас. */
function stageNote(props: TaskCardContainerProps, semanticType: KanbanColumnSemanticType, activeRun: boolean): string | null {
  if (props.ciSummary?.awaitingInput) return 'Модель задала уточняющий вопрос.'
  if (props.task.taskPreparationStatus === 'running') return 'AI формирует Development Brief.'
  if (activeRun) return 'Ран выполняется.'
  if (semanticType === 'decision_required') return 'Автоматический выход запрещён.'
  if (semanticType === 'backlog') return 'Подготовка ещё не запускалась.'
  return null
}

/**
 * Состав вкладок зависит от возможностей типа проекта и стадии — как в старой
 * карточке. Точка `live` у ленты рана показывает, что там сейчас что-то идёт.
 */
function cardTabs(props: TaskCardContainerProps, semanticType: KanbanColumnSemanticType, draftCount: number, activeRun: boolean): TaskCardViewModel['tabs'] {
  const features = props.projectFeatures ?? ALL_PROJECT_FEATURES
  const preparationVisible = props.task.type === 'task' && ['backlog', 'preparation', 'ready'].includes(semanticType)
  return [
    { id: 'overview', label: 'Общее' },
    { id: 'chat', label: 'AI-чат' },
    { id: 'reworks', label: 'Доработки', ...(draftCount ? { count: draftCount } : {}) },
    ...(preparationVisible && features.ci ? [{ id: 'preparation' as const, label: 'Подготовка к разработке' }] : []),
    { id: 'settings', label: 'Настройки' },
    { id: 'progress', label: 'Ход выполнения' },
    ...(features.qa ? [
      { id: 'component_qa' as const, label: 'Component QA' },
      { id: 'integration_tests' as const, label: 'Интеграционные тесты' },
      { id: 'automated_qa' as const, label: 'Automated QA' },
      { id: 'manual_qa' as const, label: 'Ручное QA' }
    ] : []),
    ...(features.git ? [{ id: 'merge' as const, label: 'Merge' }] : []),
    ...(features.ci ? [{ id: 'feed' as const, label: 'Лента рана', ...(activeRun ? { live: true } : {}) }] : [])
  ]
}

/** Merge several drafts into one: the server submits exactly one cycle per pass. */
export function mergeDraftInputs(chosen: TaskReworkCycleViewModel[]): { description: string; criteria: string[]; makeSources: Array<{ conversationId: string; mode: 'whole_project' | 'files'; paths: string[] }>; uploadIds: string[] } {
  const ordered = [...chosen].sort((a, b) => a.sequence - b.sequence)
  const sources = new Map<string, { conversationId: string; mode: 'whole_project' | 'files'; paths: string[] }>()
  for (const cycle of ordered) for (const source of cycle.makeSources) {
    const current = sources.get(source.conversationId)
    if (!current) { sources.set(source.conversationId, { conversationId: source.conversationId, mode: source.mode, paths: source.paths.map((path) => path.path) }); continue }
    // The whole project already covers any file list; otherwise union the files.
    if (current.mode === 'whole_project' || source.mode === 'whole_project') sources.set(source.conversationId, { conversationId: source.conversationId, mode: 'whole_project', paths: [] })
    else current.paths = [...new Set([...current.paths, ...source.paths.map((path) => path.path)])].sort()
  }
  return {
    description: ordered.length === 1 ? ordered[0]!.description : ordered.map((cycle) => `№ ${cycle.sequence} — ${cycle.description}`).join('\n\n'),
    criteria: [...new Set(ordered.flatMap((cycle) => cycle.criteria))],
    makeSources: [...sources.values()],
    uploadIds: ordered.flatMap((cycle) => cycle.attachments.map((item) => item.id))
  }
}

export function TaskCardContainer(props: TaskCardContainerProps): JSX.Element {
  // По умолчанию — legacy. Новая карточка вводится рядом со старой и включается
  // переключателем в шапке: на legacy-разметке стоят и существующие сценарии
  // доски (`task-modal`, `task-desc-view`), и привычка пользователей. Выбор
  // запоминается в браузере, чтобы не переключать карточку при каждом открытии.
  const [version, setVersionState] = useState<TaskCardVersion>(() => props.initialVersion ?? storedVersion() ?? 'legacy')
  const setVersion = (next: TaskCardVersion): void => { rememberVersion(next); setVersionState(next) }
  const confirm = useConfirm()
  const [activeTab, setActiveTab] = useState<TaskCardTab>(props.initialTab === 'chat' ? 'chat' : 'overview')
  useEffect(() => {
    if (props.initialTab === 'chat') setActiveTab('chat')
    else if (props.initialTab === 'preparation') setActiveTab('preparation')
    else if (props.initialTab === 'settings') setActiveTab('settings')
    else if (props.initialTab === 'progress') setActiveTab('progress')
    else if (props.initialTab === 'component_qa' || props.initialTab === 'integration_tests' || props.initialTab === 'automated_qa' || props.initialTab === 'merge' || props.initialTab === 'feed') setActiveTab(props.initialTab)
    else if (props.initialTab === 'qa') setActiveTab('manual_qa')
    else setActiveTab('overview')
  }, [props.initialTab, props.task.id])
  const [reworkOpen, setReworkOpen] = useState(false)
  const [draft, setDraft] = useState<TaskReworkDraft>(EMPTY_DRAFT)
  const [cycles, setCycles] = useState<TaskReworkCycleViewModel[]>(props.reworkCycles ?? [])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourceAttachments, setSourceAttachments] = useState<TaskCardViewModel['source']['attachments']>([])
  const [makeSources, setMakeSources] = useState<TaskReworkSourcesState>({ state: 'loading', items: [] })
  const [makeLinkPending, setMakeLinkPending] = useState(false)
  const [timeline, setTimeline] = useState<TaskTimeline | null>(null)
  const [designs, setDesigns] = useState<TaskDesignLink[] | null>(null)
  const loadPersistent = async (): Promise<void> => {
    const api = window.api
    if (!api) return
    const [history, files] = await Promise.all([
      props.loadReworkCycles ? props.loadReworkCycles(props.task.id) : api['tasks:reworkCycles']({ projectId: props.task.projectId, taskId: props.task.id }),
      api['tasks:attachments']({ projectId: props.task.projectId, taskId: props.task.id, scope: 'source' })
    ])
    setCycles(history.map(cycleView))
    setSourceAttachments(files.map(fileView))
  }
  const loadMakeSources = async (): Promise<void> => {
    setMakeSources({ state: 'loading', items: [] })
    try {
      const items = await window.api['projects:designSources']({ id: props.task.projectId })
      setMakeSources({ state: items.length ? 'ready' : 'empty', items })
    } catch (cause) { setMakeSources({ state: 'error', items: [], error: cause instanceof Error ? cause.message : 'Не удалось загрузить Make-проекты' }) }
  }
  useEffect(() => { void loadPersistent().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))) }, [props.task.id])
  // Make links live in their own table: the board task does not carry them.
  useEffect(() => {
    if (version !== 'new') return
    let live = true
    setDesigns(null)
    const request = window.api?.['tasks:designs']?.({ projectId: props.task.projectId, taskId: props.task.id })
    if (!request) return
    void request.then((value) => { if (live) setDesigns(value) }).catch(() => { /* the task field stays as fallback */ })
    return () => { live = false }
  }, [props.task.id, version])
  // Список Make-проектов нужен и форме доработки, и связи макета на «Общем».
  useEffect(() => { if (version === 'new') void loadMakeSources() }, [props.task.projectId, version])
  // Timing of the workflow steps comes from the task timeline; it changes only
  // when a run finishes, so the column and the run summary are enough triggers.
  useEffect(() => {
    if (version !== 'new') return
    let live = true
    const request = window.ci?.getTaskTimeline(props.task.projectId, props.task.id)
    if (!request) return
    void request.then((value) => { if (live) setTimeline(value) }).catch(() => { /* the workflow shows without timings */ })
    return () => { live = false }
  }, [props.task.id, props.task.columnId, props.ciSummary?.status, version])
  const model = useMemo(() => {
    const value = buildTaskCardViewModel(props, cycles, timeline, designs)
    value.source.attachments = sourceAttachments
    return value
  }, [props, cycles, sourceAttachments, timeline, designs])
  const column = props.board.columns.find((item) => item.id === props.task.columnId)
  const semanticType = column?.semanticType ?? 'custom'
  const workflowLabels = QA_WORKFLOW.map((step) => LABELS[step])
  const submittedCycles = useMemo(() => cycles.filter((cycle) => cycle.status !== 'draft'), [cycles])
  const openFix = (runId: string): void => { setActiveTab('feed'); props.onOpenCiRun?.(runId) }

  // Панели вкладок — функциональные панели старой карточки внутри рейки этапов
  // дизайна: логика подготовки, QA, merge и ленты рана живёт в них, и второй
  // её копии в новой оболочке быть не должно.
  const renderPanel = (tab: TaskCardTab): ReactNode => {
    const shared = { projectId: props.task.projectId, taskId: props.task.id }
    const stageShared = { ...shared, cycles: submittedCycles, workflow: workflowLabels }
    const runActive = Boolean(props.ciSummary && isActiveCiStatus(props.ciSummary.status)) || Boolean(props.task.activeMergeRunId)
    if (tab === 'chat') return <TaskChatPanel projectId={props.task.projectId} taskId={props.task.id} initialDraft={props.initialChatDraft} onOpenConversationSettings={props.onOpenConversationSettings} />
    if (tab === 'preparation') return <NewTaskPreparationPanel
      {...stageShared}
      preparation={{
        ...shared, liveRunId: props.task.taskPreparationRunId, liveStatus: props.task.taskPreparationStatus,
        loadRuns: props.loadPreparationRuns, loadRun: props.loadPreparationRun, onStart: props.onStartPreparation,
        onRetry: props.onRetryPreparation, llmAccess: props.llmAccess, llmEngines: props.llmEngines,
        onCancel: props.onCancelPreparation, onAnswer: props.onAnswerPreparation, onExport: props.onExportPreparation
      }}
    />
    if (tab === 'settings') return <NewTaskSettingsPanel {...shared} mergeMachineBound={props.task.mergeMachineBound} />
    if (tab === 'progress') return <NewTaskProgressPanel
      {...stageShared}
      ciSummary={props.ciSummary ?? null}
      canStart={semanticType !== 'done' && semanticType !== 'backlog' && semanticType !== 'preparation' && semanticType !== 'cancelled'}
      {...(props.onStartCi ? { onStartCi: () => props.onStartCi?.(props.task.id) } : {})}
    />
    if (tab === 'component_qa' || tab === 'integration_tests' || tab === 'automated_qa') return <NewTaskQaStagesPanel {...stageShared} stage={tab} runActive={runActive} onFixStarted={openFix} />
    if (tab === 'manual_qa') return <NewTaskManualQaPanel {...stageShared} runActive={runActive} onFixStarted={openFix} />
    if (tab === 'merge') return <NewTaskMergePanel
      {...stageShared}
      activeRunId={props.task.activeMergeRunId ?? null}
      canStart={Boolean(props.onStartMerge) && canStartMerge({
        semanticType,
        sourceBranch: props.task.mergeSourceBranch,
        alreadyMerged: isCurrentMergeSourceMerged({ sourceSha: props.task.mergeSourceSha, mergedSourceSha: props.task.mergedSourceSha, mergedSha: props.task.mergedSha }),
        hasActiveRun: Boolean(props.task.activeMergeRunId), permitted: props.task.mergePermitted, machineBound: props.task.mergeMachineBound
      })}
      onStartMerge={(agentId) => props.onStartMerge?.(props.task.id, agentId)}
    />
    if (tab === 'feed') return <NewTaskFeedPanel {...shared} ciSummary={props.ciSummary ?? null} activeMergeRunId={props.task.activeMergeRunId ?? null} onStopRun={stopRun} />
    return null
  }

  /** Stop the active run after an explicit confirmation — the banner's "Остановить ран". */
  const stopRun = async (): Promise<void> => {
    const development = props.ciSummary && isActiveCiStatus(props.ciSummary.status) ? props.ciSummary.id : null
    const merge = props.task.activeMergeRunId ?? null
    if (!development && !merge) return
    const ok = await confirm({ title: 'Остановить активный ран?', message: 'Модель прервёт работу, незавершённые шаги будут отменены.', variant: 'danger', confirmLabel: 'Остановить' })
    if (!ok) return
    try {
      if (development) await window.ci?.cancelRun(development)
      else if (merge) await window.ci?.cancelMerge(merge)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось остановить ран.') }
  }

  const linkMake = async (draft: TaskCardMakeLinkDraft, replaceLinkId: string | null): Promise<void> => {
    setMakeLinkPending(true); setError(null)
    try {
      if (replaceLinkId) await window.api['tasks:unlinkDesign']({ projectId: props.task.projectId, taskId: props.task.id, linkId: replaceLinkId })
      const links = await window.api['tasks:linkDesign']({ projectId: props.task.projectId, taskId: props.task.id, conversationId: draft.conversationId, mode: draft.mode, paths: draft.paths })
      if (Array.isArray(links)) setDesigns(links)
      props.onUpdate(props.task.id, {})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось связать макет.')
      throw cause
    } finally { setMakeLinkPending(false) }
  }

  if (version === 'legacy') return <TaskModal {...props} headerExtra={<div className="task-version-switch" role="group" aria-label="Версия карточки"><Button size="sm" variant="ghost" aria-pressed={false} onClick={() => setVersion('new')}>Новая</Button><Button size="sm" variant="primary" aria-pressed>Старая</Button></div>} />
  return <NewTaskCardView
    model={model}
    renderPanel={renderPanel}
    version={version}
    activeTab={activeTab}
    reworkOpen={reworkOpen}
    reworkDraft={draft}
    reworkPending={pending}
    reworkError={error}
    makeSourcesState={makeSources}
    makeLinkPending={makeLinkPending}
    onVersionChange={setVersion}
    callbacks={{
      onClose: props.onClose,
      onChangeTab: (tab) => {
        setActiveTab(tab)
        props.onTabChange?.(tab === 'overview' || tab === 'reworks' || tab === 'manual_qa' ? 'general' : tab)
      },
      onOpenRun: (id) => props.onOpenCiRun?.(id),
      onOpenMake: (id) => props.onOpenMake?.(id),
      onStartRework: () => { setError(null); setReworkOpen(true); void loadMakeSources() },
      onRetryMakeSources: () => { void loadMakeSources() },
      onLoadMakeFiles: async (conversationId) => (await window.api['tasks:reworkMakeFiles']({ projectId: props.task.projectId, taskId: props.task.id, conversationId })).map((item) => item.path),
      onUploadAttachment: async (scope, file) => {
        const temporaryId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const update = (map: (items: TaskCardViewModel['source']['attachments']) => TaskCardViewModel['source']['attachments']) => {
          if (scope === 'source') setSourceAttachments(map)
          else setDraft((value) => ({ ...value, attachments: map(value.attachments) }))
        }
        update((items) => [...items, { id: temporaryId, name: file.name, size: file.size, mimeType: file.type, status: 'uploading' }])
        try {
          const dataBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onerror = () => reject(reader.error)
            reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
            reader.readAsDataURL(file)
          })
          const uploaded = await window.api['tasks:uploadAttachment']({ projectId: props.task.projectId, taskId: props.task.id, scope, name: file.name, mimeType: file.type, dataBase64 })
          update((items) => items.map((item) => item.id === temporaryId ? fileView(uploaded) : item))
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Не удалось загрузить файл'
          update((items) => items.map((item) => item.id === temporaryId ? { ...item, status: 'error', error: message } : item))
        }
      },
      onDeleteAttachment: async (id) => { await window.api['tasks:deleteAttachment']({ projectId: props.task.projectId, taskId: props.task.id, attachmentId: id }); setSourceAttachments((all) => all.filter((item) => item.id !== id)); setDraft((value) => ({ ...value, attachments: value.attachments.filter((item) => item.id !== id) })) },
      onChangeReworkDraft: setDraft,
      onCancelRework: () => { setDraft(EMPTY_DRAFT); setReworkOpen(false) },
      onOpenChat: () => { setActiveTab('chat'); props.onTabChange?.('chat') },
      loadAttachment: async (attachmentId) => {
        const file = await window.api['tasks:readAttachment']({ projectId: props.task.projectId, taskId: props.task.id, attachmentId })
        return `data:${file.mimeType};base64,${file.dataBase64}`
      },
      onLinkMake: (next) => linkMake(next, null),
      onReplaceMake: (linkId, next) => linkMake(next, linkId),
      onUnlinkMake: async (linkId) => {
        try {
          const links = await window.api['tasks:unlinkDesign']({ projectId: props.task.projectId, taskId: props.task.id, linkId })
          if (Array.isArray(links)) setDesigns(links)
          props.onUpdate(props.task.id, {})
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось снять связь с макетом.') }
      },
      onStopRun: stopRun,
      // Черновик сохраняется даже при активном ране: ворота стоят на отправке,
      // а не на подготовке набора — иначе доработку не собрать заранее.
      onSubmitRework: async (next) => {
        if (pending) return
        if (!next.description.trim()) { setError('Опишите, что нужно доработать.'); return }
        setPending(true); setError(null)
        try {
          const input = {
            description: next.description, criteria: next.criteria,
            makeSources: (next.makeSources ?? []).map((source) => ({ conversationId: source.conversationId, mode: source.mode, paths: source.paths })),
            uploadIds: next.attachments.map((item) => item.id)
          }
          const raw = next.editingId
            ? await window.api['tasks:updateReworkDraft']({ projectId: props.task.projectId, taskId: props.task.id, cycleId: next.editingId, input })
            : await window.api['tasks:createReworkDraft']({ projectId: props.task.projectId, taskId: props.task.id, input })
          const cycle = cycleView(raw)
          setCycles((all) => all.some((item) => item.id === cycle.id) ? all.map((item) => item.id === cycle.id ? cycle : item) : [...all, cycle])
          setDraft(EMPTY_DRAFT); setReworkOpen(false)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Не удалось сохранить черновик доработки.')
        } finally { setPending(false) }
      },
      onEditDraft: (cycleId) => {
        const cycle = cycles.find((item) => item.id === cycleId)
        if (!cycle) return
        setDraft({
          description: cycle.description, criteria: [...cycle.criteria], makeMode: 'whole_project', makePaths: [],
          makeSources: cycle.makeSources.map((source) => ({ conversationId: source.conversationId, mode: source.mode, paths: source.paths.map((path) => path.path) })),
          attachments: cycle.attachments, editingId: cycle.id
        })
        setError(null); setReworkOpen(true); void loadMakeSources()
      },
      onDeleteDraft: async (cycleId) => {
        try {
          await window.api['tasks:deleteReworkDraft']({ projectId: props.task.projectId, taskId: props.task.id, cycleId })
          setCycles((all) => all.filter((item) => item.id !== cycleId))
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось удалить черновик.') }
      },
      onSubmitDraft: async (cycleId) => {
        try {
          const { cycle } = await window.api['tasks:submitReworkDraft']({ projectId: props.task.projectId, taskId: props.task.id, cycleId })
          setCycles((all) => all.map((item) => item.id === cycleId ? cycleView(cycle) : item))
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось отправить доработку.') }
      },
      // Several drafts become one cycle: the server moves the task to
      // preparation on the first submission and rejects the second, so the set
      // is merged into the oldest draft first, the rest are deleted, then it goes.
      onSubmitDrafts: async (cycleIds) => {
        const chosen = cycles.filter((item) => item.status === 'draft' && cycleIds.includes(item.id)).sort((a, b) => a.sequence - b.sequence)
        const target = chosen[0]
        if (!target || pending) return
        setPending(true); setError(null)
        try {
          const rest = chosen.slice(1)
          if (rest.length) {
            await window.api['tasks:updateReworkDraft']({ projectId: props.task.projectId, taskId: props.task.id, cycleId: target.id, input: mergeDraftInputs(chosen) })
            for (const item of rest) await window.api['tasks:deleteReworkDraft']({ projectId: props.task.projectId, taskId: props.task.id, cycleId: item.id })
          }
          const { cycle } = await window.api['tasks:submitReworkDraft']({ projectId: props.task.projectId, taskId: props.task.id, cycleId: target.id })
          setCycles((all) => all.filter((item) => !rest.some((gone) => gone.id === item.id)).map((item) => item.id === target.id ? cycleView(cycle) : item))
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Не удалось отправить выбранные доработки.')
          void loadPersistent().catch(() => undefined)
        } finally { setPending(false) }
      }
    }}
  />
}

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@voicechat/ui-kit'
import { issueKey, QA_WORKFLOW, type KanbanColumnSemanticType, type TaskReworkCycle } from '@shared/projects'
import { ALL_PROJECT_FEATURES } from '@shared/projectTypes'
import { isActiveCiStatus } from '@shared/ci'
import { canStartMerge, isCurrentMergeSourceMerged } from '@shared/merge'
import { CiTaskSettings } from '../ci/CiTaskSettings'
import { ComponentQaPanel } from '../qa/ComponentQaPanel'
import { QaStageRunPanel } from '../qa/QaStageRunPanel'
import { ManualQaPanel } from '../qa/ManualQaPanel'
import { MergePanel } from '../ci/MergePanel'
import { TaskRunFeed } from '../ci/TaskRunFeed'
import { TaskPreparationTab } from './TaskPreparationTab'
import { TaskTimeline } from './TaskTimeline'
import type { TaskModalProps } from './TaskModal'
import { TaskModal, TaskChatPanel } from './TaskModal'
import { NewTaskCardView } from './NewTaskCardView'
import type { TaskCardRunStatus, TaskCardTab, TaskCardVersion, TaskCardViewModel, TaskReworkCycleViewModel, TaskReworkDraft, TaskReworkSourcesState } from './TaskCardViewModel'

const LABELS: Record<KanbanColumnSemanticType, string> = {
  backlog: 'Бэклог', preparation: 'Подготовка', ready: 'Готово к разработке',
  development: 'Разработка', component_qa: 'Component QA', integration_tests: 'Интеграционные тесты',
  automated_qa: 'Automated QA', testing: 'Тестирование', qa_preparation: 'Подготовка QA',
  manual_qa: 'Ручное QA', awaiting_merge: 'Ожидает merge', merge: 'Merge',
  decision_required: 'Требуется решение', done: 'Готово', cancelled: 'Отменено', custom: 'Пользовательский этап'
}
const POST_DEVELOPMENT = new Set<KanbanColumnSemanticType>(['component_qa', 'integration_tests', 'automated_qa', 'testing', 'qa_preparation', 'manual_qa', 'awaiting_merge', 'merge', 'decision_required', 'done'])
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

export function buildTaskCardViewModel(props: TaskCardContainerProps, cycles: TaskReworkCycleViewModel[]): TaskCardViewModel {
  const column = props.board.columns.find((item) => item.id === props.task.columnId)
  const semanticType = column?.semanticType ?? 'custom'
  const workflowIndex = QA_WORKFLOW.indexOf(semanticType)
  const activeRun = props.task.latestRunResult?.outcome === 'active' || props.ciSummary?.modelActive === true || props.ciSummary?.awaitingInput === true
  const developmentSucceeded = props.ciSummary?.status === 'success' || (props.task.latestRunResult?.kind === 'development' && props.task.latestRunResult.outcome === 'success')
  const canRework = Boolean(developmentSucceeded && POST_DEVELOPMENT.has(semanticType) && semanticType !== 'cancelled')
  const makeSources = (props.task.designs ?? []).map((design) => ({
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
    workflow: QA_WORKFLOW.map((step, index) => ({ id: step, semanticType: step, label: LABELS[step], state: step === semanticType ? 'current' as const : workflowIndex >= 0 && index < workflowIndex ? 'passed' as const : 'upcoming' as const })),
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
      canStopRun: activeRun && Boolean(props.ciSummary),
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

export function TaskCardContainer(props: TaskCardContainerProps): JSX.Element {
  // По умолчанию — legacy. Новая карточка вводится рядом со старой и включается
  // переключателем в шапке: на legacy-разметке стоят и существующие сценарии
  // доски (`task-modal`, `task-desc-view`), и привычка пользователей. Дефолт
  // `new` ломал 14 тестов доски и страницы проекта — merge-ран это и поймал.
  const [version, setVersion] = useState<TaskCardVersion>(props.initialVersion ?? 'legacy')
  const [activeTab, setActiveTab] = useState<TaskCardTab>('overview')
  const [reworkOpen, setReworkOpen] = useState(false)
  const [draft, setDraft] = useState<TaskReworkDraft>(EMPTY_DRAFT)
  const [cycles, setCycles] = useState<TaskReworkCycleViewModel[]>(props.reworkCycles ?? [])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourceAttachments, setSourceAttachments] = useState<TaskCardViewModel['source']['attachments']>([])
  const [makeSources, setMakeSources] = useState<TaskReworkSourcesState>({ state: 'loading', items: [] })
  const loadPersistent = async (): Promise<void> => {
    const api = window.api
    if (!api) return
    const [history, files] = await Promise.all([
      props.loadReworkCycles ? props.loadReworkCycles(props.task.id) : api['tasks:reworkCycles']({ projectId: props.task.projectId, taskId: props.task.id }),
      api['tasks:attachments']({ projectId: props.task.projectId, taskId: props.task.id, scope: 'source' })
    ])
    setCycles(history.map((cycle) => ({ ...cycle, makeSources: cycle.makeSources.map((source) => ({ ...source, id: source.conversationId, paths: source.paths.map((path) => ({ path, available: source.fileStatuses?.find((item) => item.path === path)?.available ?? true })) })), attachments: cycle.attachments.map(fileView) })))
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
  // Список Make-проектов нужен и форме доработки, и замене макета на «Общем».
  useEffect(() => { if (version === 'new') void loadMakeSources() }, [props.task.projectId, version])
  const model = useMemo(() => {
    const value = buildTaskCardViewModel(props, cycles)
    value.source.attachments = sourceAttachments
    return value
  }, [props, cycles, sourceAttachments])
  // Панели вкладок берём у старой карточки: логика подготовки, QA, merge и
  // ленты рана живёт в них, и второй её копии в новой оболочке быть не должно.
  const renderPanel = (tab: TaskCardTab): ReactNode => {
    const shared = { projectId: props.task.projectId, taskId: props.task.id }
    const runActive = Boolean(props.ciSummary && isActiveCiStatus(props.ciSummary.status)) || Boolean(props.task.activeMergeRunId)
    if (tab === 'chat') return <TaskChatPanel projectId={props.task.projectId} taskId={props.task.id} />
    if (tab === 'preparation') return <TaskPreparationTab
      {...shared} liveRunId={props.task.taskPreparationRunId} liveStatus={props.task.taskPreparationStatus}
      loadRuns={props.loadPreparationRuns} loadRun={props.loadPreparationRun} onStart={props.onStartPreparation}
      onRetry={props.onRetryPreparation} llmAccess={props.llmAccess} llmEngines={props.llmEngines}
      onCancel={props.onCancelPreparation} onAnswer={props.onAnswerPreparation} onExport={props.onExportPreparation}
    />
    if (tab === 'settings') return <div className="task-settings-stack">
      <CiTaskSettings section="machine" {...shared} mergeMachineBound={props.task.mergeMachineBound} />
      <CiTaskSettings section="model" {...shared} />
      <CiTaskSettings section="commands" {...shared} />
    </div>
    if (tab === 'progress') return <TaskTimeline {...shared} />
    if (tab === 'component_qa') return <ComponentQaPanel {...shared} active={runActive} onFixStarted={(runId) => { setActiveTab('feed'); props.onOpenCiRun?.(runId) }} />
    if (tab === 'integration_tests' || tab === 'automated_qa') return <QaStageRunPanel {...shared} stage={tab} />
    if (tab === 'manual_qa') return <ManualQaPanel {...shared} activeRun={runActive} onFixStarted={(runId) => { setActiveTab('feed'); props.onOpenCiRun?.(runId) }} />
    if (tab === 'merge') return <MergePanel
      {...shared} runId={props.task.activeMergeRunId ?? null}
      canStart={Boolean(props.onStartMerge) && canStartMerge({
        semanticType: props.board.columns.find((column) => column.id === props.task.columnId)?.semanticType ?? 'custom',
        sourceBranch: props.task.mergeSourceBranch,
        alreadyMerged: isCurrentMergeSourceMerged({ sourceSha: props.task.mergeSourceSha, mergedSourceSha: props.task.mergedSourceSha, mergedSha: props.task.mergedSha }),
        hasActiveRun: Boolean(props.task.activeMergeRunId), permitted: props.task.mergePermitted, machineBound: props.task.mergeMachineBound
      })}
      onStartMerge={(agentId) => props.onStartMerge?.(props.task.id, agentId)}
    />
    if (tab === 'feed') return <TaskRunFeed {...shared} activeDevelopmentRunId={props.ciSummary?.id ?? null} activeMergeRunId={props.task.activeMergeRunId ?? null} />
    return null
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
    onVersionChange={setVersion}
    callbacks={{
      onClose: props.onClose,
      onChangeTab: setActiveTab,
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
      onOpenChat: () => setActiveTab('chat'),
      loadAttachment: async (attachmentId) => {
        const file = await window.api['tasks:readAttachment']({ projectId: props.task.projectId, taskId: props.task.id, attachmentId })
        return `data:${file.mimeType};base64,${file.dataBase64}`
      },
      onReplaceMake: async (linkId, conversationId) => {
        try {
          await window.api['tasks:unlinkDesign']({ projectId: props.task.projectId, taskId: props.task.id, linkId })
          await window.api['tasks:linkDesign']({ projectId: props.task.projectId, taskId: props.task.id, conversationId, mode: 'whole_project', paths: [] })
          props.onUpdate(props.task.id, {})
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось заменить макет.') }
      },
      onUnlinkMake: async (linkId) => {
        try {
          await window.api['tasks:unlinkDesign']({ projectId: props.task.projectId, taskId: props.task.id, linkId })
          props.onUpdate(props.task.id, {})
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось снять связь с макетом.') }
      },
      onStopRun: props.ciSummary && props.onOpenCiRun ? () => props.onOpenCiRun?.(props.ciSummary!.id) : undefined,
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
      }
    }}
  />
}

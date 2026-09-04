import { useEffect, useMemo, useState } from 'react'
import { Button } from '@voicechat/ui-kit'
import { issueKey, QA_WORKFLOW, type KanbanColumnSemanticType } from '@shared/projects'
import type { TaskModalProps } from './TaskModal'
import { TaskModal } from './TaskModal'
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

export interface TaskCardContainerProps extends TaskModalProps {
  initialVersion?: TaskCardVersion
  reworkCycles?: TaskReworkCycleViewModel[]
  onCreateReworkCycle?: (taskId: string, draft: TaskReworkDraft, idempotencyKey: string) => Promise<TaskReworkCycleViewModel>
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
  return {
    taskId: props.task.id,
    taskKey: issueKey(props.projectName, props.task),
    projectName: props.projectName,
    title: props.task.title,
    stage: { semanticType, label: column?.name || LABELS.custom, fallback: !column || semanticType === 'custom' },
    priority: props.task.priority,
    assignee: props.task.assignee,
    description: props.task.description,
    acceptanceCriteria: props.task.acceptanceCriteria,
    labels: props.task.labels,
    workflow: QA_WORKFLOW.map((step, index) => ({ id: step, semanticType: step, label: LABELS[step], state: step === semanticType ? 'current' as const : workflowIndex >= 0 && index < workflowIndex ? 'passed' as const : 'upcoming' as const })),
    runs,
    source: { description: props.task.description, acceptanceCriteria: props.task.acceptanceCriteria, attachments: [] },
    makeSources,
    cycles,
    loadState: 'ready',
    actions: {
      canRework,
      ...(activeRun ? { reworkBlockedReason: 'Сначала выберите явное безопасное действие для активного рана.' } : {}),
      hasActiveRun: activeRun,
      safeActiveRunActions: activeRun ? ['keep_running', 'open_run', 'cancel_explicitly'] : []
    }
  }
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
      api['tasks:reworkCycles']({ projectId: props.task.projectId, taskId: props.task.id }),
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
  const model = useMemo(() => {
    const value = buildTaskCardViewModel(props, cycles)
    value.source.attachments = sourceAttachments
    return value
  }, [props, cycles, sourceAttachments])
  if (version === 'legacy') return <TaskModal {...props} headerExtra={<div className="task-version-switch" role="group" aria-label="Версия карточки"><Button size="sm" variant="ghost" aria-pressed={false} onClick={() => setVersion('new')}>Новая</Button><Button size="sm" variant="primary" aria-pressed>Старая</Button></div>} />
  return <NewTaskCardView
    model={model}
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
      onUploadAttachment: async (scope, file) => { const dataBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file) }); const uploaded = await window.api['tasks:uploadAttachment']({ projectId: props.task.projectId, taskId: props.task.id, scope, name: file.name, mimeType: file.type, dataBase64 }); if (scope === 'source') setSourceAttachments((all) => [...all, fileView(uploaded)]); else setDraft((value) => ({ ...value, attachments: [...value.attachments, fileView(uploaded)] })) },
      onDeleteAttachment: async (id) => { await window.api['tasks:deleteAttachment']({ projectId: props.task.projectId, taskId: props.task.id, attachmentId: id }); setSourceAttachments((all) => all.filter((item) => item.id !== id)); setDraft((value) => ({ ...value, attachments: value.attachments.filter((item) => item.id !== id) })) },
      onChangeReworkDraft: setDraft,
      onCancelRework: () => setReworkOpen(false),
      onSubmitRework: async (next, key) => {
        if (model.actions.hasActiveRun || pending) return
        if (!next.description.trim()) { setError('Опишите, что нужно доработать.'); return }
        setPending(true); setError(null)
        try {
          const cycle = props.onCreateReworkCycle
            ? await props.onCreateReworkCycle(props.task.id, next, key)
            : (await window.api['tasks:createReworkCycle']({ projectId: props.task.projectId, taskId: props.task.id, idempotencyKey: key, input: { description: next.description, criteria: next.criteria, makeSources: next.makeSources ?? [], attachmentIds: next.attachments.map((item) => item.id) } })).cycle as unknown as TaskReworkCycleViewModel
          setCycles((all) => all.some((item) => item.id === cycle.id) ? all : [...all, cycle])
          setDraft(EMPTY_DRAFT); setReworkOpen(false)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Не удалось создать цикл доработки.')
        } finally { setPending(false) }
      }
    }}
  />
}

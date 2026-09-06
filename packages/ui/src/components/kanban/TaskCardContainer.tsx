import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@voicechat/ui-kit'
import { issueKey, QA_WORKFLOW, type KanbanColumnSemanticType, type TaskReworkCycle } from '@shared/projects'
import type { TaskModalProps } from './TaskModal'
import { TaskModal } from './TaskModal'
import { NewTaskCardView } from './NewTaskCardView'
import type { TaskCardRunStatus, TaskCardTab, TaskCardVersion, TaskCardViewModel, TaskReworkCycleViewModel, TaskReworkDraft } from './TaskCardViewModel'

const LABELS: Record<KanbanColumnSemanticType, string> = {
  backlog: 'Бэклог', preparation: 'Подготовка', ready: 'Готово к разработке',
  development: 'Разработка', component_qa: 'Component QA', integration_tests: 'Интеграционные тесты',
  automated_qa: 'Automated QA', testing: 'Тестирование', qa_preparation: 'Подготовка QA',
  manual_qa: 'Ручное QA', awaiting_merge: 'Ожидает merge', merge: 'Merge',
  decision_required: 'Требуется решение', done: 'Готово', cancelled: 'Отменено', custom: 'Пользовательский этап'
}
const POST_DEVELOPMENT = new Set<KanbanColumnSemanticType>(['component_qa', 'integration_tests', 'automated_qa', 'testing', 'qa_preparation', 'manual_qa', 'awaiting_merge', 'merge', 'decision_required', 'done'])
const EMPTY_DRAFT: TaskReworkDraft = { description: '', criteria: [], makeMode: 'whole_project', makePaths: [], attachments: [] }

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
    source: { description: props.task.description, acceptanceCriteria: props.task.acceptanceCriteria, attachments: (props.task.attachments ?? []).map((file) => ({ ...file })) },
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

function reworkView(cycle: TaskReworkCycle): TaskReworkCycleViewModel {
  return {
    ...cycle,
    makeSources: cycle.makeSources.map((source, index) => ({
      id: source.conversationId || `source-${index}`, title: source.title || 'Make',
      conversationId: source.conversationId, mode: source.mode,
      paths: source.paths.map((path) => ({ path, available: true }))
    })),
    attachments: cycle.attachments.map((file) => ({ ...file }))
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
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>(props.loadReworkCycles ? 'loading' : 'ready')
  const requestKey = useRef<string | null>(null)
  const pendingFiles = useRef(new Map<string, File>())
  const loadHistory = (): void => {
    if (!props.loadReworkCycles) return
    setHistoryState('loading')
    void props.loadReworkCycles(props.task.id).then((items) => {
      setCycles(items.map(reworkView).sort((a, b) => a.sequence - b.sequence)); setHistoryState('ready')
    }).catch(() => setHistoryState('error'))
  }
  useEffect(loadHistory, [props.task.id, props.loadReworkCycles])
  const baseModel = useMemo(() => buildTaskCardViewModel(props, cycles), [props, cycles])
  const model = historyState === 'loading' ? { ...baseModel, loadState: 'loading' as const }
    : historyState === 'error' ? { ...baseModel, loadState: 'error' as const, error: 'Не удалось загрузить историю доработок.' }
    : baseModel
  if (version === 'legacy') return <TaskModal {...props} headerExtra={<div className="task-version-switch" role="group" aria-label="Версия карточки"><Button size="sm" variant="ghost" aria-pressed={false} onClick={() => setVersion('new')}>Новая</Button><Button size="sm" variant="primary" aria-pressed>Старая</Button></div>} />
  return <NewTaskCardView
    model={model}
    version={version}
    activeTab={activeTab}
    reworkOpen={reworkOpen}
    reworkDraft={draft}
    reworkPending={pending}
    reworkError={error}
    onVersionChange={setVersion}
    callbacks={{
      onClose: props.onClose,
      onChangeTab: setActiveTab,
      onOpenRun: (id) => props.onOpenCiRun?.(id),
      onOpenMake: (id) => props.onOpenMake?.(id),
      onStartRework: () => { setError(null); requestKey.current = null; setReworkOpen(true) },
      onChangeReworkDraft: setDraft,
      onRetryHistory: loadHistory,
      onAddReworkFiles: (list) => {
        for (const file of Array.from(list ?? [])) {
          const localId = 'pending-' + crypto.randomUUID()
          pendingFiles.current.set(localId, file)
          setDraft((current) => ({ ...current, attachments: [...current.attachments, { id: localId, name: file.name, size: file.size, mimeType: file.type, status: 'uploading' }] }))
          if (!props.uploadReworkAttachment) {
            setDraft((current) => ({ ...current, attachments: current.attachments.map((item) => item.id === localId ? { ...item, status: 'error', error: 'Загрузка недоступна' } : item) }))
            continue
          }
          void props.uploadReworkAttachment(file).then((uploaded) => {
            pendingFiles.current.delete(localId)
            setDraft((current) => ({ ...current, attachments: current.attachments.map((item) => item.id === localId ? { ...uploaded, status: 'ready' } : item) }))
          }).catch((cause) => setDraft((current) => ({ ...current, attachments: current.attachments.map((item) => item.id === localId ? { ...item, status: 'error', error: cause instanceof Error ? cause.message : 'Ошибка загрузки' } : item) })))
        }
      },
      onRemoveReworkFile: (id) => { pendingFiles.current.delete(id); setDraft((current) => ({ ...current, attachments: current.attachments.filter((file) => file.id !== id) })) },
      onRetryReworkFile: (id) => {
        const file = pendingFiles.current.get(id)
        if (!file || !props.uploadReworkAttachment) return
        setDraft((current) => ({ ...current, attachments: current.attachments.map((item) => item.id === id ? { ...item, status: 'uploading', error: undefined } : item) }))
        void props.uploadReworkAttachment(file).then((uploaded) => {
          pendingFiles.current.delete(id)
          setDraft((current) => ({ ...current, attachments: current.attachments.map((item) => item.id === id ? { ...uploaded, status: 'ready' } : item) }))
        }).catch((cause) => setDraft((current) => ({ ...current, attachments: current.attachments.map((item) => item.id === id ? { ...item, status: 'error', error: cause instanceof Error ? cause.message : 'Ошибка загрузки' } : item) })))
      },
      onCancelRework: () => setReworkOpen(false),
      onSubmitRework: async (next, key) => {
        if (model.actions.hasActiveRun || pending || next.attachments.some((file) => file.status !== 'ready')) return
        if (!next.description.trim()) { setError('Опишите, что нужно доработать.'); return }
        if (!props.onCreateReworkCycle) { setError('Создание цикла пока недоступно для этого проекта.'); return }
        requestKey.current ??= key
        setPending(true); setError(null)
        try {
          const cycle = reworkView(await props.onCreateReworkCycle(props.task.id, next, requestKey.current))
          setCycles((all) => all.some((item) => item.id === cycle.id) ? all : [...all, cycle].sort((a, b) => a.sequence - b.sequence))
          setDraft(EMPTY_DRAFT); requestKey.current = null; setReworkOpen(false)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Не удалось создать цикл доработки.')
        } finally { setPending(false) }
      }
    }}
  />
}

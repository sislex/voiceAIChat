// "Ход выполнения" of the new task card: development cycles as a rail of stages
// with metrics and the live feed of the selected run, plus the sub-sections of
// the Make mock (model work, checks, knowledge base, resources) and the legacy
// timeline. Data comes from the CI task report; the feed itself is the shared
// `RunFeed`, so retry/cancel/answer work exactly as in the legacy card.
import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, EmptyState, ErrorState, MetricGrid, ResultTable, Skeleton, SubTabs } from '@voicechat/ui-kit'
import type { CiRunReport, CiRunSummary, CiTaskReport } from '@shared/ci'
import { canStartCiRun } from '@shared/ci'
import type { KbTaskUsageReport } from '@shared/kb'
import { ciStatusLabel, ciTone, fmtDuration, type CiTone } from '../ci/ciFormat'
import { NewDevelopmentRunFeed } from './NewDevelopmentRunFeed'
import { KbUsageBrief } from '../kb/KbUsageBrief'
import { formatDateTime } from '../../lib/dateFormat'
import { useNewTaskAction, useNewTaskResource } from './useNewTaskResource'
import { AttemptList, MetricTiles, StageCard, StageHeading, StageRail } from './NewTaskStages'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'
import { assignToCycles, ciStageStatus, pluralRu, stageStatusOf, type CycleStage, type StageStatus } from './taskCycles'

type ProgressSection = 'overview' | 'model' | 'checks' | 'kb' | 'resources' | 'timeline'
const SECTIONS: Array<{ id: ProgressSection; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'model', label: 'Работа модели' },
  { id: 'checks', label: 'Проверки' },
  { id: 'kb', label: 'База знаний' },
  { id: 'resources', label: 'Ресурсы' },
  { id: 'timeline', label: 'Временная шкала' }
]
const DEVELOPMENT_LABEL: Partial<Record<StageStatus, string>> = {
  success: 'Завершено', running: 'В разработке', cancelled: 'Отменено', idle: 'Ожидает разработки'
}

export interface NewTaskProgressPanelProps {
  projectId: string
  taskId: string
  cycles: TaskReworkCycleViewModel[]
  workflow: string[]
  /** Summary of the active development run: reload the report when it changes. */
  ciSummary?: CiRunSummary | null
  /** Queue a development run — the card offers it when nothing is running. */
  onStartCi?: () => void | Promise<void>
  canStart?: boolean
}

const runStatus = (run: CiRunReport): StageStatus => ciStageStatus(run.status)
/** CI tone vocabulary → result table tone. */
const TABLE_TONE: Record<CiTone, 'success' | 'danger' | 'running' | 'neutral'> = { success: 'success', removed: 'danger', progress: 'running', neutral: 'neutral' }
const doneSteps = (run: CiRunReport): number => run.steps.filter((step) => step.status === 'success' || step.status === 'skipped').length
const checkSteps = (run: CiRunReport) => run.steps.filter((step) => step.kind === 'command' || step.kind === 'model_command')

export function NewTaskProgressPanel(props: NewTaskProgressPanelProps): JSX.Element {
  const [section, setSection] = useState<ProgressSection>('overview')
  const resource = useNewTaskResource(props.projectId + ':' + props.taskId, async () => {
    if (!window.ci) throw new Error('CI bridge недоступен')
    return window.ci.getTaskReport(props.projectId, props.taskId)
  })
  const { data: report, error, loading, refresh: load } = resource
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const { busy: launching, error: launchError, act } = useNewTaskAction(load)
  useEffect(() => { if (props.ciSummary) void load() }, [load, props.ciSummary?.id, props.ciSummary?.status])
  // A finished run changes the report totals; a new run appears in the list.
  useEffect(() => {
    const bridge = window.ci
    if (!bridge) return
    const offDone = bridge.onDone((message) => { if (message.run.taskId === props.taskId) void load() })
    const offRun = bridge.onRun((message) => { if (message.run.taskId === props.taskId) void load() })
    return () => { offDone(); offRun() }
  }, [load, props.taskId])

  const runs = useMemo(() => [...(report?.runs ?? [])].sort((a, b) => a.createdAt - b.createdAt), [report])
  const stages = useMemo(() => assignToCycles(props.cycles, runs, { createdAt: (run) => run.createdAt }), [props.cycles, runs])
  const selected = stages.find((stage) => stage.key === selectedKey) ?? stages[stages.length - 1]!
  const selectedRun = selected.items.find((run) => run.runId === selectedRunId) ?? selected.items[selected.items.length - 1] ?? null
  const activeStatus = props.ciSummary?.status
  const canStart = Boolean(props.onStartCi) && (props.canStart ?? true) && canStartCiRun(activeStatus ? { status: activeStatus } : null)
  const launch = async (): Promise<void> => {
    if (!props.onStartCi || !canStart) return
    await act(async () => { await props.onStartCi!() })
  }

  if (loading && !report) return <div className="new-task-process" data-testid="new-task-progress">
    <span className="vc-sr-only" aria-live="polite">Загрузка хода выполнения…</span>
    <Skeleton variant="list" count={3} item="block" height={96} gap={10} />
  </div>
  if (error && !report) return <ErrorState message="Не удалось загрузить ход выполнения" detail={error} onRetry={() => void load()} />

  return <div className="new-task-process" data-testid="new-task-progress">
    <SubTabs items={SECTIONS} value={section} onChange={setSection} ariaLabel="Разделы хода выполнения" className="new-task-subtabs" />
    {section === 'overview' && <>
      <StageHeading
        eyebrow="Development-циклы"
        title="Этапы выполнения"
        description="Результаты каждого набора требований хранятся отдельно."
        badge={<div className="new-task-heading-actions">
          <Badge>{pluralRu(stages.length, 'этап', 'этапа', 'этапов')}</Badge>
          {props.onStartCi && <Button size="sm" variant="primary" disabled={!canStart} loading={launching} onClick={() => void launch()}>В очередь на разработку</Button>}
        </div>}
      />
      {(error || launchError) && <ErrorState compact message="Не удалось обновить ход выполнения" detail={error || launchError} onRetry={() => void load()} />}
      <StageRail testId="new-task-progress-rail">
        {stages.map((stage, index) => {
          const status = stageStatusOf(stage, runStatus)
          const isSelected = stage.key === selected.key
          const latest = stage.items[stage.items.length - 1]
          const shown = isSelected ? selectedRun : latest ?? null
          return <StageCard
            key={stage.key}
            number={stage.number}
            status={status}
            statusLabel={DEVELOPMENT_LABEL[status] ?? undefined}
            eyebrow={`Этап ${stage.number}`}
            title={stage.cycle ? `Разработка доработки ${stage.cycle.sequence}` : 'Разработка первоначальной постановки'}
            workflow={shown ? shown.steps.filter(step => !step.parentStepId).map(step => step.title) : []}
            workflowTitle="Снимок шагов выбранного рана"
            cycle={stage.cycle}
            sourceTitle="Основа разработки"
            sourceText="Первоначальная постановка и Development Brief этапа 1."
            selected={isSelected}
            onSelect={() => { setSelectedKey(stage.key); setSelectedRunId(null) }}
            connector={index < stages.length - 1}
            testId={`new-task-progress-stage-${stage.number}`}
            {...(isSelected && shown ? {
              detailsSummary: 'Лента и результаты этапа',
              details: <NewDevelopmentRunFeed runId={shown.runId} onDone={() => void load()} />
            } : {})}
          >
            {stage.cycle && <div className="new-task-sent-reworks new-task-sent-reworks--title"><b>Реализуемые доработки</b></div>}
            {shown && shown.steps.length === 0 && <p className="new-task-muted">Снимок шагов рана отсутствует.</p>}
            {shown
              ? <MetricTiles items={[
                { label: 'Прогресс', value: shown.steps.length ? `${Math.round(doneSteps(shown) / shown.steps.length * 100)}%` : '—' },
                { label: 'Шаги', value: `${doneSteps(shown)}/${shown.steps.length}` },
                { label: 'Проверки', value: checkSteps(shown).length ? `${checkSteps(shown).filter((step) => step.status === 'success').length}/${checkSteps(shown).length}` : '—' },
                { label: 'Время', value: fmtDuration(shown.durationMs) }
              ]} />
              : <p className="new-task-stage-summary">Development-ран этого этапа ещё не запускался.</p>}
            {isSelected && <AttemptList
              ariaLabel="Раны этапа"
              selectedId={shown?.runId ?? null}
              onSelect={setSelectedRunId}
              attempts={stage.items.map((run, at) => ({ id: run.runId, label: `Ран ${at + 1}`, status: runStatus(run), at: run.createdAt, note: `${run.provider} · ${run.model}` }))}
            />}
          </StageCard>
        })}
      </StageRail>
    </>}
    {section === 'model' && (selectedRun
      ? <NewDevelopmentRunFeed runId={selectedRun.runId} onDone={() => void load()} />
      : <EmptyState compact icon="⏱" title="Запусков ещё нет" description="Лента модели появится после первого development-рана." />)}
    {section === 'checks' && <ChecksSection stages={stages} />}
    {section === 'kb' && <KbSection projectId={props.projectId} taskId={props.taskId} />}
    {section === 'resources' && <ResourcesSection report={report} />}
    {section === 'timeline' && <TimelineSection projectId={props.projectId} taskId={props.taskId} />}
  </div>
}

function TimelineSection({ projectId, taskId }: { projectId: string; taskId: string }): JSX.Element {
  const resource = useNewTaskResource(projectId + ':' + taskId, async () => {
    if (!window.ci) throw new Error('История недоступна')
    return window.ci.getTaskTimeline(projectId, taskId)
  })
  return <div className="new-task-process">
    {resource.error && <ErrorState compact message="Не удалось загрузить временную шкалу" detail={resource.error} onRetry={() => void resource.refresh()} />}
    {!resource.data && resource.loading && <Skeleton variant="list" count={3} />}
    {resource.data && !resource.data.stages.length && <EmptyState compact icon="⏱" title="Этапов пока нет" description="Время появится после первого запуска." />}
    {resource.data?.stages.map(stage => <section className="new-task-section" key={stage.id}>
      <h3>{stage.title}</h3>
      <MetricTiles items={[{ label: 'Календарное время', value: fmtDuration(stage.calendarDuration) }, { label: 'Активное время', value: fmtDuration(stage.activeDuration) },
        { label: 'Очередь', value: fmtDuration(stage.queueDuration) }, { label: 'Попытки', value: String(stage.attemptCount) }]} />
      {stage.attempts.map(attempt => <details key={attempt.id}><summary>Попытка {attempt.number} · {attempt.status} · {fmtDuration(attempt.calendarDuration)}</summary>
        <p>{attempt.machine ?? 'Машина не указана'} · {attempt.model ?? 'Модель не указана'}</p>
        <p>{attempt.reason?.message}</p>
        <p>{attempt.startedAt ? formatDateTime(attempt.startedAt) : 'Время запуска не указано'}</p>
      </details>)}
    </section>)}
  </div>
}

/** Every command step of every run: what the pipeline checked and how it ended. */
function ChecksSection({ stages }: { stages: CycleStage<CiRunReport>[] }): JSX.Element {
  const rows = stages.flatMap((stage) => stage.items.flatMap((run) => checkSteps(run).map((step) => ({
    id: `${run.runId}-${step.id}`,
    name: step.title,
    result: ciStatusLabel(step.status),
    tone: TABLE_TONE[ciTone(step.status)],
    detail: `Этап ${stage.number} · ${formatDateTime(run.createdAt)}${step.durationMs != null ? ` · ${fmtDuration(step.durationMs)}` : ''}${step.exitCode != null ? ` · exit ${step.exitCode}` : ''}`
  }))))
  if (!rows.length) return <EmptyState compact icon="✓" title="Проверок пока не было" description="Команды воркфлоу появятся здесь после первого рана." />
  return <ResultTable caption="Проверки ранов" resultLabel="Итог" rows={rows} />
}

function KbSection({ projectId, taskId }: { projectId: string; taskId: string }): JSX.Element {
  const [usage, setUsage] = useState<KbTaskUsageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setUsage(null); setError(null)
    const request = window.ci?.getTaskKbUsage(projectId, taskId)
    if (!request) { setError('CI bridge недоступен'); return () => { live = false } }
    void request.then((value) => { if (live) setUsage(value) }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { live = false }
  }, [projectId, taskId, attempt])
  if (error) return <ErrorState message="Не удалось загрузить использование базы знаний" detail={error} onRetry={() => setAttempt((value) => value + 1)} />
  if (!usage) return <Skeleton variant="list" count={2} item="block" height={64} gap={10} />
  return <KbUsageBrief title="База знаний в ранах задачи" totals={usage.totals} sections={usage.sections} recent={usage.recent} note={`по ${pluralRu(usage.runs, 'рану', 'ранам', 'ранам')} задачи`} />
}

function ResourcesSection({ report }: { report: CiTaskReport | null }): JSX.Element {
  if (!report || !report.runs.length) return <EmptyState compact icon="∑" title="Расхода пока нет" description="Ходы модели и время появятся после первого рана." />
  const cost = report.totals.costUsd == null ? '—' : `${report.totals.costEstimated ? '≈ ' : ''}$${report.totals.costUsd.toFixed(2)}`
  return <div className="new-task-resources">
    <MetricGrid items={[
      { label: 'Ранов', value: String(report.runs.length) },
      { label: 'Ходов модели', value: String(report.totals.requests) },
      { label: 'Токенов', value: report.totals.tokens.toLocaleString('ru-RU') },
      { label: 'Стоимость', value: cost },
      { label: 'Время', value: fmtDuration(report.durationMs) },
      { label: 'Вызовов инструментов', value: report.toolCalls ? String(Object.values(report.toolCalls as Record<string, number>).reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)) : '—' }
    ]} />
    <ResultTable caption="Раны задачи" resultLabel="Статус" rows={report.runs.map((run) => ({
      id: run.runId,
      name: `${formatDateTime(run.createdAt)} · ${run.provider} · ${run.model}`,
      result: ciStatusLabel(run.status),
      tone: TABLE_TONE[ciTone(run.status)],
      detail: `${run.totals.requests} ходов · ${run.totals.tokens.toLocaleString('ru-RU')} токенов · ${fmtDuration(run.durationMs)}`
    }))} />
  </div>
}

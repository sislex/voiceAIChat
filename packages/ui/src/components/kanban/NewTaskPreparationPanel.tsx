// "Подготовка к разработке" of the new task card: preparation attempts drawn as
// a rail of stages — the original statement first, then one stage per
// submitted rework cycle. The functional part (start form, questions, gates,
// Development Brief, cancel/retry/export) is the legacy `TaskPreparationTab`
// mounted once inside the selected stage, so the two cards cannot drift apart.
import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@voicechat/ui-kit'
import type { TaskPreparationRun } from '@shared/qa'
import { formatDateTime } from '../../lib/dateFormat'
import { TaskPreparationTab, type TaskPreparationTabProps } from './TaskPreparationTab'
import { AttemptList, StageCard, StageHeading, StageRail } from './NewTaskStages'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'
import { assignToCycles, isLiveStageStatus, pluralRu, preparationStageStatus, stageStatusOf, type CycleStage, type StageStatus } from './taskCycles'

/** Design wording of preparation states differs from the generic vocabulary. */
const PREPARATION_LABEL: Partial<Record<StageStatus, string>> = {
  success: 'Подготовлено', validating: 'Проверка результата', paused: 'На паузе',
  blocked: 'Заблокировано', cancelled: 'Отменено', idle: 'Ожидает', waiting_for_answer: 'Ждёт ответа'
}

export interface NewTaskPreparationPanelProps {
  preparation: Omit<TaskPreparationTabProps, 'runFilter' | 'onRunsChange' | 'hideHistory'>
  cycles: TaskReworkCycleViewModel[]
  /** Workflow labels of the task for the "Workflow этого цикла" chip chain. */
  workflow: string[]
}

const runStatus = (run: TaskPreparationRun): StageStatus => preparationStageStatus(run.status)

export function NewTaskPreparationPanel(props: NewTaskPreparationPanelProps): JSX.Element {
  const [runs, setRuns] = useState<TaskPreparationRun[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const onRunsChange = useCallback((next: TaskPreparationRun[]) => setRuns(next), [])
  const stages = useMemo(() => assignToCycles(props.cycles, runs, {
    createdAt: (run) => run.createdAt,
    pinnedCycleId: (run, all) => all.find((cycle) => cycle.preparationRunId === run.id)?.id ?? null
  }), [props.cycles, runs])
  // The live attempt wins, otherwise the newest stage: that is where the user acts.
  const liveStage = props.preparation.liveRunId ? stages.find((stage) => stage.items.some((run) => run.id === props.preparation.liveRunId)) : undefined
  const selected = stages.find((stage) => stage.key === selectedKey) ?? liveStage ?? stages[stages.length - 1]!
  // Filter by time range, not by identity: a run started from the embedded form
  // must land in the stage immediately, before the rail has re-rendered.
  const runFilter = useMemo(() => {
    const ordered = props.cycles.filter((cycle) => cycle.status !== 'draft').sort((a, b) => a.createdAt - b.createdAt)
    const index = selected.cycle ? ordered.findIndex((cycle) => cycle.id === selected.cycle!.id) : -1
    const from = selected.cycle?.createdAt ?? Number.NEGATIVE_INFINITY
    const to = index >= 0 ? ordered[index + 1]?.createdAt ?? Number.POSITIVE_INFINITY : ordered[0]?.createdAt ?? Number.POSITIVE_INFINITY
    return (run: TaskPreparationRun): boolean => {
      const pinned = ordered.find((cycle) => cycle.preparationRunId === run.id)
      if (pinned) return pinned.id === selected.cycle?.id
      return run.createdAt >= from && run.createdAt < to
    }
  }, [props.cycles, selected.key])

  return <div className="new-task-process" data-testid="new-task-preparation">
    <StageHeading
      eyebrow="История подготовки"
      title="Этапы подготовки к разработке"
      description="Каждый новый набор доработок готовится отдельно, не перезаписывая исходный Development Brief."
      badge={<Badge>{pluralRu(stages.length, 'этап', 'этапа', 'этапов')}</Badge>}
    />
    <StageRail testId="new-task-preparation-rail">
      {stages.map((stage, index) => {
        const status = stageStatusOf(stage, runStatus)
        const isSelected = stage.key === selected.key
        return <StageCard
          key={stage.key}
          number={stage.number}
          status={status}
          statusLabel={PREPARATION_LABEL[status] ?? undefined}
          eyebrow={`Этап ${stage.number}`}
          title={stage.cycle ? `Подготовка к разработке доработки ${stage.cycle.sequence}` : 'Подготовка задачи по первоначальному описанию'}
          workflow={props.workflow}
          cycle={stage.cycle}
          sourceTitle="Источник этапа"
          sourceText="Первоначальное описание, критерии приёмки, файлы задачи и Make-дизайн."
          selected={isSelected}
          onSelect={() => setSelectedKey(stage.key)}
          connector={index < stages.length - 1}
          testId={`new-task-preparation-stage-${stage.number}`}
        >
          {isSelected
            ? <PreparationStageBody stage={stage} status={status} preparation={props.preparation} runFilter={runFilter} onRunsChange={onRunsChange} />
            : <StageSummary stage={stage} />}
        </StageCard>
      })}
    </StageRail>
  </div>
}

function StageSummary({ stage }: { stage: CycleStage<TaskPreparationRun> }): JSX.Element {
  const latest = stage.items[stage.items.length - 1]
  return <p className="new-task-stage-summary">
    {latest
      ? `${pluralRu(stage.items.length, 'попытка', 'попытки', 'попыток')} · последняя ${formatDateTime(latest.createdAt)} · ${latest.provider ?? 'claude'} · ${latest.model || 'по умолчанию'}`
      : 'Подготовка этого этапа ещё не запускалась.'}
  </p>
}

function PreparationStageBody({ stage, status, preparation, runFilter, onRunsChange }: {
  stage: CycleStage<TaskPreparationRun>
  status: StageStatus
  preparation: NewTaskPreparationPanelProps['preparation']
  runFilter: (run: TaskPreparationRun) => boolean
  onRunsChange: (runs: TaskPreparationRun[]) => void
}): JSX.Element {
  const panel = <TaskPreparationTab {...preparation} runFilter={runFilter} onRunsChange={onRunsChange} hideHistory />
  // A finished stage collapses into "Development Brief и результат"; anything
  // still moving or needing a decision stays open like in the Make mock.
  if (status === 'success' && stage.items.length > 0) {
    return <details className="new-task-stage-details" open={false}>
      <summary>Development Brief и результат</summary>
      <AttemptList ariaLabel="Попытки подготовки" attempts={stage.items.map((run) => ({ id: run.id, label: `Попытка ${run.attempt}`, status: runStatus(run), at: run.createdAt }))} />
      {panel}
    </details>
  }
  return <div className={'new-task-stage-panel' + (isLiveStageStatus(status) ? ' new-task-stage-live' : '')}>{panel}</div>
}

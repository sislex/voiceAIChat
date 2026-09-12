// "Лента рана" of the new task card: the run header of the Make mock (live dot,
// engine · stage, stop button) above the shared technical feed.
import { Button } from '@voicechat/ui-kit'
import type { CiRunSummary } from '@shared/ci'
import { isActiveCiStatus } from '@shared/ci'
import { ciLlmLabel, ciStageLabel } from '../ci/ciFormat'
import { TaskRunFeed } from '../ci/TaskRunFeed'
import { STAGE_STATUS_LABEL, ciStageStatus, isLiveStageStatus } from './taskCycles'
import { StageBadge } from './NewTaskStages'

export interface NewTaskFeedPanelProps {
  projectId: string
  taskId: string
  ciSummary?: CiRunSummary | null
  activeMergeRunId?: string | null
  onStopRun?: () => void | Promise<void>
}

export function NewTaskFeedPanel(props: NewTaskFeedPanelProps): JSX.Element {
  const summary = props.ciSummary ?? null
  const active = summary ? isActiveCiStatus(summary.status) : Boolean(props.activeMergeRunId)
  const status = summary ? ciStageStatus(summary.status) : props.activeMergeRunId ? 'running' : 'idle'
  const label = summary
    ? `${summary.executionLlm ? ciLlmLabel(summary.executionLlm) : 'Модель'} · ${summary.executionLlm?.source === 'stage' ? ciStageLabel(summary.executionLlm.stage) : 'development'}`
    : props.activeMergeRunId ? 'Merge-ран' : 'Ранов сейчас нет'
  return <div className="new-task-process" data-testid="new-task-feed">
    <div className="new-task-run-head" role="status" aria-label="Состояние рана">
      <div>
        <span className={`new-task-live-dot${isLiveStageStatus(status) ? ' new-task-live-dot--live' : ''}`} aria-hidden="true" />
        <b>{label}</b>
        <StageBadge status={status} label={STAGE_STATUS_LABEL[status]} />
      </div>
      {active && props.onStopRun && <Button size="sm" variant="danger" onClick={() => void props.onStopRun?.()}>Остановить ран</Button>}
    </div>
    <TaskRunFeed projectId={props.projectId} taskId={props.taskId} activeDevelopmentRunId={summary?.id ?? null} activeMergeRunId={props.activeMergeRunId ?? null} />
  </div>
}

// "Лента рана" of the new task card: the run header of the Make mock (live dot,
// engine · stage, stop button) above the shared technical feed.
import { useEffect } from 'react'
import { Button, EmptyState, ErrorState } from '@voicechat/ui-kit'
import { NewDevelopmentRunFeed } from './NewDevelopmentRunFeed'
import { NewMergeRunDetails } from './NewTaskMergePanel'
import { useNewTaskAction, useNewTaskResource } from './useNewTaskResource'
import type { CiRunSummary } from '@shared/ci'
import { isActiveCiStatus } from '@shared/ci'
import { ciLlmLabel, ciStageLabel } from '../ci/ciFormat'
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
  const mergeId = props.activeMergeRunId ?? null
  const merge = useNewTaskResource(mergeId ?? 'no-merge', async () => mergeId && window.ci ? window.ci.getMerge(mergeId) : null)
  const { busy, error, act } = useNewTaskAction(merge.refresh)
  useEffect(() => {
    const off = window.ci?.onMerge(message => { if (message.runId === mergeId) void merge.refresh() })
    return () => off?.()
  }, [mergeId, merge.refresh])
  const active = Boolean(mergeId) || Boolean(summary && isActiveCiStatus(summary.status))
  const status = mergeId ? 'running' : summary ? ciStageStatus(summary.status) : 'idle'
  const label = mergeId ? 'Merge-ран' : summary
    ? `${summary.executionLlm ? ciLlmLabel(summary.executionLlm) : 'Модель'} · ${summary.executionLlm?.source === 'stage' ? ciStageLabel(summary.executionLlm.stage) : 'development'}`
    : props.activeMergeRunId ? 'Merge-ран' : 'Ранов сейчас нет'
  return <div className="new-task-process" data-testid="new-task-feed">
    <div className="new-task-run-head" role="status" aria-label="Состояние рана">
      <div>
        <span className={`new-task-live-dot${isLiveStageStatus(status) ? ' new-task-live-dot--live' : ''}`} aria-hidden="true" />
        <b>{label}</b>
        <StageBadge status={status} label={STAGE_STATUS_LABEL[status]} />
      </div>
      {active && props.onStopRun && <Button size="sm" variant="danger" loading={busy} onClick={() => void act(async () => { await props.onStopRun?.() })}>Остановить ран</Button>}
    </div>
    {(error || merge.error) && <ErrorState compact message="Не удалось обновить ран" detail={error || merge.error} onRetry={() => void merge.refresh()} />}
    {mergeId ? merge.data && <NewMergeRunDetails run={merge.data} /> : summary
      ? <NewDevelopmentRunFeed key={summary.id} runId={summary.id} />
      : <EmptyState compact icon="⏱" title="Запусков ещё нет" description="Историю можно открыть во вкладках хода выполнения и merge." />}
  </div>
}

// "Merge" of the new task card: merge runs as passes of the stage rail, with
// the legacy `MergePanel` (machine picker, start, live feed, repositories)
// inside the selected stage. The rail owns the selected run; the panel reports
// the runs it loaded so both stay in sync without a second request.
import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@voicechat/ui-kit'
import type { MergeRun } from '@shared/merge'
import { MergePanel } from '../ci/MergePanel'
import { MERGE_STATUS_LABEL } from '../ci/MergeRunFeed'
import { formatDateTime } from '../../lib/dateFormat'
import { AttemptList, CheckList, StageCard, StageHeading, StageRail } from './NewTaskStages'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'
import { assignToCycles, mergeStageStatus, pluralRu, stageStatusOf, stageTitle, type StageStatus } from './taskCycles'

const MERGE_LABEL: Partial<Record<StageStatus, string>> = { success: 'Влито в main', idle: 'Ожидает' }

export interface NewTaskMergePanelProps {
  projectId: string
  taskId: string
  cycles: TaskReworkCycleViewModel[]
  workflow: string[]
  activeRunId: string | null
  canStart: boolean
  onStartMerge?: (agentId: string | null) => void
}

const runStatus = (run: MergeRun): StageStatus => mergeStageStatus(run.status)

export function NewTaskMergePanel(props: NewTaskMergePanelProps): JSX.Element {
  const [runs, setRuns] = useState<MergeRun[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const onRunsChange = useCallback((next: MergeRun[]) => setRuns(next), [])
  const stages = useMemo(() => assignToCycles(props.cycles, runs, { createdAt: (run) => run.createdAt }), [props.cycles, runs])
  const activeStage = props.activeRunId ? stages.find((stage) => stage.items.some((run) => run.id === props.activeRunId)) : undefined
  const selected = stages.find((stage) => stage.key === selectedKey) ?? activeStage ?? stages[stages.length - 1]!
  const selectedRun = selected.items.find((run) => run.id === selectedRunId) ?? selected.items[selected.items.length - 1] ?? null

  return <div className="new-task-process" data-testid="new-task-merge">
    <StageHeading
      eyebrow="История проходов"
      title="Merge"
      description="Отдельный проход для каждого development-цикла и набора доработок."
      badge={<Badge>{pluralRu(stages.length, 'проход', 'прохода', 'проходов')}</Badge>}
    />
    <StageRail testId="new-task-merge-rail">
      {stages.map((stage, index) => {
        const status = stageStatusOf(stage, runStatus)
        const isSelected = stage.key === selected.key
        const latest = stage.items[stage.items.length - 1]
        const failedChecks = latest?.checks.filter((check) => check.status === 'failed').length ?? 0
        return <StageCard
          key={stage.key}
          number={stage.number}
          status={status}
          statusLabel={MERGE_LABEL[status] ?? undefined}
          eyebrow={`Проход ${stage.number}`}
          title={stageTitle('Merge', stage)}
          workflow={props.workflow}
          cycle={stage.cycle}
          sourceTitle="Цикл 1"
          sourceText="Результат разработки первоначальной постановки задачи."
          selected={isSelected}
          onSelect={() => { setSelectedKey(stage.key); setSelectedRunId(null) }}
          connector={index < stages.length - 1}
          testId={`new-task-merge-stage-${stage.number}`}
        >
          <CheckList checks={[
            { id: 'main', title: 'Актуальность main', ok: latest ? latest.conflicts.length === 0 : null, note: latest ? (latest.conflicts.length ? pluralRu(latest.conflicts.length, 'конфликт', 'конфликта', 'конфликтов') : `main ${latest.targetSha?.slice(0, 8) ?? '—'} · без конфликтов`) : 'Ран ещё не запускался' },
            { id: 'checks', title: 'CI и конфликты', ok: latest ? (failedChecks === 0 && latest.status !== 'failed' ? (latest.status === 'success' ? true : null) : false) : null, note: latest ? `${MERGE_STATUS_LABEL[latest.status] ?? latest.status} · ${formatDateTime(latest.createdAt)}` : 'Нет данных' }
          ]} />
          {isSelected && <>
            <AttemptList
              ariaLabel="Merge-раны прохода"
              selectedId={selectedRun?.id ?? null}
              onSelect={setSelectedRunId}
              attempts={stage.items.map((run, at) => ({ id: run.id, label: `Ран ${at + 1}`, status: runStatus(run), at: run.createdAt, note: run.machineName ?? run.agentId }))}
            />
            <div className="new-task-stage-panel">
              <MergePanel
                projectId={props.projectId} taskId={props.taskId}
                runId={props.activeRunId}
                selectedRunId={selectedRun?.id ?? null}
                onSelectRun={setSelectedRunId}
                onRunsChange={onRunsChange}
                hideHistory
                canStart={props.canStart}
                {...(props.onStartMerge ? { onStartMerge: props.onStartMerge } : {})}
              />
            </div>
          </>}
        </StageCard>
      })}
    </StageRail>
  </div>
}

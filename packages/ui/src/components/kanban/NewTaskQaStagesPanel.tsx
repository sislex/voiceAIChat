// QA passes (Component QA, integration tests, Automated QA) of the new task
// card: "история проходов" — one stage per development cycle, attempts inside,
// the functional legacy panel mounted in the selected stage. The panel reports
// the attempt list upward so the rail never requests the state twice.
import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@voicechat/ui-kit'
import type { ComponentQaTaskState, QaRunStage } from '@shared/qa'
import { ComponentQaPanel } from '../qa/ComponentQaPanel'
import { QaStageRunPanel } from '../qa/QaStageRunPanel'
import { formatDateTime } from '../../lib/dateFormat'
import { AttemptList, CheckList, StageCard, StageHeading, StageRail } from './NewTaskStages'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'
import { assignToCycles, pluralRu, qaRunStageStatus, qaStageRunStatus, STAGE_STATUS_LABEL, stageStatusOf, stageTitle, type StageStatus } from './taskCycles'

export const QA_STAGE_NAME: Record<QaRunStage, string> = {
  component_qa: 'Component QA', integration_tests: 'Интеграционные тесты', automated_qa: 'Automated QA'
}
const PASS_LABEL: Partial<Record<StageStatus, string>> = { success: 'Завершено', idle: 'Ожидает' }

/** Attempt of any QA stage, normalized for the rail. */
export interface QaPassAttempt { id: string; attempt: number; status: StageStatus; createdAt: number }

export interface NewTaskQaStagesPanelProps {
  projectId: string
  taskId: string
  stage: QaRunStage
  cycles: TaskReworkCycleViewModel[]
  workflow: string[]
  /** A development run is active: Component QA must not start in parallel. */
  runActive: boolean
  onFixStarted?: (runId: string) => void
}

export function NewTaskQaStagesPanel(props: NewTaskQaStagesPanelProps): JSX.Element {
  const [attempts, setAttempts] = useState<QaPassAttempt[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const onComponentState = useCallback((state: ComponentQaTaskState) => {
    setAttempts(state.runs.map((run) => ({ id: run.id, attempt: run.attempt, status: qaRunStageStatus(run.status), createdAt: run.createdAt })))
  }, [])
  const onRunsChange = useCallback((runs: Array<{ id: string; attempt: number; status: string; createdAt: number }>) => {
    setAttempts(runs.map((run) => ({
      id: run.id, attempt: run.attempt, createdAt: run.createdAt,
      // Integration runs use the component vocabulary, automated QA — stage runs.
      status: props.stage === 'integration_tests' ? qaRunStageStatus(run.status as 'passed') : qaStageRunStatus(run.status as 'success')
    })))
  }, [props.stage])
  const stages = useMemo(() => assignToCycles(props.cycles, attempts, { createdAt: (run) => run.createdAt }), [props.cycles, attempts])
  const selected = stages.find((stage) => stage.key === selectedKey) ?? stages[stages.length - 1]!
  const selectedAttempt = selected.items.find((run) => run.id === selectedRunId) ?? selected.items[selected.items.length - 1] ?? null
  const name = QA_STAGE_NAME[props.stage]
  const panel = props.stage === 'component_qa'
    ? <ComponentQaPanel projectId={props.projectId} taskId={props.taskId} active={props.runActive} runId={selectedAttempt?.id ?? null} onStateChange={onComponentState} hideHistory {...(props.onFixStarted ? { onFixStarted: props.onFixStarted } : {})} />
    : <QaStageRunPanel projectId={props.projectId} taskId={props.taskId} stage={props.stage} runId={selectedAttempt?.id ?? null} onRunsChange={onRunsChange} hideHistory />

  return <div className="new-task-process" data-testid={`new-task-qa-${props.stage}`}>
    <StageHeading
      eyebrow="История проходов"
      title={name}
      description="Отдельный проход для каждого development-цикла и набора доработок."
      badge={<Badge>{pluralRu(stages.length, 'проход', 'прохода', 'проходов')}</Badge>}
    />
    <StageRail testId={`new-task-qa-rail-${props.stage}`}>
      {stages.map((stage, index) => {
        const status = stageStatusOf(stage, (run) => run.status)
        const isSelected = stage.key === selected.key
        const latest = stage.items[stage.items.length - 1]
        return <StageCard
          key={stage.key}
          number={stage.number}
          status={status}
          statusLabel={PASS_LABEL[status] ?? undefined}
          eyebrow={`Проход ${stage.number}`}
          title={stageTitle(name, stage)}
          workflow={props.workflow}
          cycle={stage.cycle}
          sourceTitle="Цикл 1"
          sourceText="Результат разработки первоначальной постановки задачи."
          selected={isSelected}
          onSelect={() => { setSelectedKey(stage.key); setSelectedRunId(null) }}
          connector={index < stages.length - 1}
          testId={`new-task-qa-stage-${props.stage}-${stage.number}`}
        >
          <CheckList checks={[
            { id: 'launch', title: 'Запуск прохода', ok: stage.items.length ? true : null, note: stage.items.length ? pluralRu(stage.items.length, 'попытка', 'попытки', 'попыток') : 'Проход ещё не запускался' },
            { id: 'result', title: 'Результат', ok: status === 'success' ? true : status === 'failed' || status === 'blocked' || status === 'timeout' ? false : null, note: latest ? `${STAGE_STATUS_LABEL[status]} · ${formatDateTime(latest.createdAt)}` : 'Нет данных' }
          ]} />
          {isSelected && <>
            <AttemptList
              ariaLabel={`Попытки ${name}`}
              selectedId={selectedAttempt?.id ?? null}
              onSelect={setSelectedRunId}
              attempts={stage.items.map((run) => ({ id: run.id, label: `Попытка ${run.attempt}`, status: run.status, at: run.createdAt }))}
            />
            <div className="new-task-stage-panel">{panel}</div>
          </>}
        </StageCard>
      })}
    </StageRail>
  </div>
}

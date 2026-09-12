// "Ручное QA" of the new task card: the test environment block (preview and
// Storybook links of the current session) and the QA sessions as passes of the
// stage rail. The functional part — scenarios, results, screenshots, the final
// decision — is the legacy `ManualQaPanel` inside the current pass.
import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@voicechat/ui-kit'
import type { QaSession, QaTaskState } from '@shared/qa'
import { qaProgress } from '@shared/qa'
import { ManualQaPanel } from '../qa/ManualQaPanel'
import { formatDateTime } from '../../lib/dateFormat'
import { CheckList, StageCard, StageHeading, StageRail } from './NewTaskStages'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'
import { assignToCycles, pluralRu, qaSessionStageStatus, stageStatusOf, stageTitle, type StageStatus } from './taskCycles'

const SESSION_LABEL: Partial<Record<StageStatus, string>> = { success: 'Принято', failed: 'Отклонено', paused: 'Устарела', idle: 'Ожидает' }

export interface NewTaskManualQaPanelProps {
  projectId: string
  taskId: string
  cycles: TaskReworkCycleViewModel[]
  workflow: string[]
  runActive: boolean
  onFixStarted?: (runId: string) => void
}

export function NewTaskManualQaPanel(props: NewTaskManualQaPanelProps): JSX.Element {
  const [state, setState] = useState<QaTaskState | null>(null)
  const onStateChange = useCallback((next: QaTaskState) => setState(next), [])
  const sessions = useMemo(() => [...(state?.sessions ?? [])].sort((a, b) => a.startedAt - b.startedAt), [state])
  const stages = useMemo(() => assignToCycles(props.cycles, sessions, { createdAt: (session) => session.startedAt }), [props.cycles, sessions])
  const current = state?.activeSession ?? sessions[sessions.length - 1] ?? null
  // The functional panel lives in the stage of the active session; without one
  // it goes to the newest stage, where the next session will start.
  const panelStage = stages.find((stage) => current && stage.items.some((session) => session.id === current.id)) ?? stages[stages.length - 1]!
  const panel = <ManualQaPanel projectId={props.projectId} taskId={props.taskId} activeRun={props.runActive} onStateChange={onStateChange} {...(props.onFixStarted ? { onFixStarted: props.onFixStarted } : {})} />

  return <div className="new-task-process" data-testid="new-task-manual-qa">
    <section className="new-task-section new-task-preview-summary">
      <h3>Тестовое окружение</h3>
      {current?.appUrl || current?.storybookUrl
        ? <p>
          {current.appUrl && <>Preview: <a href={current.appUrl} target="_blank" rel="noreferrer">{current.appUrl}</a></>}
          {current.appUrl && current.storybookUrl && ' · '}
          {current.storybookUrl && <>Storybook: <a href={current.storybookUrl} target="_blank" rel="noreferrer">{current.storybookUrl}</a></>}
        </p>
        : <p className="new-task-muted">{current ? `Сессия ${current.commitSha.slice(0, 8)} без опубликованного preview.` : 'Preview появится вместе с первой QA-сессией.'}</p>}
    </section>
    <StageHeading
      eyebrow="История проходов"
      title="Ручное QA"
      description="Отдельный проход для каждого development-цикла и набора доработок."
      badge={<Badge>{pluralRu(stages.length, 'проход', 'прохода', 'проходов')}</Badge>}
    />
    <StageRail testId="new-task-manual-qa-rail">
      {stages.map((stage, index) => {
        const status = stageStatusOf(stage, (session: QaSession) => qaSessionStageStatus(session.status))
        const latest = stage.items[stage.items.length - 1]
        const progress = latest ? qaProgress(latest) : null
        const hostsPanel = stage.key === panelStage.key
        return <StageCard
          key={stage.key}
          number={stage.number}
          status={status}
          statusLabel={SESSION_LABEL[status] ?? undefined}
          eyebrow={`Проход ${stage.number}`}
          title={stageTitle('Ручное QA', stage)}
          workflow={props.workflow}
          cycle={stage.cycle}
          sourceTitle="Цикл 1"
          sourceText="Результат разработки первоначальной постановки задачи."
          selected={hostsPanel}
          connector={index < stages.length - 1}
          testId={`new-task-manual-qa-stage-${stage.number}`}
        >
          <CheckList checks={[
            { id: 'scenarios', title: 'Сценарии', ok: progress ? progress.total > 0 : null, note: progress ? `${progress.passed}/${progress.total} проверено успешно` : 'Сессия ещё не создана' },
            { id: 'decision', title: 'Решение проверяющего', ok: status === 'success' ? true : status === 'failed' || status === 'blocked' ? false : null, note: latest ? `${SESSION_LABEL[status] ?? 'Проверяется'} · ${formatDateTime(latest.startedAt)}` : 'Ожидает' }
          ]} />
          {hostsPanel && <div className="new-task-stage-panel">{panel}</div>}
        </StageCard>
      })}
    </StageRail>
  </div>
}

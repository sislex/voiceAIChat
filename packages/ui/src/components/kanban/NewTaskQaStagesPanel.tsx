import { useMemo, useState } from 'react'
import { Badge, Button, EmptyState, ErrorState, FeedLog, ResultTable, Skeleton } from '@voicechat/ui-kit'
import type { AnyQaStageRun, ComponentQaTaskState, IntegrationTestTaskState, QaRunStage } from '@shared/qa'
import { useQaStageUpdates } from '../qa/useQaStageUpdates'
import { AttemptList, CheckList, StageCard, StageHeading, StageRail } from './NewTaskStages'
import { useNewTaskAction, useNewTaskResource } from './useNewTaskResource'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'
import { assignToCycles, pluralRu, qaRunStageStatus, qaStageRunStatus, stageTitle, type StageStatus } from './taskCycles'

export const QA_STAGE_NAME: Record<QaRunStage, string> = {
  component_qa: 'Component QA', integration_tests: 'Интеграционные тесты', automated_qa: 'Automated QA'
}
export interface QaPassAttempt { id: string; attempt: number; status: StageStatus; createdAt: number }
export interface NewTaskQaStagesPanelProps {
  projectId: string; taskId: string; stage: QaRunStage
  cycles: TaskReworkCycleViewModel[]; workflow: string[]; runActive: boolean
  onFixStarted?: (runId: string) => void
}
interface Snapshot {
  component: ComponentQaTaskState | null
  integration: IntegrationTestTaskState | null
  automated: AnyQaStageRun[]
}
export function NewTaskQaStagesPanel(props: NewTaskQaStagesPanelProps): JSX.Element {
  const { projectId, taskId } = props
  const resource = useNewTaskResource<Snapshot>(`${projectId}:${taskId}:${props.stage}`, async () => {
    if (!window.qa) throw new Error('QA недоступен')
    return {
      component: props.stage === 'component_qa' ? await window.qa.getComponent!(projectId, taskId) : null,
      integration: props.stage === 'integration_tests' ? await window.qa.getIntegration!(projectId, taskId) : null,
      automated: props.stage === 'automated_qa' ? await window.qa.listStageRuns!(projectId, taskId, props.stage) : []
    }
  })
  const { busy, error, act } = useNewTaskAction(resource.refresh)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const state = resource.data?.component ?? resource.data?.integration
  const runs = useMemo(() => state?.runs ?? resource.data?.automated ?? [], [state, resource.data])
  const statusOf = (run: (typeof runs)[number]): StageStatus => 'gateReasons' in run ? qaStageRunStatus(run.status) : qaRunStageStatus(run.status)
  const stages = useMemo(() => assignToCycles<(typeof runs)[number]>(props.cycles, runs, { createdAt: run => run.createdAt }), [props.cycles, runs])
  const selected = stages.find(stage => stage.key === selectedKey) ?? stages[stages.length - 1]!
  const run = selected.items.find(item => item.id === selectedId) ?? selected.items[selected.items.length - 1] ?? null
  const latest = state?.latestRun ?? resource.data?.automated[0]
  const currentCycle = selected.key === stages[stages.length - 1]!.key
  const current = currentCycle && (!run || run.id === latest?.id)
  const active = state?.activeRun ?? resource.data?.automated.find(item => item.canCancel)
  useQaStageUpdates({ projectId, taskId, stage: props.stage, onUpdate: () => void resource.refresh(), active: Boolean(active) })
  const name = QA_STAGE_NAME[props.stage]
  const start = () => props.stage === 'component_qa' ? window.qa!.startComponent!(projectId, taskId)
    : props.stage === 'integration_tests' ? window.qa!.startIntegration!(projectId, taskId)
    : window.qa!.startStageRun!(projectId, taskId, props.stage)
  return <div className="new-task-process" data-testid={`new-task-qa-${props.stage}`}>
    <StageHeading eyebrow="История проходов" title={name} description="Отдельный проход для каждого development-цикла и набора доработок." badge={<Badge>{pluralRu(stages.length, 'проход', 'прохода', 'проходов')}</Badge>} />
    {(resource.error || error) && <ErrorState compact message="Не удалось обновить этап" detail={error || resource.error} onRetry={() => void resource.refresh()} />}
    {!resource.data && resource.loading && <Skeleton variant="list" count={3} />}
    <StageRail testId={`new-task-qa-rail-${props.stage}`}>
      {stages.map((stage, index) => {
        const shown = stage.key === selected.key ? run : stage.items[stage.items.length - 1]
        const status = shown ? statusOf(shown) : 'idle'
        return <StageCard key={stage.key} number={stage.number} status={status} statusLabel={status === 'success' ? 'Завершено' : status === 'idle' ? 'Ожидает' : undefined} eyebrow={`Проход ${stage.number}`} title={stageTitle(name, stage)}
          workflow={props.workflow} cycle={stage.cycle} sourceTitle="Цикл 1" sourceText="Результат разработки первоначальной постановки задачи."
          selected={stage.key === selected.key} onSelect={() => { setSelectedKey(stage.key); setSelectedId(null) }} connector={index < stages.length - 1}
          testId={`new-task-qa-stage-${props.stage}-${stage.number}`}>
          <CheckList checks={[
            { id: 'launch', title: 'Запуск прохода', ok: shown ? true : null, note: shown ? `Попытка ${shown.attempt}` : 'Проход ещё не запускался' },
            { id: 'result', title: 'Результат', ok: status === 'success' ? true : ['failed', 'blocked'].includes(status) ? false : null, note: shown && 'summary' in shown ? shown.summary : 'Нет данных' }
          ]} />
          {stage.key === selected.key && <>
            <AttemptList ariaLabel={`Попытки ${name}`} selectedId={run?.id ?? null} onSelect={setSelectedId}
              attempts={stage.items.map(item => ({ id: item.id, label: `Попытка ${item.attempt}`, status: statusOf(item), at: item.createdAt }))} />
            {!run && <EmptyState compact icon="🧪" title="Проход ещё не запускался" description="Запуск доступен в текущем цикле, когда выполнены условия этапа." />}
            {state?.launchReasons.length ? <ErrorState compact message="Запуск недоступен" detail={state.launchReasons.join('; ')} /> : null}
            {run && <section className="new-task-section">
              <p>Ветка: {run.branch || '—'} · SHA: {run.commitSha?.slice(0, 8) || '—'}</p>
              {'blockerReasons' in run && run.blockerReasons.length > 0 && <ErrorState compact message="Проход заблокирован" detail={run.blockerReasons.join('; ')} />}
              {'components' in run && <ResultTable caption="Компоненты" rows={run.components.map(item => ({
                id: item.id, name: item.name, result: item.storybookStoryId && run.storybookUrl
                  ? <a href={run.storybookUrl + '/?path=/story/' + item.storybookStoryId} target="_blank" rel="noreferrer">{item.storybookStoryId}</a>
                  : item.exclusionReason, detail: item.alternativeVerification, tone: 'neutral' as const
              }))} />}
              {'components' in run && <ResultTable caption="Сценарии" rows={run.scenarios.map(item => ({
                id: item.testCase.id, name: item.testCase.title, result: item.status, detail: item.actualResult, tone: item.status === 'passed' ? 'success' as const : 'neutral' as const
              }))} />}
              {'testCases' in run && <ResultTable caption="Тест-кейсы" rows={run.testCases.map(item => ({
                id: item.id, name: item.title, result: item.automatable ? 'Автоматизация' : item.notAutomatedReason, tone: 'neutral' as const
              }))} />}
              {'commands' in run && run.commands.map(command => <details key={command.commandId}><summary>{command.name} · {command.status} · {command.durationMs} мс</summary><FeedLog label={command.name}>{command.stdout + command.stderr}</FeedLog></details>)}
              {'gateReasons' in run && <>
                <CheckList checks={run.gateReasons.map((reason, at) => ({ id: String(at), title: reason, note: '', ok: false }))} />
                <p>{run.currentStep} · {run.progress.current}/{run.progress.total}</p>
                {run.error && <ErrorState compact message="Этап остановлен" detail={run.error} />}
                {run.result && <details><summary>Результат Automated QA</summary><pre>{JSON.stringify(run.result, null, 2)}</pre></details>}
              </>}
              <FeedLog label={`Лента ${name}`}>{typeof run.log === 'string' ? run.log : run.log.map(line => line.text).join('\n')}</FeedLog>
            </section>}
            <div className="new-task-heading-actions">
              {current && <Button size="sm" loading={busy} disabled={!resource.data || props.runActive || Boolean(active) || (state ? !state.canStart : false)} onClick={() => void act(start)}>Запустить</Button>}
              {run && active?.id === run.id && <Button size="sm" variant="danger" loading={busy} onClick={() => void act(() =>
                props.stage === 'component_qa' ? window.qa!.cancelComponent!(projectId, taskId, run.id) :
                  props.stage === 'integration_tests' ? window.qa!.cancelIntegration!(projectId, taskId, run.id) : window.qa!.cancelStageRun!(run.id)
              )}>Отменить</Button>}
              {current && run?.canRetry && <Button size="sm" loading={busy} disabled={Boolean(active) || props.runActive} onClick={() => void act(() => props.stage === 'automated_qa' ? window.qa!.retryStageRun!(run.id) : start())}>Повторить</Button>}
              {current && run && state && ['failed', 'blocked'].includes(run.status) && <Button size="sm" loading={busy} disabled={Boolean(active) || props.runActive} onClick={() => void act(async () => {
                if (props.stage === 'component_qa') { const fix = await window.qa!.fixComponent!(projectId, taskId, run.id); props.onFixStarted?.(fix.id) }
                else await window.qa!.fixIntegration!(projectId, taskId, run.id)
              })}>Отправить на доработку</Button>}
              {current && run && state && <Button size="sm" loading={busy} disabled={!state.canComplete} onClick={() => void act(() => props.stage === 'component_qa'
                ? window.qa!.completeComponent!(projectId, taskId, run.id) : window.qa!.completeIntegration!(projectId, taskId, run.id))}>
                {props.stage === 'component_qa' ? 'Перейти к созданию интеграционных автотестов' : 'Перейти к Automated QA'}</Button>}
            </div>
          </>}
        </StageCard>
      })}
    </StageRail>
  </div>
}

import { useCallback, useEffect, useState } from 'react'
import type { ComponentQaTaskState } from '@shared/qa'
import { QA_RUN_STATUS_LABELS, QA_STEP_STATUS_LABELS } from '@shared/qa'
import { Skeleton } from '@voicechat/ui-kit'
import { AttemptHistory, Button, EmptyState, ErrorState, FeedItem, FeedLog, MetricGrid, PanelHeading, QaScore, ResultTable, StatusPill, type ResultRow } from '@voicechat/ui-kit'
import { COMPONENT_QA_SCENARIO_LABEL, qaRunTone, qaScenarioTone, qaStepTone } from './qaTone'
import { useQaStageUpdates } from './useQaStageUpdates'

export function ComponentQaPanel(props:{projectId:string;taskId:string;active:boolean;onFixStarted?:(id:string)=>void}):JSX.Element {
  const [state,setState]=useState<ComponentQaTaskState|null>(null)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const load=useCallback(async()=>{
    if (!window.qa?.getComponent) return
    try {
      const next=await window.qa.getComponent(props.projectId,props.taskId)
      setState((current)=>{
        if (!current||!next) return next
        const a=current.latestRun?.finishedAt??current.latestRun?.startedAt??current.latestRun?.createdAt??0
        const b=next.latestRun?.finishedAt??next.latestRun?.startedAt??next.latestRun?.createdAt??0
        return b>=a?next:current
      })
      setError('')
    } catch(cause) { setError(cause instanceof Error?cause.message:String(cause)) }
  },[props.projectId,props.taskId])
  useEffect(()=>{void load()},[load])
  // Опрос встаёт вместе со вкладкой браузера: карточка, оставленная открытой,
  // стучала в сервер каждые две секунды и в фоне.
  useQaStageUpdates({ projectId: props.projectId, taskId: props.taskId, stage: 'component_qa', onUpdate: () => void load(), active: Boolean(state?.activeRun) })
  if (!window.qa?.getComponent) return <section className="component-qa-panel">
    <EmptyState compact icon="🧪" title="Component QA недоступен" description="Мост QA не подключён в этой сборке." testId="component-qa-unavailable" />
  </section>
  if (!state) return <section className="component-qa-panel">
    <span className="vc-sr-only" aria-live="polite">Загрузка Component QA…</span>
    <Skeleton variant="list" count={3} item="block" height={64} gap={10} />
  </section>
  const run=state.latestRun
  const act=async(action:()=>Promise<unknown>)=>{setBusy(true);try{await action();await load()}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}}
  return <section className="component-qa-panel" aria-label="Component QA">
    <PanelHeading
      kicker={run ? `Попытка ${run.attempt}` : 'Component QA'}
      title="Проверка компонентов"
      description="Визуальные и интерактивные сценарии интерфейса."
      actions={run && <StatusPill tone={qaRunTone(run.status)}>{QA_RUN_STATUS_LABELS[run.status]}</StatusPill>}
    />
    {error&&<ErrorState compact message="Не удалось обновить Component QA" detail={error} onRetry={()=>void load()} />}
    {!run&&<EmptyState compact icon="🧪" title="Проверка ещё не запускалась" description="Модель соберёт витрину и прогонит сценарии компонентов." testId="component-qa-empty" />}
    {state.launchReasons.length>0&&<ErrorState
      compact
      message="Запуск недоступен"
      detail={state.launchReasons.join('; ')}
      testId="component-qa-blocked"
    />}
    {run&&<>
      <MetricGrid
        testId="component-qa-summary"
        items={[
          { label: 'Ветка', value: run.branch, title: run.branch },
          { label: 'SHA', value: run.commitSha.slice(0, 8), title: run.commitSha },
          { label: 'Процесс', value: run.status==='queued'||run.status==='running'?'активен':'завершён' }
        ]}
      />
      {run.scenarios.length>0&&<QaScore
        passed={run.scenarios.filter((item)=>item.status==='passed').length}
        total={run.scenarios.length}
        testId="component-qa-score"
      />}
      {run.staleReason&&<p className="ci-task-hint">Устарел: {run.staleReason}</p>}
      {run.blockerReasons.length>0&&<ErrorState compact message="Проверка заблокирована" detail={run.blockerReasons.join('; ')} />}
      <ResultTable
        className="component-qa-components"
        caption="Компоненты"
        resultLabel="Витрина"
        rows={run.components.map((component): ResultRow => ({
          id: component.id,
          name: component.name,
          tone: component.storybookStoryId ? 'success' : 'neutral',
          result: component.storybookStoryId
            ? <a href={run.storybookUrl?run.storybookUrl+'/?path=/story/'+component.storybookStoryId:'#'} target="_blank" rel="noreferrer">{component.storybookStoryId}</a>
            : 'исключён',
          detail: component.storybookStoryId ? undefined : `${component.exclusionReason}; ${component.alternativeVerification}`
        }))}
      />
      <ResultTable
        className="component-qa-scenarios"
        caption="Сценарии"
        rows={run.scenarios.map((item): ResultRow => ({
          id: item.testCase.id,
          name: item.testCase.title,
          tone: qaScenarioTone(item.status),
          result: COMPONENT_QA_SCENARIO_LABEL[item.status],
          detail: item.actualResult || undefined
        }))}
      />
      <div className="vc-feed component-qa-commands">
        {run.commands.map((command)=><FeedItem
          key={command.commandId}
          tone={qaStepTone(command.status)}
          title={command.name}
          meta={`${QA_STEP_STATUS_LABELS[command.status]} · exit ${command.exitCode??'—'} · ${command.durationMs} мс`}
        >
          <FeedLog label={`Лог команды ${command.name}`}>{`$ ${command.command}\n${command.stdout}${command.stderr}${command.diagnostic?`\n${command.diagnostic}`:''}`}</FeedLog>
        </FeedItem>)}
        {run.log&&<FeedItem tone={run.status==='running'?'running':'neutral'} title="Потоковый лог" defaultOpen={run.status==='running'}>
          <FeedLog label="Потоковый лог Component QA">{run.log}</FeedLog>
        </FeedItem>}
      </div>
      {run.artifacts.length>0&&<><h4 className="jmodal-h">Артефакты</h4><ul className="component-qa-artifacts">{run.artifacts.map(artifact=><li key={artifact.id}><a href={artifact.url||artifact.path}>{artifact.name}</a> ({artifact.kind})</li>)}</ul></>}
      {run.summary&&<p className="ci-task-hint"><strong>Итог:</strong> {run.summary}</p>}
    </>}
    <div className="component-qa-actions">
      <Button size="sm" disabled={busy||props.active||!state.canStart} onClick={()=>void act(()=>window.qa!.startComponent!(props.projectId,props.taskId))}>Запустить</Button>
      {state.activeRun&&<Button size="sm" disabled={busy} onClick={()=>void act(()=>window.qa!.cancelComponent!(props.projectId,props.taskId,state.activeRun!.id))}>Отменить</Button>}
      {run?.canRetry&&<Button size="sm" disabled={busy||props.active||state.activeRun!=null} onClick={()=>void act(()=>window.qa!.startComponent!(props.projectId,props.taskId))}>Повторить</Button>}
      {run?.storybookUrl&&<Button size="sm" onClick={()=>window.open(run.storybookUrl!,'_blank')}>Открыть Storybook</Button>}
      {run&&['failed','blocked'].includes(run.status)&&<Button size="sm" disabled={busy} onClick={()=>void act(async()=>{const fix=await window.qa!.fixComponent!(props.projectId,props.taskId,run.id);props.onFixStarted?.(fix.id)})}>Отправить на доработку</Button>}
      {run&&<Button size="sm" disabled={busy||!state.canComplete} onClick={()=>void act(()=>window.qa!.completeComponent!(props.projectId,props.taskId,run.id))}>Перейти к созданию интеграционных автотестов</Button>}
    </div>
    {state.runs.length>1&&<AttemptHistory
      testId="component-qa-history"
      selectedId={run?.id}
      attempts={state.runs.map((item)=>({
        id: item.id,
        attempt: item.attempt,
        status: QA_RUN_STATUS_LABELS[item.status],
        tone: qaRunTone(item.status),
        note: item.commitSha.slice(0,8)
      }))}
    />}
  </section>
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentQaTaskState } from '@shared/qa'
import { QA_RUN_STATUS_LABELS, QA_STEP_STATUS_LABELS } from '@shared/qa'
import { Dialog, RefreshIndicator, Skeleton } from '@voicechat/ui-kit'
import { AttemptHistory, Button, EmptyState, ErrorState, FeedItem, FeedLog, MetricGrid, PanelHeading, QaScore, ResultTable, StatusPill, type ResultRow } from '@voicechat/ui-kit'
import { COMPONENT_QA_SCENARIO_LABEL, qaRunTone, qaScenarioTone, qaStepTone } from './qaTone'
import { useQaStageUpdates } from './useQaStageUpdates'

/**
 * Embedding props for the new card: `runId` shows a specific attempt instead of
 * the latest one, `onStateChange` hands the whole state to the stage rail (one
 * request for both), `hideHistory` drops the built-in attempt list the rail
 * replaces. Gate actions (fix, complete) stay bound to the latest run: the
 * server only accepts them for it.
 */
export interface ComponentQaPanelProps {
  onRetryActions?: (actions: Record<string, () => void>) => void

  projectId:string;taskId:string;active:boolean;onFixStarted?:(id:string)=>void
  runId?:string|null;onStateChange?:(state:ComponentQaTaskState)=>void;hideHistory?:boolean
}
export function ComponentQaPanel(props:ComponentQaPanelProps):JSX.Element {
  const [state,setState]=useState<ComponentQaTaskState|null>(null)
  const onStateChange=props.onStateChange
  useEffect(()=>{if(state)onStateChange?.(state)},[state,onStateChange])
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [filter,setFilter]=useState('all'),[search,setSearch]=useState('')
  const refresh=useQaRefresh(`${props.projectId}:${props.taskId}`)
  const load=useCallback(async()=>{
    if (!window.qa?.getComponent) return
    await refresh.request(()=>window.qa!.getComponent!(props.projectId,props.taskId),next=>{setState(next);setError('')},cause=>setError(cause instanceof Error?cause.message:String(cause)))
  },[props.projectId,props.taskId,refresh.request])
  useEffect(()=>{setState(null);void load()},[load])
  // Опрос встаёт вместе со вкладкой браузера: карточка, оставленная открытой,
  // стучала в сервер каждые две секунды и в фоне.
  useQaStageUpdates({ projectId: props.projectId, taskId: props.taskId, stage: 'component_qa', onUpdate: () => void load(), active: Boolean(state?.activeRun) })
  const act=useCallback(async(action:()=>Promise<unknown>)=>{setBusy(true);try{await action();await load()}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}},[load])
  const retry = useCallback(() => { if (!busy && !props.active && !state?.activeRun && window.qa?.startComponent) void act(() => window.qa!.startComponent!(props.projectId, props.taskId)) }, [act, busy, props.active, props.projectId, props.taskId, state?.activeRun])
  useEffect(() => {
    props.onRetryActions?.(Object.fromEntries((state?.runs ?? []).filter((item) => item.canRetry && !busy && !props.active && !state?.activeRun && window.qa?.startComponent).map((item) => [item.id, retry])))
  }, [state, busy, props.active, retry, props.onRetryActions])
  if (!window.qa?.getComponent) return <section className="component-qa-panel">
    <EmptyState compact icon="🧪" title="Component QA недоступен" description="Мост QA не подключён в этой сборке." testId="component-qa-unavailable" />
  </section>
  if (!state) return <section className="component-qa-panel">
    {error&&<ErrorState compact message="Не удалось загрузить Component QA" detail={error} onRetry={()=>void load()}/>}
    <span className="vc-sr-only" aria-live="polite">Загрузка Component QA…</span>
    <Skeleton variant="list" count={3} item="block" height={64} gap={10} />
  </section>
  const run=props.runId?state.runs.find(item=>item.id===props.runId)??null:state.latestRun
  const latest=run!=null&&run.id===state.latestRun?.id
  return <section className="component-qa-panel" aria-label="Component QA">
    <PanelHeading
      kicker={run ? `Попытка ${run.attempt}` : 'Component QA'}
      title="Проверка компонентов"
      description="Визуальные и интерактивные сценарии интерфейса."
      actions={run && <StatusPill tone={qaRunTone(run.status)}>{QA_RUN_STATUS_LABELS[run.status]}</StatusPill>}
    />
    <QaRefresh {...refresh} onRefresh={()=>void load()}/>
    {run&&<Button size="sm" onClick={()=>downloadQaReport(run.id,componentQaReport(run))}>Скачать отчёт</Button>}
    {error&&<ErrorState compact message="Не удалось обновить Component QA" detail={error} onRetry={()=>void load()} />}
    {!run&&<EmptyState compact icon="🧪" title="Проверка ещё не запускалась" description="Модель соберёт витрину и прогонит сценарии компонентов." testId="component-qa-empty" />}
    {state.launchReasons.length>0&&<ErrorState
      compact
      message="Запуск недоступен"
      detail={state.launchReasons.join('; ')}
      testId="component-qa-blocked"
    />}
    {run&&<>
      <QaMetadata run={run} testId="component-qa-summary"/>
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
            ? (run.storybookUrl ? <a href={storybookLink(run.storybookUrl,component.storybookStoryId)} target="_blank" rel="noreferrer">Открыть в Storybook</a> : 'Storybook недоступен')
            : 'исключён',
          detail: component.storybookStoryId ? undefined : `${component.exclusionReason}; ${component.alternativeVerification}`
        }))}
      />
      <div className="qa-filters"><label>Статус<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">Все</option><option value="failed">Провалены</option><option value="not_applicable">Пропущены</option></select></label><label>Поиск по названию<input value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
      {!run.scenarios.some(item=>(filter==='all'||item.status===filter)&&item.testCase.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))&&<EmptyState compact title="Сценарии не найдены" description="Измените поиск или фильтр."/>}
      <ResultTable
        className="component-qa-scenarios"
        caption="Сценарии"
        rows={run.scenarios.filter(item=>(filter==='all'||item.status===filter)&&item.testCase.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((item): ResultRow => ({
          id: item.testCase.id,
          name: item.testCase.title,
          tone: qaScenarioTone(item.status),
          result: COMPONENT_QA_SCENARIO_LABEL[item.status],
          detail: <>{item.actualResult}{item.testCase.storybookStoryId&&(run.storybookUrl?<a href={storybookLink(run.storybookUrl,item.testCase.storybookStoryId)} target="_blank" rel="noreferrer">Открыть в Storybook</a>:<span>Storybook недоступен</span>)}</>
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
        {run.log&&<FeedItem tone={run.status==='running'?'running':'neutral'} title="Потоковый лог" defaultOpen={false}>
          <FeedLog label="Потоковый лог Component QA">{run.log}</FeedLog>
        </FeedItem>}
      </div>
      {run.artifacts.length>0&&<><h4 className="jmodal-h">Артефакты</h4><ul className="component-qa-artifacts">{run.artifacts.map(artifact=><li key={artifact.id}>{artifact.kind==='screenshot'||artifact.kind==='visual_diff'?<QaImage url={artifact.url||artifact.path} name={artifact.name}/>:<a href={artifact.url||artifact.path}>{artifact.name}</a>}</li>)}</ul></>}
      {run.summary&&<p className="ci-task-hint"><strong>Итог:</strong> {run.summary}</p>}
    </>}
    <div className="component-qa-actions">
      <Button size="sm" disabled={busy||props.active||!state.canStart} onClick={()=>void act(()=>window.qa!.startComponent!(props.projectId,props.taskId))}>Запустить</Button>
      {state.activeRun&&<Button size="sm" disabled={busy} onClick={()=>void act(()=>window.qa!.cancelComponent!(props.projectId,props.taskId,state.activeRun!.id))}>Отменить</Button>}
      {run?.canRetry&&<Button size="sm" disabled={busy||props.active||state.activeRun!=null} onClick={retry}>Повторить</Button>}
      {run?.storybookUrl&&<Button size="sm" onClick={()=>window.open(run.storybookUrl!,'_blank')}>Открыть Storybook</Button>}
      {run&&latest&&['failed','blocked'].includes(run.status)&&<Button size="sm" disabled={busy} onClick={()=>void act(async()=>{const fix=await window.qa!.fixComponent!(props.projectId,props.taskId,run.id);props.onFixStarted?.(fix.id)})}>Отправить на доработку</Button>}
      {run&&latest&&<Button size="sm" disabled={busy||!state.canComplete} onClick={()=>void act(()=>window.qa!.completeComponent!(props.projectId,props.taskId,run.id))}>Перейти к созданию интеграционных автотестов</Button>}
    </div>
    {state.runs.length>1&&!props.hideHistory&&<AttemptHistory
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

export function QaMetadata({ run, testId }: { run: { branch?: string; commitSha?: string; llmModel?: string; machineName?: string; machineId?: string | null; startedAt?: number | null; finishedAt?: number | null }; testId?: string }): JSX.Element {
  return <section aria-label="Что проверялось"><h4>Что проверялось</h4><MetricGrid testId={testId} items={[
    { label: 'Ветка', value: run.branch || 'Нет данных' },
    { label: 'SHA', value: run.commitSha?.slice(0, 8) || 'Нет данных', title: run.commitSha },
    { label: 'Машина', value: run.machineName || run.machineId || 'Нет данных' },
    { label: 'Модель', value: run.llmModel || 'Нет данных' },
    { label: 'Длительность', value: run.startedAt != null && run.finishedAt != null ? `${Math.max(0, run.finishedAt - run.startedAt)} мс` : 'Нет данных' }
  ]} /></section>
}

// Request identity and sequence prevent stale responses from replacing a newer task.
export function useQaRefresh(identity: string) {
  const owner = useRef(identity), sequence = useRef(0)
  if (owner.current !== identity) { owner.current = identity; sequence.current++ }
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  useEffect(() => { setUpdatedAt(null); return () => { sequence.current++ } }, [identity])
  const request = useCallback(async <T,>(read: () => Promise<T>, apply: (value: T) => void, fail: (cause: unknown) => void) => {
    const seq = ++sequence.current
    setRefreshing(true)
    try { const value = await read(); if (owner.current === identity && seq === sequence.current) { apply(value); setUpdatedAt(Date.now()) } }
    catch (cause) { if (owner.current === identity && seq === sequence.current) fail(cause) }
    finally { if (owner.current === identity && seq === sequence.current) setRefreshing(false) }
  }, [identity])
  return { request, refreshing, updatedAt }
}

export function QaRefresh({ refreshing, updatedAt, onRefresh }: { refreshing: boolean; updatedAt: number | null; onRefresh(): void }): JSX.Element {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer) }, [])
  return <div className="qa-refresh"><Button size="sm" disabled={refreshing} onClick={onRefresh}>Обновить</Button>
    {refreshing && <RefreshIndicator label="Обновляем результаты…" />}
    <span>{updatedAt === null ? 'Данные ещё не получены' : `Обновлено ${Math.max(0, Math.floor((now - updatedAt) / 1000))} с назад`}</span>
  </div>
}

export function QaImage({ url, name }: { url: string; name: string }): JSX.Element {
  const [open, setOpen] = useState(false), [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false); setOpen(false) }, [url])
  return <span className="qa-image">
    {failed ? <><span>Изображение недоступно или формат не поддерживается. </span><a href={url}>{name}</a></> :
      <Button size="sm" onClick={() => setOpen(true)} aria-label={`Увеличить: ${name}`}><img src={url} alt={name} onError={() => setFailed(true)} style={{ maxWidth: 140, maxHeight: 90, objectFit: 'contain' }} /></Button>}
    {open && <Dialog title={name} size="lg" onClose={() => setOpen(false)} padded>
      {failed ? <ErrorState compact message="Не удалось открыть изображение" /> : <img src={url} alt={name} onError={() => setFailed(true)} style={{ maxWidth: '100%', height: 'auto' }} />}
    </Dialog>}
  </span>
}

export function downloadQaReport(id: string, report: string): void {
  const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `qa-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
export function storybookLink(base: string, id: string): string {
  const url = new URL(base); url.searchParams.set('path', '/story/' + id); return url.toString()
}
export function componentQaReport(run: import('@shared/qa').ComponentQaRun): string {
  return ['# Component QA', md(run.id), md(QA_RUN_STATUS_LABELS[run.status]), md(run.branch), md(run.commitSha), ...run.scenarios.map(item=>`## ${md(item.testCase.title)}\n${COMPONENT_QA_SCENARIO_LABEL[item.status]}\n${md(item.testCase.steps)}\n${md(item.actualResult)}\n${md(item.diagnostic)}`), ...run.artifacts.map(item=>reportLink(item.name,item.url||item.path)), ...run.commands.map(item=>`## ${md(item.name)}\n${md(item.stdout)}\n${md(item.stderr)}`), md(run.summary)].join('\n\n')
}
export const md = (value: unknown): string => String(value ?? 'Нет данных').replace(/[\\`*_{}\[\]<>#|]/g, char => String.fromCharCode(92) + char)
export const reportLink = (name: string, url: string): string => `[${md(name)}](${url.replace(/[\s()<>]/g, encodeURIComponent)})`

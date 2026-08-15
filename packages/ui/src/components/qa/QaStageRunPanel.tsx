import { useCallback, useEffect, useState } from 'react'
import type { AnyQaStageRun, QaRunStage } from '@shared/qa'
import { Button } from '@voicechat/ui-kit'

const LABEL: Record<QaRunStage, string> = {
  component_qa: 'Component QA',
  integration_tests: 'Интеграционные тесты',
  automated_qa: 'Automated QA'
}

function IntegrationTestPanel(props:{projectId:string;taskId:string}):JSX.Element {
  const [state,setState]=useState<import('@shared/qa').IntegrationTestTaskState|null>(null)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  const load=useCallback(async()=>{if(!window.qa?.getIntegration)return;try{const next=await window.qa.getIntegration(props.projectId,props.taskId);setState((current)=>{if(!current||!next)return next;const a=current.latestRun?.finishedAt??current.latestRun?.startedAt??current.latestRun?.createdAt??0,b=next.latestRun?.finishedAt??next.latestRun?.startedAt??next.latestRun?.createdAt??0;return b>=a?next:current});setError('')}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}},[props.projectId,props.taskId])
  useEffect(()=>{void load()},[load])
  useEffect(()=>{if(!state?.activeRun)return;const timer=window.setInterval(()=>void load(),2000);return()=>window.clearInterval(timer)},[state?.activeRun?.id,load])
  if(!window.qa?.getIntegration)return <section>Стадия недоступна</section>
  if(!state)return <section>Загрузка интеграционных автотестов…</section>
  const run=state.latestRun
  const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);try{await fn();await load()}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}}
  return <section aria-label="Интеграционные автотесты"><header><h3>Интеграционные автотесты</h3>{run&&<span>{run.status}</span>}</header>
    {error&&<p role="alert">{error}</p>}
    {state.launchReasons.length>0&&<div><strong>Запуск недоступен</strong><ul>{state.launchReasons.map((reason)=><li key={reason}>{reason}</li>)}</ul></div>}
    {run&&<><dl><dt>Ветка</dt><dd>{run.branch}</dd><dt>SHA</dt><dd><code>{run.commitSha}</code></dd><dt>Попытка</dt><dd>{run.attempt}</dd></dl>
      {run.blockerReasons.length>0&&<ul>{run.blockerReasons.map((reason)=><li key={reason}>{reason}</li>)}</ul>}
      <h4>Тест-кейсы</h4><ul>{run.testCases.map((item)=><li key={item.id}>{item.title} — {item.automatable?'автоматизируемый':'исключён'} {item.automationLinks.filter((link)=>link.commitSha===run.commitSha).map((link)=><a key={link.testId+link.path} href={link.path}>{link.path}</a>)}</li>)}</ul>
      <h4>Команды</h4>{run.commands.map((command)=><details key={command.commandId}><summary>{command.name} — {command.status}, exit {command.exitCode??'—'}, {command.durationMs} ms</summary><code>{command.command}</code><pre>{command.stdout}{command.stderr}</pre></details>)}
      {run.log&&<details open={run.status==='running'}><summary>Потоковый лог</summary><pre>{run.log}</pre></details>}{run.summary&&<p><strong>Итог:</strong> {run.summary}</p>}</>}
    <div><Button size="sm" disabled={busy||!state.canStart} onClick={()=>void act(()=>window.qa!.startIntegration!(props.projectId,props.taskId))}>Запустить</Button>
      {state.activeRun&&<Button size="sm" disabled={busy} onClick={()=>void act(()=>window.qa!.cancelIntegration!(props.projectId,props.taskId,state.activeRun!.id))}>Отменить</Button>}
      {run?.canRetry&&<Button size="sm" disabled={busy||!!state.activeRun} onClick={()=>void act(()=>window.qa!.startIntegration!(props.projectId,props.taskId))}>Повторить</Button>}
      {run&&['failed','blocked'].includes(run.status)&&<Button size="sm" disabled={busy} onClick={()=>void act(()=>window.qa!.fixIntegration!(props.projectId,props.taskId,run.id))}>Отправить на доработку</Button>}
      {run&&<Button size="sm" disabled={busy||!state.canComplete} onClick={()=>void act(()=>window.qa!.completeIntegration!(props.projectId,props.taskId,run.id))}>Перейти к Automated QA</Button>}</div>
    {state.runs.length>0&&<section><h4>История попыток</h4><ol>{state.runs.map((item)=><li key={item.id}>#{item.attempt} · {item.status}</li>)}</ol></section>}
  </section>
}

function GenericQaStageRunPanel(props: { projectId: string; taskId: string; stage: QaRunStage }): JSX.Element {
  const [runs, setRuns] = useState<AnyQaStageRun[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState('')
  const load = useCallback(async () => {
    if (!window.qa?.listStageRuns) return
    try { setRuns(await window.qa.listStageRuns(props.projectId, props.taskId, props.stage)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [props.projectId, props.taskId, props.stage])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const current = runs[0]
    if (!current || !['running','queued','awaiting_input'].includes(current.status)) return
    const timer = window.setInterval(() => void load(), 1500)
    return () => window.clearInterval(timer)
  }, [runs, load])
  const run = runs[0]
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try { await fn(); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <div className="qa-stage-run" data-testid={`qa-stage-${props.stage}`}>
    <div className="qa-stage-run__head"><h3>{LABEL[props.stage]}</h3>
      {!run?.canCancel && window.qa?.startStageRun && <Button size="sm" variant="primary" disabled={busy} onClick={() => void act(() => window.qa!.startStageRun!(props.projectId, props.taskId, props.stage))}>Запустить</Button>}
      {run?.canCancel && window.qa?.cancelStageRun && <Button size="sm" variant="danger" disabled={busy} onClick={() => void act(() => window.qa!.cancelStageRun!(run.id))}>Отменить</Button>}
      {run?.canRetry && window.qa?.retryStageRun && <Button size="sm" disabled={busy} onClick={() => void act(() => window.qa!.retryStageRun!(run.id))}>Повторить</Button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {!run && <p>Запусков этого этапа ещё нет.</p>}
    {run && <><p><strong>{run.status}</strong> · попытка {run.attempt} · {run.branch || 'ветка не задана'} {run.commitSha && <>· <code>{run.commitSha.slice(0, 10)}</code></>}</p>
      <p>{run.currentStep || 'Ожидание'} · {run.progress.current}/{run.progress.total} {run.progress.label}</p>
      <progress max={Math.max(1, run.progress.total)} value={run.progress.current} />
      {run.gateReasons.length > 0 && <section><h4>Quality gate не пройден</h4><ul>{run.gateReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></section>}
      {run.error && <p role="alert">{run.error}</p>}
      {run.result && <section><h4>Результат</h4><pre>{JSON.stringify(run.result, null, 2)}</pre></section>}
      <section><h4>Потоковая лента</h4><div className="ci-log">{run.log.map((line) => <div key={line.seq}>{line.text}</div>)}</div></section>
      {run.status === 'awaiting_input' && props.stage === 'integration_tests' && window.qa?.answerStageRun && <form onSubmit={(event) => { event.preventDefault(); void act(async () => { await window.qa!.answerStageRun!(run.id, answer); setAnswer('') }) }}><label>Ответ модели<textarea value={answer} onChange={(event) => setAnswer(event.target.value)} /></label><Button size="sm" type="submit" disabled={busy || !answer.trim()}>Отправить</Button></form>}
    </>}
    {runs.length > 0 && <section><h4>История попыток</h4><ol>{runs.map((item) => <li key={item.id}>#{item.attempt} · {item.status} · {new Date(item.createdAt).toLocaleString()}</li>)}</ol></section>}
  </div>
}
export function QaStageRunPanel(props:{projectId:string;taskId:string;stage:QaRunStage}):JSX.Element {
  return props.stage==='integration_tests'?<IntegrationTestPanel projectId={props.projectId} taskId={props.taskId}/>:<GenericQaStageRunPanel {...props}/>
}

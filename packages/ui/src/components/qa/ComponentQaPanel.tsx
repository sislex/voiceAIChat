import { useCallback, useEffect, useState } from 'react'
import type { ComponentQaTaskState } from '@shared/qa'
import { Button } from '@voicechat/ui-kit'

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
  useEffect(()=>{
    if (!state?.activeRun) return
    const timer=window.setInterval(()=>void load(),2000)
    return ()=>window.clearInterval(timer)
  },[state?.activeRun?.id,load])
  if (!window.qa?.getComponent) return <section className="component-qa-panel">Component QA недоступен</section>
  if (!state) return <section className="component-qa-panel">Загрузка Component QA…</section>
  const run=state.latestRun
  const act=async(action:()=>Promise<unknown>)=>{setBusy(true);try{await action();await load()}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}}
  return <section className="component-qa-panel" aria-label="Component QA">
    <header><h3>Component QA</h3>{run&&<span className={'qa-status qa-status--'+run.status}>{run.status}</span>}</header>
    {error&&<p role="alert">{error}</p>}
    {!run&&<p>Проверка ещё не запускалась.</p>}
    {state.launchReasons.length>0&&<div><strong>Запуск недоступен</strong><ul>{state.launchReasons.map(reason=><li key={reason}>{reason}</li>)}</ul></div>}
    {run&&<>
      <dl className="component-qa-meta"><dt>Ветка</dt><dd>{run.branch}</dd><dt>SHA</dt><dd><code>{run.commitSha}</code></dd><dt>Попытка</dt><dd>{run.attempt}</dd><dt>Процесс</dt><dd>{run.status==='queued'||run.status==='running'?'активен':'завершён'}</dd></dl>
      {run.staleReason&&<p>Устарел: {run.staleReason}</p>}
      {run.blockerReasons.length>0&&<ul>{run.blockerReasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}
      <h4>Компоненты</h4><ul>{run.components.map(component=><li key={component.id}><strong>{component.name}</strong>{component.storybookStoryId?<> · <a href={run.storybookUrl?run.storybookUrl+'/?path=/story/'+component.storybookStoryId:'#'} target="_blank" rel="noreferrer">{component.storybookStoryId}</a></>:<> · исключён: {component.exclusionReason}; {component.alternativeVerification}</>}</li>)}</ul>
      <h4>Сценарии</h4><ul>{run.scenarios.map(item=><li key={item.testCase.id}>{item.testCase.title} — {item.status}{item.actualResult&&<div>{item.actualResult}</div>}</li>)}</ul>
      <h4>Команды</h4>{run.commands.map(command=><details key={command.commandId}><summary>{command.name} — {command.status}, exit {command.exitCode??'—'}, {command.durationMs} ms</summary><code>{command.command}</code><pre>{command.stdout}{command.stderr}</pre>{command.diagnostic&&<p>{command.diagnostic}</p>}</details>)}
      {run.log&&<details open={run.status==='running'}><summary>Потоковый лог</summary><pre>{run.log}</pre></details>}
      {run.artifacts.length>0&&<><h4>Артефакты</h4><ul>{run.artifacts.map(artifact=><li key={artifact.id}><a href={artifact.url||artifact.path}>{artifact.name}</a> ({artifact.kind})</li>)}</ul></>}
      {run.summary&&<p><strong>Итог:</strong> {run.summary}</p>}
    </>}
    <div className="component-qa-actions">
      <Button size="sm" disabled={busy||props.active||!state.canStart} onClick={()=>void act(()=>window.qa!.startComponent!(props.projectId,props.taskId))}>Запустить</Button>
      {state.activeRun&&<Button size="sm" disabled={busy} onClick={()=>void act(()=>window.qa!.cancelComponent!(props.projectId,props.taskId,state.activeRun!.id))}>Отменить</Button>}
      {run?.canRetry&&<Button size="sm" disabled={busy||props.active||state.activeRun!=null} onClick={()=>void act(()=>window.qa!.startComponent!(props.projectId,props.taskId))}>Повторить</Button>}
      {run?.storybookUrl&&<Button size="sm" onClick={()=>window.open(run.storybookUrl!,'_blank')}>Открыть Storybook</Button>}
      {run&&['failed','blocked'].includes(run.status)&&<Button size="sm" disabled={busy} onClick={()=>void act(async()=>{const fix=await window.qa!.fixComponent!(props.projectId,props.taskId,run.id);props.onFixStarted?.(fix.id)})}>Отправить на доработку</Button>}
      {run&&<Button size="sm" disabled={busy||!state.canComplete} onClick={()=>void act(()=>window.qa!.completeComponent!(props.projectId,props.taskId,run.id))}>Перейти к созданию интеграционных автотестов</Button>}
    </div>
    {state.runs.length>1&&<details><summary>История попыток ({state.runs.length})</summary><ol>{state.runs.map(item=><li key={item.id}>#{item.attempt} · {item.commitSha.slice(0,8)} · {item.status}</li>)}</ol></details>}
  </section>
}

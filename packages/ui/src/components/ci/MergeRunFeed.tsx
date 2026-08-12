import { useEffect, useRef, useState } from 'react'
import type { MergeRun } from '@shared/merge'
import { Button } from '../ui/Button'
import { fmtDuration } from './ciFormat'

export function MergeRunFeed({ runId, onRunChanged }:{ runId:string; onRunChanged?:()=>void }):JSX.Element {
  const [run,setRun]=useState<MergeRun|null>(null), [error,setError]=useState('')
  const [autoscroll,setAutoscroll]=useState(true), logRef=useRef<HTMLPreElement>(null)
  useEffect(()=>{
    let alive=true
    const load=()=>window.ci?.getMerge(runId).then(value=>{if(alive){setRun(value);setError('')}}).catch(e=>{if(alive)setError(e instanceof Error?e.message:String(e))})
    void load()
    const off=window.ci?.onMerge(({runId:id,run:value})=>{if(alive&&id===runId)setRun(value)})
    const timer=window.setInterval(()=>void load(),3000)
    return()=>{alive=false;off?.();window.clearInterval(timer)}
  },[runId])
  useEffect(()=>{const el=logRef.current;if(autoscroll&&el)el.scrollTop=el.scrollHeight},[run?.log,autoscroll])
  if(error)return <div className="error">{error}</div>
  if(!run)return <div>Загрузка merge-рана…</div>
  const duration=(run.finishedAt??Date.now())-(run.startedAt??run.createdAt)
  const download=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([run.log],{type:'text/plain'}));a.download=`merge-run-${run.id}.txt`;a.click();URL.revokeObjectURL(a.href)}
  return <section className="ci-runfeed" data-testid="merge-run-feed">
    <div className="ci-runfeed-head">
      <strong>{run.status} · {run.stage}</strong><span>{fmtDuration(duration)}</span>
      <span><code>{run.sourceBranch}</code> · {run.sourceSha?.slice(0,8)} → main {run.targetSha?.slice(0,8)}</span>
      <span>merge {run.mergeSha?.slice(0,8)??'—'} · машина {run.machineName??run.agentId}</span>
      <div className="ci-runfeed-actions">
        <label><input type="checkbox" checked={autoscroll} onChange={e=>setAutoscroll(e.target.checked)}/> автоскролл</label>
        <Button onClick={()=>void navigator.clipboard.writeText(run.log)}>Копировать лог</Button>
        <Button onClick={download}>Скачать .txt</Button>
        {run.canCancel&&<Button onClick={()=>void window.ci?.cancelMerge(run.id).then(value=>{setRun(value);onRunChanged?.()})}>Отменить</Button>}
        {run.canRetry&&<Button onClick={()=>void window.ci?.retryMerge(run.id).then(value=>{setRun(value);onRunChanged?.()})}>Повторить</Button>}
      </div>
    </div>
    <dl>
      <dt>Инициатор</dt><dd>{run.triggeredBy}</dd><dt>Создан</dt><dd>{new Date(run.createdAt).toLocaleString()}</dd>
      <dt>Модель конфликтов</dt><dd>{run.llmProvider} {run.llmModel||'по умолчанию'}</dd>
    </dl>
    {run.error&&<div className="error"><strong>{run.error}</strong>{run.recommendedAction&&<div>{run.recommendedAction}</div>}</div>}
    {run.conflicts.length>0&&<section><strong>Конфликтующие файлы</strong><ul>{run.conflicts.map(path=><li key={path}><code>{path}</code></li>)}</ul></section>}
    <ol className="ci-steps">{run.stages.map(stage=><li key={stage.stage} className="ci-step"><strong>{stage.stage}</strong> · {stage.status} · {fmtDuration(stage.durationMs??(stage.startedAt?Date.now()-stage.startedAt:null))}{stage.message&&<div>{stage.message}</div>}</li>)}</ol>
    {run.checks.map(check=><section key={check.name}><strong>{check.name}: {check.status}</strong> · exit {check.exitCode??'—'} · {fmtDuration(check.durationMs)}<pre>{check.output}</pre></section>)}
    <pre ref={logRef} style={{maxHeight:360,overflow:'auto',whiteSpace:'pre-wrap'}}>{run.log}</pre>
    {!autoscroll&&<Button onClick={()=>{const el=logRef.current;if(el)el.scrollTop=el.scrollHeight}}>К последней строке</Button>}
  </section>
}

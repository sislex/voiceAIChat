import { useCallback, useEffect, useMemo, useState } from 'react'
import { compareReleaseBranches, releaseFailureSummary, type ProjectRelease, type ReleaseBranch, type ReleaseStep } from '@voicechat/shared'
import type { RendererApi } from '@shared/ipc'

interface Props { projectId:string; baseBranch:string; owner:boolean; api?:RendererApi }
type Tab='releases'|'deploy'
const labels:Record<string,string>={regression:'Regression',knowledge_base:'База знаний',switching:'Переключение checkout',building:'Сборка и обновление контейнеров',health_check:'Health-check'}
const statusLabels:Record<string,string>={preparing:'Подготовка',checking:'Проверки',ready:'Готов',queued:'В очереди',switching:'Переключение',building:'Сборка',health_check:'Health-check',released:'Опубликован',failed:'Ошибка'}
const terminal=new Set(['ready','released','failed'])
const duration=(release:ProjectRelease):number|null=>{
  const starts=release.steps.flatMap(step=>step.startedAt==null?[]:[step.startedAt])
  const finishes=release.steps.flatMap(step=>step.finishedAt==null?[]:[step.finishedAt])
  if(!starts.length)return null
  return (finishes.length?Math.max(...finishes):Date.now())-Math.min(...starts)
}
const fmtDuration=(ms:number|null):string=>{
  if(ms==null)return '—'
  const seconds=Math.max(0,Math.round(ms/1000))
  return seconds<60?`${seconds} с`:`${Math.floor(seconds/60)} мин ${seconds%60} с`
}
const download=(release:ProjectRelease):void=>{
  const text=[
    `${release.branch} · ${release.sha} · ${release.status}`,
    ...release.steps.map(step=>`\n=== ${labels[step.kind]??step.kind} · ${step.status} ===\n${step.log||'(лог пуст)'}`)
  ].join('\n')
  const blob=new Blob([text],{type:'text/plain;charset=utf-8'})
  const url=URL.createObjectURL(blob)
  const anchor=document.createElement('a')
  anchor.href=url;anchor.download=`${release.branch.replace('/','-')}-${release.id}.log`;anchor.click();URL.revokeObjectURL(url)
}
function StepFeed({steps}:{steps:ReleaseStep[]}):JSX.Element{
  const [,tick]=useState(0)
  const running=steps.some(step=>step.status==='running')
  useEffect(()=>{if(!running)return;const id=window.setInterval(()=>tick(value=>value+1),1000);return()=>window.clearInterval(id)},[running])
  return <ol className="release-run-feed">{steps.map(step=>{
    const elapsed=step.startedAt?(step.finishedAt??Date.now())-step.startedAt:null
    const open=step.status==='running'||step.status==='failed'
    return <li key={step.id} className="release-run-step" data-status={step.status}>
      <details open={open}>
        <summary><span className="release-run-dot"/><strong>{labels[step.kind]??step.kind}</strong><span className="release-run-status">{statusLabels[step.status]??step.status}</span><time>{fmtDuration(elapsed)}</time></summary>
        {step.status==='failed'&&<p className="release-step-summary">{releaseFailureSummary(step.kind,step.log)}</p>}
        {step.log&&<pre>{step.log}</pre>}
      </details>
    </li>
  })}</ol>
}
function ReleaseDetail({release,onBack}:{release:ProjectRelease;onBack:()=>void}):JSX.Element{
  const visibleSteps=release.previousReleaseId?release.steps.filter(step=>['switching','building','health_check'].includes(step.kind)):release.steps.filter(step=>['knowledge_base','regression'].includes(step.kind))
  return <section className="release-detail">
    <header><button className="vc-btn vc-btn--secondary" onClick={onBack}>← К списку</button><div><h2>{release.branch}</h2><p>SHA {release.sha.slice(0,12)} · {statusLabels[release.status]??release.status}</p></div><button className="vc-btn vc-btn--secondary" onClick={()=>download(release)}>Скачать лог</button></header>
    <div className="release-metrics"><span>Начат<br/><strong>{new Date(release.createdAt).toLocaleString()}</strong></span><span>Длительность<br/><strong>{fmtDuration(duration(release))}</strong></span><span>Инициатор<br/><strong>{release.triggeredBy}</strong></span></div>
    <StepFeed steps={visibleSteps}/>
  </section>
}

export function ReleaseCenter({projectId,baseBranch,owner,api=window.api}:Props):JSX.Element {
  const [tab,setTab]=useState<Tab>('releases')
  const [branches,setBranches]=useState<ReleaseBranch[]>([])
  const [releases,setReleases]=useState<ProjectRelease[]>([])
  const [detail,setDetail]=useState<ProjectRelease|null>(null)
  const [selected,setSelected]=useState('')
  const [version,setVersion]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const refresh=useCallback(async()=>{
    try{
      const [nextBranches,nextReleases]=await Promise.all([api['releases:branches']({projectId}),api['releases:list']({projectId})])
      const deployable=nextBranches.filter(branch=>nextReleases.some(item=>item.branch===branch.branch&&item.status==='ready'))
      setBranches(nextBranches);setReleases(nextReleases);setSelected(current=>deployable.some(item=>item.branch===current)?current:(deployable[0]?.branch??''));setError('')
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason))}
  },[api,projectId])
  useEffect(()=>{void refresh()},[refresh])
  useEffect(()=>{
    if(!detail||terminal.has(detail.status))return
    const update=async()=>{try{const next=await api['releases:get']({projectId,releaseId:detail.id});if(next)setDetail(next)}catch{}}
    const id=window.setInterval(()=>void update(),2000)
    return()=>window.clearInterval(id)
  },[api,projectId,detail])
  const preparations=useMemo(()=>releases.filter(item=>!item.previousReleaseId),[releases])
  const deployments=useMemo(()=>releases.filter(item=>item.previousReleaseId),[releases])
  const readyBranches=useMemo(()=>branches.filter(branch=>releases.some(item=>item.branch===branch.branch&&item.status==='ready')),[branches,releases])
  const prepared=releases.find(item=>item.branch===selected&&item.status==='ready')
  const current=deployments.find(item=>item.status==='released')
  const latestDeploy=deployments[0]
  const transition=current&&selected&&current.branch!==selected
    ? compareReleaseBranches(selected,current.branch)===-1
      ?`Будет выполнен откат production с ${current.branch} на ${selected}.`
      :`Будет выполнено обновление production с ${current.branch} на ${selected}.`
    :''
  const create=async():Promise<void>=>{setBusy(true);setError('');try{const release=await api['releases:createBranch']({projectId,branch:`release/${version}`,baseBranch});setDetail(release);setVersion('');await refresh()}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}}
  const deploy=async():Promise<void>=>{setBusy(true);setError('');try{const release=await api['releases:deploy']({projectId,branch:selected});setDetail(release);await refresh()}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}}
  if(detail)return <ReleaseDetail release={detail} onBack={()=>{setDetail(null);void refresh()}}/>
  return <section className="release-center" aria-label="Релизы и деплой">
    <nav className="release-tabs" role="tablist" aria-label="Разделы релизов"><button role="tab" aria-selected={tab==='releases'} onClick={()=>setTab('releases')}>Релизы</button><button role="tab" aria-selected={tab==='deploy'} onClick={()=>setTab('deploy')}>Деплой</button></nav>
    {error&&<p role="alert">{error}</p>}
    {tab==='releases'?<>
      <header><div><h2>Релизы</h2><p>Подготовка и история сборок</p></div><button className="vc-btn vc-btn--secondary" disabled={busy} onClick={()=>void refresh()}>Обновить</button></header>
      <div className="release-create"><label>Новая версия <input value={version} placeholder="1.2.3" onChange={event=>setVersion(event.target.value)}/></label><button className="vc-btn vc-btn--primary" disabled={!owner||busy||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)} onClick={()=>void create()}>Собрать новый релиз</button></div>
      <div className="release-table-wrap"><table className="release-table"><thead><tr><th>Название</th><th>Дата</th><th>Время сборки</th><th>Статус</th></tr></thead><tbody>{preparations.map(release=><tr key={release.id} tabIndex={0} onClick={()=>setDetail(release)} onKeyDown={event=>{if(event.key==='Enter')setDetail(release)}}><td><strong>{release.branch}</strong><small>{release.sha.slice(0,12)}</small></td><td>{new Date(release.createdAt).toLocaleString()}</td><td>{fmtDuration(duration(release))}</td><td><span className="release-status" data-status={release.status}>{statusLabels[release.status]??release.status}</span></td></tr>)}</tbody></table>{preparations.length===0&&<p>Релизов пока нет.</p>}</div>
    </>:<>
      <header><div><h2>Деплой</h2><p>Публикация подготовленного релиза в production</p></div><button className="vc-btn vc-btn--secondary" disabled={busy} onClick={()=>void refresh()}>Обновить</button></header>
      {latestDeploy?<button className="release-last-deploy" onClick={()=>setDetail(latestDeploy)}><span>Последний деплой</span><strong>{latestDeploy.branch}</strong><span>{statusLabels[latestDeploy.status]??latestDeploy.status} · {fmtDuration(duration(latestDeploy))}</span></button>:<p>Деплоев ещё не было.</p>}
      <div className="release-deploy"><label>Релиз <select value={selected} onChange={event=>setSelected(event.target.value)}>{readyBranches.map(branch=><option key={branch.branch} value={branch.branch}>{branch.branch} · {branch.sha.slice(0,12)}</option>)}</select></label>{transition&&<p role="status">{transition}</p>}<button className="vc-btn vc-btn--primary" disabled={!owner||busy||!prepared} onClick={()=>void deploy()}>Задеплоить</button></div>
      {deployments.length>0&&<div className="release-table-wrap"><table className="release-table"><thead><tr><th>Релиз</th><th>Дата</th><th>Длительность</th><th>Статус</th></tr></thead><tbody>{deployments.map(release=><tr key={release.id} onClick={()=>setDetail(release)}><td>{release.branch}</td><td>{new Date(release.createdAt).toLocaleString()}</td><td>{fmtDuration(duration(release))}</td><td>{statusLabels[release.status]??release.status}</td></tr>)}</tbody></table></div>}
    </>}
  </section>
}

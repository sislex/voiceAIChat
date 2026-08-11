import { useCallback, useEffect, useMemo, useState } from 'react'
import { compareReleaseBranches, releaseFailureSummary, type ProjectRelease, type ReleaseBranch } from '@voicechat/shared'
import type { RendererApi } from '@shared/ipc'

interface Props { projectId:string; baseBranch:string; owner:boolean; api?:RendererApi }
const labels:Record<string,string>={regression:'Regression',knowledge_base:'База знаний',switching:'Переключение checkout',building:'Сборка и обновление контейнеров',health_check:'Health-check'}

export function ReleaseCenter({projectId,baseBranch,owner,api=window.api}:Props):JSX.Element {
  const [branches,setBranches]=useState<ReleaseBranch[]>([])
  const [releases,setReleases]=useState<ProjectRelease[]>([])
  const [selected,setSelected]=useState('')
  const [version,setVersion]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const refresh=useCallback(async()=>{
    try{
      const [nextBranches,nextReleases]=await Promise.all([api['releases:branches']({projectId}),api['releases:list']({projectId})])
      setBranches(nextBranches);setReleases(nextReleases);setSelected(current=>nextBranches.some(item=>item.branch===current)?current:(nextBranches[0]?.branch??''));setError('')
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason))}
  },[api,projectId])
  useEffect(()=>{void refresh()},[refresh])
  const prepared=useMemo(()=>releases.find(item=>item.branch===selected&&item.status==='ready'),[releases,selected])
  const current=releases.find(item=>item.status==='released')
  const transition=current&&selected&&current.branch!==selected
    ? compareReleaseBranches(selected,current.branch) === -1
      ? `Будет выполнен откат production с ${current.branch} на ${selected}.`
      : `Будет выполнено обновление production с ${current.branch} на ${selected}.`
    : ''
  const run=async(action:()=>Promise<unknown>):Promise<void>=>{setBusy(true);setError('');try{await action();await refresh()}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}}
  return <section className="release-center" aria-label="Центр деплоя релиза">
    <header><h2>Релизы</h2><button className="vc-btn vc-btn--secondary" disabled={busy} onClick={()=>void refresh()}>Обновить origin</button></header>
    {error&&<p role="alert">{error}</p>}
    {current&&<p>Production: <strong>{current.branch}</strong> · {current.sha.slice(0,12)} · {current.releasedAt?new Date(current.releasedAt).toLocaleString():''} · health-check пройден</p>}
    <div className="release-create">
      <label>Новая версия <input value={version} placeholder="1.2.3" onChange={event=>setVersion(event.target.value)}/></label>
      <button className="vc-btn vc-btn--secondary" disabled={!owner||busy||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)} onClick={()=>void run(()=>api['releases:createBranch']({projectId,branch:`release/${version}`,baseBranch}))}>Создать и подготовить release-ветку</button>
    </div>
    <div className="release-deploy">
      <label>Подготовленный релиз <select value={selected} onChange={event=>setSelected(event.target.value)}>{branches.map(branch=><option key={branch.branch} value={branch.branch}>{branch.branch} · {branch.sha.slice(0,12)}</option>)}</select></label>
      {transition&&<p role="status">{transition}</p>}
      <button className="vc-btn vc-btn--primary" disabled={!owner||busy||!prepared} onClick={()=>void run(()=>api['releases:deploy']({projectId,branch:selected}))}>Задеплоить</button>
    </div>
    {releases.length===0?<p>Подготовленных релизов и публикаций ещё нет.</p>:releases.map(release=><article key={release.id} className="release-card">
      <h3>{release.branch} <small>{release.status}</small></h3>
      <p>SHA {release.sha} · инициатор {release.triggeredBy} · {new Date(release.createdAt).toLocaleString()}</p>
      <ol>{release.steps.map(step=><li key={step.id} data-status={step.status}>{labels[step.kind]??step.kind}: {step.status}{step.status==='failed'?<p className="release-step-summary">{releaseFailureSummary(step.kind,step.log)}</p>:null}{step.log?<details><summary>Расшифровка</summary><pre>{step.log}</pre></details>:null}</li>)}</ol>
    </article>)}
  </section>
}

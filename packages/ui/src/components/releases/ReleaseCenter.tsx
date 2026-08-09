import { useCallback, useEffect, useState } from 'react'
import type { ProjectRelease, ReleaseBranch } from '@voicechat/shared'
import type { RendererApi } from '@shared/ipc'

interface Props { projectId:string; baseBranch:string; owner:boolean; api?:RendererApi }
const labels:Record<string,string>={regression:'Regression',knowledge_base:'База знаний',merge_main:'Merge в main',push_main:'Push main',production_deploy:'Production deploy',health_check:'Health-check',cleanup:'Очистка preview/workspace'}

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
  const run=async(action:()=>Promise<unknown>):Promise<void>=>{setBusy(true);setError('');try{await action();await refresh()}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}}
  return <section className="release-center" aria-label="Центр деплоя релиза">
    <header><h2>Релизы</h2><button className="vc-btn vc-btn--secondary" disabled={busy} onClick={()=>void refresh()}>Обновить origin</button></header>
    {error&&<p role="alert">{error}</p>}
    <div className="release-create">
      <label>Новая версия <input value={version} placeholder="1.2.3" onChange={event=>setVersion(event.target.value)}/></label>
      <button className="vc-btn vc-btn--secondary" disabled={!owner||busy||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)} onClick={()=>void run(()=>api['releases:createBranch']({projectId,branch:`release/${version}`,baseBranch}))}>Создать release-ветку</button>
    </div>
    <div className="release-deploy">
      <label>Существующий релиз <select value={selected} onChange={event=>setSelected(event.target.value)}>{branches.map(branch=><option key={branch.branch} value={branch.branch}>{branch.branch} · {branch.sha.slice(0,12)}</option>)}</select></label>
      <button className="vc-btn vc-btn--primary" disabled={!owner||busy||!selected} onClick={()=>void run(()=>api['releases:deploy']({projectId,branch:selected}))}>Задеплоить релиз</button>
    </div>
    {releases.length===0?<p>Публикаций ещё нет.</p>:releases.map(release=><article key={release.id} className="release-card">
      <h3>{release.branch} <small>{release.status}</small></h3>
      <p>SHA {release.sha} · инициатор {release.triggeredBy} · попытка {release.attempt}</p>
      <ol>{release.steps.map(step=><li key={step.id} data-status={step.status}>{labels[step.kind]??step.kind}: {step.status}{step.model?` · ${step.model}`:''}{step.log?<details><summary>Лог</summary><pre>{step.log}</pre></details>:null}</li>)}</ol>
    </article>)}
  </section>
}

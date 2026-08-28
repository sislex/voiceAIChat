import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDateTime, isoDate } from '../../lib/dateFormat'
import { compareReleaseBranches, DEFAULT_RELEASE_TIMEOUTS, releaseFailureSummary, type ProjectMachine, type ProjectRelease, type ProjectReleaseSummary, type ReleaseBranch, type ReleaseStep, type ReleaseTimeouts } from '@voicechat/shared'
import type { AgentInfo } from '@shared/agentProtocol'
import type { RendererApi } from '@shared/ipc'
import { loadView, type LoadStatus } from '../../lib/loadState'
import { useConfirm, EmptyState, ErrorState, RefreshIndicator, Skeleton } from '@voicechat/ui-kit'

interface Props { projectId:string; baseBranch:string; owner:boolean; machines?:ProjectMachine[]; agents?:AgentInfo[]; agentsStatus?:LoadStatus; agentsError?:string|null; defaultAgentId?:string|null; releaseTimeouts?:ReleaseTimeouts; api?:RendererApi }
type Tab='releases'|'deploy'
const labels:Record<string,string>={checkout:'Подготовка checkout',regression:'Regression',knowledge_base:'База знаний',switching:'Переключение checkout',building:'Сборка и обновление контейнеров',health_check:'Health-check'}
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
  const started=release.steps.flatMap(step=>step.startedAt==null?[]:[step.startedAt]).sort()[0]??release.createdAt
  const finished=release.steps.flatMap(step=>step.finishedAt==null?[]:[step.finishedAt]).sort((a,b)=>b-a)[0]??null
  const text=[`Проект: ${release.projectId}`,`Ветка: ${release.branch}`,`Версия: ${release.version}`,`SHA: ${release.sha}`,`Ран: ${release.id}`,`Машина: ${release.agentId??'не сохранена'}`,`Checkout: ${release.checkoutPath??'не сохранён'}`,`Начало: ${isoDate(started)}`,`Окончание: ${finished?isoDate(finished):'ран активен'}`,`Общая длительность: ${fmtDuration(duration(release))}`,`Статус: ${release.status}`,...release.steps.map(step=>`\n=== ${labels[step.kind]??step.kind} · ${step.status} ===\nДлительность: ${fmtDuration(step.startedAt?(step.finishedAt??Date.now())-step.startedAt:null)}\nЛимит: ${fmtDuration(step.limitMs??null)}\n${step.log||'(лог пуст)'}`),release.status==='failed'?`\nИтоговая ошибка: ${releaseFailureSummary(release.steps.find(s=>s.status==='failed')?.kind??'',release.steps.find(s=>s.status==='failed')?.log??'')}`:''].join('\n')
  const blob=new Blob([text],{type:'text/plain;charset=utf-8'})
  const url=URL.createObjectURL(blob)
  const anchor=document.createElement('a')
  const suffix=release.previousReleaseId?`deploy-${isoDate(release.createdAt).slice(0,10)}`:'preparation'
  anchor.href=url;anchor.download=`release-${release.version}-${suffix}.txt`;anchor.click();URL.revokeObjectURL(url)
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
        <summary><span className="release-run-dot"/><strong>{labels[step.kind]??step.kind}</strong><span className="release-run-status">{statusLabels[step.status]??step.status}</span><time>{elapsed==null?'':`${fmtDuration(elapsed)} `}(лимит {fmtDuration(step.limitMs??null)})</time></summary>
        {step.status==='failed'&&<p className="release-step-summary">{releaseFailureSummary(step.kind,step.log)}</p>}
        {step.log&&<pre>{step.log}</pre>}
      </details>
    </li>
  })}</ol>
}
function ReleaseDetail({release,onBack}:{release:ProjectRelease;onBack:()=>void}):JSX.Element{
  const visibleSteps=release.previousReleaseId?release.steps.filter(step=>['switching','building','health_check'].includes(step.kind)):release.steps.filter(step=>['checkout','knowledge_base','regression'].includes(step.kind))
  return <section className="release-detail">
    <header><button className="vc-btn vc-btn--secondary" onClick={onBack}>← К списку</button><div><h2>{release.branch}</h2><p>SHA {release.sha.slice(0,12)} · {statusLabels[release.status]??release.status}</p></div><button className="vc-btn vc-btn--secondary" onClick={()=>download(release)}>Скачать лог</button></header>
    <div className="release-metrics"><span>Начат<br/><strong>{formatDateTime(release.createdAt)}</strong></span><span>Длительность<br/><strong>{fmtDuration(duration(release))}</strong></span><span>Инициатор<br/><strong>{release.triggeredBy}</strong></span></div>
    <StepFeed steps={visibleSteps}/>
  </section>
}

export function ReleaseCenter({projectId,baseBranch,owner,machines=[],agents=[],agentsStatus='ready',agentsError=null,defaultAgentId=null,releaseTimeouts=DEFAULT_RELEASE_TIMEOUTS,api=window.api}:Props):JSX.Element {
  const [tab,setTab]=useState<Tab>('releases')
  const [branches,setBranches]=useState<ReleaseBranch[]>([])
  const [releaseItems,setReleaseItems]=useState<ProjectReleaseSummary[]>([])
  const [deploymentItems,setDeploymentItems]=useState<ProjectReleaseSummary[]>([])
  const [releaseStatus,setReleaseStatus]=useState<LoadStatus>('idle')
  const [releaseError,setReleaseError]=useState('')
  const [deploymentError,setDeploymentError]=useState('')
  const [detail,setDetail]=useState<ProjectRelease|null>(null)
  const [detailReleaseId,setDetailReleaseId]=useState('')
  const [detailStatus,setDetailStatus]=useState<LoadStatus>('idle')
  const [detailError,setDetailError]=useState('')
  const detailRequest=useRef(0)
  const [selected,setSelected]=useState('')
  const [selectedAgentId,setSelectedAgentId]=useState(defaultAgentId??'')
  const [machineSaving,setMachineSaving]=useState(false)
  const [machineSaveError,setMachineSaveError]=useState('')
  const [version,setVersion]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  // Удаление релиза — необратимое (ветка уходит из origin): подтверждение с набором названия, не window.prompt —
  // нативный диалог блокирует вкладку и не даётся тестам/автоматизации.
  const confirm=useConfirm()
  useEffect(()=>setSelectedAgentId(defaultAgentId??''),[defaultAgentId])
  const availableMachines=useMemo(()=>{
    const linked=new Map(machines.map(machine=>[machine.agentId,machine]))
    return agents.map(agent=>linked.get(agent.id)??{agentId:agent.id,name:agent.name,online:agent.online,path:'',reposRoot:''}).concat(machines.filter(machine=>!agents.some(agent=>agent.id===machine.agentId)))
  },[agents,machines])
  const defaultMachine=availableMachines.find(machine=>machine.agentId===selectedAgentId)
  const machineProblem=!selectedAgentId
    ?'В настройках проекта не выбрана машина по умолчанию.'
    :!defaultMachine
      ?'Машина проекта по умолчанию не подключена к проекту.'
      :!defaultMachine.path&&!defaultMachine.reposRoot
        ?'У машины для этого проекта не настроена даже root-директория (repos_root).'
        :!defaultMachine.online
          ?'Машина проекта по умолчанию offline.'
          :''
  const [settingsOpen,setSettingsOpen]=useState(false)
  const [timeouts,setTimeouts]=useState(releaseTimeouts)
  const refreshReleases=useCallback(async()=>{
    setReleaseStatus('loading')
    try{
      const next=await api['releases:list']({projectId})
      setReleaseItems(next.filter(item=>!item.previousReleaseId));setDeploymentItems(next.filter(item=>item.previousReleaseId));setReleaseError('');setReleaseStatus('ready')
    }catch(reason){setReleaseError(reason instanceof Error?reason.message:String(reason));setReleaseStatus('error')}
  },[api,projectId])
  const refreshBranches=useCallback(async()=>{
    try{
      const next=await api['releases:branches']({projectId})
      setBranches(next);setDeploymentError('')
    }catch(reason){setDeploymentError(reason instanceof Error?reason.message:String(reason))}
  },[api,projectId])
  const refresh=useCallback(async()=>{await Promise.all([refreshReleases(),refreshBranches()])},[refreshBranches,refreshReleases])
  useEffect(()=>{void refresh()},[refresh])
  const openDetail=useCallback(async(releaseId:string)=>{
    const request=++detailRequest.current
    setDetailReleaseId(releaseId);setDetail(null);setDetailError('');setDetailStatus('loading')
    try{
      const next=await api['releases:get']({projectId,releaseId})
      if(request!==detailRequest.current)return
      if(!next)throw new Error('Релиз не найден')
      setDetail(next);setDetailStatus('ready')
    }catch(reason){if(request===detailRequest.current){setDetailError(reason instanceof Error?reason.message:String(reason));setDetailStatus('error')}}
  },[api,projectId])
  const closeDetail=useCallback(()=>{detailRequest.current+=1;setDetailReleaseId('');setDetail(null);setDetailError('');setDetailStatus('idle');void refresh()},[refresh])
  useEffect(()=>{
    if(!detail||terminal.has(detail.status))return
    let cancelled=false
    const update=async()=>{try{const next=await api['releases:get']({projectId,releaseId:detail.id});if(next&&!cancelled)setDetail(next)}catch{}}
    const id=window.setInterval(()=>void update(),2000)
    return()=>{cancelled=true;window.clearInterval(id)}
  },[api,projectId,detail])
  const releases=[...releaseItems,...deploymentItems]
  const preparations=releaseItems
  const deployments=deploymentItems
  const releaseView=loadView(releaseStatus,preparations.length>0)
  const deploymentView=loadView(releaseStatus,deployments.length>0)
  const readyBranches=useMemo(()=>branches.filter(branch=>releaseItems.some(item=>item.branch===branch.branch&&item.status==='ready')),[branches,releaseItems])
  useEffect(()=>setSelected(current=>readyBranches.some(item=>item.branch===current)?current:(readyBranches[0]?.branch??'')),[readyBranches])
  const prepared=releases.find(item=>item.branch===selected&&item.status==='ready')
  const current=deployments.find(item=>item.status==='released')
  const latestDeploy=deployments[0]
  const transition=current&&selected&&current.branch!==selected
    ? compareReleaseBranches(selected,current.branch)===-1
      ?`Будет выполнен откат production с ${current.branch} на ${selected}.`
      :`Будет выполнено обновление production с ${current.branch} на ${selected}.`
    :''
  const saveDefaultMachine=async(agentId:string):Promise<void>=>{const previous=selectedAgentId;setSelectedAgentId(agentId);setMachineSaving(true);setMachineSaveError('');try{if(!machines.some(machine=>machine.agentId===agentId))await api['projects:linkMachine']({id:projectId,agentId});await api['projects:setDefaultMachine']({id:projectId,agentId})}catch(reason){setSelectedAgentId(previous);setMachineSaveError(reason instanceof Error?reason.message:String(reason))}finally{setMachineSaving(false)}}
  const create=async():Promise<void>=>{setBusy(true);setError('');try{const release=await api['releases:createBranch']({projectId,branch:`release/${version}`,baseBranch});detailRequest.current+=1;setDetailReleaseId(release.id);setDetail(release);setDetailStatus('ready');setVersion('');await refresh()}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}}
  const saveSettings=async():Promise<void>=>{setBusy(true);setError('');try{await api['projects:update']({id:projectId,releaseTimeouts:timeouts});setSettingsOpen(false)}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}}
  const remove=async(release:ProjectReleaseSummary):Promise<void>=>{const ok=await confirm({title:`Удалить релиз ${release.branch}?`,message:`Ветка ${release.branch} будет удалена из origin, запись — из списка. Введите название ветки, чтобы подтвердить.`,variant:'danger',confirmLabel:'Удалить',requireText:release.branch});if(!ok)return;setBusy(true);try{await api['releases:delete']({projectId,releaseId:release.id,branch:release.branch});await refresh()}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}}
  const deploy=async():Promise<void>=>{setBusy(true);setError('');try{const release=await api['releases:deploy']({projectId,branch:selected});detailRequest.current+=1;setDetailReleaseId(release.id);setDetail(release);setDetailStatus('ready');await refresh()}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}}
  if(detailStatus==='loading')return <section className="release-detail" aria-busy="true"><button className="vc-btn vc-btn--secondary" onClick={closeDetail}>← К списку</button><RefreshIndicator label="Загружаем подробности релиза…"/><Skeleton variant="list" item="block" count={4} height={49}/></section>
  if(detailStatus==='error')return <section className="release-detail"><button className="vc-btn vc-btn--secondary" onClick={closeDetail}>← К списку</button><ErrorState message="Не удалось загрузить подробности релиза" detail={detailError} onRetry={()=>void openDetail(detailReleaseId)}/></section>
  if(detail)return <ReleaseDetail release={detail} onBack={closeDetail}/>
  return <section className="release-center" aria-label="Релизы и деплой">
    <nav className="release-tabs" role="tablist" aria-label="Разделы релизов"><button role="tab" aria-selected={tab==='releases'} onClick={()=>setTab('releases')}>Релизы</button><button role="tab" aria-selected={tab==='deploy'} onClick={()=>setTab('deploy')}>Деплой</button></nav>
    {error&&<p role="alert">{error}</p>}
    {!owner&&<p role="status">Недостаточно прав: подготовка релиза и production deploy доступны только администратору.</p>}
    {owner&&<button className="vc-btn vc-btn--secondary" onClick={()=>setSettingsOpen(value=>!value)}>Настройки</button>}
    {settingsOpen&&<form className="release-create" onSubmit={event=>{event.preventDefault();void saveSettings()}}>{([['checkoutMs','Подготовка checkout'],['knowledgeBaseMs','База знаний'],['regressionMs','Regression (каждая стадия)'],['switchingMs','Переключение checkout'],['buildingMs','Сборка и обновление контейнеров'],['healthCheckMs','Health-check']] as const).map(([key,label])=><label key={key}>{label}, сек.<input type="number" min="1" max="86400" required value={Math.round(timeouts[key]/1000)} onChange={event=>setTimeouts(value=>({...value,[key]:Number(event.target.value)*1000}))}/></label>)}<button className="vc-btn vc-btn--primary" disabled={busy}>Сохранить</button></form>}
    {tab==='releases'?<div className="release-pane">
      <header><div><h2>Релизы</h2><p>Подготовка и история сборок</p></div><span>{releaseView.refreshing&&<RefreshIndicator label="Обновляем релизы…"/>}<button className="vc-btn vc-btn--secondary" disabled={releaseStatus==='loading'} onClick={()=>void refreshReleases()}>Обновить</button></span></header>
      <div className="release-create"><label>Машина проекта по умолчанию<select aria-label="Машина проекта по умолчанию" value={selectedAgentId} disabled={!owner||machineSaving||agentsStatus==='loading'||availableMachines.length===0} onChange={event=>void saveDefaultMachine(event.target.value)}><option value="" disabled>{agentsStatus==='loading'?'Загрузка машин…':availableMachines.length===0?'Доступных машин нет':'Выберите машину'}</option>{selectedAgentId&&!availableMachines.some(machine=>machine.agentId===selectedAgentId)&&<option value={selectedAgentId}>Ранее выбранная машина · недоступна</option>}{availableMachines.map(machine=><option key={machine.agentId} value={machine.agentId}>{machine.name??machine.agentId} · {machine.online?'online':'offline'}{machines.some(item=>item.agentId===machine.agentId)?' · машина проекта':' · личная машина'}</option>)}</select></label>{machineSaving&&<RefreshIndicator label="Сохраняем выбор…"/>}{agentsStatus==='error'&&<ErrorState compact message="Не удалось загрузить машины" detail={agentsError}/>} {machineSaveError&&<ErrorState compact message="Не удалось сохранить машину по умолчанию" detail={machineSaveError}/>} {machineProblem&&<p role="alert">{machineProblem}</p>}<label>Новая версия <input value={version} placeholder="1.2.3" onChange={event=>setVersion(event.target.value)}/></label><button className="vc-btn vc-btn--primary" disabled={!owner||busy||machineSaving||Boolean(machineProblem)||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)} onClick={()=>void create()}>Собрать новый релиз</button></div>
      {releaseView.staleError&&<ErrorState compact message="Не удалось обновить релизы" detail={releaseError} onRetry={()=>void refreshReleases()}/>}
      <div className="release-table-wrap" aria-busy={releaseStatus==='loading'}>{releaseView.state==='skeleton'?<Skeleton variant="list" item="block" count={5} height={49}/>:releaseView.state==='error'?<ErrorState message="Не удалось загрузить релизы" detail={releaseError} onRetry={()=>void refreshReleases()}/>:releaseView.state==='empty'?<EmptyState title="Релизов пока нет" description="Соберите новый релиз — он появится в этом списке."/>:<table className="release-table"><thead><tr><th>Название</th><th>Дата</th><th>Время сборки</th><th>Статус</th><th>Действия</th></tr></thead><tbody>{preparations.map(release=><tr key={release.id} tabIndex={0} onClick={()=>void openDetail(release.id)} onKeyDown={event=>{if(event.key==='Enter')void openDetail(release.id)}}><td><strong>{release.branch}</strong><small>{release.sha.slice(0,12)}</small></td><td>{formatDateTime(release.createdAt)}</td><td>{fmtDuration(release.durationMs)}</td><td><span className="release-status" data-status={release.status}>{statusLabels[release.status]??release.status}</span></td><td>{owner&&['ready','failed'].includes(release.status)&&<button className="vc-btn vc-btn--secondary" onClick={event=>{event.stopPropagation();void remove(release)}}>Удалить</button>}</td></tr>)}</tbody></table>}</div>
    </div>:<div className="release-pane">
      <header><div><h2>Деплой</h2><p>Публикация подготовленного релиза в production</p></div><span>{deploymentView.refreshing&&<RefreshIndicator label="Обновляем деплои…"/>}<button className="vc-btn vc-btn--secondary" disabled={releaseStatus==='loading'} onClick={()=>void refresh()}>Обновить</button></span></header>
      {latestDeploy&&<button className="release-last-deploy" onClick={()=>void openDetail(latestDeploy.id)}><span>Последний деплой</span><strong>{latestDeploy.branch}</strong><span>{statusLabels[latestDeploy.status]??latestDeploy.status} · {fmtDuration(latestDeploy.durationMs)}</span></button>}
      <div className="release-deploy"><label>Релиз <select value={selected} onChange={event=>setSelected(event.target.value)}><option value="" disabled>{readyBranches.length?'Выберите релиз':'Готовых релизов нет'}</option>{readyBranches.map(branch=><option key={branch.branch} value={branch.branch}>{branch.branch} · {branch.sha.slice(0,12)}</option>)}</select></label>{transition&&<p role="status">{transition}</p>}<button className="vc-btn vc-btn--primary" disabled={!owner||busy||!prepared} onClick={()=>void deploy()}>Задеплоить</button></div>
      {deploymentError&&<ErrorState compact message="Не удалось загрузить release-ветки" detail={deploymentError} onRetry={()=>void refreshBranches()}/>}
      {deploymentView.staleError&&<ErrorState compact message="Не удалось обновить деплои" detail={releaseError} onRetry={()=>void refreshReleases()}/>}
      <div className="release-table-wrap" aria-busy={releaseStatus==='loading'}>{deploymentView.state==='skeleton'?<Skeleton variant="list" item="block" count={5} height={49}/>:deploymentView.state==='error'?<ErrorState message="Не удалось загрузить деплои" detail={releaseError} onRetry={()=>void refreshReleases()}/>:deploymentView.state==='empty'?<EmptyState title="Деплоев пока нет" description="Выберите готовый релиз и опубликуйте его в production."/>:<table className="release-table"><thead><tr><th>Релиз</th><th>Дата</th><th>Длительность</th><th>Статус</th></tr></thead><tbody>{deployments.map(release=><tr key={release.id} tabIndex={0} onClick={()=>void openDetail(release.id)} onKeyDown={event=>{if(event.key==='Enter')void openDetail(release.id)}}><td>{release.branch}</td><td>{formatDateTime(release.createdAt)}</td><td>{fmtDuration(release.durationMs)}</td><td>{statusLabels[release.status]??release.status}</td></tr>)}</tbody></table>}</div>
    </div>}
  </section>
}

import { ApplicationReleaseCenter } from './ApplicationReleaseCenter'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDateTime, formatRelativeTime, isoDate } from '../../lib/dateFormat'
import { compareReleaseBranches, DEFAULT_RELEASE_TIMEOUTS, releaseFailureSummary, releaseVersion, suggestNextReleaseVersion, type ProjectRelease, type ProjectReleaseSummary, type ReleaseBranch, type ReleaseMachine, type ReleaseStep, type ReleaseTimeouts } from '@voicechat/shared'
import type { RendererApi } from '@shared/ipc'
import { loadView, type LoadStatus } from '@voicechat/ui-foundation/lib/loadState'
import { useConfirm, useToast, EmptyState, ErrorState, RefreshIndicator, Skeleton } from '@voicechat/ui-kit'
import { RELEASES_TAB_KEY } from '@voicechat/ui-foundation/persistence'

interface Props { projectId:string; baseBranch:string; owner:boolean; releaseTimeouts?:ReleaseTimeouts; api?:RendererApi; /** Repository URL of the project: GitHub links to the commit and to the diff against production. */ gitUrl?:string|null }
const PAGE=20
type Tab='releases'|'deploy'
const labels:Record<string,string>={checkout:'Подготовка checkout',regression:'Regression',knowledge_base:'База знаний',switching:'Переключение checkout',building:'Сборка и обновление контейнеров',health_check:'Health-check'}
const statusLabels:Record<string,string>={preparing:'Подготовка',checking:'Проверки',ready:'Готов',queued:'В очереди',switching:'Переключение',building:'Сборка',health_check:'Health-check',released:'Опубликован',failed:'Ошибка'}
/** Step statuses are their own vocabulary: the run status map printed raw `passed` next to Russian labels. */
const stepStatusLabels:Record<ReleaseStep['status'],string>={queued:'В очереди',running:'Выполняется',passed:'Пройден',failed:'Ошибка',skipped:'Пропущен'}
const terminal=new Set(['ready','released','failed'])
const VERSION_RE=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
/** GitHub web root of a project repository, or null for non-GitHub / unknown URLs. */
export function githubWebUrl(gitUrl:string|null|undefined):string|null{
  if(!gitUrl)return null
  const match=gitUrl.trim().match(/^(?:https?:\/\/|git@)github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
  return match?`https://github.com/${match[1]}/${match[2]}`:null
}
/** Persisted tab: the deploy tab is the one people return to while a run goes on. */
function storedTab():Tab{try{return window.localStorage?.getItem(RELEASES_TAB_KEY)==='deploy'?'deploy':'releases'}catch{return 'releases'}}
const duration=(release:ProjectRelease,now=Date.now()):number|null=>{
  const starts=release.steps.flatMap(step=>step.startedAt==null?[]:[step.startedAt])
  const finishes=release.steps.flatMap(step=>step.finishedAt==null?[]:[step.finishedAt])
  if(!starts.length)return null
  const running=release.steps.some(step=>step.status==='running')
  return (running||!finishes.length?now:Math.max(...finishes))-Math.min(...starts)
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
/** One-second tick while something runs: elapsed times and the total duration stay live. */
function useLiveNow(active:boolean):number{
  const [now,setNow]=useState(()=>Date.now())
  useEffect(()=>{if(!active)return;setNow(Date.now());const id=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(id)},[active])
  return active?now:Date.now()
}
/** Log of a running step follows its tail until the reader scrolls up to look at something. */
function StepLog({log,live}:{log:string;live:boolean}):JSX.Element{
  const ref=useRef<HTMLPreElement>(null)
  const stick=useRef(true)
  useEffect(()=>{const node=ref.current;if(node&&live&&stick.current)node.scrollTop=node.scrollHeight},[log,live])
  return <pre ref={ref} onScroll={event=>{const node=event.currentTarget;stick.current=node.scrollHeight-node.scrollTop-node.clientHeight<24}}>{log}</pre>
}
function StepFeed({steps,now}:{steps:ReleaseStep[];now:number}):JSX.Element{
  return <ol className="release-run-feed">{steps.map(step=>{
    const elapsed=step.startedAt?(step.finishedAt??now)-step.startedAt:null
    const open=step.status==='running'||step.status==='failed'
    return <li key={step.id} className="release-run-step" data-status={step.status}>
      <details open={open}>
        <summary><span className="release-run-dot"/><strong>{labels[step.kind]??step.kind}</strong><span className="release-run-status">{stepStatusLabels[step.status]??step.status}</span><time>{elapsed==null?'':`${fmtDuration(elapsed)} `}(лимит {fmtDuration(step.limitMs??null)})</time></summary>
        {step.status==='failed'&&<p className="release-step-summary">{releaseFailureSummary(step.kind,step.log)}</p>}
        {step.log&&<StepLog log={step.log} live={step.status==='running'}/>}
      </details>
    </li>
  })}</ol>
}
interface ReleaseDetailActions{
  /** Re-run a failed deploy of the same prepared branch. */
  onRedeploy?:()=>void
  /** Delete the failed preparation branch and build the same version again. */
  onRebuild?:()=>void
  /** Open the preparation this deploy attempt was made from. */
  onOpenSource?:()=>void
  busy?:boolean
}
function ReleaseDetail({release,onBack,github,productionSha,actions}:{release:ProjectRelease;onBack:()=>void;github:string|null;productionSha:string|null;actions?:ReleaseDetailActions}):JSX.Element{
  const toast=useToast()
  const copySha=async():Promise<void>=>{try{await navigator.clipboard.writeText(release.sha);toast.success('SHA скопирован')}catch{toast.error('Не удалось скопировать SHA')}}
  const deploy=Boolean(release.previousReleaseId)
  const visibleSteps=deploy?release.steps.filter(step=>['switching','building','health_check'].includes(step.kind)):release.steps.filter(step=>['checkout','knowledge_base','regression'].includes(step.kind))
  const live=!terminal.has(release.status)
  const now=useLiveNow(live)
  return <section className="release-detail" aria-live={live?'polite':undefined}>
    <header>
      <button className="vc-btn vc-btn--secondary" onClick={onBack}>← К списку</button>
      <div><h2>{release.branch}</h2><p>{release.sha?<button type="button" className="release-sha" title="Скопировать полный SHA" onClick={()=>void copySha()}>SHA {release.sha.slice(0,12)}</button>:'SHA ещё не зафиксирован'} · <span className="release-status" data-status={release.status}>{statusLabels[release.status]??release.status}</span>{deploy&&<span className="release-attempt"> · попытка {release.attempt}</span>}{live&&<span className="release-live"> · обновляется каждые 2 с</span>}</p></div>
      <span className="release-detail-actions">
        {actions?.onOpenSource&&<button className="vc-btn vc-btn--secondary" onClick={actions.onOpenSource}>Сборка релиза</button>}
        {release.status==='failed'&&deploy&&actions?.onRedeploy&&<button className="vc-btn vc-btn--primary" disabled={actions.busy} onClick={actions.onRedeploy}>Повторить деплой</button>}
        {release.status==='failed'&&!deploy&&actions?.onRebuild&&<button className="vc-btn vc-btn--primary" disabled={actions.busy} onClick={actions.onRebuild}>Удалить и собрать заново</button>}
        <button className="vc-btn vc-btn--secondary" onClick={()=>download(release)}>Скачать лог</button>
      </span>
    </header>
    <div className="release-metrics">
      <span>{deploy?'Деплой начат':'Сборка начата'}<br/><strong>{formatDateTime(release.createdAt)}</strong></span>
      <span>Длительность<br/><strong>{fmtDuration(duration(release,now))}</strong></span>
      <span>Инициатор<br/><strong>{release.triggeredBy}</strong></span>
      <span>{deploy?'Production':'Машина сборки'}<br/><strong title={release.checkoutPath??undefined}>{release.agentId?release.agentId.slice(0,8):'—'}</strong></span>
    </div>
    {github&&release.sha&&<p className="release-links">
      <a href={`${github}/commit/${release.sha}`} target="_blank" rel="noreferrer">Коммит на GitHub ↗</a>
      <a href={`${github}/tree/${release.branch}`} target="_blank" rel="noreferrer">Ветка {release.branch} ↗</a>
      {productionSha&&productionSha!==release.sha&&<a href={`${github}/compare/${productionSha.slice(0,12)}...${release.sha.slice(0,12)}`} target="_blank" rel="noreferrer">Изменения относительно production ↗</a>}
    </p>}
    <StepFeed steps={visibleSteps} now={now}/>
  </section>
}

function LegacyReleaseCenter({projectId,baseBranch,owner,releaseTimeouts=DEFAULT_RELEASE_TIMEOUTS,api=window.api,gitUrl}:Props):JSX.Element {
  const [tab,setTabState]=useState<Tab>(storedTab)
  const setTab=(next:Tab):void=>{try{window.localStorage?.setItem(RELEASES_TAB_KEY,next)}catch{}setTabState(next)}
  const github=githubWebUrl(gitUrl)
  const [releasePage,setReleasePage]=useState(1)
  const [deployPage,setDeployPage]=useState(1)
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
  const [releaseMachines,setReleaseMachines]=useState<ReleaseMachine[]>([])
  const [selectedAgentId,setSelectedAgentId]=useState('')
  const [machinesStatus,setMachinesStatus]=useState<LoadStatus>('idle')
  const [machinesError,setMachinesError]=useState('')
  const [version,setVersion]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  // Удаление релиза — необратимое (ветка уходит из origin): подтверждение с набором названия, не window.prompt —
  // нативный диалог блокирует вкладку и не даётся тестам/автоматизации.
  const confirm=useConfirm()
  const refreshMachines=useCallback(async()=>{
    setMachinesStatus('loading');setMachinesError('')
    try{
      const catalog=await api['releases:machines']({projectId})
      setReleaseMachines(catalog.machines)
      const saved=catalog.machines.find(machine=>machine.agentId===catalog.lastAgentId&&machine.eligible)
      setSelectedAgentId((saved??catalog.machines.find(machine=>machine.eligible))?.agentId??'')
      setMachinesStatus('ready')
    }catch(reason){setReleaseMachines([]);setSelectedAgentId('');setMachinesError(reason instanceof Error?reason.message:String(reason));setMachinesStatus('error')}
  },[api,projectId])
  useEffect(()=>{void refreshMachines()},[refreshMachines])
  const selectedMachine=releaseMachines.find(machine=>machine.agentId===selectedAgentId)
  const machineProblem=machinesStatus==='loading'||machinesStatus==='idle'
    ?'Загрузка машин…'
    :machinesStatus==='error'
      ?'Каталог машин недоступен.'
      :releaseMachines.length===0
        ?'Доступных машин нет.'
        :!selectedMachine
          ?'Нет пригодных машин для сборки релиза.'
          :!selectedMachine.eligible
            ?selectedMachine.unavailableReason??'Машина непригодна для сборки релиза.'
            :''
  const [settingsOpen,setSettingsOpen]=useState(false)
  const [timeouts,setTimeouts]=useState(releaseTimeouts)
  const [settingsSaved,setSettingsSaved]=useState(false)
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
  // A running build or deploy in the list keeps the summary live too: before,
  // only the opened detail polled, and the table showed stale «Сборка» forever.
  const anyActive=useMemo(()=>[...releaseItems,...deploymentItems].some(item=>!terminal.has(item.status)),[releaseItems,deploymentItems])
  useEffect(()=>{
    if(!anyActive||detail||detailStatus==='loading')return
    const id=window.setInterval(()=>void refreshReleases(),5000)
    return()=>window.clearInterval(id)
  },[anyActive,detail,detailStatus,refreshReleases])
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
  // Only one build and one deploy run at a time — the server rejects the second
  // request, so the buttons say so up front instead of after a round trip.
  const activePreparation=preparations.find(item=>!terminal.has(item.status))
  const activeDeployment=deployments.find(item=>!terminal.has(item.status))
  const redeploy=Boolean(current&&selected&&current.branch===selected)
  const transition=current&&selected&&current.branch!==selected
    ? compareReleaseBranches(selected,current.branch)===-1
      ?`Будет выполнен откат production с ${current.branch} на ${selected}.`
      :`Будет выполнено обновление production с ${current.branch} на ${selected}.`
    :redeploy?`${selected} уже в production — деплой пересоберёт и перезапустит ту же версию.`:''
  // Suggested next version comes from the branches that already exist: typing
  // it by hand was the usual way to hit «ветка уже существует».
  const suggestion=useMemo(()=>suggestNextReleaseVersion(branches.map(branch=>branch.branch)),[branches])
  const versionTrimmed=version.trim()
  const versionExists=Boolean(versionTrimmed)&&branches.some(branch=>releaseVersion(branch.branch)===versionTrimmed)
  const versionProblem=!versionTrimmed?'':!VERSION_RE.test(versionTrimmed)?'Формат версии: x.y.z без ведущих нулей.':versionExists?`Ветка release/${versionTrimmed} уже существует — выберите другую версию.`:''
  const create=async():Promise<void>=>{setBusy(true);setError('');try{const release=await api['releases:createBranch']({projectId,branch:`release/${versionTrimmed}`,baseBranch,agentId:selectedAgentId});detailRequest.current+=1;setDetailReleaseId(release.id);setDetail(release);setDetailStatus('ready');setVersion('');await refresh()}catch(reason){setError(reason instanceof Error?reason.message:String(reason));await refreshMachines()}finally{setBusy(false)}}
  const saveSettings=async():Promise<void>=>{setBusy(true);setError('');try{await api['projects:update']({id:projectId,releaseTimeouts:timeouts});setSettingsSaved(true);setSettingsOpen(false)}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}}
  const remove=async(release:ProjectReleaseSummary):Promise<void>=>{const ok=await confirm({title:`Удалить релиз ${release.branch}?`,message:`Ветка ${release.branch} будет удалена из origin, запись — из списка. Введите название ветки, чтобы подтвердить.`,variant:'danger',confirmLabel:'Удалить',requireText:release.branch});if(!ok)return;setBusy(true);try{await api['releases:delete']({projectId,releaseId:release.id,branch:release.branch});await refresh()}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}}
  const deploy=async(branch=selected):Promise<void>=>{setBusy(true);setError('');try{const release=await api['releases:deploy']({projectId,branch});detailRequest.current+=1;setDetailReleaseId(release.id);setDetail(release);setDetailStatus('ready');await refresh()}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}}
  // A failed preparation keeps its branch in origin; rebuilding the same
  // version means deleting that branch first — one confirmed action instead of two.
  const rebuild=async(release:ProjectRelease):Promise<void>=>{
    const ok=await confirm({title:`Собрать ${release.branch} заново?`,message:`Ветка ${release.branch} будет удалена из origin и создана снова от ${baseBranch} на машине сборки.`,variant:'danger',confirmLabel:'Удалить и собрать'})
    if(!ok)return
    setBusy(true);setError('')
    try{
      await api['releases:delete']({projectId,releaseId:release.id,branch:release.branch})
      const next=await api['releases:createBranch']({projectId,branch:release.branch,baseBranch,agentId:selectedAgentId})
      detailRequest.current+=1;setDetailReleaseId(next.id);setDetail(next);setDetailStatus('ready');await refresh()
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}
  }
  if(detailStatus==='loading')return <section className="release-detail" aria-busy="true"><button className="vc-btn vc-btn--secondary" onClick={closeDetail}>← К списку</button><RefreshIndicator label="Загружаем подробности релиза…"/><Skeleton variant="list" item="block" count={4} height={49}/></section>
  if(detailStatus==='error')return <section className="release-detail"><button className="vc-btn vc-btn--secondary" onClick={closeDetail}>← К списку</button><ErrorState message="Не удалось загрузить подробности релиза" detail={detailError} onRetry={()=>void openDetail(detailReleaseId)}/></section>
  if(detail)return <>
    {error&&<p role="alert" className="release-alert">{error}</p>}
    <ReleaseDetail release={detail} onBack={closeDetail} github={github} productionSha={current&&current.id!==detail.id?current.sha:null} actions={{
      busy,
      ...(owner&&detail.previousReleaseId?{onRedeploy:()=>void deploy(detail.branch)}:{}),
      ...(owner&&!detail.previousReleaseId&&selectedAgentId?{onRebuild:()=>void rebuild(detail)}:{}),
      ...(detail.previousReleaseId?{onOpenSource:()=>void openDetail(detail.previousReleaseId!)}:{})
    }}/>
  </>
  const settingsButton=owner&&<button className="vc-btn vc-btn--secondary" aria-expanded={settingsOpen} aria-controls="release-settings" onClick={()=>{setSettingsOpen(value=>!value);setSettingsSaved(false)}}>Настройки</button>
  const settingsForm=settingsOpen&&<form id="release-settings" className="release-settings" aria-label="Лимиты этапов релиза" onSubmit={event=>{event.preventDefault();void saveSettings()}}>
    <p className="release-settings-hint">Лимит каждого этапа в секундах. Новые лимиты применяются к следующим сборкам и деплоям; уже идущие ран не меняют.</p>
    <div className="release-settings-grid">{([['checkoutMs','Подготовка checkout'],['knowledgeBaseMs','База знаний'],['regressionMs','Regression (каждая стадия)'],['switchingMs','Переключение checkout'],['buildingMs','Сборка и обновление контейнеров'],['healthCheckMs','Health-check']] as const).map(([key,label])=><label key={key}>{label}, сек.<input type="number" inputMode="numeric" min="1" max="86400" required value={Math.round(timeouts[key]/1000)} onChange={event=>setTimeouts(value=>({...value,[key]:Number(event.target.value)*1000}))}/></label>)}</div>
    <div className="release-settings-actions"><button type="button" className="vc-btn vc-btn--secondary" disabled={busy} onClick={()=>{setTimeouts(releaseTimeouts);setSettingsOpen(false)}}>Отмена</button><button className="vc-btn vc-btn--primary" disabled={busy}>Сохранить</button></div>
  </form>
  return <section className="release-center" aria-label="Релизы и деплой">
    <nav className="release-tabs" role="tablist" aria-label="Разделы релизов" onKeyDown={event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();const next=tab==='releases'?'deploy':'releases';setTab(next);(event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`))?.focus()}}}><button role="tab" data-tab="releases" tabIndex={tab==='releases'?0:-1} aria-selected={tab==='releases'} onClick={()=>setTab('releases')}>Релизы{preparations.some(item=>!terminal.has(item.status))&&<span className="release-tab-live" title="Идёт сборка" aria-hidden="true"/>}</button><button role="tab" data-tab="deploy" tabIndex={tab==='deploy'?0:-1} aria-selected={tab==='deploy'} onClick={()=>setTab('deploy')}>Деплой{deployments.some(item=>!terminal.has(item.status))&&<span className="release-tab-live" title="Идёт деплой" aria-hidden="true"/>}</button></nav>
    {error&&<p role="alert" className="release-alert">{error}</p>}
    {settingsSaved&&<p role="status" className="release-saved">Лимиты сохранены.</p>}
    {!owner&&<p role="status">Недостаточно прав: подготовка релиза и production deploy доступны только администратору.</p>}
    {tab==='releases'?<div className="release-pane">
      <header><div><h2>Релизы</h2><p>Подготовка и история сборок</p></div><span>{releaseView.refreshing&&<RefreshIndicator label="Обновляем релизы…"/>}{settingsButton}<button className="vc-btn vc-btn--secondary" disabled={releaseStatus==='loading'} onClick={()=>void refreshReleases()}>Обновить</button></span></header>
      {settingsForm}
      <div className="release-create"><label>Машина сборки релиза<select aria-label="Машина сборки релиза" value={selectedAgentId} disabled={!owner||busy||machinesStatus==='loading'||releaseMachines.length===0} onChange={event=>setSelectedAgentId(event.target.value)}><option value="" disabled>{machinesStatus==='loading'?'Загрузка машин…':releaseMachines.length===0?'Доступных машин нет':'Выберите машину'}</option>{releaseMachines.map(machine=><option key={machine.agentId} value={machine.agentId} disabled={!machine.eligible}>{machine.name} · {machine.online?'online':'offline'} · {machine.ownership==='mine'?'личная машина':'машина проекта'}{machine.unavailableReason?` · ${machine.unavailableReason}`:''}</option>)}</select></label>{machinesStatus==='error'&&<ErrorState compact message="Не удалось загрузить машины" detail={machinesError} onRetry={()=>void refreshMachines()}/>} {machineProblem&&<p role="alert">{machineProblem}</p>}
        <label>Новая версия<span className="release-version-field"><input value={version} placeholder={suggestion} inputMode="decimal" aria-invalid={Boolean(versionProblem)} aria-describedby="release-version-hint" disabled={!owner} onChange={event=>setVersion(event.target.value)}/>{owner&&versionTrimmed!==suggestion&&<button type="button" className="vc-btn vc-btn--ghost" onClick={()=>setVersion(suggestion)} title={`Подставить следующую версию ${suggestion}`}>{suggestion}</button>}</span></label>
        <button className="vc-btn vc-btn--primary" disabled={!owner||busy||Boolean(machineProblem)||Boolean(versionProblem)||!versionTrimmed||Boolean(activePreparation)} onClick={()=>void create()}>Собрать новый релиз</button>
        <p id="release-version-hint" className={versionProblem?'release-field-error':'release-field-hint'} role={versionProblem?'alert':undefined}>{versionProblem||(activePreparation?`Идёт сборка ${activePreparation.branch} — новую можно запустить после её завершения.`:`Ветка release/${versionTrimmed||suggestion} от ${baseBranch}.`)}</p>
      </div>
      {releaseView.staleError&&<ErrorState compact message="Не удалось обновить релизы" detail={releaseError} onRetry={()=>void refreshReleases()}/>}
      <div className="release-table-wrap" aria-busy={releaseStatus==='loading'}>{releaseView.state==='skeleton'?<Skeleton variant="list" item="block" count={5} height={49}/>:releaseView.state==='error'?<ErrorState message="Не удалось загрузить релизы" detail={releaseError} onRetry={()=>void refreshReleases()}/>:releaseView.state==='empty'?<EmptyState title="Релизов пока нет" description="Соберите новый релиз — он появится в этом списке."/>:<table className="release-table"><thead><tr><th scope="col">Название</th><th scope="col">Дата</th><th scope="col">Время сборки</th><th scope="col">Статус</th><th scope="col">Действия</th></tr></thead><tbody>{preparations.slice(0,releasePage*PAGE).map(release=><tr key={release.id} tabIndex={0} aria-label={`Релиз ${release.branch}, ${statusLabels[release.status]??release.status}`} onClick={()=>void openDetail(release.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void openDetail(release.id)}}}><td data-label="Название"><strong>{release.branch}</strong><small>{release.sha.slice(0,12)||'SHA ещё не зафиксирован'}{current?.branch===release.branch?' · в production':''}</small>{release.failure&&<small className="release-failure">{release.failure}</small>}</td><td data-label="Дата"><time dateTime={new Date(release.createdAt).toISOString()} title={formatDateTime(release.createdAt)}>{formatRelativeTime(release.createdAt)}</time></td><td data-label="Время сборки">{fmtDuration(release.durationMs)}</td><td data-label="Статус"><span className="release-status" data-status={release.status}>{statusLabels[release.status]??release.status}</span></td><td data-label="Действия">{owner&&['ready','failed'].includes(release.status)&&<button className="vc-btn vc-btn--secondary" disabled={current?.branch===release.branch} title={current?.branch===release.branch?'Релиз сейчас в production — сначала задеплойте другой':undefined} onClick={event=>{event.stopPropagation();void remove(release)}}>Удалить</button>}</td></tr>)}</tbody></table>}</div>
      {preparations.length>releasePage*PAGE&&<button className="vc-btn vc-btn--secondary release-more" onClick={()=>setReleasePage(page=>page+1)}>Показать ещё ({preparations.length-releasePage*PAGE})</button>}
    </div>:<div className="release-pane">
      <header><div><h2>Деплой</h2><p>Публикация подготовленного релиза в production</p></div><span>{deploymentView.refreshing&&<RefreshIndicator label="Обновляем деплои…"/>}{settingsButton}<button className="vc-btn vc-btn--secondary" disabled={releaseStatus==='loading'} onClick={()=>void refresh()}>Обновить</button></span></header>
      {settingsForm}
      {current&&current.id!==latestDeploy?.id&&<button className="release-last-deploy release-production" onClick={()=>void openDetail(current.id)}><span>Сейчас в production</span><strong>{current.branch}<small>{current.sha.slice(0,12)} · с {formatDateTime(current.createdAt)}</small></strong><span><span className="release-status" data-status={current.status}>{statusLabels[current.status]??current.status}</span></span></button>}
      {latestDeploy&&<button className="release-last-deploy" onClick={()=>void openDetail(latestDeploy.id)}><span>Последний деплой</span><strong>{latestDeploy.branch}<small>{latestDeploy.sha.slice(0,12)} · {formatDateTime(latestDeploy.createdAt)}{latestDeploy.attempt?` · попытка ${latestDeploy.attempt}`:''}{latestDeploy.id===current?.id?' · сейчас в production':''}</small>{latestDeploy.failure&&<small className="release-failure">{latestDeploy.failure}</small>}</strong><span><span className="release-status" data-status={latestDeploy.status}>{statusLabels[latestDeploy.status]??latestDeploy.status}</span> · {fmtDuration(latestDeploy.durationMs)}</span></button>}
      <div className="release-deploy"><label><span>Релиз{readyBranches.length>0&&<span className="release-count"> · готовых: {readyBranches.length}</span>}</span><select aria-label="Релиз" value={selected} onChange={event=>setSelected(event.target.value)}><option value="" disabled>{readyBranches.length?'Выберите релиз':'Готовых релизов нет'}</option>{readyBranches.map(branch=><option key={branch.branch} value={branch.branch}>{branch.branch} · {branch.sha.slice(0,12)}{current?.branch===branch.branch?' · сейчас в production':''}</option>)}</select></label>{activeDeployment?<p role="status" className="release-transition">Идёт деплой {activeDeployment.branch} ({statusLabels[activeDeployment.status]??activeDeployment.status}) — новый можно запустить после его завершения.</p>:transition&&<p role="status" className="release-transition">{transition}</p>}<button className="vc-btn vc-btn--primary" disabled={!owner||busy||!prepared||Boolean(activeDeployment)} onClick={()=>void deploy()}>{redeploy?'Задеплоить повторно':'Задеплоить'}</button></div>
      {deploymentError&&<ErrorState compact message="Не удалось загрузить release-ветки" detail={deploymentError} onRetry={()=>void refreshBranches()}/>}
      {deploymentView.staleError&&<ErrorState compact message="Не удалось обновить деплои" detail={releaseError} onRetry={()=>void refreshReleases()}/>}
      <div className="release-table-wrap" aria-busy={releaseStatus==='loading'}>{deploymentView.state==='skeleton'?<Skeleton variant="list" item="block" count={5} height={49}/>:deploymentView.state==='error'?<ErrorState message="Не удалось загрузить деплои" detail={releaseError} onRetry={()=>void refreshReleases()}/>:deploymentView.state==='empty'?<EmptyState title="Деплоев пока нет" description="Выберите готовый релиз и опубликуйте его в production."/>:<table className="release-table"><thead><tr><th scope="col">Релиз</th><th scope="col">Дата</th><th scope="col">Длительность</th><th scope="col">Статус</th></tr></thead><tbody>{deployments.slice(0,deployPage*PAGE).map(release=><tr key={release.id} tabIndex={0} aria-label={`Деплой ${release.branch}, ${statusLabels[release.status]??release.status}`} onClick={()=>void openDetail(release.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void openDetail(release.id)}}}><td data-label="Релиз"><strong>{release.branch}</strong><small>{release.sha.slice(0,12)}{release.attempt?` · попытка ${release.attempt}`:''}{release.id===current?.id?' · в production':''}</small>{release.failure&&<small className="release-failure">{release.failure}</small>}</td><td data-label="Дата"><time dateTime={new Date(release.createdAt).toISOString()} title={formatDateTime(release.createdAt)}>{formatRelativeTime(release.createdAt)}</time></td><td data-label="Длительность">{fmtDuration(release.durationMs)}</td><td data-label="Статус"><span className="release-status" data-status={release.status}>{statusLabels[release.status]??release.status}</span></td></tr>)}</tbody></table>}</div>
      {deployments.length>deployPage*PAGE&&<button className="vc-btn vc-btn--secondary release-more" onClick={()=>setDeployPage(page=>page+1)}>Показать ещё ({deployments.length-deployPage*PAGE})</button>}
    </div>}
  </section>
}

export function ReleaseCenter(props:Props):JSX.Element {
  const [mode,setMode]=useState<'legacy'|'applications'>('legacy')
  return <div className="release-shell">
    <nav className="release-mode" role="group" aria-label="Вид выпуска">
      <button type="button" className={mode==='legacy'?'release-mode-button release-mode-button--active':'release-mode-button'} aria-pressed={mode==='legacy'} onClick={()=>setMode('legacy')}>Весь проект</button>
      <button type="button" className={mode==='applications'?'release-mode-button release-mode-button--active':'release-mode-button'} aria-pressed={mode==='applications'} onClick={()=>setMode('applications')}>Приложения</button>
    </nav>
    {mode==='legacy'?<LegacyReleaseCenter {...props}/>:<ApplicationReleaseCenter {...props} api={props.api??window.api}/>}
  </div>
}

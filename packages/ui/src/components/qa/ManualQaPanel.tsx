import { useEffect, useMemo, useRef, useState } from 'react'
import { usePolling } from '@voicechat/ui-kit'
import type { AcceptanceCriterion, AcceptanceCriterionSnapshot, QaCriterionResult, QaResultStatus, QaSession, QaTaskState } from '@shared/qa'
import { canCompleteQa, qaProgress } from '@shared/qa'
import { QaMetadata, QaRefresh, QaImage, useQaRefresh, downloadQaReport, md, reportLink } from './ComponentQaPanel'
import { useQaStageUpdates } from './useQaStageUpdates'
import { useHotkeys } from '../../lib/useHotkeys'
import { Dialog, EmptyState, StatusPill, Button, QaScore } from '@voicechat/ui-kit'
import { ErrorState, Skeleton } from '@voicechat/ui-kit'

export function ManualQaPanel(props: {
  projectId: string; taskId: string; activeRun?: boolean; onFixStarted?: (runId: string) => void
  /** The new card draws sessions as a rail around this panel and needs the same state. */
  onStateChange?: (state: QaTaskState) => void
}): JSX.Element {
  const [state, setState] = useState<QaTaskState | null>(null)
  const onStateChange = props.onStateChange
  useEffect(() => { if (state) onStateChange?.(state) }, [state, onStateChange])
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preparationOpen, setPreparationOpen] = useState(true)
  const [additionalIssues, setAdditionalIssues] = useState('')
  const [pendingResults, setPendingResults] = useState<Record<string, (() => Promise<boolean>) | null>>({})
  const [rework,setRework]=useState<{id:string;description:string}|null>(null)
  const refresh=useQaRefresh(`${props.projectId}:${props.taskId}:manual`)
  const actionInFlight = useRef(false)
  const identityRef = useRef('')
  const [draft, setDraft] = useState<AcceptanceCriterionSnapshot>({
    title: '', description: '', preconditions: '', steps: '', testData: '', expectedResult: '', required: true, testType: 'manual'
  })
  const load = async (): Promise<void> => {
    if (!window.qa) return
    const key = `${props.projectId}:${props.taskId}`
    await refresh.request(()=>window.qa!.get(props.projectId,props.taskId),next=>{if(identityRef.current===key){setState(next);setError('')}},cause=>setError(cause instanceof Error?cause.message:String(cause)))
  }
  useEffect(() => {
    identityRef.current = `${props.projectId}:${props.taskId}`
    setState(null)
    setOpen(null)
    setPendingResults({})
    setRework(null)
    setError('')
    void load()
  }, [props.projectId, props.taskId])
  useEffect(()=>{if(!window.board?.onQaStageUpdated)return window.board?.onReconnect?.(()=>void load())},[props.projectId,props.taskId])
  useQaStageUpdates({projectId:props.projectId,taskId:props.taskId,stage:'manual_qa',onUpdate:()=>void load(),active:!!state?.activeSession})
  useEffect(() => { setAdditionalIssues(state?.activeSession?.additionalIssues ?? '') }, [state?.activeSession?.id])
  useEffect(() => { if (state?.preparation?.status === 'success') setPreparationOpen(false); else if (state?.preparation) setPreparationOpen(true) }, [state?.preparation?.status, state?.preparation?.id])
  usePolling(() => { void load() }, { enabled: state?.preparation?.status === 'running', intervalMs: 2_000 })
  const session = state?.activeSession ?? state?.sessions[0] ?? null
  const progress = useMemo(() => session ? qaProgress(session) : null, [session])

  const update = async (result: QaCriterionResult, status: QaResultStatus, fields: Record<string, unknown> = {}): Promise<void> => {
    if (!window.qa) throw new Error('QA API недоступен')
    try {
      const saved = await window.qa.saveResult(props.projectId, props.taskId, result.id, result.revision, { status, draft: false, ...fields })
      setState((current) => current ? {
        ...current,
        sessions: current.sessions.map((item) => ({ ...item, results: item.results.map((value) => value.id === saved.id ? saved : value) })),
        activeSession: current.activeSession ? { ...current.activeSession, results: current.activeSession.results.map((value) => value.id === saved.id ? saved : value) } : null
      } : current)
      setError('')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      await load()
      throw new Error(message)
    }
  }

  const flushPendingResults = async (): Promise<boolean> => {
    const saves = Object.values(pendingResults).filter((save): save is () => Promise<boolean> => Boolean(save))
    for (const save of saves) if (!await save()) return false
    return true
  }

  const runFinalAction = async (action: 'complete' | 'fix'): Promise<void> => {
    if (!window.qa || actionInFlight.current) return
    actionInFlight.current = true
    setBusy(true)
    setError('')
    try {
      if (!await flushPendingResults()) {
        setError('Не удалось сохранить изменения тестов. Исправьте ошибки и повторите действие.')
        return
      }
      if (action === 'complete') {
        const latest = await window.qa.get(props.projectId, props.taskId)
        if (!latest) throw new Error('QA-сессия недоступна')
        setState(latest)
        const latestSession = latest.activeSession
        if (!latestSession) throw new Error('Активная QA-сессия недоступна')
        const gate = canCompleteQa({ ...latestSession, additionalIssues })
        if (!gate.allowed) throw new Error(completionReason(latestSession, latest.criteria, additionalIssues))
        await window.qa.complete(props.projectId, props.taskId, latestSession.id, 'Ручное QA подтверждено тестировщиком')
      } else {
        const latest = await window.qa.get(props.projectId, props.taskId)
        if (!latest) throw new Error('QA-сессия недоступна')
        setState(latest)
        const latestSession = latest.activeSession
        if (!latestSession) throw new Error('Активная QA-сессия недоступна')
        const failed=latestSession.results.filter(result=>result.status==='failed')
        if(!failed.length) throw new Error('Нет проваленных сценариев для доработки')
        const description=failed.map(result=>{
          const criterion=latest.versions.find(item=>item.criterionId===result.criterionId&&item.version===result.criterionVersion) ?? latest.criteria.find(item=>item.id===result.criterionId&&item.currentVersion===result.criterionVersion)
          return `## ${criterion?.title??result.criterionId}\nШаги:\n${criterion?.steps??result.executedSteps}\nКомментарий:\n${result.comment}\nФактический результат:\n${result.actualResult}`
        }).join('\n\n')
        const created=await window.api['tasks:createReworkDraft']({projectId:props.projectId,taskId:props.taskId,input:{description,criteria:[],makeSources:[],uploadIds:[]}})
        setRework({id:created.id,description})
      }
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      actionInFlight.current = false
      setBusy(false)
    }
  }

  if(!window.qa)return <EmptyState compact title="Ручное QA недоступно" description="Мост QA не подключён в этой сборке."/>
  return <section className="manual-qa" aria-label="Ручное QA">
    <QaRefresh {...refresh} onRefresh={()=>void load()}/>
    {session&&<><QaMetadata run={session}/><StatusPill tone={session.status==='passed'?'success':session.status==='failed'?'danger':'neutral'}>{session.status==='active'?'Выполняется':session.status==='passed'?'Пройден':session.status==='failed'?'Ошибка':'Устарел'}</StatusPill><Button size="sm" onClick={()=>downloadQaReport(session.id,manualQaReport(session,state!.criteria,state!.versions))}>Скачать отчёт</Button></>}
    {rework&&<Dialog title="Проверить черновик доработки" padded onClose={()=>{if(!busy)setRework(null)}} footer={<Button loading={busy} onClick={async()=>{
      if(actionInFlight.current)return
      actionInFlight.current=true;setBusy(true)
      try { await window.api['tasks:submitReworkDraft']({projectId:props.projectId,taskId:props.taskId,cycleId:rework.id});setRework(null);await load() }
      catch(cause){setError(cause instanceof Error?cause.message:String(cause))}
      finally{actionInFlight.current=false;setBusy(false)}
    }}>Отправить черновик</Button>}><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{rework.description}</pre></Dialog>}
    {/* Заголовок секции не дублирует имя вкладки — оно уже стоит в полосе. */}
    {error && <ErrorState compact message="Не удалось загрузить ручное QA" detail={error} onRetry={() => void load()} />}
    {!state ? <>
      <span className="vc-sr-only" aria-live="polite">Загрузка ручного QA…</span>
      <Skeleton variant="list" count={3} item="block" height={64} gap={10} />
    </> : <>
      {!state.preparation && <div className="manual-qa-summary"><strong>Создание сценариев не запущено</strong><span>Ожидаем завершения разработки.</span></div>}
      {state.preparation && <details className="manual-qa-preparation" open={preparationOpen} onToggle={(event) => setPreparationOpen(event.currentTarget.open)}>
        <summary><strong>{state.preparation.status === 'running' ? (state.preparation.attempt > 1 ? 'Повторное создание сценариев' : 'Создаём сценарии') : state.preparation.status === 'success' ? 'Сценарии созданы' : 'Не удалось создать сценарии'}</strong> · попытка {state.preparation.attempt} · {new Date(state.preparation.createdAt).toLocaleString()} · {formatDuration((state.preparation.finishedAt ?? Date.now()) - state.preparation.createdAt)}</summary>
        {state.preparation.status === 'running' && <div className="manual-qa-summary" role="status"><span className="manual-qa-spinner" aria-hidden /> <span>Попытка {state.preparation.attempt} из {state.preparation.maxAttempts}</span></div>}
        <details><summary>Лог подготовки</summary><pre className="merge-terminal merge-terminal--log">{state.preparation.log || 'Ожидаем вывод модели…'}</pre></details>
        {state.preparation.attempts.length > 0 && <details><summary>Диагностика попыток</summary><pre className="merge-terminal">{state.preparation.attempts.map((item) => `Попытка ${item.attempt}: ${item.status}${item.error ? ` — ${item.error}` : ''}\n${item.rawResponse}`).join('\n\n')}</pre></details>}
      </details>}
      {state.preparation?.status === 'failed' && <div className="err" role="alert">
        <strong>Не удалось создать сценарии</strong>
        <p>{state.preparation.error || 'Модель не вернула валидные сценарии'}</p>
        <Button size="sm" disabled={busy || !state.preparation.canRetry || !window.qa?.retryPreparation} onClick={async () => {
          if (!window.qa?.retryPreparation) return
          setBusy(true)
          try { await window.qa.retryPreparation(props.projectId, props.taskId); await load() }
          catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
          finally { setBusy(false) }
        }}>Повторить создание сценариев</Button>
      </div>}
      {session && progress && <QaScore
        testId="manual-qa-score"
        passed={progress.passed}
        total={progress.total}
        unit="сценариев"
        tone={session.status === 'failed' ? 'danger' : session.status === 'stale' ? 'warning' : undefined}
      />}
      {session && progress && <div className="manual-qa-summary">
        <strong>{session.status === 'stale' ? 'QA-сессия устарела' : session.status === 'passed' ? 'QA завершено успешно' : session.status === 'failed' ? 'Задача отправлена на доработку' : `Проверено ${progress.passed + progress.failed + progress.blocked + progress.notApplicable}/${progress.total}`}</strong>
        <span>SHA {session.commitSha.slice(0, 8)}</span>
        {session.previewSha && <span>Preview {session.previewSha.slice(0, 8)}</span>}
        {session.staleReason && <span role="alert">{session.staleReason}</span>}
        {session.appUrl && <a href={session.appUrl} target="_blank" rel="noreferrer">Открыть preview</a>}
        {session.storybookUrl && <a href={session.storybookUrl} target="_blank" rel="noreferrer">Открыть Storybook</a>}
        <span>Всего: {progress.total} · Проверено: {progress.passed + progress.failed + progress.blocked + progress.notApplicable} · Успешно: {progress.passed} · Неуспешно: {progress.failed} · Заблокировано: {progress.blocked} · Осталось: {progress.notTested + progress.inProgress + progress.stale}</span>
      </div>}
      {state.preparation?.status !== 'running' && <details className="manual-qa-create">
        <summary>Добавить сценарий ручного QA</summary>
        <div className="manual-qa-create__form">
          <label>Название сценария<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Цель и описание<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label>Предусловия и URL<textarea value={draft.preconditions} onChange={(event) => setDraft({ ...draft, preconditions: event.target.value })} placeholder="Открыть https://…; войти тестовым пользователем" /></label>
          <label>Подробные действия<textarea value={draft.steps} onChange={(event) => setDraft({ ...draft, steps: event.target.value })} placeholder={'1. Открыть URL\n2. Нажать кнопку…\n3. Заполнить форму…'} /></label>
          <label>Данные для заполнения<textarea value={draft.testData} onChange={(event) => setDraft({ ...draft, testData: event.target.value })} /></label>
          <label>Ожидаемый результат<textarea value={draft.expectedResult} onChange={(event) => setDraft({ ...draft, expectedResult: event.target.value })} /></label>
          <label><input type="checkbox" checked={draft.required} onChange={(event) => setDraft({ ...draft, required: event.target.checked })} /> Обязательный сценарий</label>
          <Button variant="primary" size="sm" disabled={busy || !draft.title.trim() || !draft.steps.trim() || !draft.expectedResult.trim()} onClick={async () => {
            if (!window.qa) return
            setBusy(true)
            try {
              await window.qa.createCriterion(props.projectId, props.taskId, draft)
              setDraft({ title: '', description: '', preconditions: '', steps: '', testData: '', expectedResult: '', required: true, testType: 'manual' })
              await load()
            } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
            finally { setBusy(false) }
          }}>Сохранить сценарий</Button>
        </div>
      </details>}
      {state.preparation?.status !== 'running' && (!state.criteria.length ? <p className="muted">Структурированные критерии ещё не добавлены.</p> :
        <div className="manual-qa-list" role="list">
          {state.criteria.filter((criterion) => criterion.active).map((criterion) =>
            <CriterionCard key={`${props.taskId}:${session?.id}:${criterion.id}`} criterion={criterion} result={session?.results.find((result) => result.criterionId === criterion.id) ?? null}
              open={open === criterion.id} onToggle={() => setOpen(open === criterion.id ? null : criterion.id)}
              onUpdate={update} onPendingChange={(save) => setPendingResults((current) => ({ ...current, [criterion.id]: save }))} onAttach={async (result, file) => {
                if (!window.qa || !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Допустимы PNG, JPEG и WebP до 10 МБ')
                setBusy(true)
                try {
                  const dataBase64 = await fileBase64(file)
                  const upload = await window.api['uploads:add']({ name: file.name, mimeType: file.type, dataBase64 })
                  await window.qa.addAttachment(props.projectId, props.taskId, result.id, upload.id, file.name)
                  await load()
                } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause }
                finally { setBusy(false) }
              }} disabled={busy || session?.status !== 'active' || state.canEdit === false} />
          )}
        </div>)}
      {!state.activeSession && state.criteria.some((criterion) => criterion.active) && <Button disabled={busy} onClick={async () => {
        if (!window.qa) return
        setBusy(true)
        try { setState(await window.qa.completePreparation(props.projectId, props.taskId)); setError('') }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
        finally { setBusy(false) }
      }}>Сценарии готовы — перейти в ручное QA</Button>}
      {state.activeSession && <label className="manual-qa-additional">Дополнительные баги и недоработки<textarea value={additionalIssues} disabled={busy || state.canEdit === false} onChange={(event) => setAdditionalIssues(event.target.value)} onBlur={async () => { if (!window.qa?.saveAdditionalIssues || additionalIssues === (state.activeSession?.additionalIssues ?? '')) return; setBusy(true); try { await window.qa.saveAdditionalIssues(props.projectId, props.taskId, state.activeSession!.id, additionalIssues); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }} /></label>}
      {state.activeSession && <div className="manual-qa-final-actions">
        <Button variant="primary" disabled={busy || state.canEdit === false || props.activeRun} onClick={() => void runFinalAction('fix')}>Отправить на доработку</Button>
        <Button variant="primary" disabled={busy || state.canEdit === false} onClick={() => void runFinalAction('complete')}>Следующий этап</Button>
      </div>}
      {state.activeSession && (Object.values(pendingResults).some(Boolean) || !canCompleteQa({ ...state.activeSession, additionalIssues }).allowed) && <p className="muted">{Object.values(pendingResults).some(Boolean) ? 'Есть несохранённые изменения — перед переходом они будут сохранены' : completionReason(state.activeSession, state.criteria, additionalIssues)}</p>}
    </>}
  </section>
}

function CriterionCard(props: {
  criterion: AcceptanceCriterion; result: QaCriterionResult | null; open: boolean; disabled: boolean
  onToggle(): void
  onPendingChange(save: (() => Promise<boolean>) | null): void
  onAttach(result: QaCriterionResult, file: File): Promise<void>
  onUpdate(result: QaCriterionResult, status: QaResultStatus, fields?: Record<string, unknown>): Promise<void>
}): JSX.Element {
  const [comment, setComment] = useState(props.result?.comment ?? '')
  const [selected, setSelected] = useState<QaResultStatus>(props.result?.status ?? 'not_tested')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [dirty, setDirty] = useState(false)
  const card=useRef<HTMLDivElement>(null)
  const inFlight=useRef<Promise<boolean>|null>(null)
  const [uploadError,setUploadError]=useState('')
  const uploading=useRef(false)
  useEffect(() => {
    if (dirty || saving) return
    setComment(props.result?.comment ?? '')
    setSelected(props.result?.status ?? 'not_tested')
  }, [props.result?.revision, dirty, saving])
  const result = props.result
  const commentRequired = selected === 'failed' || selected === 'blocked'
  const commentId = `qa-comment-${props.criterion.id}`
  const errorId = `qa-error-${props.criterion.id}`
  const performSave = async (status: QaResultStatus = selected, value: string = comment): Promise<boolean> => {
    if (!result || saving) return false
    if ((status === 'failed' || status === 'blocked') && !value.trim()) {
      setSaveError(status === 'blocked' ? 'Укажите причину блокировки' : 'Опишите фактический результат или отличие от ожидания')
      return false
    }
    setSaving(true)
    setSaveError('')
    try {
      const fields = status === 'failed'
        ? { comment: value, actualResult: value, classification: 'implementation_defect', severity: 'major', frequency: 'unknown', reproduction: value }
        : status === 'blocked'
          ? { comment: value, blockerReason: value, blockerType: 'other', blockerOwner: 'Не назначен' }
          : { comment: value }
      await props.onUpdate(result, status, fields)
      setDirty(false)
      props.onPendingChange(null)
      return true
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setSaving(false)
    }
  }
  const save = (status:QaResultStatus=selected,value:string=comment):Promise<boolean>=>{
    if(inFlight.current)return inFlight.current
    const promise=performSave(status,value).finally(()=>{inFlight.current=null})
    inFlight.current=promise
    return promise
  }
  useEffect(()=>{
    if(!dirty||saving||saveError||props.disabled)return
    const timer=window.setTimeout(()=>void save(),700)
    return ()=>clearTimeout(timer)
  },[dirty,selected,comment,saving,saveError,props.disabled])
  useHotkeys({enabled:false,onPushStart:()=>{},onPushEnd:()=>{},onEscape:()=>{},bindings:([
    ['1','passed'],['2','failed'],['3','blocked']
  ] as const).map(([combo,status])=>({combo,enabled:()=>props.open&&!props.disabled&&!saving&&!!card.current?.contains(document.activeElement),onDown:()=>choose(status)}))})
  const attach=async(file:File)=>{
    if(!result||props.disabled||uploading.current)return
    uploading.current=true;setUploadError('')
    try {await props.onAttach(result,file)}
    catch(cause){setUploadError(cause instanceof Error?cause.message:String(cause))}
    finally{uploading.current=false}
  }
  const choose = (status: QaResultStatus): void => {
    setSelected(status)
    setDirty(status !== result?.status || comment !== (result?.comment ?? ''))
    props.onPendingChange(status !== result?.status || comment !== (result?.comment ?? '') ? () => save(status, comment) : null)
    setSaveError('')
  }
  return <div ref={card} className="manual-qa-card" role="listitem" data-status={selected} onPaste={event=>{
    if(props.disabled)return
    const file=Array.from(event.clipboardData.items).find(item=>item.kind==='file'&&item.type.startsWith('image/'))?.getAsFile()
    if(file){event.preventDefault();void attach(file)}
  }}>
    <button className="manual-qa-card__head" aria-expanded={props.open} onClick={props.onToggle}>
      <span>Тест {props.criterion.order}. {props.criterion.title} {!props.criterion.required && <small>необязательный</small>}</span>
      <span>{resultStatusLabel(selected)} · v{props.criterion.currentVersion}</span>
    </button>
    <p className="manual-qa-card__description">{props.criterion.description || 'Описание не указано'}</p>
    {props.open && <div className="manual-qa-card__details">
      <dl>
        <dt>Предусловия</dt><dd>{props.criterion.preconditions || '—'}</dd>
        <dt>Шаги</dt><dd>{props.criterion.steps || '—'}</dd>
        <dt>Тестовые данные</dt><dd>{props.criterion.testData || '—'}</dd>
        <dt>Ожидаемый результат</dt><dd>{props.criterion.expectedResult}</dd>
      </dl>
    </div>}
    {result && <div className="manual-qa-card__body">
      <div className="manual-qa-actions" role="group" aria-label={`Результат теста ${props.criterion.title}`}>
        <Button size="sm" variant={selected === 'passed' ? 'primary' : undefined} aria-pressed={selected === 'passed'} disabled={props.disabled || saving} onClick={() => choose('passed')}>Работает</Button>
        <Button size="sm" variant={selected === 'blocked' ? 'primary' : undefined} aria-pressed={selected === 'blocked'} disabled={props.disabled || saving} onClick={() => choose('blocked')}>Нет возможности проверить</Button>
        <Button size="sm" variant={selected === 'failed' ? 'primary' : undefined} aria-pressed={selected === 'failed'} disabled={props.disabled || saving} onClick={() => choose('failed')}>Не работает</Button>
      </div>
      <label htmlFor={commentId}>Комментарий{commentRequired ? ' (обязательно)' : ''}</label>
      <textarea id={commentId} value={comment} disabled={props.disabled || saving} aria-invalid={Boolean(saveError)} aria-describedby={saveError ? errorId : undefined} onChange={(event) => { const value = event.target.value; setComment(value); setDirty(true); props.onPendingChange(() => save(selected, value)); setSaveError('') }} placeholder="Фактический результат, наблюдения, шаг ошибки или причина блокировки" />
      <div className="manual-qa-save-state" role="status">{uploadError ? 'Скриншот не сохранён' : saving ? 'Сохраняем…' : saveError ? 'Не сохранено' : dirty ? 'Есть несохранённые изменения' : result.status==='not_tested' ? 'Выберите результат' : result.draft ? 'Черновик' : `Сохранено: ${resultStatusLabel(result.status)}`}</div>
      {saveError && <div id={errorId} className="err" role="alert">{saveError}</div>}
      {!props.disabled && <Button size="sm" variant="primary" disabled={saving || !dirty} onClick={() => { void save() }}>{saveError ? 'Повторить сохранение' : 'Сохранить результат'}</Button>}
      <label>Скриншоты<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={props.disabled || saving} onChange={(event) => { void (async()=>{for (const file of Array.from(event.currentTarget.files ?? [])) await attach(file)})() }} /></label>
      {uploadError&&<p role="alert">Скриншот не сохранён: {uploadError}</p>}
      {result.attachments.length > 0 && <div>{result.attachments.map((attachment) => <QaImage key={attachment.id} url={`/api/qa/attachments/${attachment.id}`} name={attachment.caption || attachment.name}/>)}</div>}
      {result.issue && <div>Связанный дефект: {result.issue.classification} · {result.issue.reproduction}</div>}
    </div>}
  </div>
}

export function manualQaReport(session:QaSession,criteria:AcceptanceCriterion[],versions:import('@shared/qa').AcceptanceCriterionVersion[]=[]):string {
  return ['# Ручное QA',md(session.id),md(session.branch),md(session.commitSha),...session.results.map(result=>{
    const criterion=versions.find(item=>item.criterionId===result.criterionId&&item.version===result.criterionVersion)??criteria.find(item=>item.id===result.criterionId&&item.currentVersion===result.criterionVersion)
    return [`## ${md(criterion?.title??result.criterionId)}`,resultStatusLabel(result.status),md(criterion?.steps??result.executedSteps),md(result.comment),md(result.actualResult),...result.attachments.map(item=>reportLink(item.name,`/api/qa/attachments/${item.id}`))].join('\n\n')
  })].join('\n\n')
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`
}

function resultStatusLabel(status?: QaResultStatus): string {
  if (status === 'passed') return 'Работает'
  if (status === 'failed') return 'Не работает'
  if (status === 'blocked') return 'Нет возможности проверить'
  if (status === 'not_applicable') return 'Не применимо'
  return 'Без результата'
}

function completionReason(session: QaSession, criteria: AcceptanceCriterion[], additionalIssues: string): string {
  if (session.status !== 'active') return session.status === 'stale' ? 'QA-сессия устарела после изменения кода' : 'QA-сессия уже завершена'
  if (additionalIssues.trim()) return 'Есть дополнительные баги — задачу нельзя отправить на merge'
  const failed = session.results.find((result) => result.status === 'failed')
  if (failed) return `Тест «${criteria.find((item) => item.id === failed.criterionId)?.title ?? 'Без названия'}» не работает${failed.comment.trim() ? '' : ' — заполните описание ошибки'}`
  const blocked = session.results.find((result) => result.status === 'blocked')
  if (blocked) return `Тест «${criteria.find((item) => item.id === blocked.criterionId)?.title ?? 'Без названия'}» невозможно проверить${blocked.comment.trim() ? '' : ' — укажите причину'}`
  const remaining = session.criteriaSnapshot.filter((item) => {
    const result = session.results.find((value) => value.criterionId === item.criterionId && value.criterionVersion === item.version)
    return item.required && result?.status !== 'passed'
  })
  return remaining.length ? `Осталось проверить ${remaining.length} тестов` : ''
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать скриншот'))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(file)
  })
}

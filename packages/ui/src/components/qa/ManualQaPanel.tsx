import { useEffect, useMemo, useState } from 'react'
import type { AcceptanceCriterion, AcceptanceCriterionSnapshot, QaCriterionResult, QaResultStatus, QaSession, QaTaskState } from '@shared/qa'
import { canCompleteQa, qaProgress } from '@shared/qa'
import { Button } from '@voicechat/ui-kit'

export function ManualQaPanel(props: { projectId: string; taskId: string; activeRun?: boolean; onFixStarted?: (runId: string) => void }): JSX.Element {
  const [state, setState] = useState<QaTaskState | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preparationOpen, setPreparationOpen] = useState(true)
  const [additionalIssues, setAdditionalIssues] = useState('')
  const [pendingResults, setPendingResults] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<AcceptanceCriterionSnapshot>({
    title: '', description: '', preconditions: '', steps: '', testData: '', expectedResult: '', required: true, testType: 'manual'
  })
  const load = async (): Promise<void> => {
    if (!window.qa) return
    try { setState(await window.qa.get(props.projectId, props.taskId)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  useEffect(() => { void load() }, [props.projectId, props.taskId])
  useEffect(() => { setAdditionalIssues(state?.activeSession?.additionalIssues ?? '') }, [state?.activeSession?.id])
  useEffect(() => { if (state?.preparation?.status === 'success') setPreparationOpen(false); else if (state?.preparation) setPreparationOpen(true) }, [state?.preparation?.status, state?.preparation?.id])
  useEffect(() => {
    if (state?.preparation?.status !== 'running') return
    const timer = window.setTimeout(() => { void load() }, 2_000)
    return () => window.clearTimeout(timer)
  }, [state?.preparation?.status, state?.preparation?.attempt])
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
      throw new Error(message)
    }
  }

  return <section className="manual-qa" aria-label="Ручное QA">
    <h3 className="jmodal-h">Ручное QA</h3>
    {error && <div className="err" role="alert">{error}</div>}
    {!state ? <p>Загрузка QA…</p> : <>
      {!state.preparation && <div className="manual-qa-summary"><strong>Создание сценариев не запущено</strong><span>Ожидаем завершения разработки.</span></div>}
      {state.preparation && <details className="manual-qa-preparation" open={preparationOpen} onToggle={(event) => setPreparationOpen(event.currentTarget.open)}>
        <summary><strong>{state.preparation.status === 'running' ? (state.preparation.attempt > 1 ? 'Повторное создание сценариев' : 'Создаём сценарии') : state.preparation.status === 'success' ? 'Сценарии созданы' : 'Не удалось создать сценарии'}</strong> · попытка {state.preparation.attempt} · {new Date(state.preparation.createdAt).toLocaleString()} · {formatDuration((state.preparation.finishedAt ?? Date.now()) - state.preparation.createdAt)}</summary>
        {state.preparation.status === 'running' && <div className="manual-qa-summary" role="status"><span className="manual-qa-spinner" aria-hidden /> <span>Попытка {state.preparation.attempt} из {state.preparation.maxAttempts}</span></div>}
        <pre className="merge-terminal merge-terminal--log">{state.preparation.log || 'Ожидаем вывод модели…'}</pre>
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
            <CriterionCard key={criterion.id} criterion={criterion} result={session?.results.find((result) => result.criterionId === criterion.id) ?? null}
              open={open === criterion.id} onToggle={() => setOpen(open === criterion.id ? null : criterion.id)}
              onUpdate={update} onPendingChange={(pending) => setPendingResults((current) => ({ ...current, [criterion.id]: pending }))} onAttach={async (result, file) => {
                if (!window.qa || !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('Допустимы PNG, JPEG и WebP до 10 МБ'); return }
                setBusy(true)
                try {
                  const dataBase64 = await fileBase64(file)
                  const upload = await window.api['uploads:add']({ name: file.name, mimeType: file.type, dataBase64 })
                  await window.qa.addAttachment(props.projectId, props.taskId, result.id, upload.id, file.name)
                  await load()
                } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
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
      {state.activeSession && progress && (progress.failed > 0 || additionalIssues.trim()) && <Button variant="primary" disabled={busy || state.canEdit === false || props.activeRun || state.activeSession.results.some((result) => result.status === 'failed' && !result.comment.trim())} onClick={async () => {
        if (!window.qa) return
        setBusy(true)
        try { const run = await window.qa.requestFix(props.projectId, props.taskId, state.activeSession!.id); props.onFixStarted?.(run.id); await load() }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
        finally { setBusy(false) }
      }}>Отправить на доработку</Button>}
      {state.activeSession && <Button variant="primary" disabled={busy || state.canEdit === false || Object.values(pendingResults).some(Boolean) || !canCompleteQa({ ...state.activeSession, additionalIssues }).allowed} onClick={async () => {
        if (!window.qa) return
        setBusy(true)
        try { await window.qa.complete(props.projectId, props.taskId, state.activeSession!.id, 'Ручное QA подтверждено тестировщиком'); await load() }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
        finally { setBusy(false) }
      }}>Прошёл тестирование</Button>}
      {state.activeSession && !canCompleteQa({ ...state.activeSession, additionalIssues }).allowed && <p className="muted">{completionReason(state.activeSession, state.criteria, additionalIssues)}</p>}
    </>}
  </section>
}

function CriterionCard(props: {
  criterion: AcceptanceCriterion; result: QaCriterionResult | null; open: boolean; disabled: boolean
  onToggle(): void
  onPendingChange(pending: boolean): void
  onAttach(result: QaCriterionResult, file: File): Promise<void>
  onUpdate(result: QaCriterionResult, status: QaResultStatus, fields?: Record<string, unknown>): Promise<void>
}): JSX.Element {
  const [comment, setComment] = useState(props.result?.comment ?? '')
  const [selected, setSelected] = useState<QaResultStatus>(props.result?.status ?? 'not_tested')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (dirty || saving) return
    setComment(props.result?.comment ?? '')
    setSelected(props.result?.status ?? 'not_tested')
  }, [props.result?.revision, dirty, saving])
  const result = props.result
  const commentRequired = selected === 'failed' || selected === 'blocked'
  const commentId = `qa-comment-${props.criterion.id}`
  const errorId = `qa-error-${props.criterion.id}`
  const save = async (): Promise<void> => {
    if (!result || saving) return
    if (commentRequired && !comment.trim()) {
      setSaveError(selected === 'blocked' ? 'Укажите причину блокировки' : 'Опишите фактический результат или отличие от ожидания')
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const fields = selected === 'failed'
        ? { comment, actualResult: comment, classification: 'implementation_defect', severity: 'major', frequency: 'unknown', reproduction: comment }
        : selected === 'blocked'
          ? { comment, blockerReason: comment, blockerType: 'other', blockerOwner: 'Не назначен' }
          : { comment }
      await props.onUpdate(result, selected, fields)
      setDirty(false)
      props.onPendingChange(false)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }
  const choose = (status: QaResultStatus): void => {
    setSelected(status)
    setDirty(status !== result?.status || comment !== (result?.comment ?? ''))
    props.onPendingChange(status !== result?.status || comment !== (result?.comment ?? ''))
    setSaveError('')
  }
  return <article className="manual-qa-card" role="listitem" data-status={selected}>
    <button className="manual-qa-card__head" aria-expanded={props.open} onClick={props.onToggle}>
      <span>Тест {props.criterion.order}. {props.criterion.title} {!props.criterion.required && <small>необязательный</small>}</span>
      <span>{resultStatusLabel(selected)} · v{props.criterion.currentVersion}</span>
    </button>
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
        <Button size="sm" variant={selected === 'passed' ? 'primary' : undefined} aria-pressed={selected === 'passed'} disabled={props.disabled || saving} onClick={() => choose('passed')}>Успешно</Button>
        <Button size="sm" variant={selected === 'failed' ? 'primary' : undefined} aria-pressed={selected === 'failed'} disabled={props.disabled || saving} onClick={() => choose('failed')}>Неуспешно</Button>
        <Button size="sm" variant={selected === 'blocked' ? 'primary' : undefined} aria-pressed={selected === 'blocked'} disabled={props.disabled || saving} onClick={() => choose('blocked')}>Заблокировано</Button>
        {!props.criterion.required && <Button size="sm" variant={selected === 'not_applicable' ? 'primary' : undefined} aria-pressed={selected === 'not_applicable'} disabled={props.disabled || saving} onClick={() => choose('not_applicable')}>Пропустить</Button>}
      </div>
      <label htmlFor={commentId}>Комментарий{commentRequired ? ' (обязательно)' : ''}</label>
      <textarea id={commentId} value={comment} disabled={props.disabled || saving} aria-invalid={Boolean(saveError)} aria-describedby={saveError ? errorId : undefined} onChange={(event) => { setComment(event.target.value); setDirty(true); props.onPendingChange(true); setSaveError('') }} placeholder="Фактический результат, наблюдения, шаг ошибки или причина блокировки" />
      <div className="manual-qa-save-state" role="status">{saving ? 'Сохраняем…' : saveError ? 'Не сохранено' : dirty ? 'Есть несохранённые изменения' : result.draft ? 'Черновик' : `Сохранено: ${resultStatusLabel(result.status)}`}</div>
      {saveError && <div id={errorId} className="err" role="alert">{saveError}</div>}
      {!props.disabled && <Button size="sm" variant="primary" disabled={saving || !dirty} onClick={() => void save()}>{saveError ? 'Повторить сохранение' : 'Сохранить результат'}</Button>}
      <label>Скриншоты<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={props.disabled || saving} onChange={(event) => { for (const file of Array.from(event.currentTarget.files ?? [])) void props.onAttach(result, file) }} /></label>
      {result.attachments.length > 0 && <div>{result.attachments.map((attachment) => <a key={attachment.id} href={`/api/qa/attachments/${attachment.id}`} target="_blank" rel="noreferrer">{attachment.caption || attachment.name}</a>)}</div>}
      {result.issue && <div>Связанный дефект: {result.issue.classification} · {result.issue.reproduction}</div>}
    </div>}
  </article>
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`
}

function resultStatusLabel(status?: QaResultStatus): string {
  if (status === 'passed') return 'Успешно'
  if (status === 'failed') return 'Ошибка'
  if (status === 'not_applicable') return 'Пропущен'
  return 'Без результата'
}

function completionReason(session: QaSession, criteria: AcceptanceCriterion[], additionalIssues: string): string {
  if (session.status !== 'active') return session.status === 'stale' ? 'QA-сессия устарела после изменения кода' : 'QA-сессия уже завершена'
  if (additionalIssues.trim()) return 'Есть дополнительные баги — задачу нельзя отправить на merge'
  const failed = session.results.find((result) => result.status === 'failed')
  if (failed) return `Обнаружены ошибки — задачу нельзя отправить на merge${failed.comment.trim() ? '' : `. Заполните описание ошибки для теста «${criteria.find((item) => item.id === failed.criterionId)?.title ?? 'Без названия'}»`}`
  const remaining = session.criteriaSnapshot.filter((item) => {
    const result = session.results.find((value) => value.criterionId === item.criterionId && value.criterionVersion === item.version)
    return item.required ? result?.status !== 'passed' : !result || !['passed', 'not_applicable'].includes(result.status)
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

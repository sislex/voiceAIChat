import { useEffect, useMemo, useState } from 'react'
import type { AcceptanceCriterion, QaCriterionResult, QaResultStatus, QaTaskState } from '@shared/qa'
import { canCompleteQa, qaProgress } from '@shared/qa'
import { Button } from '../ui/Button'

export function ManualQaPanel(props: { projectId: string; taskId: string }): JSX.Element {
  const [state, setState] = useState<QaTaskState | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async (): Promise<void> => {
    if (!window.qa) return
    try { setState(await window.qa.get(props.projectId, props.taskId)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  useEffect(() => { void load() }, [props.projectId, props.taskId])
  const session = state?.activeSession ?? state?.sessions[0] ?? null
  const progress = useMemo(() => session ? qaProgress(session) : null, [session])

  const update = async (result: QaCriterionResult, status: QaResultStatus, fields: Record<string, unknown> = {}): Promise<void> => {
    if (!window.qa) return
    setBusy(true)
    try {
      await window.qa.saveResult(props.projectId, props.taskId, result.id, result.revision, { status, draft: false, ...fields })
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return <section className="manual-qa" aria-label="Ручное QA">
    <h3 className="jmodal-h">Ручное QA</h3>
    {error && <div className="err" role="alert">{error}</div>}
    {!state ? <p>Загрузка QA…</p> : <>
      {session && progress && <div className="manual-qa-summary">
        <strong>{session.status === 'stale' ? 'Session устарела' : `Прогресс ${progress.passed + progress.notApplicable}/${progress.total}`}</strong>
        <span>SHA {session.commitSha.slice(0, 8)}</span>
        {session.previewSha && <span>Preview {session.previewSha.slice(0, 8)}</span>}
        {session.staleReason && <span role="alert">{session.staleReason}</span>}
        {session.appUrl && <a href={session.appUrl} target="_blank" rel="noreferrer">Открыть preview</a>}
        {session.storybookUrl && <a href={session.storybookUrl} target="_blank" rel="noreferrer">Открыть Storybook</a>}
        <span>Passed {progress.passed} · Failed {progress.failed} · Blocked {progress.blocked} · N/A {progress.notApplicable} · Не проверено {progress.notTested}</span>
      </div>}
      {!state.criteria.length ? <p className="muted">Структурированные критерии ещё не добавлены.</p> :
        <div className="manual-qa-list" role="list">
          {state.criteria.filter((criterion) => criterion.active).map((criterion) =>
            <CriterionCard key={criterion.id} criterion={criterion} result={session?.results.find((result) => result.criterionId === criterion.id) ?? null}
              open={open === criterion.id} onToggle={() => setOpen(open === criterion.id ? null : criterion.id)}
              onUpdate={update} onAttach={async (result, file) => {
                if (!window.qa || !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('Допустимы PNG, JPEG и WebP до 10 МБ'); return }
                setBusy(true)
                try {
                  const dataBase64 = await fileBase64(file)
                  const upload = await window.api['uploads:add']({ name: file.name, mimeType: file.type, dataBase64 })
                  await window.qa.addAttachment(props.projectId, props.taskId, result.id, upload.id, file.name)
                  await load()
                } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
                finally { setBusy(false) }
              }} disabled={busy || session?.status !== 'active'} />
          )}
        </div>}
      {state.activeSession && canCompleteQa(state.activeSession).allowed && <Button variant="primary" disabled={busy} onClick={async () => {
        if (!window.qa) return
        setBusy(true)
        try { await window.qa.complete(props.projectId, props.taskId, state.activeSession!.id, 'Ручное QA подтверждено тестировщиком'); await load() }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
        finally { setBusy(false) }
      }}>Завершить QA и ожидать мержа</Button>}
    </>}
  </section>
}

function CriterionCard(props: {
  criterion: AcceptanceCriterion; result: QaCriterionResult | null; open: boolean; disabled: boolean
  onToggle(): void
  onAttach(result: QaCriterionResult, file: File): Promise<void>
  onUpdate(result: QaCriterionResult, status: QaResultStatus, fields?: Record<string, unknown>): Promise<void>
}): JSX.Element {
  const [actual, setActual] = useState(props.result?.actualResult ?? '')
  const [steps, setSteps] = useState(props.result?.executedSteps ?? '')
  const [comment, setComment] = useState(props.result?.comment ?? '')
  const [reason, setReason] = useState('')
  const result = props.result
  return <article className="manual-qa-card" role="listitem">
    <button className="manual-qa-card__head" aria-expanded={props.open} onClick={props.onToggle}>
      <span>Критерий {props.criterion.order}. {props.criterion.title}</span>
      <span>{result?.status ?? 'not_tested'} · v{props.criterion.currentVersion}</span>
    </button>
    {props.open && <div className="manual-qa-card__body">
      <dl>
        <dt>Предусловия</dt><dd>{props.criterion.preconditions || '—'}</dd>
        <dt>Шаги</dt><dd>{props.criterion.steps || '—'}</dd>
        <dt>Тестовые данные</dt><dd>{props.criterion.testData || '—'}</dd>
        <dt>Ожидаемый результат</dt><dd>{props.criterion.expectedResult}</dd>
      </dl>
      {result && <>
        <label>Фактически выполненные шаги<textarea value={steps} onChange={(event) => setSteps(event.target.value)} /></label>
        <label>Фактический результат<textarea value={actual} onChange={(event) => setActual(event.target.value)} /></label>
        <label>Комментарий<textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label>
        <label>Причина для Blocked / N/A<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <label>Скриншоты<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={props.disabled} onChange={(event) => { for (const file of Array.from(event.currentTarget.files ?? [])) void props.onAttach(result, file) }} /></label>
        <div className="manual-qa-actions">
          <Button size="sm" disabled={props.disabled} onClick={() => props.onUpdate(result, 'in_progress', { draft: true, executedSteps: steps, actualResult: actual, comment })}>Сохранить черновик</Button>
          <Button size="sm" variant="primary" disabled={props.disabled} onClick={() => props.onUpdate(result, 'passed', { executedSteps: steps, actualResult: actual, comment })}>Пройден</Button>
          <Button size="sm" disabled={props.disabled} onClick={() => props.onUpdate(result, 'failed', { executedSteps: steps, actualResult: actual, comment, classification: 'implementation_defect', severity: 'major', frequency: 'unknown', reproduction: steps })}>Не пройден</Button>
          <Button size="sm" disabled={props.disabled || !reason.trim()} onClick={() => props.onUpdate(result, 'blocked', { executedSteps: steps, actualResult: actual, comment, blockerReason: reason, blockerType: 'other', blockerOwner: 'QA owner' })}>Заблокирован</Button>
          <Button size="sm" disabled={props.disabled || !reason.trim()} onClick={() => props.onUpdate(result, 'not_applicable', { executedSteps: steps, actualResult: actual, comment, notApplicableReason: reason })}>Неприменим</Button>
        </div>
        {result.attachments.length > 0 && <div>{result.attachments.map((attachment) => <a key={attachment.id} href={`/api/qa/attachments/${attachment.id}`} target="_blank" rel="noreferrer">{attachment.caption || attachment.name}</a>)}</div>}
      </>}
    </div>}
  </article>
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать скриншот'))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(file)
  })
}

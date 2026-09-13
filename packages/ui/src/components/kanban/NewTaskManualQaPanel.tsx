import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, EmptyState, ErrorState, FeedLog, Skeleton } from '@voicechat/ui-kit'
import type { QaCriterionResult, QaResultStatus } from '@shared/qa'
import { canCompleteQa, qaProgress } from '@shared/qa'
import { AttemptList, CheckList, StageCard, StageHeading, StageRail } from './NewTaskStages'
import { useNewTaskAction, useNewTaskResource } from './useNewTaskResource'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'
import { assignToCycles, pluralRu, qaSessionStageStatus, stageTitle } from './taskCycles'

export interface NewTaskManualQaPanelProps {
  projectId: string; taskId: string; cycles: TaskReworkCycleViewModel[]; workflow: string[]
  runActive: boolean; onFixStarted?: (runId: string) => void
}
export function NewTaskManualQaPanel(props: NewTaskManualQaPanelProps): JSX.Element {
  const key = props.projectId + ':' + props.taskId
  const resource = useNewTaskResource(key, async () => {
    if (!window.qa) throw new Error('Ручное QA недоступно')
    return window.qa.get(props.projectId, props.taskId)
  })
  const state = resource.data
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [additional, setAdditional] = useState<string | null>(null)
  const { busy, error, act } = useNewTaskAction(resource.refresh)
  const stages = useMemo(() => assignToCycles(props.cycles, state?.sessions ?? [], { createdAt: session => session.startedAt }), [props.cycles, state])
  const selected = stages.find(stage => stage.key === selectedKey) ?? stages[stages.length - 1]!
  const session = selected.items.find(item => item.id === selectedId) ?? selected.items[selected.items.length - 1] ?? null
  const editable = session?.id === state?.activeSession?.id && session?.status === 'active' && state?.canEdit !== false
  const unsaved = Object.values(dirty).some(Boolean) || additional !== null
  useEffect(() => {
    const off = window.board?.onReconnect?.(() => void resource.refresh())
    return () => off?.()
  }, [resource.refresh])
  useEffect(() => {
    if (state?.preparation?.status !== 'running') return
    const timer = window.setTimeout(() => void resource.refresh(), 2000)
    return () => window.clearTimeout(timer)
  }, [state, resource.refresh])
  return <div className="new-task-process" data-testid="new-task-manual-qa">
    <section className="new-task-section new-task-preview-summary"><h3>Тестовое окружение</h3>
      {session?.appUrl || session?.storybookUrl ? <p>
        {session.appUrl && <a href={session.appUrl} target="_blank" rel="noreferrer">{session.appUrl}</a>}
        {session.storybookUrl && <> · <a href={session.storybookUrl} target="_blank" rel="noreferrer">{session.storybookUrl}</a></>}
      </p> : <p>{session ? 'В этой сессии preview не опубликовано.' : 'Preview появится вместе с первой QA-сессией.'}</p>}
    </section>
    <StageHeading eyebrow="История проходов" title="Ручное QA" description="Результаты сохраняются в выбранной QA-сессии."
      badge={<Badge>{pluralRu(stages.length, 'проход', 'прохода', 'проходов')}</Badge>} />
    {(resource.error || error) && <ErrorState compact message="Не удалось обновить ручное QA" detail={error || resource.error} onRetry={() => void resource.refresh()} />}
    {!state && resource.loading && <Skeleton variant="list" count={3} />}
    {unsaved && <p role="status">Сохраните результаты перед переключением сессии или переходом дальше.</p>}
    <StageRail testId="new-task-manual-qa-rail">
      {stages.map((stage, index) => {
        const shown = stage.key === selected.key ? session : stage.items[stage.items.length - 1]
        const progress = shown ? qaProgress(shown) : null
        return <StageCard key={stage.key} number={stage.number} status={shown ? qaSessionStageStatus(shown.status) : 'idle'}
          statusLabel={shown?.status === 'passed' ? 'Принято' : undefined} eyebrow={`Проход ${stage.number}`} title={stageTitle('Ручное QA', stage)}
          workflow={props.workflow} cycle={stage.cycle} sourceTitle="Цикл 1" sourceText="Результат разработки первоначальной постановки задачи."
          selected={stage.key === selected.key} onSelect={unsaved || busy ? undefined : () => { setSelectedKey(stage.key); setSelectedId(null) }}
          connector={index < stages.length - 1} testId={`new-task-manual-qa-stage-${stage.number}`}>
          <CheckList checks={[{ id: 'scenarios', title: 'Сценарии', ok: progress ? progress.passed === progress.total && progress.total > 0 : null, note: progress ? `${progress.passed}/${progress.total} проверено успешно` : 'Сессия ещё не создана' }]} />
          {stage.key === selected.key && <>
            <AttemptList ariaLabel="QA-сессии" selectedId={session?.id ?? null} onSelect={unsaved || busy ? undefined : setSelectedId}
              attempts={stage.items.map((item, at) => ({ id: item.id, label: `Сессия ${at + 1}`, status: qaSessionStageStatus(item.status), at: item.startedAt }))} />
            {!session && <EmptyState compact icon="🧪" title="Сессий этого цикла ещё нет" description="Тестовое окружение появится после разработки и подготовки сценариев." />}
            {!session && stage.key === stages[stages.length - 1]!.key && state?.preparation && <section className="new-task-section">
              <h4>Подготовка сценариев · {state.preparation.status}</h4>
              <FeedLog label="Подготовка сценариев QA">{state.preparation.log ?? ''}</FeedLog>
              {state.preparation.canRetry && <Button loading={busy} onClick={() => void act(() => window.qa!.retryPreparation!(props.projectId, props.taskId))}>Повторить создание сценариев</Button>}
              {!state.activeSession && state.criteria.some(item => item.active) && <Button loading={busy} onClick={() => void act(() => window.qa!.completePreparation(props.projectId, props.taskId))}>Сценарии готовы — перейти в ручное QA</Button>}
            </section>}
            {session && state && <section className="new-task-section" data-testid="new-manual-qa-session">
              <p>SHA {session.commitSha.slice(0, 8)} · {session.staleReason ?? session.summary}</p>
              {session.criteriaSnapshot.map(snapshot => {
                const version = state.versions.find(item => item.criterionId === snapshot.criterionId && item.version === snapshot.version)
                  ?? state.criteria.find(item => item.id === snapshot.criterionId && item.currentVersion === snapshot.version)
                const result = session.results.find(item => item.criterionId === snapshot.criterionId && item.criterionVersion === snapshot.version)
                return <article key={snapshot.criterionId} className="new-task-section">
                  <h4>{version?.title ?? 'Описание этой версии недоступно'} · v{snapshot.version}</h4>
                  {version && <details><summary>Сценарий проверки</summary><p>{version.preconditions}</p><pre>{version.steps}</pre><p>{version.testData}</p><p>Ожидается: {version.expectedResult}</p></details>}
                  {result && <ManualResult key={result.id} result={result} disabled={!editable || busy} onDirty={value => setDirty(current => ({ ...current, [result.id]: value }))}
                    save={async (status, fields) => {
                      try { await window.qa!.saveResult(props.projectId, props.taskId, result.id, result.revision, { status, draft: false, ...fields }) }
                      finally { await resource.refresh() }
                    }} />}
                </article>
              })}
              {editable && <>
                <label>Дополнительные баги и недоработки<textarea value={additional ?? session.additionalIssues ?? ''} onChange={event => setAdditional(event.target.value)} disabled={busy} /></label>
                {additional !== null && <Button loading={busy} onClick={() => void act(async () => { await window.qa!.saveAdditionalIssues!(props.projectId, props.taskId, session.id, additional); setAdditional(null) })}>Сохранить замечания</Button>}
                <div className="new-task-heading-actions">
                  <Button loading={busy} disabled={unsaved || props.runActive} onClick={() => void act(async () => { const next = await window.qa!.requestFix(props.projectId, props.taskId, session.id); props.onFixStarted?.(next.id) })}>Отправить на доработку</Button>
                  <Button loading={busy} disabled={unsaved || !canCompleteQa(session).allowed} onClick={() => void act(() => window.qa!.complete(props.projectId, props.taskId, session.id, 'Ручное QA подтверждено тестировщиком'))}>Следующий этап</Button>
                </div>
              </>}
            </section>}
          </>}
        </StageCard>
      })}
    </StageRail>
  </div>
}
function ManualResult({ result, disabled, save, onDirty }: {
  result: QaCriterionResult; disabled: boolean; onDirty: (value: boolean) => void
  save: (status: QaResultStatus, fields: Record<string, unknown>) => Promise<void>
}): JSX.Element {
  const [status, setStatus] = useState(result.status)
  const [comment, setComment] = useState(result.comment)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (!dirty) { setStatus(result.status); setComment(result.comment) } }, [result.revision, dirty])
  return <form onSubmit={event => {
    event.preventDefault()
    if (busy || disabled) return
    setBusy(true); setError('')
    const fields = status === 'failed' ? { comment, actualResult: comment, classification: 'implementation_defect', severity: 'major', frequency: 'unknown', reproduction: comment }
      : status === 'blocked' ? { comment, blockerReason: comment, blockerType: 'other', blockerOwner: 'Не назначен' } : { comment }
    void save(status, fields).then(() => { setDirty(false); onDirty(false) }).catch(cause => setError(String(cause))).finally(() => setBusy(false))
  }}>
    <label>Результат<select aria-label="Результат проверки" value={status} disabled={disabled || busy} onChange={event => { setStatus(event.target.value as QaResultStatus); setDirty(true); onDirty(true) }}>
      <option value="not_tested">Не проверено</option><option value="passed">Работает</option><option value="failed">Не работает</option><option value="blocked">Нет возможности проверить</option>
    </select></label>
    <label>Комментарий<textarea value={comment} disabled={disabled || busy} onChange={event => { setComment(event.target.value); setDirty(true); onDirty(true) }} /></label>
    {error && <ErrorState compact message="Результат не сохранён" detail={error} />}
    {!disabled && <Button type="submit" loading={busy} disabled={!dirty || (['failed', 'blocked'].includes(status) && !comment.trim())}>Сохранить результат</Button>}
  </form>
}

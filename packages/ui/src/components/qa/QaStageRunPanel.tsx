import { useCallback, useEffect, useState } from 'react'
import type { AnyQaStageRun, QaRunStage } from '@shared/qa'
import { Button } from '../ui/Button'

const LABEL: Record<QaRunStage, string> = {
  component_qa: 'Component QA',
  integration_tests: 'Интеграционные тесты',
  automated_qa: 'Automated QA'
}

export function QaStageRunPanel(props: { projectId: string; taskId: string; stage: QaRunStage }): JSX.Element {
  const [runs, setRuns] = useState<AnyQaStageRun[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState('')
  const load = useCallback(async () => {
    if (!window.qa?.listStageRuns) return
    try { setRuns(await window.qa.listStageRuns(props.projectId, props.taskId, props.stage)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [props.projectId, props.taskId, props.stage])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const current = runs[0]
    if (!current || !['running','queued','awaiting_input'].includes(current.status)) return
    const timer = window.setInterval(() => void load(), 1500)
    return () => window.clearInterval(timer)
  }, [runs, load])
  const run = runs[0]
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try { await fn(); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <div className="qa-stage-run" data-testid={`qa-stage-${props.stage}`}>
    <div className="qa-stage-run__head"><h3>{LABEL[props.stage]}</h3>
      {!run?.canCancel && window.qa?.startStageRun && <Button size="sm" variant="primary" disabled={busy} onClick={() => void act(() => window.qa!.startStageRun!(props.projectId, props.taskId, props.stage))}>Запустить</Button>}
      {run?.canCancel && window.qa?.cancelStageRun && <Button size="sm" variant="danger" disabled={busy} onClick={() => void act(() => window.qa!.cancelStageRun!(run.id))}>Отменить</Button>}
      {run?.canRetry && window.qa?.retryStageRun && <Button size="sm" disabled={busy} onClick={() => void act(() => window.qa!.retryStageRun!(run.id))}>Повторить</Button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {!run && <p>Запусков этого этапа ещё нет.</p>}
    {run && <><p><strong>{run.status}</strong> · попытка {run.attempt} · {run.branch || 'ветка не задана'} {run.commitSha && <>· <code>{run.commitSha.slice(0, 10)}</code></>}</p>
      <p>{run.currentStep || 'Ожидание'} · {run.progress.current}/{run.progress.total} {run.progress.label}</p>
      <progress max={Math.max(1, run.progress.total)} value={run.progress.current} />
      {run.gateReasons.length > 0 && <section><h4>Quality gate не пройден</h4><ul>{run.gateReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></section>}
      {run.error && <p role="alert">{run.error}</p>}
      {run.result && <section><h4>Результат</h4><pre>{JSON.stringify(run.result, null, 2)}</pre></section>}
      <section><h4>Потоковая лента</h4><div className="ci-log">{run.log.map((line) => <div key={line.seq}>{line.text}</div>)}</div></section>
      {run.status === 'awaiting_input' && props.stage === 'integration_tests' && window.qa?.answerStageRun && <form onSubmit={(event) => { event.preventDefault(); void act(async () => { await window.qa!.answerStageRun!(run.id, answer); setAnswer('') }) }}><label>Ответ модели<textarea value={answer} onChange={(event) => setAnswer(event.target.value)} /></label><Button size="sm" type="submit" disabled={busy || !answer.trim()}>Отправить</Button></form>}
    </>}
    {runs.length > 0 && <section><h4>История попыток</h4><ol>{runs.map((item) => <li key={item.id}>#{item.attempt} · {item.status} · {new Date(item.createdAt).toLocaleString()}</li>)}</ol></section>}
  </div>
}

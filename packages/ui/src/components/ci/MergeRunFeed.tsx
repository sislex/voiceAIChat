import { useEffect, useRef, useState } from 'react'
import type { MergeRun } from '@shared/merge'
import { Button } from '../ui/Button'
import { fmtDuration } from './ciFormat'

export const MERGE_STATUS_LABEL: Record<string, string> = {
  success: 'успех', failed: 'ошибка', cancelled: 'отменён', decision_required: 'нужно решение',
  queued: 'в очереди', checking: 'выполняется', fetching: 'выполняется', merging: 'выполняется',
  resolving_conflicts: 'выполняется', kb_update: 'выполняется', testing: 'выполняется', pushing: 'выполняется'
}
const STAGE_LABEL: Record<string, string> = {
  checking: 'Проверки сервера', fetching: 'Получение веток', merging: 'Merge',
  resolving_conflicts: 'Конфликты', kb_update: 'База знаний', testing: 'Проверки проекта', pushing: 'Публикация в main'
}

export function mergeStatusTone(status: string): 'ok' | 'err' | 'warn' | 'run' {
  if (status === 'success') return 'ok'
  if (status === 'failed' || status === 'cancelled') return 'err'
  if (status === 'decision_required') return 'warn'
  return 'run'
}

/** Живая лента merge-рана: статус-шапка, степпер стадий, терминальные блоки
 *  лога и проверок. Обновления — WS merge.snapshot + fallback-опрос. */
export function MergeRunFeed({ runId, onRunChanged }: { runId: string; onRunChanged?: () => void }): JSX.Element {
  const [run, setRun] = useState<MergeRun | null>(null)
  const [error, setError] = useState('')
  const [autoscroll, setAutoscroll] = useState(true)
  const logRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    let alive = true
    const load = (): Promise<void> | undefined => window.ci?.getMerge(runId).then((value) => { if (alive) { setRun(value); setError('') } }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    void load()
    const off = window.ci?.onMerge(({ runId: id, run: value }) => { if (alive && id === runId) setRun(value) })
    const timer = window.setInterval(() => void load(), 3000)
    return () => { alive = false; off?.(); window.clearInterval(timer) }
  }, [runId])
  useEffect(() => { const el = logRef.current; if (autoscroll && el) el.scrollTop = el.scrollHeight }, [run?.log, autoscroll])
  if (error) return <div className="merge-alert" role="alert">{error}</div>
  if (!run) return <div className="task-tab-empty">Загрузка merge-рана…</div>
  const tone = mergeStatusTone(run.status)
  const terminal = ['success', 'failed', 'cancelled', 'decision_required'].includes(run.status)
  const duration = (run.finishedAt ?? Date.now()) - (run.startedAt ?? run.createdAt)
  const stale = /stale source/i.test(run.error ?? '')
  const act = (value: MergeRun): void => { setRun(value); onRunChanged?.() }
  const download = (): void => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([run.log], { type: 'text/plain' })); a.download = `merge-run-${run.id}.txt`; a.click(); URL.revokeObjectURL(a.href) }
  return (
    <section className="merge-feed" data-testid="merge-run-feed">
      <header className="merge-feed-head">
        <span className={`merge-badge merge-badge--${tone}`}>{MERGE_STATUS_LABEL[run.status] ?? run.status}</span>
        <span className="merge-feed-route"><code>{run.sourceBranch}</code> <span aria-hidden>→</span> <code>main</code></span>
        <span className="merge-feed-shas">
          {run.sourceSha && <code className="merge-sha" title={`source ${run.sourceSha}`}>{run.sourceSha.slice(0, 8)}</code>}
          {run.targetSha && <code className="merge-sha" title={`main ${run.targetSha}`}>{run.targetSha.slice(0, 8)}</code>}
          {run.mergeSha && <code className="merge-sha merge-sha--merge" title={`merge ${run.mergeSha}`}>{run.mergeSha.slice(0, 8)}</code>}
        </span>
        <span className="merge-feed-meta">{run.machineName ?? run.agentId} · {fmtDuration(duration)}</span>
        <div className="merge-feed-actions">
          {stale && run.canRetry && <Button variant="primary" onClick={() => void window.ci?.retryMerge(run.id, true).then(act)}>Мержить текущий head ветки</Button>}
          {run.canRetry && <Button onClick={() => void window.ci?.retryMerge(run.id).then(act)}>Повторить</Button>}
          {run.canCancel && <Button onClick={() => void window.ci?.cancelMerge(run.id).then(act)}>Отменить</Button>}
          {run.status === 'success' && !run.deployId && <Button variant="primary" onClick={() => void window.ci?.deployMergeRun(run.id).then(act).catch((e) => setError(e instanceof Error ? e.message : String(e)))}>Выпустить на прод</Button>}
        </div>
      </header>
      {run.error && (
        <div className="merge-alert" role="alert">
          <strong>{run.error}</strong>
          {run.recommendedAction && <div className="merge-alert-hint">{run.recommendedAction}</div>}
          {run.conflicts.length > 0 && <ul className="merge-alert-conflicts">{run.conflicts.map((path) => <li key={path}><code>{path}</code></li>)}</ul>}
        </div>
      )}
      {run.deployId && <div className="merge-deploy-note">Деплой {run.deployVersion ?? run.deployId}: {run.productionStatus ?? '—'}</div>}
      <ol className="merge-steps">
        {run.stages.map((stage) => (
          <li key={stage.stage} className={`merge-step merge-step--${stage.status}`}>
            <span className="merge-step-dot" aria-hidden />
            <span className="merge-step-name">{STAGE_LABEL[stage.stage] ?? stage.stage}</span>
            <span className="merge-step-time">{fmtDuration(stage.durationMs ?? (stage.startedAt ? Date.now() - stage.startedAt : null))}</span>
            {stage.message && <span className="merge-step-message">{stage.message}</span>}
          </li>
        ))}
      </ol>
      {run.checks.map((check) => (
        <details key={check.name} className="merge-collapse">
          <summary>{check.name}: {check.status} · exit {check.exitCode ?? '—'} · {fmtDuration(check.durationMs)}</summary>
          <pre className="merge-terminal">{check.output}</pre>
        </details>
      ))}
      <details className="merge-collapse" open={!terminal}>
        <summary>Лог рана</summary>
        <div className="merge-log-actions">
          <label><input type="checkbox" checked={autoscroll} onChange={(event) => setAutoscroll(event.target.checked)} /> автоскролл</label>
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(run.log)}>Копировать</Button>
          <Button size="sm" onClick={download}>Скачать .txt</Button>
        </div>
        <pre ref={logRef} className="merge-terminal merge-terminal--log">{run.log}</pre>
      </details>
      <dl className="merge-feed-details">
        <dt>Инициатор</dt><dd>{run.triggeredBy}</dd>
        <dt>LLM БЗ</dt><dd>{run.llmEngineId ?? run.llmProvider} · {run.llmModel || 'по умолчанию'}</dd>
        <dt>Создан</dt><dd>{new Date(run.createdAt).toLocaleString()}</dd>
      </dl>
    </section>
  )
}

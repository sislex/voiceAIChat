import { useEffect, useId, useRef, useState } from 'react'
import { formatDateTime } from '../../lib/dateFormat'
import type { MergeRun, MergeRunStatus } from '@shared/merge'
import type { CiTaskMachine } from '@shared/ci'
import { Button } from '@voicechat/ui-kit'
import { fmtDuration } from './ciFormat'
import { AnsiText } from './AnsiText'

/**
 * Подпись статуса merge-рана. Карта покрывает `MergeRunStatus` целиком: раньше
 * в ней не было `deploying`, `production_checks`, `rolling_back` и `timeout`, и
 * в списке запусков они показывались сырыми английскими идентификаторами рядом
 * с русскими соседями.
 */
export const MERGE_STATUS_LABEL: Record<MergeRunStatus, string> = {
  success: 'успех', failed: 'ошибка', cancelled: 'отменён', decision_required: 'нужно решение',
  queued: 'в очереди', checking: 'выполняется', fetching: 'выполняется', merging: 'выполняется',
  resolving_conflicts: 'выполняется', kb_update: 'выполняется', testing: 'выполняется', pushing: 'выполняется',
  deploying: 'публикация', production_checks: 'проверки прода', rolling_back: 'откат', timeout: 'таймаут'
}
const STAGE_LABEL: Record<string, string> = {
  checking: 'Проверки сервера', fetching: 'Получение веток', merging: 'Merge',
  resolving_conflicts: 'Конфликты', kb_update: 'База знаний', testing: 'Проверки проекта', pushing: 'Публикация в main'
}

export function mergeLlmFallbackMessage(run: MergeRun): string | null {
  if (!run.llmFallbackReason || !run.requestedLlmProvider) return null
  const requested = `${run.requestedLlmProvider}${run.requestedLlmModel ? ` · ${run.requestedLlmModel}` : ''}`
  const reason = run.llmFallbackReason === 'provider_unavailable'
    ? 'запрошенный provider недоступен'
    : 'запрошенная модель недоступна'
  return `LLM заменён: был запрошен ${requested}, но ${reason}; запущен ${run.llmProvider} · ${run.llmModel}.`
}

/**
 * Длительность этапа. У незавершённого этапа её приходится считать до «сейчас»,
 * но только пока жив сам ран: раньше этап без `finishedAt` тикал вечно, и у
 * упавшего рана «База знаний» показывала 95+ минут спустя часы после остановки.
 * Сервер теперь закрывает этапы при финализации, а здесь чинится и то, что уже
 * записано в БД такими ранами.
 */
export function stageDuration(
  stage: { durationMs: number | null; startedAt: number | null },
  runFinishedAt: number | null,
  now: number = Date.now()
): number | null {
  if (stage.durationMs !== null) return stage.durationMs
  if (!stage.startedAt) return null
  return Math.max(0, (runFinishedAt ?? now) - stage.startedAt)
}

export function mergeStatusTone(status: string): 'ok' | 'err' | 'warn' | 'run' {
  if (status === 'success') return 'ok'
  if (status === 'failed' || status === 'cancelled') return 'err'
  if (status === 'decision_required') return 'warn'
  return 'run'
}

function MergeKbDisclosure({ run }: { run: MergeRun }): JSX.Element {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const stage = run.stages.find((item) => item.stage === 'kb_update')
  const status = !stage ? 'Не запускалась' : stage.status === 'queued' ? 'Ожидает' : stage.status === 'running' ? 'Выполняется…' : stage.status === 'passed' ? 'Успешно' : stage.status === 'skipped' ? 'Пропущена' : 'Есть ошибки'
  return (
    <section className={`kbu-brief kbu-brief--disclosure${open ? ' is-open' : ''}`} data-testid="merge-run-kb-usage">
      <button className="kbu-brief__toggle" aria-expanded={open} aria-controls={panelId}
        aria-label={`Использование базы знаний: актуализация, ${status.toLowerCase()}. ${open ? 'Скрыть подробности' : 'Показать подробности'}`}
        onClick={() => setOpen(!open)}>
        <span className="kbu-brief__icon" aria-hidden>⧉</span>
        <span className="kbu-brief__line"><strong>База знаний</strong><span>Актуализация БЗ</span><span className={stage?.status === 'failed' ? 'kbu-brief__status kbu-brief__status--error' : 'kbu-brief__status'}>{status}</span></span>
        <span className="kbu-brief__chevron" aria-hidden>
          {stage?.status === 'running' ? '…' : stage?.status === 'failed' ? '⚠' : <span className="vc-feed-caret" />}
        </span>
      </button>
      {open && <div id={panelId} className="kbu-run-report" onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
        <section><h4>Актуализация базы знаний</h4>
          {!stage ? <p>Этап актуализации БЗ не запускался.</p> : <>
            <p>Статус: {status}.</p>
            <p>{stage.message || (stage.status === 'running' ? 'Отчёт ещё формируется.' : 'Дополнительные сведения недоступны.')}</p>
            {stage.durationMs != null && <p>Длительность: {fmtDuration(stage.durationMs)}.</p>}
          </>}
        </section>
        <p>Использование БЗ моделью и актуализация показаны раздельно; эта строка относится только к merge-рану {run.id}.</p>
      </div>}
    </section>
  )
}

/** Живая лента merge-рана: статус-шапка, степпер стадий, терминальные блоки
 *  лога и проверок. После начального REST-снимка обновляется через WS merge.snapshot. */
export function MergeRunFeed({ runId, initialRun, machines = [], onRunChanged }: { runId: string; initialRun?: MergeRun; machines?: CiTaskMachine[]; onRunChanged?: (run?: MergeRun) => void }): JSX.Element {
  const [run, setRun] = useState<MergeRun | null>(null)
  const [retryAgentId, setRetryAgentId] = useState('')
  const [error, setError] = useState('')
  const [autoscroll, setAutoscroll] = useState(true)
  const [reload, setReload] = useState(0)
  const logRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    let alive = true
    setRetryAgentId('')
    const apply = (value: MergeRun): void => { if (alive) { setRun(value); setRetryAgentId((current) => current || value.agentId); setError('') } }
    const load = (): Promise<void> | undefined => initialRun ? undefined : window.ci?.getMerge(runId).then(apply).catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    if (initialRun) apply(initialRun); else void load()
    const off = window.ci?.onMerge(({ runId: id, run: value }) => { if (id === runId) apply(value) })
    const offReconnect = window.board?.onReconnect?.(() => { void load() })
    return () => { alive = false; off?.(); offReconnect?.() }
  }, [runId, initialRun, reload])
  useEffect(() => { const el = logRef.current; if (autoscroll && el) el.scrollTop = el.scrollHeight }, [run?.log, autoscroll])
  const onLogScroll = (): void => {
    const element = logRef.current
    if (element) setAutoscroll(element.scrollHeight - element.scrollTop - element.clientHeight < 32)
  }
  const jumpToNew = (): void => {
    setAutoscroll(true)
    const element = logRef.current
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }
  if (error) return <div className="merge-alert" role="alert">{error}<div><Button size="sm" onClick={() => setReload((value) => value + 1)}>Повторить</Button></div></div>
  if (!run) return <div className="task-tab-empty">Загрузка merge-рана…</div>
  const tone = mergeStatusTone(run.status)
  const terminal = ['success', 'failed', 'cancelled', 'decision_required'].includes(run.status)
  const duration = (run.finishedAt ?? Date.now()) - (run.startedAt ?? run.createdAt)
  const stale = /stale source/i.test(run.error ?? '')
  const llmFallbackMessage = mergeLlmFallbackMessage(run)
  const act = (value: MergeRun): void => { setRun(value); setRetryAgentId(value.agentId); onRunChanged?.(value) }
  const retry = (unpin = false): void => { void window.ci?.retryMerge(run.id, retryAgentId || run.agentId, unpin).then(act) }
  const retryMachines = machines.some((machine) => machine.agentId === run.agentId)
    ? machines
    : [{ agentId: run.agentId, name: run.machineName ?? run.agentId, online: false, personal: false, project: false, projectDefault: false }, ...machines]
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
        <span className="merge-feed-meta"><span title={run.agentId}>{run.machineName ?? run.agentId}</span> · {fmtDuration(duration)}</span>
        {run.canRetry && <label className="merge-start-machine">Машина повтора{' '}
          <select aria-label="Машина повторного merge-рана" value={retryAgentId || run.agentId} onChange={(event) => setRetryAgentId(event.target.value)}>
            {retryMachines.map((machine) => <option key={machine.agentId} value={machine.agentId} disabled={!machine.online}>{machine.name}{!machine.online ? ' (офлайн)' : ''}</option>)}
          </select>
        </label>}
        <div className="merge-feed-actions">
          {stale && run.canRetry && <Button variant="primary" onClick={() => retry(true)}>Мержить текущий head ветки</Button>}
          {run.canRetry && <Button onClick={() => retry()}>Повторить</Button>}
          {run.canCancel && <Button onClick={() => void window.ci?.cancelMerge(run.id).then(act)}>Отменить</Button>}
          {run.status === 'success' && !run.deployId && <Button variant="primary" onClick={() => void window.ci?.deployMergeRun(run.id).then(act).catch((e) => setError(e instanceof Error ? e.message : String(e)))}>Выпустить на прод</Button>}
        </div>
      </header>
      <MergeKbDisclosure run={run} />
      {llmFallbackMessage && <div className="merge-alert" role="status" data-testid="merge-llm-fallback">{llmFallbackMessage}</div>}
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
            <span className="merge-step-time">{fmtDuration(stageDuration(stage, run.finishedAt))}</span>
            {stage.message && <span className="merge-step-message">{stage.message}</span>}
          </li>
        ))}
      </ol>
      {run.checks.map((check) => (
        <details key={check.name} className="merge-collapse">
          <summary>{check.name}: {check.status} · exit {check.exitCode ?? '—'} · {fmtDuration(check.durationMs)}</summary>
          <pre className="merge-terminal"><AnsiText>{check.output}</AnsiText></pre>
        </details>
      ))}
      <details className="merge-collapse" open={!terminal}>
        <summary>Лог рана</summary>
        <div className="merge-log-actions">
          <label><input type="checkbox" checked={autoscroll} onChange={(event) => setAutoscroll(event.target.checked)} /> автоскролл</label>
          {!autoscroll && <Button size="sm" onClick={jumpToNew}>К новым событиям</Button>}
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(run.log)}>Копировать</Button>
          <Button size="sm" onClick={download}>Скачать .txt</Button>
        </div>
        <pre ref={logRef} className="merge-terminal merge-terminal--log" onScroll={onLogScroll}><AnsiText>{run.log}</AnsiText></pre>
      </details>
      <dl className="merge-feed-details">
        <dt>Инициатор</dt><dd>{run.triggeredBy}</dd>
        <dt>LLM БЗ</dt><dd>{run.llmProvider} · {run.llmModel || 'по умолчанию'}</dd>
        <dt>Создан</dt><dd>{formatDateTime(run.createdAt)}</dd>
      </dl>
    </section>
  )
}

import { useEffect, useState, type JSX } from 'react'
import type { AutomationProgress } from '@shared/ci'
import { fmtDuration } from '../ci/ciFormat'

export interface AutomationProgressViewProps {
  progress: AutomationProgress
  compact?: boolean
  now?: () => number
}

function statusText(progress: AutomationProgress): string {
  if (progress.status === 'waiting') return 'Ожидает действия пользователя'
  if (progress.status === 'cancelled') return 'Отменено'
  if (progress.status === 'failed') return 'Ошибка'
  if (progress.status === 'success') return 'Завершено'
  return progress.currentStep ?? progress.stage
}

export function AutomationProgressView({ progress, compact = false, now = Date.now }: AutomationProgressViewProps): JSX.Element {
  const [tick, setTick] = useState(0)
  const active = progress.status === 'running' || progress.status === 'queued' || progress.status === 'waiting'
  useEffect(() => {
    if (!active || progress.startedAt == null) return
    const timer = setInterval(() => setTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [active, progress.startedAt])
  void tick
  const elapsed = progress.startedAt == null
    ? progress.elapsedMs
    : active ? Math.max(progress.elapsedMs, now() - progress.startedAt) : progress.elapsedMs
  const eta = progress.etaRangeMs
    ? `≈ ${fmtDuration(progress.etaRangeMs[0])}–${fmtDuration(progress.etaRangeMs[1])}`
    : progress.etaUnavailableReason ?? null

  return (
    <section className={`automation-progress${compact ? ' automation-progress--compact' : ''}`} aria-live="polite">
      <div className="automation-progress__head">
        <strong>{progress.stage}</strong>
        {progress.percent != null && <span>{progress.percent}%</span>}
      </div>
      <div
        className={`automation-progress__bar${progress.percent == null ? ' automation-progress__bar--indeterminate' : ''}`}
        role="progressbar"
        aria-label={statusText(progress)}
        aria-valuemin={progress.percent == null ? undefined : 0}
        aria-valuemax={progress.percent == null ? undefined : 100}
        aria-valuenow={progress.percent ?? undefined}
        aria-valuetext={progress.percent == null ? statusText(progress) : `${progress.percent}% — ${statusText(progress)}`}
      >
        {progress.percent != null && <span style={{ width: `${progress.percent}%` }} />}
      </div>
      <div className="automation-progress__meta">
        <span>{statusText(progress)}</span>
        <span>{elapsed > 0 ? `Прошло ${fmtDuration(elapsed)}` : 'Ещё не начато'}</span>
        <span>{eta ? `ETA: ${eta}` : ''}</span>
      </div>
      {!compact && (
        <>
          <div className="automation-progress__times">
            <span>Начало: {progress.startedAt ? new Date(progress.startedAt).toLocaleString('ru') : '—'}</span>
            {progress.etaRangeMs && <span>Расчётное завершение: {new Date(now() + progress.etaRangeMs[0]).toLocaleTimeString('ru')}–{new Date(now() + progress.etaRangeMs[1]).toLocaleTimeString('ru')}</span>}
            <a href={progress.logUrl}>Журнал</a>
          </div>
          <ol className="automation-progress__steps">
            {progress.steps.map((step) => <li key={step.id} data-status={step.status}><span>{step.title}</span><span>{step.durationMs != null ? fmtDuration(step.durationMs) : step.status}</span></li>)}
          </ol>
        </>
      )}
    </section>
  )
}

import { useState, type JSX } from 'react'
import { usePolling } from '../../lib/usePolling'
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
  if (progress.status === 'queued') return 'Ожидает запуска'
  return progress.currentStep ?? progress.stage
}

function stepStatusText(status: AutomationProgress['steps'][number]['status']): string {
  if (status === 'queued' || status === 'pending') return 'ожидает'
  if (status === 'running') return 'выполняется'
  if (status === 'waiting') return 'ожидает ответа'
  if (status === 'success') return 'завершено'
  if (status === 'failed') return 'ошибка'
  if (status === 'cancelled') return 'отменено'
  return 'пропущено'
}

export function AutomationProgressView({ progress, compact = false, now = Date.now }: AutomationProgressViewProps): JSX.Element {
  const [tick, setTick] = useState(0)
  const active = progress.status === 'running' || progress.status === 'queued' || progress.status === 'waiting'
  // Секундные часы «прошло столько-то» тикают только на видимой вкладке.
  usePolling(() => setTick((value) => value + 1), { enabled: active && progress.startedAt != null, intervalMs: 1000 })
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
            {progress.finishedAt != null && <span>Завершение: {new Date(progress.finishedAt).toLocaleString('ru')}</span>}
            <span>Продолжительность: {elapsed > 0 ? fmtDuration(elapsed) : '—'}</span>
            {progress.etaRangeMs && <span>Расчётное завершение: {new Date(now() + progress.etaRangeMs[0]).toLocaleTimeString('ru')}–{new Date(now() + progress.etaRangeMs[1]).toLocaleTimeString('ru')}</span>}
            <a href={progress.logUrl}>Журнал</a>
          </div>
          <ol className="automation-progress__steps">
            {progress.steps.map((step) => <li key={step.id} data-status={step.status}><span>{step.title}</span><span>{step.durationMs != null ? fmtDuration(step.durationMs) : stepStatusText(step.status)}</span></li>)}
          </ol>
        </>
      )}
    </section>
  )
}

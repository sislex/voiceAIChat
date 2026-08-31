// Счёт проверок этапа: «12 из 12 прошли» крупной цифрой и полоса под ней.
//
// До этого счёт складывали глазами из списка сценариев: сколько всего и сколько
// прошло, было видно только если пересчитать строки.

import { ProgressTrack } from './ProgressTrack'
import type { StatusTone } from './StatusPill'

export interface QaScoreProps {
  passed: number
  total: number
  /** Что считаем: «сценариев», «проверок». Родительный падеж. */
  unit?: string
  /**
   * Тон полосы. По умолчанию выводится из счёта: всё прошло — success, часть —
   * warning, ничего при непустом total — danger.
   */
  tone?: StatusTone
  className?: string
  testId?: string
}

function defaultTone(passed: number, total: number): StatusTone {
  if (total <= 0) return 'neutral'
  if (passed >= total) return 'success'
  return passed > 0 ? 'warning' : 'danger'
}

export function QaScore({ passed, total, unit = 'сценариев', tone, className, testId = 'qa-score' }: QaScoreProps): JSX.Element {
  const resolved = tone ?? defaultTone(passed, total)
  return (
    <div className={['vc-score', className].filter(Boolean).join(' ')} data-testid={testId}>
      <strong className="vc-score__value">{passed}/{total}</strong>
      <span className="vc-score__unit">{unit} прошли</span>
      <ProgressTrack
        className="vc-score__bar"
        value={passed}
        max={total}
        label={`Пройдено ${unit}`}
        tone={resolved}
      />
    </div>
  )
}

// Список проверок гейта: значок, название, деталь и вердикт справа.
//
// Отличается от `StepList` смыслом: у шага есть порядок (шаг 3 идёт после 2), а
// проверки гейта равноправны и выполняются вместе — поэтому здесь `ul`, а не
// `ol`, и вердикт вынесен в отдельную колонку.

import type { ReactNode } from 'react'
import type { StatusTone } from './StatusPill'

export interface GateCheck {
  id?: string
  name: ReactNode
  /** Чем измерено: «76% при пороге 80%», «0 предупреждений». */
  detail?: ReactNode
  /** Вердикт словом: «Пройдено», «Не пройдено». */
  verdict: ReactNode
  tone?: StatusTone
}

export interface GateListProps {
  checks: readonly GateCheck[]
  /** Имя списка для скринридера: «Проверки Automated QA». */
  ariaLabel: string
  className?: string
  testId?: string
}

const MARK: Record<StatusTone, string> = {
  neutral: '·',
  running: '↗',
  success: '✓',
  warning: '!',
  danger: '!'
}

export function GateList({ checks, ariaLabel, className, testId = 'gate-list' }: GateListProps): JSX.Element {
  return (
    <ul className={['vc-gates', className].filter(Boolean).join(' ')} aria-label={ariaLabel} data-testid={testId}>
      {checks.map((check, index) => {
        const tone = check.tone ?? 'neutral'
        return (
          <li className={`vc-gate vc-gate--${tone}`} key={check.id ?? index} data-tone={tone}>
            {/* Значок декоративен: вердикт стоит рядом словом. */}
            <span className="vc-gate__mark" aria-hidden="true">{MARK[tone]}</span>
            <span className="vc-gate__body">
              <span className="vc-gate__name">{check.name}</span>
              {check.detail != null && <span className="vc-gate__detail">{check.detail}</span>}
            </span>
            <b className={`vc-gate__verdict vc-gate__verdict--${tone}`}>{check.verdict}</b>
          </li>
        )
      })}
    </ul>
  )
}

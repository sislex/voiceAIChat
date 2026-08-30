// Ячейка сводки: подпись, крупное значение и необязательное пояснение.
//
// Одна форма и для полосы метрик над списком, и для «быстрых фактов» в карточке
// человека: это одно и то же — число с подписью, — и выглядеть они должны
// одинаково, иначе страница читается как две разные.

import type { ReactNode } from 'react'

/** Тон пояснения: нейтральное, хорошее, тревожное. Само значение цвет не меняет. */
export type StatTone = 'neutral' | 'positive' | 'warning' | 'danger'

export interface StatCardProps {
  label: string
  value: ReactNode
  /** Вторая строка: динамика, доля, уточнение. Нет данных — не рисуется вовсе. */
  hint?: ReactNode
  tone?: StatTone
  /** Плотный вариант — ряд «быстрых фактов» внутри карточки. */
  compact?: boolean
  className?: string
  testId?: string
}

export function StatCard({ label, value, hint, tone = 'neutral', compact = false, className, testId }: StatCardProps): JSX.Element {
  return (
    <article
      className={['vc-stat', compact && 'vc-stat--compact', className].filter(Boolean).join(' ')}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <span className="vc-stat__label">{label}</span>
      <strong className="vc-stat__value">{value}</strong>
      {hint !== undefined && hint !== null && hint !== '' && (
        <small className={['vc-stat__hint', tone !== 'neutral' && `vc-stat__hint--${tone}`].filter(Boolean).join(' ')}>{hint}</small>
      )}
    </article>
  )
}

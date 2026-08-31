// Сводка рана: длительность, машина, модель — три подписанных числа в ряд.
//
// Это список определений, а не таблица и не набор div-ов: подпись и значение
// связаны семантически, поэтому скринридер читает «Машина — MacBook, online», а
// не две несвязанные строки подряд.

import type { CSSProperties, ReactNode } from 'react'

/** Тон пояснения: нейтральное, хорошее, тревожное. Значение цвет не меняет. */
export type MetricTone = 'neutral' | 'positive' | 'warning' | 'danger'

export interface MetricItem {
  /** Подпись: «Длительность», «Машина». */
  label: string
  value: ReactNode
  /** Полное значение под курсором, если видимое обрезано. */
  title?: string
  /**
   * Вторая строка: динамика, доля, уточнение. Пустой подсказки не бывает — если
   * данных нет, строка не рисуется вовсе, а не показывает «—».
   */
  hint?: ReactNode
  tone?: MetricTone
}

export interface MetricGridProps {
  items: readonly MetricItem[]
  /** Сколько колонок на десктопе; на телефоне колонка всегда одна. */
  columns?: number
  /** Имя группы для скринридера: «Сводка». Без него набор чисел безымянный. */
  ariaLabel?: string
  /** Плотный вариант: ряд «быстрых фактов» внутри карточки. */
  compact?: boolean
  className?: string
  testId?: string
}

export function MetricGrid({ items, columns = 3, ariaLabel, compact = false, className, testId = 'metric-grid' }: MetricGridProps): JSX.Element {
  return (
    <dl
      className={['vc-metrics', compact && 'vc-metrics--compact', className].filter(Boolean).join(' ')}
      style={{ '--vc-metrics-columns': String(Math.max(1, columns)) } as CSSProperties}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
      data-testid={testId}
    >
      {items.map((item) => (
        <div className="vc-metric" key={item.label}>
          <dt className="vc-metric__label">{item.label}</dt>
          <dd className="vc-metric__value" {...(item.title ? { title: item.title } : {})}>{item.value}</dd>
          {item.hint !== undefined && item.hint !== null && item.hint !== '' && (
            <dd className={['vc-metric__hint', item.tone && item.tone !== 'neutral' && `vc-metric__hint--${item.tone}`].filter(Boolean).join(' ')}>
              {item.hint}
            </dd>
          )}
        </div>
      ))}
    </dl>
  )
}

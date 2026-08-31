// Сводка рана: длительность, машина, модель — три подписанных числа в ряд.
//
// Это список определений, а не таблица и не набор div-ов: подпись и значение
// связаны семантически, поэтому скринридер читает «Машина — MacBook, online», а
// не две несвязанные строки подряд.

import type { CSSProperties, ReactNode } from 'react'

export interface MetricItem {
  /** Подпись: «Длительность», «Машина». */
  label: string
  value: ReactNode
  /** Полное значение под курсором, если видимое обрезано. */
  title?: string
}

export interface MetricGridProps {
  items: readonly MetricItem[]
  /** Сколько колонок на десктопе; на телефоне колонка всегда одна. */
  columns?: number
  className?: string
  testId?: string
}

export function MetricGrid({ items, columns = 3, className, testId = 'metric-grid' }: MetricGridProps): JSX.Element {
  return (
    <dl
      className={['vc-metrics', className].filter(Boolean).join(' ')}
      style={{ '--vc-metrics-columns': String(Math.max(1, columns)) } as CSSProperties}
      data-testid={testId}
    >
      {items.map((item) => (
        <div className="vc-metric" key={item.label}>
          <dt className="vc-metric__label">{item.label}</dt>
          <dd className="vc-metric__value" {...(item.title ? { title: item.title } : {})}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

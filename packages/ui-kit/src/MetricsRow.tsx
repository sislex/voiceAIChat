// Полоса метрик: одинаковая сетка и одинаковые переносы для любых StatCard.
//
// Каждая страница задавала свой grid-template-columns и свои брейкпойнты, и
// метрики «сползали» по-разному: где-то 2×2 на планшете, где-то 4×1 до самого
// телефона. Сетка — свойство полосы, а не страницы.

import type { ReactNode } from 'react'

export interface MetricsRowProps {
  children: ReactNode
  /** Подпись группы для скринридера: «Сводка». */
  label: string
  className?: string
  testId?: string
}

export function MetricsRow({ children, label, className, testId }: MetricsRowProps): JSX.Element {
  return (
    <section className={['vc-metrics', className].filter(Boolean).join(' ')} aria-label={label} {...(testId ? { 'data-testid': testId } : {})}>
      {children}
    </section>
  )
}

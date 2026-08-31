// Лозенга состояния рана: «Успешно», «Выполняется», «Требует внимания».
//
// До неё каждая вкладка карточки задачи рисовала статус по-своему: подготовка —
// текстом, QA — своим `.qa-status`, merge — `.merge-chip`, CI — `.lozenge`.
// Четыре формы для одного смысла, и ни одна не совпадала с соседней по высоте.
//
// Тон — семантический, а не цвет: правило «жёлтый» пришлось бы помнить на месте
// вызова, а `warning` переживает смену палитры и тёмную тему.

import type { ReactNode } from 'react'

/** neutral — нет данных, running — идёт, warning — требует внимания, danger — упало. */
export type StatusTone = 'neutral' | 'running' | 'success' | 'warning' | 'danger'

export interface StatusPillProps {
  tone?: StatusTone
  /** Подпись: короткая и на русском — она же читается скринридером. */
  children: ReactNode
  className?: string
  testId?: string
}

export function StatusPill({ tone = 'neutral', children, className, testId = 'status-pill' }: StatusPillProps): JSX.Element {
  return (
    <span className={['vc-pill', `vc-pill--${tone}`, className].filter(Boolean).join(' ')} data-tone={tone} data-testid={testId}>
      {children}
    </span>
  )
}

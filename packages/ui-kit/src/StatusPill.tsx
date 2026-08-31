// Лозенга состояния рана — это тот же бейдж, что и всюду.
//
// Два компонента об одном смысле разошлись бы в первой же правке палитры,
// поэтому здесь остался только адаптер имени: разметку и тона держит `Badge`.
// Новый код зовёт `Badge` напрямую.

import { Badge, type BadgeTone } from './Badge'
import type { ReactNode } from 'react'

/** Тон состояния: тот же набор, что у бейджа. */
export type StatusTone = BadgeTone

export interface StatusPillProps {
  tone?: StatusTone
  /** Подпись: короткая и на русском — она же читается скринридером. */
  children: ReactNode
  className?: string
  testId?: string
}

export function StatusPill({ tone = 'neutral', children, className, testId = 'status-pill' }: StatusPillProps): JSX.Element {
  return <Badge tone={tone} className={className} testId={testId}>{children}</Badge>
}

// Бейдж состояния: роль, «активен», «заблокирован», версия агента.
//
// До этого каждая страница рисовала свой: `.ublock` в админке с зашитым #c0392b,
// инлайновые `<span>` в списке сессий, `MachineHealthBadge` в машинах. Разные
// формы одного и того же читались как разные сущности, а зашитый цвет не
// переживал тёмную тему.

import type { ReactNode } from 'react'

/** Тон бейджа — по смыслу состояния, а не по желаемому цвету. */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export interface BadgeProps {
  children: ReactNode
  tone?: BadgeTone
  /** Пояснение при наведении: почему состояние такое. */
  title?: string
  className?: string
  testId?: string
}

export function Badge({ children, tone = 'neutral', title, className, testId }: BadgeProps): JSX.Element {
  return (
    <span
      className={['vc-badge', `vc-badge--${tone}`, className].filter(Boolean).join(' ')}
      {...(title ? { title } : {})}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {children}
    </span>
  )
}

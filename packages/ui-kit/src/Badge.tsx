// Бейдж состояния: роль, «активен», «заблокирован», версия агента, исход рана.
//
// До него каждая страница рисовала свой: `.ublock` в админке с зашитым #c0392b,
// инлайновые `<span>` в списке сессий, `.qa-status` и `.merge-chip` во вкладках
// карточки задачи, `MachineHealthBadge` в машинах. Разные формы одного и того же
// читались как разные сущности, а зашитый цвет не переживал тёмную тему.
//
// Тон семантический, а не цвет: правило «жёлтый» пришлось бы помнить на месте
// вызова, а `warning` переживает смену палитры и тёмную тему.

import type { ReactNode } from 'react'

/**
 * Тон бейджа — по смыслу состояния, а не по желаемому цвету.
 * `running` — работа идёт, `accent` — выделение (роль, режим).
 */
export type BadgeTone = 'neutral' | 'accent' | 'running' | 'success' | 'warning' | 'danger'

/** Прежнее имя тона из карточки задачи: смысл тот же. */
export type StatusTone = BadgeTone

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
      // Класс `.vc-pill` — общий для всех лозенг приложения: на него смотрит
      // сторож стилей карточки задачи, и второй набор классов означал бы второй
      // вид у одного смысла.
      className={['vc-pill', `vc-pill--${tone}`, className].filter(Boolean).join(' ')}
      // Тон в атрибуте: по нему цепляются тесты вкладок карточки задачи, где
      // важно не «какой класс», а «какое состояние показано».
      data-tone={tone}
      {...(title ? { title } : {})}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {children}
    </span>
  )
}

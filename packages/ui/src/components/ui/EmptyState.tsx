// Единый пустой экран.
//
// Раньше пустота выглядела по-разному: `.pb-empty` в AI-помощнике был
// единственным оформленным вариантом, где-то стоял серый текст «Нет машин», а
// где-то просто ничего не рисовалось. Теперь форма одна: иконка, заголовок,
// поясняющий текст и необязательное действие.
//
// Тексты объясняют следующий шаг, а не констатируют пустоту: не «Нет бесед», а
// «Пока нет бесед — начните первую». Формулировка «нет данных» не говорит
// пользователю, что делать, и не отличима от поломки.

import type { ReactNode } from 'react'
import { Button } from './Button'

export interface EmptyStateProps {
  /** Глиф или SVG. По умолчанию нейтральный кружок — цвет от `currentColor`. */
  icon?: ReactNode
  /** Что пусто и что будет дальше: «Пока нет бесед — начните первую». */
  title: string
  /** Пояснение: как именно появится содержимое. */
  description?: string
  /** Подпись кнопки действия; без `onAction` кнопки не будет. */
  actionLabel?: string
  onAction?: () => void
  /** Плотный вариант: колонка канбана, узкая панель, секция внутри страницы. */
  compact?: boolean
  className?: string
  testId?: string
}

export function EmptyState({
  icon = '◌',
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
  className,
  testId = 'empty-state'
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={['vc-state', 'vc-state--empty', compact && 'vc-state--compact', className].filter(Boolean).join(' ')}
      data-testid={testId}
    >
      {icon !== false && icon != null && (
        <span className="vc-state__ico" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="vc-state__title">{title}</p>
      {description && <p className="vc-state__text">{description}</p>}
      {actionLabel && onAction && (
        <Button variant="primary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}

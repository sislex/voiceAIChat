// Плавающая полоса действий: «есть несохранённые изменения».
//
// Черновик, о котором человек забыл, — потерянная работа. Полоса висит поверх
// страницы, пока изменения не сохранены или не отменены, и объявляется
// скринридеру как статус: это сообщение о состоянии, а не запрос ввода.

import type { ReactNode } from 'react'

export interface StickyActionBarProps {
  /** Скрытая полоса не удаляется из дерева: так работает анимация появления. */
  open: boolean
  title: string
  /** Что именно изменено: «Настройки доступа изменены». */
  hint?: string
  children: ReactNode
  className?: string
  testId?: string
}

export function StickyActionBar({ open, title, hint, children, className, testId = 'sticky-action-bar' }: StickyActionBarProps): JSX.Element {
  return (
    <div
      className={['vc-actionbar', open && 'vc-actionbar--on', className].filter(Boolean).join(' ')}
      role="status"
      aria-hidden={!open}
      data-testid={testId}
    >
      <div className="vc-actionbar__text">
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </div>
      <div className="vc-actionbar__actions">{children}</div>
    </div>
  )
}

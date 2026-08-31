// Строка над содержимым: сводка слева, действия справа.
//
// Повторялась в матрице доступа («N разрешено · M запрещено» + две кнопки) и в
// списке людей («N пользователей» + порядок). Разные отступы и разное поведение
// на переносе строки делали их непохожими, хотя это одна и та же форма.

import type { ReactNode } from 'react'

export interface ToolbarProps {
  /** Левая часть: сводка или счётчик. */
  summary: ReactNode
  /** Правая часть: действия. Нет — строка остаётся только сводкой. */
  children?: ReactNode
  /** Плотный вариант без подложки — для строки счётчика в узком списке. */
  bare?: boolean
  /**
   * Объявлять изменения сводки скринридеру: список после фильтрации молча
   * менял число строк, и незрячий человек не узнавал результат поиска.
   */
  live?: boolean
  className?: string
  testId?: string
}

export function Toolbar({ summary, children, bare = false, live = false, className, testId }: ToolbarProps): JSX.Element {
  return (
    <div className={['vc-toolbar', bare && 'vc-toolbar--bare', className].filter(Boolean).join(' ')} {...(testId ? { 'data-testid': testId } : {})}>
      <span className="vc-toolbar__summary" {...(live ? { role: 'status', 'aria-live': 'polite' } : {})}>{summary}</span>
      {children && <span className="vc-toolbar__actions">{children}</span>}
    </div>
  )
}

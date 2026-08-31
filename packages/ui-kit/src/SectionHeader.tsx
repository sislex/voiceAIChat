// Заголовок секции: название слева, необязательная сводка и текстовое действие
// справа.
//
// До него у «Описания» и «Критериев приёмки» действие было иконкой-карандашом
// (что она делает, узнавали наведением), у «Подзадач» заголовок стоял голым
// `h3`, а у «Активности» его не было вовсе.

import type { ReactNode } from 'react'

export interface SectionHeaderProps {
  title: ReactNode
  /**
   * Уровень заголовка. По умолчанию 3: секция живёт внутри окна, чей заголовок —
   * h2, и h2 здесь ломал бы порядок уровней.
   */
  level?: 2 | 3 | 4
  /** Короткая сводка рядом с названием: «2 из 3». */
  meta?: ReactNode
  /** Действие справа — обычно текстовая кнопка. */
  action?: ReactNode
  className?: string
  testId?: string
}

export function SectionHeader({ title, level = 3, meta, action, className, testId }: SectionHeaderProps): JSX.Element {
  const Heading = `h${level}` as 'h2' | 'h3' | 'h4'
  return (
    <div className={['vc-section-head', className].filter(Boolean).join(' ')} {...(testId ? { 'data-testid': testId } : {})}>
      <Heading className="vc-section-head__title">{title}</Heading>
      {meta != null && <span className="vc-section-head__meta">{meta}</span>}
      {action != null && <span className="vc-section-head__action">{action}</span>}
    </div>
  )
}

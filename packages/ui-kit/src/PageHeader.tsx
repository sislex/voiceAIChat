// Шапка страницы: надзаголовок, заголовок и действия.
//
// Форма повторилась в разделе людей, на служебных страницах и в «Моём аккаунте»,
// и каждый раз с чуть другими отступами и поведением на переносе. Разный вид
// одинаковых шапок читается как разные разделы приложения.

import type { ReactNode } from 'react'

export interface PageHeaderProps {
  /** Надзаголовок: «Администрирование». Необязателен. */
  eyebrow?: string
  title: ReactNode
  /** Уровень заголовка. Страница внутри окна начинается не с h1. */
  level?: 1 | 2
  children?: ReactNode
  className?: string
  testId?: string
}

export function PageHeader({ eyebrow, title, level = 1, children, className, testId }: PageHeaderProps): JSX.Element {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <header className={['vc-pagehead', className].filter(Boolean).join(' ')} {...(testId ? { 'data-testid': testId } : {})}>
      <div className="vc-pagehead__title">
        {eyebrow && <p className="vc-pagehead__eyebrow">{eyebrow}</p>}
        <Heading>{title}</Heading>
      </div>
      {children && <div className="vc-pagehead__actions">{children}</div>}
    </header>
  )
}

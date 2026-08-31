// Шапка панели вкладки: надзаголовок, заголовок, пояснение и действия справа.
//
// Десять вкладок карточки задачи писали шапку каждая по-своему — где-то h3, где-то
// просто жирный span, где-то заголовка не было вовсе, и вкладка начиналась сразу
// с таблицы. Форма одна: что это (`kicker` — «Попытка 2», «Merge run #4»), что
// показано (`title`) и зачем (`description`).

import type { ReactNode } from 'react'

export interface PanelHeadingProps {
  /** Надзаголовок: попытка, номер рана, режим. */
  kicker?: ReactNode
  title: ReactNode
  /** Одна строка о том, что делает этот этап. */
  description?: ReactNode
  /** Лозенга состояния или кнопка справа. */
  actions?: ReactNode
  /**
   * Уровень заголовка. По умолчанию 3: панель живёт внутри окна, чей заголовок —
   * h2, и h2 здесь ломал бы порядок уровней. Уровень 1 — для шапки целой
   * страницы (раздел «Пользователи», «Мой аккаунт»).
   */
  level?: 1 | 2 | 3 | 4
  /** id заголовка — чтобы панель могла сослаться на него `aria-labelledby`. */
  titleId?: string
  className?: string
  testId?: string
}

export function PanelHeading({
  kicker,
  title,
  description,
  actions,
  level = 3,
  titleId,
  className,
  testId = 'panel-heading'
}: PanelHeadingProps): JSX.Element {
  const Heading = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4'
  return (
    <div className={['vc-panel-head', level === 1 && 'vc-panel-head--page', className].filter(Boolean).join(' ')} data-testid={testId}>
      <div className="vc-panel-head__text">
        {kicker != null && <span className="vc-panel-head__kicker">{kicker}</span>}
        <Heading className="vc-panel-head__title" {...(titleId ? { id: titleId } : {})}>{title}</Heading>
        {description != null && <p className="vc-panel-head__desc">{description}</p>}
      </div>
      {actions != null && <div className="vc-panel-head__actions">{actions}</div>}
    </div>
  )
}

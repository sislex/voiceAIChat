// «История попыток» этапа: номер, статус, время.
//
// Этот блок был скопирован в четырёх панелях (Component QA, интеграционные
// тесты, общий этап, подготовка), и каждая копия расходилась: где-то `ol` с
// сырым статусом, где-то кнопка выбора попытки, где-то без даты вовсе.
//
// Порядок значим (попытка 2 после попытки 1), поэтому `ol`. Выбор попытки —
// кнопка с `aria-current`: `aria-selected` допустим только внутри listbox/grid,
// а здесь обычный список.

import type { ReactNode } from 'react'
import type { StatusTone } from './StatusPill'

export interface AttemptItem {
  id: string
  /** Номер попытки — он же подпись «#N». */
  attempt: number
  /** Статус словом, по-русски. */
  status: ReactNode
  tone?: StatusTone
  /** Когда: уже отформатированная строка. */
  at?: ReactNode
  /** Дополнительное поле строки: модель, SHA. */
  note?: ReactNode
}

export interface AttemptHistoryProps {
  attempts: readonly AttemptItem[]
  /** Заголовок блока; он же имя списка для скринридера. */
  title?: string
  /** Выбранная попытка — если панель позволяет переключаться. */
  selectedId?: string
  onSelect?: (id: string) => void
  className?: string
  testId?: string
}

export function AttemptHistory({
  attempts,
  title = 'История попыток',
  selectedId,
  onSelect,
  className,
  testId = 'attempt-history'
}: AttemptHistoryProps): JSX.Element {
  return (
    <section className={['vc-attempts', className].filter(Boolean).join(' ')} data-testid={testId}>
      <h4 className="vc-attempts__title">{title} <span className="vc-attempts__count">{attempts.length}</span></h4>
      <ol className="vc-attempts__list" aria-label={title}>
        {attempts.map((item) => {
          const selected = selectedId != null && selectedId === item.id
          const row = <>
            <span className="vc-attempts__num">#{item.attempt}</span>
            <span className={`vc-feed-dot vc-feed-dot--${item.tone === 'success' ? 'success' : item.tone === 'danger' ? 'danger' : item.tone === 'running' || item.tone === 'warning' ? 'progress' : 'muted'}`} aria-hidden="true" />
            <span className="vc-attempts__status">{item.status}</span>
            {item.note != null && <span className="vc-attempts__note">{item.note}</span>}
            {item.at != null && <time className="vc-attempts__at">{item.at}</time>}
          </>
          return (
            <li className="vc-attempts__item" key={item.id} data-tone={item.tone ?? 'neutral'}>
              {onSelect
                ? <button
                  type="button"
                  className={selected ? 'vc-attempts__row vc-attempts__row--current' : 'vc-attempts__row'}
                  {...(selected ? { 'aria-current': 'true' as const } : {})}
                  onClick={() => onSelect(item.id)}
                >{row}</button>
                : <span className="vc-attempts__row">{row}</span>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

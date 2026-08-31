// Таблица «проверка | результат»: сценарии QA, интеграционные тесты.
//
// Раньше это был `ul` со строками вида «Навигация с клавиатуры — running»: и
// сырой статус, и никакой связи между проверкой и её результатом для читалки.
// Настоящая таблица даёт заголовки колонок и навигацию по ячейкам.

import type { ReactNode } from 'react'
import type { StatusTone } from './StatusPill'

export interface ResultRow {
  id?: string
  /** Что проверяли. */
  name: ReactNode
  /** Результат словом: «Пройдено», «В работе». */
  result: ReactNode
  tone?: StatusTone
  /** Подробность под названием: фактический результат, причина падения. */
  detail?: ReactNode
}

export interface ResultTableProps {
  rows: readonly ResultRow[]
  /** Имя таблицы для скринридера: «Сценарии Component QA». */
  caption: string
  /** Подпись колонки результата; колонка проверки всегда «Проверка». */
  resultLabel?: string
  className?: string
  testId?: string
}

export function ResultTable({
  rows,
  caption,
  resultLabel = 'Результат',
  className,
  testId = 'result-table'
}: ResultTableProps): JSX.Element {
  return (
    <table className={['vc-results', className].filter(Boolean).join(' ')} data-testid={testId}>
      {/* Подпись видимая: у таблицы внутри вкладки иначе нет имени, а
          `aria-label` на таблице читалки объявляют непоследовательно. */}
      <caption className="vc-results__caption">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Проверка</th>
          <th scope="col">{resultLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.id ?? index} data-tone={row.tone ?? 'neutral'}>
            <th scope="row">
              <span className="vc-results__name">{row.name}</span>
              {row.detail != null && <span className="vc-results__detail">{row.detail}</span>}
            </th>
            <td className={`vc-results__result vc-results__result--${row.tone ?? 'neutral'}`}>{row.result}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

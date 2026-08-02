// Таблица разделов: что модель запрашивала, сколько раз и сколько это дало ей
// символов/токенов. Сортировка объявлена через aria-sort (скринридер читает
// порядок), а название раздела — кнопка, а не клик по <tr>: строка таблицы не
// фокусируется с клавиатуры.

import { useMemo, useState } from 'react'
import type { KbUsageSectionAggregate } from '@shared/kb'
import { EmptyState } from '../ui/EmptyState'
import { KbFreshnessChip } from './KbFreshnessChip'
import { num, timeOf } from './kbUsageFormat'

export type KbSectionSort = 'times' | 'chars' | 'tokens' | 'last'

const COLUMNS: Array<{ id: KbSectionSort; label: string; numeric: boolean }> = [
  { id: 'times', label: 'обращений', numeric: true },
  { id: 'chars', label: 'символы', numeric: true },
  { id: 'tokens', label: '≈ токены', numeric: true },
  { id: 'last', label: 'последнее', numeric: true }
]

export interface KbUsageSectionsProps {
  sections: KbUsageSectionAggregate[]
  /** Проектный агрегат показывает ещё и число чатов на раздел. */
  withConversations?: boolean
  /** Открыть документ БЗ (переход на #/kb/:documentId). */
  onOpenDocument?: (documentId: string, anchor: string) => void
}

export function KbUsageSections({ sections, withConversations = false, onOpenDocument }: KbUsageSectionsProps): JSX.Element {
  const [sort, setSort] = useState<KbSectionSort>('times')
  const rows = useMemo(() => {
    const value = (item: KbUsageSectionAggregate): number =>
      sort === 'chars' ? item.chars : sort === 'tokens' ? item.estimatedTokens : sort === 'last' ? item.lastAt : item.times
    return [...sections].sort((a, b) => value(b) - value(a) || a.title.localeCompare(b.title, 'ru'))
  }, [sections, sort])

  if (!sections.length) {
    return (
      <EmptyState
        compact
        icon="📚"
        title="Разделов пока нет"
        description="Здесь появятся разделы базы знаний, которые получила модель."
        testId="kb-usage-sections-empty"
      />
    )
  }
  return (
    <table className="kbu-table" data-testid="kb-usage-sections">
      <caption className="vc-sr-only">Разделы базы знаний, полученные моделью</caption>
      <thead>
        <tr>
          <th scope="col">Документ и раздел</th>
          {COLUMNS.map((column) => (
            <th key={column.id} scope="col" aria-sort={sort === column.id ? 'descending' : 'none'}>
              <button
                className={sort === column.id ? 'kbu-sort on' : 'kbu-sort'}
                onClick={() => setSort(column.id)}
                aria-label={`Сортировать по «${column.label}»`}
                title={`Сортировать по «${column.label}»`}
              >
                {column.label}
              </button>
            </th>
          ))}
          {withConversations && <th scope="col">чатов</th>}
          <th scope="col">источник</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((item) => {
          const label = `${item.title}${item.heading && item.heading !== item.title ? ` / ${item.heading}` : ''}`
          return (
            <tr key={`${item.documentId}#${item.anchor}`}>
              <th scope="row">
                {onOpenDocument ? (
                  <button
                    className="kbu-doc"
                    onClick={() => onOpenDocument(item.documentId, item.anchor)}
                    title={`Открыть «${label}» в базе знаний`}
                  >
                    {label}
                  </button>
                ) : (
                  <span className="kbu-doc">{label}</span>
                )}
                <span className="kbu-path">{item.sourcePath}</span>
                <KbFreshnessChip freshness={item.freshness} />
              </th>
              <td>{num(item.times)}</td>
              <td>{num(item.chars)}</td>
              <td>{num(item.estimatedTokens)}</td>
              <td>{timeOf(item.lastAt)}</td>
              {withConversations && <td>{num(item.conversations ?? 1)}</td>}
              <td>{item.autoTimes === item.times ? 'авто-контекст' : item.autoTimes ? `модель + авто (${num(item.autoTimes)})` : 'запрос модели'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

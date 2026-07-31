// Лента обращений: пока БЗ ищет — «запрашивает…», дальше статус и числа. Живой
// элемент помечен aria-live: обращение появляется без действий пользователя, и
// об изменении нужно сообщить, не перетаскивая фокус.

import type { KbUsageQuery } from '@shared/kb'
import { EmptyState } from '../ui/EmptyState'
import { Dots } from '../animations'
import { num, queryLabel, SOURCE_LABEL, STATUS_LABEL, timeOf } from './kbUsageFormat'

export interface KbUsageFeedProps {
  queries: KbUsageQuery[]
  /** Показывать чат каждого обращения (вкладка «По проекту»). */
  titleOf?: (conversationId: string) => string | undefined
}

export function KbUsageFeed({ queries, titleOf }: KbUsageFeedProps): JSX.Element {
  if (!queries.length) {
    return (
      <EmptyState
        compact
        icon="🕑"
        title="Обращений ещё не было"
        description="Как только модель обратится к базе знаний, событие появится здесь."
        testId="kb-usage-feed-empty"
      />
    )
  }
  return (
    <ul className="kbu-feed" data-testid="kb-usage-feed" aria-live="polite" aria-label="Лента обращений к базе знаний">
      {queries.map((query) => (
        <li key={query.id} className={`kbu-ev kbu-ev--${query.status}`}>
          <span className="kbu-ev__time">{timeOf(query.createdAt)}</span>
          <span className="kbu-ev__src">{SOURCE_LABEL[query.source]}</span>
          <span className="kbu-ev__q">{queryLabel(query)}</span>
          <span className="kbu-ev__st">
            {query.status === 'pending' ? (
              <>
                <Dots /> запрашивает…
              </>
            ) : (
              STATUS_LABEL[query.status]
            )}
          </span>
          <span className="kbu-ev__nums">
            {query.status === 'delivered'
              ? `${num(query.sectionsCount)} разд. · ${num(query.chars)} симв. · ≈ ${num(query.estimatedTokens)} ток.`
              : query.error ?? ''}
          </span>
          {titleOf && <span className="kbu-ev__chat">{titleOf(query.conversationId) ?? 'чат удалён'}</span>}
        </li>
      ))}
    </ul>
  )
}

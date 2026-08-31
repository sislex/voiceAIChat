// Обзор: последняя активность, на что уходят деньги и опасная зона.

import { Badge, Button, EmptyState, ProgressBar } from '@voicechat/ui-kit'
import type { ProfileCapabilities, ProfileConversation, ProfileSecurityEvent, ProfileUsage, ProfileUser } from '../contracts'
import { activityFeed, formatUsd, modelShares } from '../model'
import { formatAgo } from '../format'

export interface OverviewTabProps {
  user: ProfileUser
  usage: ProfileUsage | null
  events: readonly ProfileSecurityEvent[]
  conversations: readonly ProfileConversation[]
  capabilities: ProfileCapabilities
  now: number
  periodLabel: string
  onOpenHistory?: () => void
  onBlock?: () => void
}

export function OverviewTab({ user, usage, events, conversations, capabilities, now, periodLabel, onOpenHistory, onBlock }: OverviewTabProps): JSX.Element {
  const feed = activityFeed(events, conversations, 5)
  const shares = usage ? modelShares(usage) : []
  return (
    <div className="vcp-overview">
      <div className="vcp-overview__grid">
        <article className="vcp-card" data-testid="activity-card">
          <div className="vcp-card__title">
            <div><h3>Активность</h3><p>Последние события и разговоры</p></div>
            {onOpenHistory && <Button size="sm" variant="ghost" onClick={onOpenHistory}>Вся история →</Button>}
          </div>
          {feed.length === 0
            ? <EmptyState compact icon="✦" title="Событий пока нет" description="Здесь появятся входы, изменения учётки и разговоры." />
            : (
              <ul className="vcp-feed" role="list">
                {feed.map((item) => (
                  <li key={item.id}>
                    <span className={`vcp-feed__ico vcp-feed__ico--${item.kind}`} aria-hidden="true">{item.kind === 'security' ? '✦' : '💬'}</span>
                    <p>
                      <b>{item.title}</b>
                      <small>{[item.detail, formatAgo(item.at, now)].filter(Boolean).join(' · ')}</small>
                    </p>
                  </li>
                ))}
              </ul>
            )}
        </article>

        <article className="vcp-card" data-testid="spend-card">
          <div className="vcp-card__title">
            <div><h3>Расход по моделям</h3><p>{periodLabel}</p></div>
            <b>{usage ? formatUsd(usage.spendUsd, usage.spendIncomplete) : '—'}</b>
          </div>
          {shares.length === 0
            ? <EmptyState compact icon="📊" title="Расхода пока нет" description="Появится после первых ответов модели за выбранный период." />
            : (
              <ul className="vcp-bars" role="list">
                {shares.map((item) => (
                  <li key={item.model}>
                    <span className="vcp-bars__label">
                      <span>{item.model}</span>
                      <b>{formatUsd(item.spendUsd, item.incomplete)}</b>
                    </span>
                    <ProgressBar
                      className="vcp-bars__track"
                      value={item.share}
                      label={`Доля расхода: ${item.model}`}
                      valueText={formatUsd(item.spendUsd, item.incomplete)}
                    />
                  </li>
                ))}
              </ul>
            )}
        </article>
      </div>

      {capabilities.canBlock && onBlock && (
        <article className="vcp-card vcp-danger" data-testid="danger-zone">
          <div>
            <h3>Ограничения учётной записи</h3>
            <p>{user.blocked ? 'Учётка заблокирована: входы запрещены.' : 'Блокировка завершит активные сессии и запретит новые подключения.'}</p>
          </div>
          <Button variant={user.blocked ? 'ghost' : 'danger'} onClick={onBlock}>{user.blocked ? 'Разблокировать' : 'Заблокировать'}</Button>
        </article>
      )}
      {!capabilities.canBlock && user.blocked && (
        <article className="vcp-card vcp-danger" data-testid="danger-zone">
          <div><h3>Учётка заблокирована</h3><p>Входы запрещены. Снять блокировку может администратор.</p></div>
          <Badge tone="danger">заблокирован</Badge>
        </article>
      )}
    </div>
  )
}

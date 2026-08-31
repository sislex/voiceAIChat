// Недавно завершённые сессии. Отдельный свёрнутый список, а не часть основного:
// после отзыва человек должен убедиться, что закрыл именно тот вход, — но
// каждый день это ему не нужно, поэтому раздел закрыт по умолчанию.
import { deviceIcon, parseUserAgent, sessionTitle, type DeviceSession } from '@voicechat/sessions-core'
import { formatMoment } from './format'
import type { SessionsTexts } from './texts'

export interface EndedSessionsProps {
  /** Что показывать: уже отфильтровано и подрезано стором. */
  sessions: DeviceSession[] | null
  /** Сколько записей скрыто за кнопкой «показать ещё». */
  hidden?: number
  query?: string
  texts: SessionsTexts
  locale: string
  onOpen(): void
  onQuery?(value: string): void
  onMore?(): void
}

export function EndedSessions({ sessions, hidden = 0, query = '', texts, locale, onOpen, onQuery, onMore }: EndedSessionsProps): JSX.Element {
  return (
    <details
      className="vcs-ended"
      data-testid="sessions-ended"
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) onOpen() }}
    >
      <summary>{texts.endedTitle}</summary>
      {sessions === null ? (
        <p className="vcs-note">{texts.loading}</p>
      ) : sessions.length === 0 ? (
        <p className="vcs-note">{texts.endedEmpty}</p>
      ) : (
        <>
        {onQuery && (
          <label className="vcs-search">
            <span className="vcs-search-label">{texts.endedSearchLabel}</span>
            <input className="vcs-input" type="search" value={query} placeholder={texts.searchPlaceholder} onChange={(e) => onQuery(e.target.value)} />
          </label>
        )}
        <ul className="vcs-list" role="list">
          {sessions.map((session) => (
            <li key={session.sid} className="vcs-item vcs-item--ended" data-testid={`ended-${session.sid}`}>
              <span className="vcs-ico" aria-hidden="true">{deviceIcon(parseUserAgent(session.userAgent).kind)}</span>
              <div className="vcs-main">
                <p className="vcs-head"><strong className="vcs-title">{sessionTitle(session) || texts.legacyTitle}</strong></p>
                <small className="vcs-meta">
                  {[
                    session.geo?.label || session.ip || texts.unknownPlace,
                    texts.endedAt(formatMoment(session.endedAt ?? session.expiresAt, locale)),
                    texts.endReason(session.endReason ?? 'revoked')
                  ].join(' · ')}
                </small>
              </div>
            </li>
          ))}
        </ul>
        {hidden > 0 && onMore && (
          <button type="button" className="vcs-more" onClick={onMore}>{texts.showMore(hidden)}</button>
        )}
        </>
      )}
    </details>
  )
}

// Недавно завершённые сессии. Отдельный свёрнутый список, а не часть основного:
// после отзыва человек должен убедиться, что закрыл именно тот вход, — но
// каждый день это ему не нужно, поэтому раздел закрыт по умолчанию.
import { deviceIcon, parseUserAgent, sessionTitle, type DeviceSession } from '@voicechat/sessions-core'
import { formatMoment } from './format'
import type { SessionsTexts } from './texts'

export interface EndedSessionsProps {
  sessions: DeviceSession[] | null
  texts: SessionsTexts
  locale: string
  onOpen(): void
}

export function EndedSessions({ sessions, texts, locale, onOpen }: EndedSessionsProps): JSX.Element {
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
        <ul className="vcs-list" role="list">
          {sessions.map((session) => (
            <li key={session.sid} className="vcs-item vcs-item--ended" data-testid={`ended-${session.sid}`}>
              <span className="vcs-ico" aria-hidden="true">{deviceIcon(parseUserAgent(session.userAgent).kind)}</span>
              <div className="vcs-main">
                <p className="vcs-head"><strong className="vcs-title">{sessionTitle(session) || texts.legacyTitle}</strong></p>
                <small className="vcs-meta">
                  {[session.geo?.label || session.ip || texts.unknownPlace, texts.endedAt(formatMoment(session.endedAt ?? session.expiresAt, locale))].join(' · ')}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

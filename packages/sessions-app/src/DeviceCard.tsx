// Карточка одного устройства. Всё, что она показывает, уже вычислено ядром
// (SessionView): здесь только раскладка, тексты и локальный режим переименования.
import { useEffect, useRef, useState } from 'react'
import { deviceIcon, type SessionView } from '@voicechat/sessions-core'
import { Button } from '@voicechat/ui-kit'
import { formatDuration, formatMoment } from './format'
import type { SessionsTexts } from './texts'

export interface DeviceCardProps {
  view: SessionView
  texts: SessionsTexts
  locale: string
  /** Момент, относительно которого считаются «назад» и «истекает через». */
  now: number
  /** По этой карточке идёт действие — кнопки заняты. */
  busy: boolean
  canRename: boolean
  canTrust: boolean
  onRevoke(): void
  onRename(label: string | null): void
  onTrust(trusted: boolean): void
}

export function DeviceCard({ view, texts, locale, now, busy, canRename, canTrust, onRevoke, onRename, onTrust }: DeviceCardProps): JSX.Element {
  const { session, profile, title, online, trusted, current } = view
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.label ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const save = (): void => {
    const next = draft.trim()
    setEditing(false)
    // Пустое имя — это не «стереть подпись», а «вернуть автоматическую».
    if (next !== (session.label ?? '')) onRename(next || null)
  }

  const place = view.place || session.ip || texts.unknownPlace
  const expiry = view.expiresInMs > 0 ? texts.expiresIn(formatDuration(view.expiresInMs)) : texts.expired

  return (
    <li className={current ? 'vcs-item vcs-item--current' : 'vcs-item'} data-testid={`session-${session.sid}`}>
      <span className="vcs-ico" aria-hidden="true">{deviceIcon(profile.kind)}</span>
      <div className="vcs-main">
        {editing ? (
          <div className="vcs-rename">
            <label className="vcs-rename-label" htmlFor={`rename-${session.sid}`}>{texts.renameLabel}</label>
            <input
              id={`rename-${session.sid}`}
              ref={inputRef}
              className="vcs-input"
              value={draft}
              maxLength={60}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
            <Button size="sm" variant="primary" onClick={save}>{texts.renameSave}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{texts.renameCancel}</Button>
          </div>
        ) : (
          <p className="vcs-head">
            <strong className="vcs-title">{title}</strong>
            {current && <span className="vcs-badge vcs-badge--current">{texts.currentBadge}</span>}
            {trusted && <span className="vcs-badge vcs-badge--trusted">{texts.trustedBadge}</span>}
            {online && !current && <span className="vcs-badge vcs-badge--online">{texts.onlineBadge}</span>}
          </p>
        )}
        <small className="vcs-meta">
          {[place, texts.createdAt(formatMoment(session.createdAt, locale)), texts.lastSeen(online ? texts.onlineBadge : `${formatDuration(now - session.lastSeen)} назад`), expiry].join(' · ')}
        </small>
      </div>
      <div className="vcs-actions">
        {canRename && !editing && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft(session.label ?? ''); setEditing(true) }}>{texts.rename}</Button>
        )}
        {canTrust && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onTrust(!trusted)}>{trusted ? texts.untrust : texts.trust}</Button>
        )}
        {!current && (
          <Button size="sm" variant="danger" loading={busy} onClick={onRevoke}>{texts.revoke}</Button>
        )}
      </div>
    </li>
  )
}

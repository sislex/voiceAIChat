// Приглашения и открытая регистрация: как в систему попадают новые люди.
//
// Секции ленивые по раскрытию — их данные не нужны при обычном просмотре списка,
// а инвайты ещё и меняются реже всего остального на странице.

import { useState } from 'react'
import type { InviteInfo, SignupConfig } from '@shared/admin'
import type { UserRole } from '@shared/types'
import { Button } from '@voicechat/ui-kit'

export interface InvitesPanelProps {
  invites?: InviteInfo[] | null
  onLoadInvites?: () => void
  onCreateInvite?: (input: { role: UserRole; ttlHours: number; maxUses: number; note: string; email?: string }) => void
  onDeleteInvite?: (token: string) => void
  /** База абсолютной ссылки инвайта: origin даёт хост, модуль не знает адреса. */
  inviteBaseUrl?: string
  signup?: SignupConfig | null
  onLoadSignup?: () => void
  onSetSignup?: (input: { enabled?: boolean; role?: UserRole; ownedProjectLimit?: number; sessionLimit?: number }) => void
}

export function InvitesPanel({
  invites,
  onLoadInvites,
  onCreateInvite,
  onDeleteInvite,
  inviteBaseUrl = '',
  signup,
  onLoadSignup,
  onSetSignup
}: InvitesPanelProps): JSX.Element {
  const [inviteRole, setInviteRole] = useState<UserRole>('developer')
  const [inviteHours, setInviteHours] = useState(72)
  const [inviteUses, setInviteUses] = useState(1)
  const [inviteNote, setInviteNote] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitesOpen, setInvitesOpen] = useState(false)
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null)

  return (
    <div className="ua-invites">
      {onLoadSignup && (
        <details className="uadmin-invites" data-testid="admin-signup" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) onLoadSignup() }}>
          <summary>Открытая регистрация{signup ? (signup.enabled ? ' — включена' : ' — выключена') : ''}</summary>
          {signup && (
            <div className="uadmin-invite-form">
              <label className="make-autosave"><input type="checkbox" aria-label="Разрешить регистрацию по email" checked={signup.enabled} onChange={(e) => onSetSignup?.({ enabled: e.target.checked })} /> разрешить регистрацию с подтверждением email</label>
              <label>Роль новых <select aria-label="Роль новых пользователей" value={signup.role} onChange={(e) => onSetSignup?.({ role: e.target.value as import('@shared/types').UserRole })}><option value="developer">developer</option><option value="tester">tester</option><option value="observer">observer</option></select></label>
              <label>Проектов на пользователя <input type="number" min={1} max={1000} aria-label="Квота проектов на пользователя" value={signup.ownedProjectLimit} onChange={(e) => { const value = Number(e.target.value); if (Number.isInteger(value) && value > 0) onSetSignup?.({ ownedProjectLimit: value }) }} /></label>
              {/* 0 — без ограничения: лимит сессий выключен по умолчанию, включать его должен человек осознанно. */}
              <label>Сессий на пользователя <input type="number" min={0} max={100} aria-label="Лимит одновременных сессий (0 — без ограничения)" value={signup.sessionLimit ?? 0} onChange={(e) => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 0 && value <= 100) onSetSignup?.({ sessionLimit: value }) }} /></label>
              {!signup.mailConfigured && <span className="ublock ublock--lock" title="Задайте VC_SMTP_URL и VC_MAIL_FROM на сервере">SMTP не настроен — письма пишутся в лог сервера</span>}
            </div>
          )}
        </details>
      )}
      {onLoadInvites && (
        <details className="uadmin-invites" data-testid="admin-invites" open={invitesOpen} onToggle={(e) => { const open = (e.currentTarget as HTMLDetailsElement).open; setInvitesOpen(open); if (open) onLoadInvites() }}>
          <summary>Инвайт-ссылки{invites ? ` (${invites.length})` : ''}</summary>
          <form className="uadmin-invite-form" onSubmit={(e) => { e.preventDefault(); onCreateInvite?.({ role: inviteRole, ttlHours: inviteHours, maxUses: inviteUses, note: inviteNote.trim(), ...(inviteEmail.trim() ? { email: inviteEmail.trim() } : {}) }); setInviteNote(''); setInviteEmail('') }}>
            <select aria-label="Роль по инвайту" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as import('@shared/types').UserRole)}><option value="developer">developer</option><option value="tester">tester</option><option value="observer">observer</option><option value="admin">admin</option></select>
            <label>Срок, ч <input type="number" min={1} max={720} aria-label="Срок действия, часов" value={inviteHours} onChange={(e) => setInviteHours(Number(e.target.value) || 1)} /></label>
            <label>Использований <input type="number" min={1} max={100} aria-label="Максимум использований" value={inviteUses} onChange={(e) => setInviteUses(Number(e.target.value) || 1)} /></label>
            <input className="login-input" aria-label="Email получателя" type="email" placeholder="email (необязательно)" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            <input className="login-input" aria-label="Заметка к инвайту" placeholder="для кого (необязательно)" value={inviteNote} onChange={(e) => setInviteNote(e.target.value)} />
            <Button size="sm" variant="primary" type="submit">Создать ссылку</Button>
          </form>
          {invites && invites.length > 0 && (
            <ul className="sessions-list" role="list">
              {invites.map((inv) => {
                const url = `${inviteBaseUrl}#/invite/${encodeURIComponent(inv.token)}`
                const dead = inv.expiresAt < Date.now() || inv.uses >= inv.maxUses
                return (
                  <li key={inv.token} className={dead ? 'sessions-item invite--dead' : 'sessions-item'}>
                    <div><strong>{inv.role}{inv.note ? ` · ${inv.note}` : ''}</strong><small>{inv.uses}/{inv.maxUses} исп. · до {new Date(inv.expiresAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{dead ? ' · недействителен' : ''}</small>{inv.email && <small>{inv.email} · {inv.emailedAt ? 'email отправлен' : 'email не отправлен'}</small>}<code className="invite-url">{url}</code></div>
                    <span className="uadmin-actions">
                      <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(url).then(() => { setCopiedInvite(inv.token); setTimeout(() => setCopiedInvite(null), 1500) }) }}>{copiedInvite === inv.token ? 'Скопировано' : 'Копировать'}</Button>
                      {onDeleteInvite && <Button size="sm" variant="ghost" onClick={() => onDeleteInvite(inv.token)}>Отозвать</Button>}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </details>
      )}
    </div>
  )
}

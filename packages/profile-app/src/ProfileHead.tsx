// Шапка карточки: кто это, в каком состоянии и что с ним можно сделать.

import { Avatar, Badge, Button } from '@voicechat/ui-kit'
import type { ProfileCapabilities, ProfileRole, ProfileUser } from './contracts'
import { formatAgo } from './format'

const ROLES: readonly ProfileRole[] = ['admin', 'developer', 'tester', 'observer']

export interface ProfileHeadProps {
  user: ProfileUser
  capabilities: ProfileCapabilities
  now: number
  activeWindowMs: number
  onChangeRole?: (role: ProfileRole) => void
  onBlock?: () => void
  onDelete?: () => void
  onIssueResetCode?: () => void
}

export function ProfileHead({ user, capabilities, now, activeWindowMs, onChangeRole, onBlock, onDelete, onIssueResetCode }: ProfileHeadProps): JSX.Element {
  const active = user.lastSeenAt != null && now - user.lastSeenAt <= activeWindowMs
  return (
    <header className="vcp-head" data-testid="profile-head">
      <Avatar username={user.name} size={50} />
      <div className="vcp-head__main">
        <div className="vcp-head__name">
          <h2>{user.name}</h2>
          <Badge tone="accent">{user.role}</Badge>
          {user.blocked
            ? <Badge tone="danger" title="Активные сессии завершены, новые входы запрещены">заблокирован</Badge>
            : <Badge tone={active ? 'success' : 'neutral'}>{active ? 'активен' : 'не в сети'}</Badge>}
          {user.mustChangePassword && <Badge tone="warning" title="Временный пароль — сменит при первом входе">временный пароль</Badge>}
        </div>
        <p className="vcp-head__sub">
          @{user.name}
          {user.email ? ` · ${user.email}` : ''}
          {` · последняя активность: ${formatAgo(user.lastSeenAt, now)}`}
        </p>
      </div>
      {capabilities.canChangeRole && onChangeRole && (
        <label className="vcp-head__role">
          <span className="vcp-visually-hidden">Роль пользователя</span>
          <select aria-label="Роль пользователя" value={user.role} onChange={(event) => onChangeRole(event.target.value as ProfileRole)}>
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>
      )}
      <div className="vcp-head__actions">
        {capabilities.canIssueResetCode && onIssueResetCode && (
          <Button size="sm" onClick={onIssueResetCode} title="Одноразовый код на 24 часа: человек вводит его вместо пароля">Код сброса</Button>
        )}
        {capabilities.canBlock && onBlock && (
          <Button size="sm" variant={user.blocked ? 'ghost' : 'danger'} onClick={onBlock}>{user.blocked ? 'Разблокировать' : 'Заблокировать'}</Button>
        )}
        {capabilities.canDelete && onDelete && <Button size="sm" variant="danger" onClick={onDelete}>Удалить учётку</Button>}
      </div>
    </header>
  )
}

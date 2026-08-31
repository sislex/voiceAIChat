// Левая колонка: поиск, фильтры, сортировка и строки людей.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, Badge, Button, EmptyState, ErrorState, RefreshIndicator, SearchField, Skeleton, Toolbar } from '@voicechat/ui-kit'
import type { AdminUserInfo, UserUsageSummary } from '@shared/admin'
import { formatAgo } from '@voicechat/profile-app'
import { filterUsers, isActive, LIST_PAGE, pageUsers, pluralUsers, type UsersFilter } from './usersModel'
import type { LoadStatus } from '../loadState'
import { loadView } from '../loadState'

export interface UsersListProps {
  users: AdminUserInfo[]
  usageSummary: readonly UserUsageSummary[]
  selected: string | null
  filter: UsersFilter
  onFilter: (filter: UsersFilter) => void
  /** Второй аргумент — выбор сделан с клавиатуры: тогда фокус уезжает в карточку. */
  onSelect: (name: string, viaKeyboard?: boolean) => void
  status?: LoadStatus
  error?: string | null
  onRetry?: () => void
  now: number
}

const ROLES = ['admin', 'developer', 'tester', 'observer']

export function UsersList({ users, usageSummary, selected, filter, onFilter, onSelect, status = 'ready', error = null, onRetry, now }: UsersListProps): JSX.Element {
  const view = loadView(status, users.length > 0)
  // Ввод отделён от фильтра: перебор сотен строк на каждую букву заметен уже на
  // сотне учёток, а курсор в поле не должен ждать перерисовку списка.
  const [query, setQuery] = useState(filter.query)
  const [shown, setShown] = useState(LIST_PAGE)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setQuery(filter.query), [filter.query])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const onQuery = (next: string): void => {
    setQuery(next)
    if (timer.current) clearTimeout(timer.current)
    // Пустой запрос применяется сразу: очистка поля должна возвращать список мгновенно.
    timer.current = setTimeout(() => onFilter({ ...filter, query: next }), next === '' ? 0 : 200)
  }

  const found = useMemo(() => filterUsers(users, filter, now, usageSummary), [users, filter, now, usageSummary])
  const { visible, rest } = pageUsers(found, shown)
  // «из N» показывается при любом сужении, включая поиск: иначе непонятно,
  // это весь список или его часть.
  const narrowed = found.length !== users.length

  return (
    <nav className="ua-list" aria-label="Список пользователей">
      <div className="ua-list__head">
        <SearchField
          value={query}
          onChange={onQuery}
          label="Имя пользователя"
          testId="users-search"
        />
      </div>
      <div className="ua-list__filters">
        <select aria-label="Роль" value={filter.role} onChange={(event) => onFilter({ ...filter, role: event.target.value })}>
          <option value="all">Все роли</option>
          {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
        <select aria-label="Статус" value={filter.state} onChange={(event) => onFilter({ ...filter, state: event.target.value as UsersFilter['state'] })}>
          <option value="all">Любой статус</option>
          <option value="online">Активные</option>
          <option value="blocked">Заблокированные</option>
        </select>
      </div>
      <Toolbar
        bare
        live
        className="ua-list__meta"
        summary={<span data-testid="users-count">{pluralUsers(found.length)}{narrowed ? ` из ${users.length}` : ''}</span>}
      >
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onFilter({ ...filter, descending: !filter.descending })}
          title="Порядок списка"
        >
          По активности {filter.descending ? '↓' : '↑'}
        </Button>
      </Toolbar>

      {view.state === 'skeleton' && <Skeleton variant="list" count={4} height={52} lines={2} className="uadmin-skel" testId="user-skeleton" />}
      {view.state === 'error' && <ErrorState message="Не удалось загрузить пользователей" detail={error} {...(onRetry ? { onRetry } : {})} />}
      {view.state === 'empty' && <EmptyState compact icon="👤" title="Пользователей пока нет" description="Создайте первую учётку кнопкой «＋ Добавить» — она сразу сможет войти." />}
      {view.staleError && <ErrorState compact message="Список мог устареть: обновить не удалось" detail={error} {...(onRetry ? { onRetry } : {})} />}
      {view.refreshing && <RefreshIndicator label="Обновляем список…" />}

      {view.state !== 'skeleton' && users.length > 0 && found.length === 0 && (
        <EmptyState compact icon="⌕" title="Никто не найден" description="Смягчите фильтры или очистите поиск." />
      )}

      <ul className="ua-list__items" role="list">
        {visible.map((user) => (
          <li key={user.name}>
            <button
              type="button"
              className={user.name === selected ? 'ua-row ua-row--on' : 'ua-row'}
              onClick={() => onSelect(user.name)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(user.name, true) } }}
              data-testid="user-item"
              aria-current={user.name === selected}
            >
              <Avatar username={user.name} size={38} />
              <span className="ua-row__info">
                <b>{user.name}</b>
                <small>
                  <i className={isActive(user, now) ? 'vcp-dot vcp-dot--on' : 'vcp-dot'} aria-hidden="true" />
                  {formatAgo(user.lastSeenAt, now)}
                </small>
              </span>
              <span className="ua-row__meta">
                {user.blocked
                  ? <Badge tone="danger">заблокирован</Badge>
                  : <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>{user.role}</Badge>}
                {user.mustChangePassword && <Badge tone="warning" title="Временный пароль — сменит при первом входе">врем. пароль</Badge>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="ua-list__more">
          <Button size="sm" variant="ghost" onClick={() => setShown((value) => value + LIST_PAGE)}>Показать ещё {Math.min(rest, LIST_PAGE)}</Button>
        </p>
      )}
    </nav>
  )
}

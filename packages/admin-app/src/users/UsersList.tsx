// Левая колонка: поиск, фильтры, сортировка и строки людей.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, Badge, Button, EmptyState, ErrorState, RefreshIndicator, SearchField, Skeleton, Toolbar } from '@voicechat/ui-kit'
import type { AdminUserInfo, UserUsageSummary } from '@shared/admin'
import { formatAgo } from '@voicechat/profile-app'
import { filterUsers, isActive, LIST_PAGE, pageUsers, pluralUsers, userSpend, type UsersFilter } from './usersModel'
import { formatUsd } from '@voicechat/profile-app'
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
  // Смена фильтра начинает список заново: иначе после сужения выборки кнопка
  // «показать ещё» исчезала, а после расширения — показывала чужой хвост.
  useEffect(() => setShown(LIST_PAGE), [filter.query, filter.role, filter.state, filter.sort])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const onQuery = (next: string): void => {
    setQuery(next)
    if (timer.current) clearTimeout(timer.current)
    // Пустой запрос применяется сразу: очистка поля должна возвращать список мгновенно.
    timer.current = setTimeout(() => onFilter({ ...filter, query: next }), next === '' ? 0 : 200)
  }

  // Лента на телефоне прокручивается к выбранному человеку: после перехода по
  // ссылке `#/users/<логин>` он мог оказаться далеко за краем экрана.
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!selected) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-user="${CSS.escape(selected)}"]`)
    // Метод есть не везде (jsdom, старые WebView): его отсутствие не должно
    // ронять рендер списка — прокрутка тут удобство, а не условие работы.
    row?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [selected])

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
        {/* Порядок виден и меняется мышью: раньше сортировка по расходу
            существовала только в адресе, и о ней невозможно было узнать. */}
        <select
          aria-label="Порядок списка"
          value={filter.sort}
          onChange={(event) => onFilter({ ...filter, sort: event.target.value as UsersFilter['sort'] })}
        >
          <option value="activity">По активности</option>
          <option value="name">По имени</option>
          <option value="spend">По расходу</option>
        </select>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onFilter({ ...filter, descending: !filter.descending })}
          aria-label={filter.descending ? 'Порядок: по убыванию' : 'Порядок: по возрастанию'}
          title={filter.descending ? 'Сначала большие значения' : 'Сначала малые значения'}
        >
          {filter.descending ? '↓' : '↑'}
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

      <ul className="ua-list__items" role="list" ref={listRef}>
        {visible.map((user) => (
          <li key={user.name}>
            <button
              type="button"
              className={user.name === selected ? 'ua-row ua-row--on' : 'ua-row'}
              onClick={() => onSelect(user.name)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(user.name, true); return }
                // Стрелки ходят по списку, не выбирая: выбор — отдельное решение
                // человека, иначе каждое движение вниз грузило бы чужую карточку.
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
                event.preventDefault()
                const rows = [...(event.currentTarget.closest('.ua-list__items')?.querySelectorAll<HTMLButtonElement>('[data-testid="user-item"]') ?? [])]
                const index = rows.indexOf(event.currentTarget)
                const next = event.key === 'Home' ? 0
                  : event.key === 'End' ? rows.length - 1
                  : event.key === 'ArrowDown' ? Math.min(index + 1, rows.length - 1)
                  : Math.max(index - 1, 0)
                rows[next]?.focus()
              }}
              data-testid="user-item"
              data-user={user.name}
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
                {/* Расход за месяц прямо в строке: иначе сортировка по расходу
                    показывает порядок, но не сами суммы. Нулевой не рисуем —
                    столбик «$0.00» у всех создаёт видимость данных там, где их нет. */}
                {userSpend(user.name, usageSummary) > 0 && (
                  <small title="Расход за текущий месяц">{formatUsd(userSpend(user.name, usageSummary))}</small>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="ua-list__more">
          <Button size="sm" variant="ghost" onClick={() => setShown((value) => value + LIST_PAGE)}>
            Показать ещё {Math.min(rest, LIST_PAGE)} из {rest}
          </Button>
        </p>
      )}
    </nav>
  )
}

// Левая колонка: поиск, фильтры, сортировка и строки людей.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfirm, Avatar, Badge, Button, EmptyState, ErrorState, RefreshIndicator, SearchField, Skeleton, Toolbar } from '@voicechat/ui-kit'
import type { AdminUserInfo, UserUsageSummary } from '@shared/admin'
import { formatAgo } from '@voicechat/profile-app'
import { filterUsers, isActive, LIST_PAGE, pageUsers, pluralUsers, userSpend, type UsersFilter } from './usersModel'
import { formatUsd } from '@voicechat/profile-app'
import type { LoadStatus } from '../loadState'
import { loadView } from '../loadState'

export interface UsersListProps {
  onLoadUsersPage?: (input: { limit?: number; offset?: number; q?: string; role?: string; state?: string; sort?: string; asc?: string }) => Promise<AdminUserInfo[]>
  onBulkUsers?: (names: string[], action: 'block' | 'unblock' | 'revoke') => Promise<void>
  currentUserName?: string
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

export function UsersList({ onLoadUsersPage, onBulkUsers, currentUserName, users, usageSummary, selected, filter, onFilter, onSelect, status = 'ready', error = null, onRetry, now }: UsersListProps): JSX.Element {
  const confirm = useConfirm()
  const [checked, setChecked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pageRows, setPageRows] = useState<AdminUserInfo[]>([])
  const [pageBusy, setPageBusy] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const generation = useRef(0)
  const pageQuery = JSON.stringify({ q: filter.query, role: filter.role, state: filter.state, sort: filter.sort, asc: filter.descending ? '0' : '1' })
  const loadPage = async (offset: number, version: number): Promise<void> => {
    if (!onLoadUsersPage) return
    setPageBusy(true)
    setPageError(null)
    try {
      const rows = await onLoadUsersPage({ q: filter.query, role: filter.role, state: filter.state, sort: filter.sort, asc: filter.descending ? '0' : '1', limit: 40, offset })
      if (generation.current !== version) return
      setPageRows((previous) => offset === 0 ? rows : [...previous, ...rows.filter((row) => !previous.some((item) => item.name === row.name))])
      setHasMore(rows.length === 40)
    } catch (error) {
      if (generation.current === version) setPageError(error instanceof Error ? error.message : String(error))
    } finally { if (generation.current === version) setPageBusy(false) }
  }
  useEffect(() => {
    const version = ++generation.current
    setChecked([])
    setPageRows([])
    setHasMore(false)
    void loadPage(0, version)
    return () => { generation.current++ }
    // A serialized query prevents reloads caused by freshly allocated filter objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageQuery, onLoadUsersPage])
  useEffect(() => {
    setPageRows((previous) => previous.map((row) => users.find((user) => user.name === row.name) ?? row))
  }, [users])
  const bulk = async (action: 'block' | 'unblock' | 'revoke', selection = checked): Promise<void> => {
    const names = [...selection]
    const title = action === 'block' ? 'Заблокировать пользователей' : action === 'unblock' ? 'Разблокировать пользователей' : 'Отозвать все сессии'
    if (!onBulkUsers || !names.length || !(await confirm({ title, message: names.join(', '), variant: 'danger', ...(names.length > 5 ? { requireText: String(names.length) } : {}) }))) return
    setBusy(true)
    setActionError(null)
    try { await onBulkUsers(names, action); setChecked([]); await loadPage(0, generation.current) }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const source = onLoadUsersPage ? pageRows : users
  const view = loadView(onLoadUsersPage ? pageBusy ? 'loading' : pageError ? 'error' : 'ready' : status, source.length > 0)
  // Ввод отделён от фильтра: перебор сотен строк на каждую букву заметен уже на
  // сотне учёток, а курсор в поле не должен ждать перерисовку списка.
  const [filtersOpen, setFiltersOpen] = useState(false)
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

  const found = useMemo(() => filterUsers(onLoadUsersPage ? pageRows : users, filter, now, usageSummary), [onLoadUsersPage, pageRows, users, filter, now, usageSummary])
  const { visible, rest } = onLoadUsersPage ? { visible: found, rest: hasMore ? 40 : 0 } : pageUsers(found, shown)
  // «из N» показывается при любом сужении, включая поиск: иначе непонятно,
  // это весь список или его часть.
  const narrowed = !onLoadUsersPage && found.length !== users.length

  return (
    <nav className="ua-list" aria-label="Список пользователей">
      <div className="ua-list__head">
        <SearchField
          value={query}
          onChange={onQuery}
          label="Имя пользователя"
          testId="users-search"
        />
        <Button size="sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>Фильтры</Button>
      </div>
      <div className={filtersOpen ? 'ua-list__filters' : 'ua-list__filters ua-list__filters--closed'}>
        <select aria-label="Роль" value={filter.role} onChange={(event) => onFilter({ ...filter, role: event.target.value })}>
          <option value="all">Все роли</option>
          {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
        <select aria-label="Статус" value={filter.state} onChange={(event) => onFilter({ ...filter, state: event.target.value as UsersFilter['state'] })}>
          <option value="all">Любой статус</option>
          <option value="online">Активные</option>
          <option value="blocked">Заблокированные</option>
          <option value="inactive">Без входа 30 дней</option>
        </select>
      </div>
      <Toolbar
        bare
        live
        className="ua-list__meta"
        summary={<span data-testid="users-count">{onLoadUsersPage ? 'Загружено: ' : ''}{pluralUsers(found.length)}{narrowed ? ` из ${users.length}` : ''}</span>}
      >
        {/* Порядок виден и меняется мышью: раньше сортировка по расходу
            существовала только в адресе, и о ней невозможно было узнать. */}
        <select
          aria-label="Порядок списка"
          value={filter.sort}
          onChange={(event) => onFilter({ ...filter, sort: event.target.value as UsersFilter['sort'] })}
        >
          <option value="activity">По активности</option>
          <option value="login">По последнему входу</option>
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

      {pageError && <ErrorState message="Не удалось загрузить страницу" detail={pageError} onRetry={() => void loadPage(pageRows.length, generation.current)} />}
      {actionError && <ErrorState message="Не все действия выполнены" detail={actionError} />}
      {onBulkUsers && checked.length > 0 && <div className="ua-bulk" aria-label="Массовые действия">
        <span>Выбрано: {checked.length}</span>
        <Button size="sm" disabled={busy} onClick={() => void bulk('block')}>Заблокировать</Button>
        <Button size="sm" disabled={busy} onClick={() => void bulk('unblock')}>Разблокировать</Button>
        <Button size="sm" disabled={busy} onClick={() => void bulk('revoke')}>Отозвать все сессии</Button>
      </div>}
      <ul className="ua-list__items" role="list" ref={listRef}>
        {visible.map((user) => (
          <li key={user.name}>
            {onBulkUsers && user.name !== 'admin' && user.name !== currentUserName && <input type="checkbox" aria-label={`Выбрать ${user.name}`} checked={checked.includes(user.name)} disabled={busy} onChange={(event) => setChecked((current) => event.target.checked ? [...current, user.name] : current.filter((name) => name !== user.name))} />}
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
            {onBulkUsers && user.name !== 'admin' && user.name !== currentUserName && <details className="ua-row-menu">
              <summary aria-label={`Действия для ${user.name}`}>Действия</summary>
              <Button size="sm" onClick={() => onSelect(user.name)}>Открыть карточку</Button>
              <Button size="sm" disabled={busy} onClick={() => void bulk(user.blocked ? 'unblock' : 'block', [user.name])}>{user.blocked ? 'Разблокировать' : 'Заблокировать'}</Button>
              <Button size="sm" disabled={busy} onClick={() => void bulk('revoke', [user.name])}>Отозвать сессии</Button>
            </details>}
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="ua-list__more">
          <Button size="sm" variant="ghost" disabled={pageBusy} onClick={() => onLoadUsersPage ? void loadPage(pageRows.length, generation.current) : setShown((value) => value + LIST_PAGE)}>
            {onLoadUsersPage ? 'Показать ещё' : `Показать ещё ${Math.min(rest, LIST_PAGE)} из ${rest}`}
          </Button>
        </p>
      )}
    </nav>
  )
}

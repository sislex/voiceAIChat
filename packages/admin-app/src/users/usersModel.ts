// Список людей: фильтрация, сортировка и метрики над ним.
//
// Чистые функции, потому что именно здесь живут решения, которые не видно
// глазами: что считается активностью, в каком порядке идут люди без активности,
// что попадает в метрику «расход за месяц».

import type { AdminUserInfo, UserUsageSummary } from '@shared/admin'
import { ACTIVE_WINDOW_MS, spendUsd } from '@shared/admin'

export type UserSort = 'activity' | 'name' | 'spend'
export type UserState = 'all' | 'online' | 'blocked'

export interface UsersFilter {
  query: string
  role: string
  state: UserState
  sort: UserSort
  /** По убыванию — свежие и дорогие сверху; это ожидаемый порядок для админа. */
  descending: boolean
}

export const DEFAULT_FILTER: UsersFilter = { query: '', role: 'all', state: 'all', sort: 'activity', descending: true }

/** Активен ли человек прямо сейчас: по последней активности живых сессий. */
export function isActive(user: AdminUserInfo, now: number): boolean {
  return user.lastSeenAt != null && now - user.lastSeenAt <= ACTIVE_WINDOW_MS
}

/** Расход человека за период сводки; сводка приходит уже суженной по датам. */
export function userSpend(name: string, summary: readonly UserUsageSummary[]): number {
  const row = summary.find((item) => item.name === name)
  return row ? spendUsd(row.totals) : 0
}

export function filterUsers(users: readonly AdminUserInfo[], filter: UsersFilter, now: number, summary: readonly UserUsageSummary[] = []): AdminUserInfo[] {
  const query = filter.query.trim().toLowerCase()
  const found = users.filter((user) => {
    if (query && !`${user.name} ${user.email ?? ''}`.toLowerCase().includes(query)) return false
    if (filter.role !== 'all' && user.role !== filter.role) return false
    if (filter.state === 'online' && !isActive(user, now)) return false
    if (filter.state === 'blocked' && !user.blocked) return false
    return true
  })
  const sorted = [...found].sort((a, b) => {
    if (filter.sort === 'name') return a.name.localeCompare(b.name, 'ru')
    if (filter.sort === 'spend') return userSpend(b.name, summary) - userSpend(a.name, summary)
    // Никогда не входившие уходят вниз, а не наверх: null в сравнении дал бы
    // им нулевую метку времени и они возглавили бы список «по активности».
    return (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)
  })
  return filter.descending ? sorted : sorted.reverse()
}

export interface UsersMetrics {
  total: number
  /** Прибавка за календарный месяц — по дате создания учётки. */
  createdThisMonth: number
  activeNow: number
  machinesOnline: number
  machinesTotal: number
  spendUsd: number
  spendIncomplete: boolean
  /** Сколько учёток с заданным лимитом и какая доля израсходована в среднем. */
  limitedUsers: number
  limitShare: number | null
}

export function usersMetrics(
  users: readonly AdminUserInfo[],
  summary: readonly UserUsageSummary[],
  now: number,
  monthStartAt: number
): UsersMetrics {
  const machines = users.flatMap((user) => user.agents)
  const spent = summary.reduce((sum, item) => sum + spendUsd(item.totals), 0)
  const limited = users.filter((user) => user.llmLimitUsd != null && user.llmLimitUsd > 0)
  const limitTotal = limited.reduce((sum, user) => sum + (user.llmLimitUsd ?? 0), 0)
  const limitedSpend = limited.reduce((sum, user) => sum + userSpend(user.name, summary), 0)
  return {
    total: users.length,
    createdThisMonth: users.filter((user) => user.createdAt >= monthStartAt).length,
    activeNow: users.filter((user) => isActive(user, now)).length,
    machinesOnline: machines.filter((machine) => machine.online).length,
    machinesTotal: machines.length,
    spendUsd: spent,
    spendIncomplete: summary.some((item) => item.totals.costIncomplete),
    limitedUsers: limited.length,
    // Общего бюджета в системе нет: процент имеет смысл только по сумме личных
    // лимитов, и только когда хоть у кого-то лимит задан.
    limitShare: limitTotal > 0 ? limitedSpend / limitTotal : null
  }
}

/** Русское склонение для строки «N пользователей». */
export function pluralUsers(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} пользователь`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} пользователя`
  return `${count} пользователей`
}

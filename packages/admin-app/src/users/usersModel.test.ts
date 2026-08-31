import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTER, filterUsers, isActive, pluralUsers, userSpend, usersMetrics } from './usersModel'
import type { AdminUserInfo, UserUsageSummary } from '@shared/admin'

const NOW = Date.UTC(2026, 7, 31, 12, 0, 0)
const MONTH = Date.UTC(2026, 7, 1, 0, 0, 0)

function user(name: string, patch: Partial<AdminUserInfo> = {}): AdminUserInfo {
  return {
    name,
    role: 'developer',
    blocked: false,
    createdAt: MONTH - 86_400_000,
    conversationCount: 0,
    agents: [],
    lastSeenAt: null,
    liveSessions: 0,
    ...patch
  }
}

const users: AdminUserInfo[] = [
  user('alexey', { role: 'admin', lastSeenAt: NOW - 30_000, agents: [{ id: 'a1', online: true } as never] }),
  user('marina', { lastSeenAt: NOW - 4 * 60_000 }),
  user('ipetrov', { role: 'tester', lastSeenAt: NOW - 3 * 86_400_000 }),
  user('nikita', { role: 'tester', blocked: true, lastSeenAt: null }),
  user('newbie', { createdAt: MONTH + 86_400_000 })
]

const summary: UserUsageSummary[] = [
  { name: 'alexey', totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 96.4, costFromPrices: 0, messages: 10 }, byModel: [] },
  { name: 'marina', totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, costFromPrices: 58.2, messages: 5 }, byModel: [] }
]

describe('фильтрация списка', () => {
  it('поиск идёт и по логину, и по почте', () => {
    expect(filterUsers([...users, user('anna', { email: 'anna@voicechat.team' })], { ...DEFAULT_FILTER, query: 'voicechat' }, NOW).map((u) => u.name)).toEqual(['anna'])
    expect(filterUsers(users, { ...DEFAULT_FILTER, query: 'MAR' }, NOW).map((u) => u.name)).toEqual(['marina'])
  })

  it('фильтр «онлайн» опирается на окно активности, а не на факт входа', () => {
    expect(filterUsers(users, { ...DEFAULT_FILTER, state: 'online' }, NOW).map((u) => u.name)).toEqual(['alexey', 'marina'])
    expect(isActive(user('x', { lastSeenAt: NOW - 6 * 60_000 }), NOW)).toBe(false)
  })

  it('фильтр «заблокирован» и фильтр роли', () => {
    expect(filterUsers(users, { ...DEFAULT_FILTER, state: 'blocked' }, NOW).map((u) => u.name)).toEqual(['nikita'])
    expect(filterUsers(users, { ...DEFAULT_FILTER, role: 'tester' }, NOW).map((u) => u.name)).toEqual(['ipetrov', 'nikita'])
  })

  it('по активности: никогда не входившие уходят вниз, а не наверх', () => {
    const sorted = filterUsers(users, DEFAULT_FILTER, NOW).map((u) => u.name)
    expect(sorted.slice(0, 3)).toEqual(['alexey', 'marina', 'ipetrov'])
    expect(sorted.slice(-2).sort()).toEqual(['newbie', 'nikita'])
  })

  it('сортировка по имени и по расходу', () => {
    expect(filterUsers(users, { ...DEFAULT_FILTER, sort: 'name' }, NOW)[0].name).toBe('alexey')
    expect(filterUsers(users, { ...DEFAULT_FILTER, sort: 'spend' }, NOW, summary).slice(0, 2).map((u) => u.name)).toEqual(['alexey', 'marina'])
  })

  it('обратный порядок переворачивает список', () => {
    const straight = filterUsers(users, DEFAULT_FILTER, NOW).map((u) => u.name)
    expect(filterUsers(users, { ...DEFAULT_FILTER, descending: false }, NOW).map((u) => u.name)).toEqual([...straight].reverse())
  })
})

describe('расход', () => {
  it('берётся большая из двух оценок: у Codex цена CLI обычно нулевая', () => {
    expect(userSpend('alexey', summary)).toBe(96.4)
    expect(userSpend('marina', summary)).toBe(58.2)
    expect(userSpend('нет такого', summary)).toBe(0)
  })
})

describe('метрики над списком', () => {
  it('считает людей, активность, машины и расход', () => {
    const metrics = usersMetrics(users, summary, NOW, MONTH)
    expect(metrics).toMatchObject({ total: 5, createdThisMonth: 1, activeNow: 2, machinesOnline: 1, machinesTotal: 1 })
    expect(metrics.spendUsd).toBeCloseTo(154.6, 5)
  })

  it('без заданных лимитов процента не бывает: общего бюджета в системе нет', () => {
    expect(usersMetrics(users, summary, NOW, MONTH).limitShare).toBeNull()
    const limited = usersMetrics([user('alexey', { llmLimitUsd: 200 })], summary, NOW, MONTH)
    expect(limited.limitShare).toBeCloseTo(96.4 / 200, 5)
    expect(limited.limitedUsers).toBe(1)
  })

  it('неполный прайс помечает сумму как нижнюю границу', () => {
    const incomplete = usersMetrics(users, [{ ...summary[0], totals: { ...summary[0].totals, costIncomplete: true } }], NOW, MONTH)
    expect(incomplete.spendIncomplete).toBe(true)
  })
})

describe('склонение', () => {
  it('пользователь / пользователя / пользователей', () => {
    expect(pluralUsers(1)).toBe('1 пользователь')
    expect(pluralUsers(3)).toBe('3 пользователя')
    expect(pluralUsers(5)).toBe('5 пользователей')
    expect(pluralUsers(11)).toBe('11 пользователей')
    expect(pluralUsers(21)).toBe('21 пользователь')
  })
})

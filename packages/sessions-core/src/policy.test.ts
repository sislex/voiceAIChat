import { describe, expect, it } from 'vitest'
import { findTrustedDevice, isNewDevice, isOnline, isStale, isTrusted, overLimit, ttlFor } from './policy'
import { SESSION_SHORT_TTL_MS, SESSION_TTL_MS, type DeviceSession } from './types'

const T0 = 1_700_000_000_000
const DAY = 24 * 60 * 60_000
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'

const make = (over: Partial<DeviceSession> = {}): DeviceSession => ({
  sid: 's', user: 'u', createdAt: T0, lastSeen: T0, expiresAt: T0 + 30 * DAY, ip: '203.0.113.7', userAgent: CHROME, ...over
})

describe('ttlFor', () => {
  it('«запомнить меня» переключает длинный TTL на короткий', () => {
    expect(ttlFor({ remember: true })).toBe(SESSION_TTL_MS)
    expect(ttlFor({})).toBe(SESSION_TTL_MS)
    expect(ttlFor({ remember: false })).toBe(SESSION_SHORT_TTL_MS)
  })

  it('приложение может задать свои сроки', () => {
    expect(ttlFor({ remember: false, policy: { shortTtlMs: 5000 } })).toBe(5000)
  })
})

describe('isOnline / isStale / isTrusted', () => {
  it('активна сейчас — только внутри окна и только пока сессия жива', () => {
    expect(isOnline(make({ lastSeen: T0 - 30_000 }), T0)).toBe(true)
    expect(isOnline(make({ lastSeen: T0 - 5 * 60_000 }), T0)).toBe(false)
    expect(isOnline(make({ lastSeen: T0, expiresAt: T0 - 1 }), T0)).toBe(false)
  })

  it('брошенная сессия считается только при заданном пороге', () => {
    const old = make({ lastSeen: T0 - 100 * DAY })
    expect(isStale(old, T0)).toBe(false)
    expect(isStale(old, T0, { staleDays: 90 })).toBe(true)
    expect(isStale(make({ lastSeen: T0 - DAY }), T0, { staleDays: 90 })).toBe(false)
  })

  it('доверие стареет вместе с сессией', () => {
    expect(isTrusted(make({ trustedAt: T0 - DAY }), T0)).toBe(true)
    expect(isTrusted(make({ trustedAt: T0 - 40 * DAY }), T0)).toBe(false)
    expect(isTrusted(make({ trustedAt: null }), T0)).toBe(false)
  })
})

describe('overLimit', () => {
  const sessions = [
    make({ sid: 'старая', lastSeen: T0 - 10 * DAY }),
    make({ sid: 'средняя', lastSeen: T0 - DAY }),
    make({ sid: 'текущая', lastSeen: T0, current: true })
  ]

  it('без лимита и в пределах лимита никого не вытесняет', () => {
    expect(overLimit(sessions, null)).toEqual([])
    expect(overLimit(sessions, 3)).toEqual([])
    expect(overLimit(sessions, 0)).toEqual([])
  })

  it('вытесняет самые давно неактивные и никогда — текущую', () => {
    expect(overLimit(sessions, 2, 'текущая').map((s) => s.sid)).toEqual(['старая'])
    expect(overLimit(sessions, 1, 'текущая').map((s) => s.sid)).toEqual(['старая', 'средняя'])
  })
})

describe('isNewDevice', () => {
  const candidate = { userAgent: CHROME, ip: '203.0.113.7' }

  it('первый вход новым устройством не считается', () => {
    expect(isNewDevice([], candidate)).toBe(false)
  })

  it('аккаунт с одними унаследованными сессиями не поднимает тревогу', () => {
    expect(isNewDevice([make({ userAgent: 'legacy', ip: '' })], candidate)).toBe(false)
  })

  it('знакомое устройство узнаётся по ключу, чужое — нет', () => {
    expect(isNewDevice([make()], candidate)).toBe(false)
    // Тот же браузер из другой сети — уже другое устройство.
    expect(isNewDevice([make({ ip: '198.51.100.1' })], candidate)).toBe(true)
    expect(isNewDevice([make({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile Safari/604.1' })], candidate)).toBe(true)
  })
})

describe('findTrustedDevice', () => {
  const candidate = { deviceSecret: 'secret-hash' }

  it('находит доверенную сессию по секрету устройства и игнорирует протухшее доверие', () => {
    expect(findTrustedDevice([make({ sid: 'a', trustedAt: T0 - DAY, deviceSecret: 'secret-hash' })], candidate, T0)?.sid).toBe('a')
    expect(findTrustedDevice([make({ sid: 'a', trustedAt: T0 - 40 * DAY, deviceSecret: 'secret-hash' })], candidate, T0)).toBeNull()
    expect(findTrustedDevice([make({ sid: 'a', deviceSecret: 'secret-hash' })], candidate, T0)).toBeNull()
  })

  it('приметы устройства доверия не дают: подделать UA и подсеть может кто угодно', () => {
    // Доверенная сессия того же браузера из той же сети, но с другим секретом.
    expect(findTrustedDevice([make({ sid: 'a', trustedAt: T0, deviceSecret: 'другой' })], candidate, T0)).toBeNull()
    // Сессия вообще без секрета (заведена до появления cookie устройства).
    expect(findTrustedDevice([make({ sid: 'a', trustedAt: T0 })], candidate, T0)).toBeNull()
    // Клиент не прислал секрет — второй фактор спрашиваем.
    expect(findTrustedDevice([make({ sid: 'a', trustedAt: T0, deviceSecret: 'secret-hash' })], {}, T0)).toBeNull()
  })
})

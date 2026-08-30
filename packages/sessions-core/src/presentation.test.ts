import { describe, expect, it } from 'vitest'
import { countryFlag, deviceSiblings, durationOf, filterSessions, groupByDevice, otherSessions, platformsOf, sessionTitle, sortSessions, toView } from './presentation'
import type { DeviceSession } from './types'

const T0 = 1_700_000_000_000
const DAY = 24 * 60 * 60_000
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0'

const make = (over: Partial<DeviceSession> = {}): DeviceSession => ({
  sid: 's', user: 'u', createdAt: T0, lastSeen: T0, expiresAt: T0 + 30 * DAY, ip: '203.0.113.7', userAgent: CHROME, ...over
})

describe('sessionTitle', () => {
  it('метка пользователя важнее разбора UA, у legacy — отдельная подпись', () => {
    expect(sessionTitle(make({ label: 'Рабочий ноут' }))).toBe('Рабочий ноут')
    expect(sessionTitle(make())).toBe('Chrome 128 · macOS')
    expect(sessionTitle(make({ userAgent: 'legacy' }))).toBe('Устройство без метки')
  })
})

describe('sortSessions', () => {
  it('текущая всегда первая, остальные по свежести активности', () => {
    const list = [
      make({ sid: 'давняя', lastSeen: T0 - 10 * DAY }),
      make({ sid: 'свежая', lastSeen: T0 - 60_000 }),
      make({ sid: 'текущая', lastSeen: T0 - 5 * DAY, current: true })
    ]
    expect(sortSessions(list).map((s) => s.sid)).toEqual(['текущая', 'свежая', 'давняя'])
    // Исходный массив не меняем: список приходит из стора и переиспользуется.
    expect(list[0]!.sid).toBe('давняя')
  })
})

describe('filterSessions', () => {
  const list = [
    make({ sid: 'a', label: 'Рабочий ноут' }),
    make({ sid: 'b', userAgent: FIREFOX, ip: '198.51.100.9' }),
    make({ sid: 'c', geo: { country: 'RU', city: 'Москва', label: 'Москва, RU' } })
  ]

  it('ищет по метке, браузеру, ОС, адресу и месту; пустой запрос отдаёт всё', () => {
    expect(filterSessions(list, '').length).toBe(3)
    expect(filterSessions(list, 'рабочий').map((s) => s.sid)).toEqual(['a'])
    expect(filterSessions(list, 'firefox').map((s) => s.sid)).toEqual(['b'])
    expect(filterSessions(list, 'Windows').map((s) => s.sid)).toEqual(['b'])
    expect(filterSessions(list, '198.51').map((s) => s.sid)).toEqual(['b'])
    expect(filterSessions(list, 'москва').map((s) => s.sid)).toEqual(['c'])
    expect(filterSessions(list, 'таких нет')).toEqual([])
  })
})

describe('otherSessions', () => {
  it('отбирает всё, кроме текущей', () => {
    expect(otherSessions([make({ sid: 'a', current: true }), make({ sid: 'b' })]).map((s) => s.sid)).toEqual(['b'])
  })
})

describe('toView', () => {
  it('собирает карточку: разбор UA, признаки и остаток срока', () => {
    const view = toView(make({ lastSeen: T0 - 30_000, trustedAt: T0 - DAY, current: true, geo: { label: 'локальная сеть', local: true } }), T0)
    expect(view).toMatchObject({ title: 'Chrome 128 · macOS', online: true, trusted: true, current: true, place: 'локальная сеть' })
    expect(view.profile.kind).toBe('desktop')
    expect(view.expiresInMs).toBe(30 * DAY)
  })

  it('у истёкшей сессии остаток отрицательный, а «активна сейчас» снято', () => {
    const view = toView(make({ expiresAt: T0 - 1 }), T0)
    expect(view.online).toBe(false)
    expect(view.expiresInMs).toBeLessThan(0)
  })
})

describe('durationOf', () => {
  it('огрубляет интервал до единиц, не занимаясь текстом', () => {
    expect(durationOf(30_000)).toEqual({ unit: 'now', value: 0 })
    expect(durationOf(5 * 60_000)).toEqual({ unit: 'minute', value: 5 })
    expect(durationOf(3 * 60 * 60_000)).toEqual({ unit: 'hour', value: 3 })
    expect(durationOf(10 * DAY)).toEqual({ unit: 'day', value: 10 })
    expect(durationOf(90 * DAY)).toEqual({ unit: 'month', value: 3 })
    // Знак не важен: «5 минут назад» и «через 5 минут» — одна и та же величина.
    expect(durationOf(-5 * 60_000)).toEqual({ unit: 'minute', value: 5 })
  })
})

describe('устройства и платформы', () => {
  const list = [
    make({ sid: 'a', deviceKey: 'dev-1', platform: 'web' }),
    make({ sid: 'b', deviceKey: 'dev-1', platform: 'web' }),
    make({ sid: 'c', deviceKey: 'dev-2', platform: 'desktop' }),
    make({ sid: 'd', platform: null })
  ]

  it('считает соседние сессии того же устройства', () => {
    expect(deviceSiblings(list, list[0]!)).toBe(1)
    expect(deviceSiblings(list, list[2]!)).toBe(0)
    // Сессия без ключа устройства ни с кем не сравнима — соседей у неё нет.
    expect(deviceSiblings(list, list[3]!)).toBe(0)
  })

  it('группирует по устройству, безключевые оставляет поодиночке', () => {
    const groups = groupByDevice(list)
    expect(groups.get('dev-1')?.map((s) => s.sid)).toEqual(['a', 'b'])
    expect(groups.get('dev-2')?.map((s) => s.sid)).toEqual(['c'])
    expect(groups.get('sid:d')?.map((s) => s.sid)).toEqual(['d'])
  })

  it('собирает список платформ без пустых и дублей', () => {
    expect(platformsOf(list)).toEqual(['desktop', 'web'])
    expect(platformsOf([])).toEqual([])
  })

  it('toView знает про соседей, если ему передали весь список', () => {
    expect(toView(list[0]!, T0, undefined, list).siblings).toBe(1)
    expect(toView(list[0]!, T0).siblings).toBe(0)
  })
})

describe('countryFlag', () => {
  it('переводит ISO-код в флаг и молчит на мусоре', () => {
    expect(countryFlag('RU')).toBe('🇷🇺')
    expect(countryFlag('de')).toBe('🇩🇪')
    for (const bad of ['', null, undefined, 'RUS', '1A', 'локальная сеть']) expect(countryFlag(bad)).toBe('')
  })
})


// Фикстуры для сториз, тестов и первого запуска в чужом приложении.
import type { DeviceSession } from '@voicechat/sessions-core'

/** Фиксированная точка отсчёта: время в сториз не должно «уезжать». */
export const FIXTURE_NOW = Date.UTC(2026, 7, 30, 12, 0, 0)
const DAY = 24 * 60 * 60_000

export function makeSession(over: Partial<DeviceSession> = {}): DeviceSession {
  return {
    sid: 'a',
    user: 'user',
    createdAt: FIXTURE_NOW - DAY,
    lastSeen: FIXTURE_NOW - 30_000,
    expiresAt: FIXTURE_NOW + 29 * DAY,
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
    ...over
  }
}

/** Разнородный набор: текущее устройство, телефон, доверенный ноут и давний вход. */
export function makeSessions(): DeviceSession[] {
  return [
    makeSession({ sid: 'current', current: true, geo: { country: 'RU', city: 'Москва', label: 'Москва, RU' } }),
    makeSession({
      sid: 'phone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
      lastSeen: FIXTURE_NOW - 3 * 60 * 60_000,
      createdAt: FIXTURE_NOW - 10 * DAY,
      ip: '198.51.100.24',
      geo: { country: 'RU', city: 'Казань', label: 'Казань, RU' }
    }),
    makeSession({
      sid: 'work',
      label: 'Рабочий ноут',
      trustedAt: FIXTURE_NOW - 2 * DAY,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0.0.0 Safari/537.36 Edg/127.0.2651.98',
      lastSeen: FIXTURE_NOW - 2 * DAY,
      createdAt: FIXTURE_NOW - 20 * DAY,
      ip: '192.168.1.14',
      geo: { local: true, label: 'локальная сеть' }
    }),
    makeSession({ sid: 'legacy', userAgent: 'legacy', ip: '', lastSeen: FIXTURE_NOW - 25 * DAY, createdAt: FIXTURE_NOW - 25 * DAY, expiresAt: FIXTURE_NOW + 5 * DAY })
  ]
}

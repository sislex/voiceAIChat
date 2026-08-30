// Политики срока жизни, лимитов и доверия. Всё это раньше жило внутри роутов
// сервера и не поддавалось отдельной проверке; здесь — чистые функции, которые
// одинаково зовут и сервер, и тесты, и чужое приложение со своей политикой.
import { deviceKey } from './deviceKey'
import { DEFAULT_SESSION_POLICY, type DeviceSession, type SessionPolicy } from './types'

/** Срок жизни новой сессии: «запомнить меня» переключает длинный TTL на короткий. */
export function ttlFor(input: { remember?: boolean; policy?: Partial<SessionPolicy> }): number {
  const policy = { ...DEFAULT_SESSION_POLICY, ...input.policy }
  return input.remember === false ? policy.shortTtlMs : policy.ttlMs
}

/** Живая сессия: не отозвана (её просто нет в списке) и не истекла. */
export function isActive(session: DeviceSession, now = Date.now()): boolean {
  return session.expiresAt > now
}

/** «Активна сейчас» — последняя активность внутри короткого окна. */
export function isOnline(session: DeviceSession, now = Date.now(), policy?: Partial<SessionPolicy>): boolean {
  const windowMs = { ...DEFAULT_SESSION_POLICY, ...policy }.onlineWindowMs
  return isActive(session, now) && now - session.lastSeen <= windowMs
}

/** Действует ли отметка «доверенное устройство» (она стареет вместе с сессией). */
export function isTrusted(session: DeviceSession, now = Date.now(), policy?: Partial<SessionPolicy>): boolean {
  const trustDays = { ...DEFAULT_SESSION_POLICY, ...policy }.trustDays
  return Boolean(session.trustedAt) && now - session.trustedAt! <= trustDays * 24 * 60 * 60_000
}

/** Брошенная сессия: формально жива, но активности не было дольше порога. */
export function isStale(session: DeviceSession, now = Date.now(), policy?: Partial<SessionPolicy>): boolean {
  const staleDays = { ...DEFAULT_SESSION_POLICY, ...policy }.staleDays
  if (!staleDays) return false
  return now - session.lastSeen > staleDays * 24 * 60 * 60_000
}

/**
 * Кого вытеснить при превышении лимита одновременных сессий. Жертвы — самые
 * давно неактивные; текущая сессия неприкосновенна, иначе вход выбивал бы сам
 * себя. Возвращает пустой массив, когда лимита нет или он не превышен.
 */
export function overLimit(sessions: readonly DeviceSession[], max: number | null | undefined, keepSid?: string | null): DeviceSession[] {
  if (!max || max <= 0 || sessions.length <= max) return []
  const candidates = sessions.filter((s) => s.sid !== keepSid).sort((a, b) => a.lastSeen - b.lastSeen)
  return candidates.slice(0, Math.max(0, sessions.length - max))
}

/**
 * Вход с нового устройства. Первый вход новым не считается (сравнивать не с
 * чем), как и вход в аккаунт, где все известные сессии — унаследованные без UA:
 * иначе одна миграция рассылала бы предупреждение всем сразу.
 */
export function isNewDevice(known: readonly DeviceSession[], candidate: { userAgent: string; ip: string }): boolean {
  if (known.length === 0) return false
  if (known.every((s) => s.userAgent === 'legacy')) return false
  const key = deviceKey(candidate)
  return !known.some((s) => (s.deviceKey ?? deviceKey({ userAgent: s.userAgent, ip: s.ip })) === key)
}

/** Доверенное устройство среди известных сессий — по нему пропускается второй фактор. */
export function findTrustedDevice(
  known: readonly DeviceSession[],
  candidate: { userAgent: string; ip: string },
  now = Date.now(),
  policy?: Partial<SessionPolicy>
): DeviceSession | null {
  const key = deviceKey(candidate)
  return known.find((s) => isTrusted(s, now, policy) && (s.deviceKey ?? deviceKey({ userAgent: s.userAgent, ip: s.ip })) === key) ?? null
}

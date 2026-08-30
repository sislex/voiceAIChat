// Публичная поверхность модуля «сессии и устройства».
export type {
  DeviceKind, DeviceProfile, DeviceSession, GeoInfo, NewSession, SessionPatch, SessionPolicy
} from './types'
export { DEFAULT_SESSION_POLICY, SESSION_TTL_MS, SESSION_SHORT_TTL_MS } from './types'
export { parseUserAgent, deviceIcon, LEGACY_USER_AGENT } from './device'
export { normalizeIp, localGeo, deviceKey, hash32, type NormalizedIp } from './deviceKey'
export { ttlFor, isActive, isOnline, isTrusted, isStale, isExpiringSoon, trustLeftMs, overLimit, isNewDevice, findTrustedDevice } from './policy'
export {
  sessionTitle, toView, sortSessions, filterSessions, otherSessions, durationOf,
  deviceSiblings, groupByDevice, platformsOf, countryFlag, sessionsSummary,
  type SessionView, type Duration, type SessionOrder
} from './presentation'
export { systemClock, type Awaitable, type Clock, type GeoResolver, type PruneOptions, type SessionStore } from './ports'
export { InMemorySessionStore, TOUCH_INTERVAL_MS, KEEP_REVOKED_MS } from './memoryStore'

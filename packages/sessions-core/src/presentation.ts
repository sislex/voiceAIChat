// Подготовка списка к показу: сортировка, поиск, относительные сроки. Живёт в
// ядре, а не в компоненте, потому что тот же порядок нужен и в админке, и в
// чужом хосте с другим UI — расхождение порядка выглядит как потерянная сессия.
import { parseUserAgent } from './device'
import { isOnline, isTrusted } from './policy'
import type { DeviceSession, DeviceProfile, SessionPolicy } from './types'

/** Сессия, готовая к отрисовке: разбор UA и вычисленные признаки уже сделаны. */
export interface SessionView {
  session: DeviceSession
  profile: DeviceProfile
  /** Имя пользователя устройства, если задано, иначе подпись из UA. */
  title: string
  online: boolean
  trusted: boolean
  current: boolean
  /** Где вошли: город/страна или «локальная сеть»; пустая строка — неизвестно. */
  place: string
  /** Сколько осталось до истечения, мс; ≤ 0 — сессия уже мертва. */
  expiresInMs: number
  /** Сколько ещё живых сессий у этого же устройства. */
  siblings: number
}

/** Подпись устройства для человека. Для унаследованных записей UA нет вовсе. */
export function sessionTitle(session: DeviceSession): string {
  if (session.label) return session.label
  const profile = parseUserAgent(session.userAgent)
  if (profile.legacy) return 'Устройство без метки'
  return profile.label
}

export function toView(session: DeviceSession, now = Date.now(), policy?: Partial<SessionPolicy>, all: readonly DeviceSession[] = []): SessionView {
  return {
    session,
    profile: parseUserAgent(session.userAgent),
    title: sessionTitle(session),
    online: isOnline(session, now, policy),
    trusted: isTrusted(session, now, policy),
    current: Boolean(session.current),
    place: session.geo?.label ?? '',
    expiresInMs: session.expiresAt - now,
    siblings: deviceSiblings(all, session)
  }
}

/**
 * Текущая сессия всегда первая — с неё пользователь начинает читать список и
 * по ней понимает, что видит именно себя; остальные по свежести активности.
 */
export function sortSessions(sessions: readonly DeviceSession[]): DeviceSession[] {
  return [...sessions].sort((a, b) => {
    if (Boolean(a.current) !== Boolean(b.current)) return a.current ? -1 : 1
    return b.lastSeen - a.lastSeen
  })
}

/** Поиск по всему, что видно в карточке: метка, браузер, ОС, адрес, место. */
export function filterSessions(sessions: readonly DeviceSession[], query: string): DeviceSession[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...sessions]
  return sessions.filter((s) => {
    const profile = parseUserAgent(s.userAgent)
    return [s.label ?? '', profile.browser, profile.os, s.ip, s.geo?.label ?? '', s.userAgent]
      .join(' ').toLowerCase().includes(q)
  })
}

/**
 * Сколько живых сессий приходится на то же устройство. Один браузер легко
 * набирает несколько входов (перелогин, другая вкладка после выхода), и без
 * этой подсказки список выглядит так, будто устройств больше, чем есть.
 */
export function deviceSiblings(sessions: readonly DeviceSession[], session: DeviceSession): number {
  const key = session.deviceKey
  if (!key) return 0
  return sessions.filter((s) => s.sid !== session.sid && s.deviceKey === key).length
}

/** Группы «одно устройство — несколько сессий»: ключ устройства → его сессии. */
export function groupByDevice(sessions: readonly DeviceSession[]): Map<string, DeviceSession[]> {
  const groups = new Map<string, DeviceSession[]>()
  for (const session of sessions) {
    // Сессии без ключа (старые записи) в группы не сводим: они не сравнимы.
    const key = session.deviceKey ?? `sid:${session.sid}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(session)
    else groups.set(key, [session])
  }
  return groups
}

/** Платформы, встреченные в списке: по ним строится фильтр в панели. */
export function platformsOf(sessions: readonly DeviceSession[]): string[] {
  return [...new Set(sessions.map((s) => s.platform).filter((p): p is string => Boolean(p)))].sort()
}

/** Сколько сессий кроме текущей — от этого зависит кнопка «выйти на других». */
export function otherSessions(sessions: readonly DeviceSession[]): DeviceSession[] {
  return sessions.filter((s) => !s.current)
}

/**
 * Грубое человеческое «сколько назад/через сколько» в единицах, а не в тексте:
 * склонение и язык — забота UI, ядро не тащит локали.
 */
export interface Duration { unit: 'now' | 'minute' | 'hour' | 'day' | 'month'; value: number }

export function durationOf(ms: number): Duration {
  const abs = Math.abs(ms)
  if (abs < 60_000) return { unit: 'now', value: 0 }
  if (abs < 60 * 60_000) return { unit: 'minute', value: Math.round(abs / 60_000) }
  if (abs < 24 * 60 * 60_000) return { unit: 'hour', value: Math.round(abs / (60 * 60_000)) }
  if (abs < 60 * 24 * 60 * 60_000) return { unit: 'day', value: Math.round(abs / (24 * 60 * 60_000)) }
  return { unit: 'month', value: Math.round(abs / (30 * 24 * 60 * 60_000)) }
}

import { useSyncExternalStore } from 'react'

export function safeStorageGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
export function safeStorageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* Keep the current UI usable. */ }
}
const cache = new Map<string, unknown>()
const listeners = new Set<() => void>()
export const userKey = (user: string, feature: string): string => `vc:shell:${encodeURIComponent(user)}:${feature}`
export function readPreference<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  if (cache.has(key)) return cache.get(key) as T
  let value = fallback
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (valid(parsed)) value = parsed
  } catch { /* Storage failure must not prevent using the shell. */ }
  cache.set(key, value)
  return value
}
export function writePreference<T>(key: string, value: T): void {
  cache.set(key, value)
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Keep the in-memory preference. */ }
  for (const listener of listeners) listener()
}
export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function usePreference<T>(user: string, feature: string, fallback: T, valid: (value: unknown) => value is T): [T, (value: T) => void] {
  const key = userKey(user, feature)
  const value = useSyncExternalStore(subscribePreferences, () => readPreference(key, fallback, valid))
  return [value, (next) => writePreference(key, next)]
}
export const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
export const EMPTY_IDS: string[] = []
export function resetPreferenceCache(): void { cache.clear() }

export interface ShellNotification {
  id: string
  text: string
  kind: 'success' | 'error' | 'info'
  source: 'toast' | 'run' | 'release' | 'invitation'
  time: number
  read: boolean
}
const EMPTY_NOTIFICATIONS: ShellNotification[] = []
const validNotifications = (value: unknown): value is ShellNotification[] => Array.isArray(value) && value.length <= 50 && value.every(item =>
  item && typeof item.id === 'string' && typeof item.text === 'string' && typeof item.time === 'number' && Number.isFinite(item.time) &&
  typeof item.read === 'boolean' && ['success', 'error', 'info'].includes(item.kind) && ['toast', 'run', 'release', 'invitation'].includes(item.source))
export function readNotifications(user: string): ShellNotification[] {
  return readPreference(userKey(user, 'notifications'), EMPTY_NOTIFICATIONS, validNotifications)
}
export function addNotification(user: string, item: ShellNotification): void {
  if (!user) return
  const previous = readNotifications(user)
  if (previous.some(value => value.id === item.id)) return
  // Copy display fields only: callbacks and invitation tokens never enter storage.
  const { id, text, kind, source, time, read } = item
  writePreference(userKey(user, 'notifications'), [{ id, text, kind, source, time, read }, ...previous].slice(0, 50))
}
export function useNotifications(user: string): [ShellNotification[], (id?: string) => void] {
  const items = useSyncExternalStore(subscribePreferences, () => readNotifications(user))
  return [items, (id) => writePreference(userKey(user, 'notifications'), readNotifications(user).map(item => !id || item.id === id ? { ...item, read: true } : item))]
}

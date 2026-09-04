// Доступ изолированного Chromium к dev-серверу выбранной машины.
//
// Машина живёт на своём loopback, поэтому раннер не может открыть её адрес
// напрямую: доставку делает прокси превью сервера (`/api/preview`) через
// компаньон-агента — тот же путь, которым Web Reader открывает машины. Здесь
// собирается адрес прокси и выдаётся ключ, которым запросы Chromium
// авторизуются от лица владельца рана.
//
// Ключ, а не сессионный токен пользователя: токен работал бы Bearer-ом на всём
// API, а лежал бы в профиле Chromium. Ключ действует только на пути прокси и
// только для машин, к которым у пользователя и так есть доступ (`canUse` в
// `previewProxy`).

import { randomBytes } from 'node:crypto'
import { MACHINE_PREVIEW_SUFFIX } from '../routes/previewProxy.js'

/** Cookie ключа; имя отличается от пользовательской preview-cookie. */
export const PREVIEW_RUN_COOKIE = 'vc_preview_run'

/** Сколько живёт ключ без продления: ран длиннее суток — это уже не ран. */
export const PREVIEW_RUN_KEY_TTL_MS = 24 * 60 * 60 * 1000

interface KeyEntry {
  userId: string
  expiresAt: number
}

/**
 * Реестр ключей «Chromium → прокси превью»: ключ на пользователя, срок
 * продлевается при каждой выдаче. Один ключ, а не по одному на ран: cookie
 * лежит в профиле Chromium, который переиспользуется между ранами задачи, и
 * ключ на ран устаревал бы в профиле сразу после его конца.
 */
export class PreviewRunKeys {
  private readonly byKey = new Map<string, KeyEntry>()
  private readonly byUser = new Map<string, string>()

  constructor(private readonly ttlMs: number = PREVIEW_RUN_KEY_TTL_MS) {}

  issue(userId: string, now = Date.now()): string {
    this.sweep(now)
    const existing = this.byUser.get(userId)
    const entry = existing ? this.byKey.get(existing) : undefined
    if (existing && entry) {
      entry.expiresAt = now + this.ttlMs
      return existing
    }
    const key = randomBytes(24).toString('base64url')
    this.byKey.set(key, { userId, expiresAt: now + this.ttlMs })
    this.byUser.set(userId, key)
    return key
  }

  userOf(key: string | undefined, now = Date.now()): string | null {
    if (!key) return null
    const entry = this.byKey.get(key)
    if (!entry) return null
    if (entry.expiresAt <= now) { this.forget(key, entry.userId); return null }
    return entry.userId
  }

  revoke(userId: string): void {
    const key = this.byUser.get(userId)
    if (key) this.forget(key, userId)
  }

  sweep(now = Date.now()): void {
    for (const [key, entry] of [...this.byKey]) if (entry.expiresAt <= now) this.forget(key, entry.userId)
  }

  /** Только для тестов: сколько ключей держим. */
  size(): number { return this.byKey.size }

  private forget(key: string, userId: string): void {
    this.byKey.delete(key)
    if (this.byUser.get(userId) === key) this.byUser.delete(userId)
  }
}

/** Адрес машины ведёт на её loopback, поэтому его открывает не Chromium, а прокси. */
export function isMachinePreviewUrl(raw: string): boolean {
  try { return new URL(raw).hostname.toLowerCase().endsWith(MACHINE_PREVIEW_SUFFIX) } catch { return false }
}

/**
 * Адрес машины → адрес прокси превью, видимый из контейнера раннера. Прочие
 * адреса возвращаются как есть: публичный сайт Chromium открывает сам, и
 * прогонять его через прокси значило бы менять страницу без нужды.
 */
export function machinePreviewUrl(runnerFacingBase: string, raw: string): string {
  if (!isMachinePreviewUrl(raw)) return raw
  const base = runnerFacingBase.replace(/\/+$/, '')
  return `${base}/api/preview?url=${encodeURIComponent(raw)}`
}

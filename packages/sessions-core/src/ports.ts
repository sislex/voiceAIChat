// Порты модуля: всё, что модуль ждёт от приложения. Реализуйте их — и ядро
// работает поверх любой базы, любых часов и любого гео-провайдера.
import type { DeviceSession, GeoInfo, NewSession, SessionPatch } from './types'

/** Хранилище может быть синхронным (SQLite в процессе) или асинхронным (сеть). */
export type Awaitable<T> = T | Promise<T>

export interface PruneOptions {
  /** Сколько держать отозванные строки, прежде чем удалить (по умолчанию неделя). */
  keepRevokedMs?: number
}

/**
 * Хранилище сессий. Контракт закреплён исполняемым набором
 * `runSessionStoreContract` — любая реализация обязана его проходить.
 *
 * Время реализация берёт из своих часов (`Clock`), а не из аргументов: так
 * контракт одинаково проверяется и на хранилище в памяти, и на базе с
 * подменёнными в тестах часами, и на удалённом сервисе.
 */
export interface SessionStore {
  /** Регистрирует сессию входа; повторный вызов с тем же sid только обновляет активность. */
  create(input: NewSession): Awaitable<void>
  /** Живая сессия по sid; отозванная и истёкшая — null. */
  get(sid: string): Awaitable<DeviceSession | null>
  /** Есть ли строка вообще, включая отозванную: отозванная сессия не должна воскресать. */
  has(sid: string): Awaitable<boolean>
  /** Живые сессии пользователя, порядок — по свежести активности. */
  list(user: string): Awaitable<DeviceSession[]>
  /** Отметка активности и продление срока; реализация вправе экономить записи. */
  touch(sid: string, input: { ttlMs: number; path?: string }): Awaitable<void>
  /** Правка метки/доверия; false — сессии нет. */
  update(sid: string, patch: SessionPatch): Awaitable<boolean>
  /** Отзыв одной сессии; false — её нет или она уже отозвана. */
  revoke(sid: string): Awaitable<boolean>
  /** Отзыв всех сессий пользователя, кроме указанной; возвращает число отозванных. */
  revokeAll(user: string, exceptSid?: string | null): Awaitable<number>
  /** Удаление истёкших и давно отозванных строк; возвращает число удалённых. */
  prune(options?: PruneOptions): Awaitable<number>
}

/** Определение места по адресу. Реализация обязана быть fail-open: ошибка → null. */
export interface GeoResolver {
  resolve(ip: string): Awaitable<GeoInfo | null>
}

/** Часы — чтобы тесты и «замороженное время» не требовали моков глобалей. */
export interface Clock {
  now(): number
}

export const systemClock: Clock = { now: () => Date.now() }

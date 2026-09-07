// Основа доменных репозиториев: общее соединение, генераторы id/времени и доступ к соседям.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import type Database from 'better-sqlite3'
import type { IdentityRepo } from './identity.js'
import type { SettingsRepo } from './settings.js'
import type { LlmRepo } from './llm.js'
import type { ChatRepo } from './chat.js'
import type { MachinesRepo } from './machines.js'
import type { ProjectsRepo } from './projects.js'
import type { TasksRepo } from './tasks.js'
import type { CiRepo } from './ci.js'
import type { QaRepo } from './qa.js'
import type { ReleasesRepo } from './releases.js'
import type { KbRepo } from './kb.js'

/** Все доменные репозитории одной БД; соседи доступны через this.repos, чтобы кросс-доменные обращения были видны глазами и гейту. */
export interface Repos {
  readonly identity: IdentityRepo
  readonly settings: SettingsRepo
  readonly llm: LlmRepo
  readonly chat: ChatRepo
  readonly machines: MachinesRepo
  readonly projects: ProjectsRepo
  readonly tasks: TasksRepo
  readonly ci: CiRepo
  readonly qa: QaRepo
  readonly releases: ReleasesRepo
  readonly kb: KbRepo
}

/** Общее состояние одного соединения: репозитории не владеют им, а делят. */
export interface RepoContext {
  readonly db: Database.Database
  readonly newId: () => string
  readonly now: () => number
  /** Close-события WebSocket могут прийти после teardown; закрытую БД больше не трогаем. */
  closed: boolean
  repos: Repos
}

/**
 * Асинхронный порт репозитория: те же методы, но каждый возвращает Promise. Сервер
 * говорит с данными только через порты (db.chat, db.tasks, …), поэтому реализацию
 * домена можно заменить на удалённую, не трогая вызывающих. Сегодня реализация —
 * синхронный better-sqlite3: тело метода выполняется сразу, откладывается лишь
 * продолжение вызывающего.
 */
export type AsyncPort<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never
}

/**
 * Оборачивает синхронный репозиторий в AsyncPort. Прокси, а не сгенерированные
 * обёртки: у 500+ методов один и тот же контракт, и его не нужно поддерживать
 * руками. Присваивание в порт (моки в тестах, vi.spyOn) уходит в сам репозиторий,
 * поэтому подмена метода видна и через порт, и соседям через this.repos.
 */
export function asyncPort<T extends object>(impl: T): AsyncPort<T> {
  const cache = new Map<PropertyKey, unknown>()
  return new Proxy(impl, {
    get(target, key) {
      const value = Reflect.get(target, key) as unknown
      if (typeof value !== 'function') return value
      let wrapped = cache.get(key)
      if (!wrapped || (wrapped as { impl?: unknown }).impl !== value) {
        const fn = value as (...args: unknown[]) => unknown
        const w = async (...args: unknown[]) => fn.apply(target, args)
        ;(w as unknown as { impl: unknown }).impl = value
        wrapped = w
        cache.set(key, wrapped)
      }
      return wrapped
    },
    set(target, key, value) {
      cache.delete(key)
      return Reflect.set(target, key, value)
    }
  }) as unknown as AsyncPort<T>
}

/** Асинхронные порты всех доменов — то, что видит сервер (db.chat, db.tasks, …). */
export type Ports = { [K in keyof Repos]: AsyncPort<Repos[K]> }

/**
 * Замена порта домена другой реализацией (другой движок, удалённый сервис). Фабрика
 * получает уже собранные порты соседей: реализация на другом движке спрашивает членство
 * в проекте через `ports.projects`, а не через общее соединение SQLite, которого у неё нет.
 */
export type PortOverrides = { [K in keyof Ports]?: (ports: Ports) => Ports[K] }

export abstract class BaseRepo {
  protected readonly db: Database.Database
  protected readonly newId: () => string
  protected readonly now: () => number
  constructor(private readonly ctx: RepoContext) {
    this.db = ctx.db
    this.newId = ctx.newId
    this.now = ctx.now
  }
  protected get closed(): boolean { return this.ctx.closed }
  protected get repos(): Repos { return this.ctx.repos }
}

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

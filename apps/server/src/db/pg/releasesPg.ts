// Домен «releases» на Postgres — proof-of-concept замены движка одного домена за тем же
// портом (`AsyncPort<ReleasesRepo>`). Семантика повторяет repos/releases.ts метод в метод;
// контрактный тест (releases.contract.test.ts) гоняет оба движка одним набором.
//
// Чем отличается от SQLite-варианта по существу:
// - соседей (членство в проекте) спрашиваем через их асинхронные порты, а не this.repos:
//   у домена на другом движке общего соединения с ними нет;
// - FK на projects(id) нет — таблица проектов живёт в другом движке; каскад удаления
//   проекта здесь не сработает, и это осознанная цена разделения (см. план, круг 4);
// - метки времени в мс — BIGINT (клиент разбирает int8 в number).
import { RELEASE_STEP_ORDER, type ProjectRelease, type ProjectReleaseSummary, type ReleaseStepKind, type ReleaseStepStatus, type ReleaseTimeouts, DEFAULT_RELEASE_TIMEOUTS, validateReleaseTimeouts, releaseStepLimit } from '@voicechat/shared'
import type { AsyncPort } from '../repos/base.js'
import type { ProjectsRepo } from '../repos/projects.js'
import type { ReleasesRepo } from '../repos/releases.js'
import type { SqlClient } from './sqlClient.js'

export const RELEASES_PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS project_releases (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version TEXT NOT NULL, branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', triggered_by TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1, previous_release_id TEXT REFERENCES project_releases(id),
  created_at BIGINT NOT NULL, released_at BIGINT, agent_id TEXT, checkout_path TEXT, deleted_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_release_attempt ON project_releases(project_id, branch, attempt);
CREATE INDEX IF NOT EXISTS idx_project_releases_project ON project_releases(project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS project_release_steps (
  id TEXT PRIMARY KEY, release_id TEXT NOT NULL REFERENCES project_releases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', model TEXT,
  attempt INTEGER NOT NULL, log TEXT NOT NULL DEFAULT '', started_at BIGINT, finished_at BIGINT, limit_ms BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_release_step ON project_release_steps(release_id, position);
CREATE TABLE IF NOT EXISTS project_release_events (
  id TEXT PRIMARY KEY, release_id TEXT NOT NULL REFERENCES project_releases(id) ON DELETE CASCADE,
  type TEXT NOT NULL, actor TEXT, payload_json TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_release_events ON project_release_events(release_id, created_at);
`

interface ReleaseRow { id: string; project_id: string; version: string; branch: string; commit_sha: string; status: string; triggered_by: string; attempt: number; previous_release_id: string | null; created_at: number; released_at: number | null; agent_id: string | null; checkout_path: string | null; deleted_at: number | null }
interface ReleaseSummaryRow { id: string; branch: string; commit_sha: string; status: string; previous_release_id: string | null; created_at: number; started_at: number | null; finished_at: number | null; running: number }
interface ReleaseStepRow { id: string; release_id: string; kind: string; position: number; status: string; model: string | null; attempt: number; log: string; started_at: number | null; finished_at: number | null; limit_ms: number | null }

export interface ReleasesPgDeps {
  sql: SqlClient
  /** Порт соседнего домена: проверки членства и владения проектом. */
  projects: Pick<AsyncPort<ProjectsRepo>, 'isProjectMember' | 'isProjectOwner'>
  newId: () => string
  now: () => number
}

export class ReleasesPgRepo implements AsyncPort<ReleasesRepo> {
  constructor(private readonly deps: ReleasesPgDeps) {}

  /** Идемпотентно: как SCHEMA_SQL у SQLite, выполняется при каждом старте. */
  async ensureSchema(): Promise<void> {
    await this.deps.sql.exec(RELEASES_PG_SCHEMA)
  }

  async createProjectRelease(userId: string, projectId: string, input: { branch: string; version: string; sha: string; status?: ProjectRelease['status']; models?: Partial<Record<ReleaseStepKind, string>>; previousReleaseId?: string | null; agentId?: string; checkoutPath?: string; limits?: ReleaseTimeouts }): Promise<ProjectRelease> {
    if (!(await this.deps.projects.isProjectOwner(userId, projectId))) throw new Error('release permission required')
    const previous = input.previousReleaseId ? await this.releaseRow(input.previousReleaseId) : null
    if (input.previousReleaseId && (!previous || previous.project_id !== projectId || previous.branch !== input.branch)) throw new Error('invalid previous release')
    const [{ n }] = await this.deps.sql.query<{ n: number | null }>(`SELECT MAX(attempt) AS n FROM project_releases WHERE project_id=$1 AND branch=$2`, [projectId, input.branch])
    const nextByBranch = (n ?? 0) + 1
    const attempt = previous ? Math.max(previous.attempt + 1, nextByBranch) : nextByBranch
    const id = this.deps.newId(), now = this.deps.now()
    await this.deps.sql.transaction(async (tx) => {
      const limits = validateReleaseTimeouts(input.limits ?? DEFAULT_RELEASE_TIMEOUTS)
      await tx.query(
        `INSERT INTO project_releases (id,project_id,version,branch,commit_sha,status,triggered_by,attempt,previous_release_id,created_at,agent_id,checkout_path) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, projectId, input.version, input.branch, input.sha, input.status ?? 'preparing', userId, attempt, input.previousReleaseId ?? null, now, input.agentId ?? null, input.checkoutPath ?? null]
      )
      for (const [position, kind] of RELEASE_STEP_ORDER.entries()) {
        await tx.query(
          `INSERT INTO project_release_steps (id,release_id,kind,position,status,model,attempt,limit_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [this.deps.newId(), id, kind, position, 'queued', input.models?.[kind] ?? null, attempt, releaseStepLimit(kind, limits)]
        )
      }
      await this.addReleaseEvent(tx, id, 'release.created', userId, { branch: input.branch, version: input.version, sha: input.sha, attempt })
    })
    return (await this.getProjectRelease(userId, projectId, id)) as ProjectRelease
  }

  async listProjectReleases(userId: string, projectId: string): Promise<ProjectRelease[]> {
    if (!(await this.deps.projects.isProjectMember(userId, projectId))) return []
    const rows = await this.deps.sql.query<ReleaseRow>(`SELECT * FROM project_releases WHERE project_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, [projectId])
    return Promise.all(rows.map((row) => this.mapProjectRelease(row)))
  }

  async listProjectReleaseSummaries(userId: string, projectId: string): Promise<ProjectReleaseSummary[]> {
    if (!(await this.deps.projects.isProjectMember(userId, projectId))) return []
    const rows = await this.deps.sql.query<ReleaseSummaryRow>(
      `SELECT r.id,r.branch,r.commit_sha,r.status,r.previous_release_id,r.created_at,MIN(s.started_at) AS started_at,MAX(s.finished_at) AS finished_at,
              MAX(CASE WHEN s.started_at IS NOT NULL AND s.finished_at IS NULL THEN 1 ELSE 0 END) AS running
         FROM project_releases r LEFT JOIN project_release_steps s ON s.release_id=r.id
        WHERE r.project_id=$1 AND r.deleted_at IS NULL GROUP BY r.id ORDER BY r.created_at DESC`,
      [projectId]
    )
    const now = this.deps.now()
    return rows.map((row) => ({ id: row.id, branch: row.branch, sha: row.commit_sha, status: row.status as ProjectRelease['status'], previousReleaseId: row.previous_release_id, createdAt: row.created_at, durationMs: row.started_at == null ? null : (row.running ? now : row.finished_at ?? now) - row.started_at }))
  }

  async listActiveProjectReleases(): Promise<ProjectRelease[]> {
    const rows = await this.deps.sql.query<ReleaseRow>(`SELECT * FROM project_releases WHERE status IN ('switching','building','health_check') ORDER BY created_at`)
    return Promise.all(rows.map((row) => this.mapProjectRelease(row)))
  }

  async getProjectRelease(userId: string, projectId: string, id: string): Promise<ProjectRelease | null> {
    if (!(await this.deps.projects.isProjectMember(userId, projectId))) return null
    const row = await this.releaseRow(id)
    return row?.project_id === projectId ? this.mapProjectRelease(row) : null
  }

  async setProjectReleaseSha(id: string, sha: string): Promise<void> {
    await this.deps.sql.query(`UPDATE project_releases SET commit_sha=$1 WHERE id=$2`, [sha, id])
  }

  async setProjectReleaseStatus(id: string, status: ProjectRelease['status'], actor: string): Promise<void> {
    const now = this.deps.now()
    await this.deps.sql.query(`UPDATE project_releases SET status=$1,released_at=$2 WHERE id=$3`, [status, status === 'released' ? now : null, id])
    await this.addReleaseEvent(this.deps.sql, id, `release.${status}`, actor, {})
  }

  async setProjectReleaseStep(id: string, kind: ReleaseStepKind, status: ReleaseStepStatus, log: string, actor: string): Promise<void> {
    const now = this.deps.now()
    // Явные приведения типов параметров: в CASE Postgres не выводит тип $n сам.
    await this.deps.sql.query(
      `UPDATE project_release_steps SET status=$1,log=$2,
              started_at=CASE WHEN $1::text='running' THEN COALESCE(started_at,$3::bigint) ELSE started_at END,
              finished_at=CASE WHEN $1::text IN ('passed','failed','skipped') THEN $3::bigint ELSE NULL END
        WHERE release_id=$4 AND kind=$5`,
      [status, log, now, id, kind]
    )
    await this.addReleaseEvent(this.deps.sql, id, `step.${status}`, actor, { kind, log })
  }

  async softDeleteProjectRelease(userId: string, projectId: string, id: string): Promise<boolean> {
    if (!(await this.deps.projects.isProjectOwner(userId, projectId))) throw new Error('release permission required')
    const row = await this.releaseRow(id)
    if (!row || row.project_id !== projectId || row.previous_release_id || !['ready', 'failed'].includes(row.status)) throw new Error('Этот релиз нельзя удалить')
    const [active] = await this.deps.sql.query(`SELECT 1 FROM project_releases WHERE project_id=$1 AND previous_release_id=$2 AND status IN ('queued','switching','building','health_check')`, [projectId, id])
    const [current] = await this.deps.sql.query<{ previous_release_id: string | null }>(`SELECT previous_release_id FROM project_releases WHERE project_id=$1 AND status='released' ORDER BY released_at DESC LIMIT 1`, [projectId])
    if (active) throw new Error('У релиза есть активный deploy')
    if (current?.previous_release_id === id) throw new Error('Текущий production-релиз удалить нельзя')
    await this.deps.sql.query(`UPDATE project_releases SET deleted_at=$1 WHERE id=$2`, [this.deps.now(), id])
    await this.addReleaseEvent(this.deps.sql, id, 'release.deleted', userId, { branch: row.branch })
    return true
  }

  private async releaseRow(id: string): Promise<ReleaseRow | undefined> {
    const [row] = await this.deps.sql.query<ReleaseRow>(`SELECT * FROM project_releases WHERE id=$1`, [id])
    return row
  }

  private async mapProjectRelease(row: ReleaseRow): Promise<ProjectRelease> {
    const steps = (await this.deps.sql.query<ReleaseStepRow>(`SELECT * FROM project_release_steps WHERE release_id=$1 ORDER BY position`, [row.id]))
      .map((s) => ({ id: s.id, kind: s.kind as ReleaseStepKind, status: s.status as ReleaseStepStatus, model: s.model, attempt: s.attempt, log: s.log, startedAt: s.started_at, finishedAt: s.finished_at, limitMs: s.limit_ms ?? null }))
    return { id: row.id, projectId: row.project_id, version: row.version, branch: row.branch, sha: row.commit_sha, status: row.status as ProjectRelease['status'], triggeredBy: row.triggered_by, attempt: row.attempt, previousReleaseId: row.previous_release_id, createdAt: row.created_at, releasedAt: row.released_at, agentId: row.agent_id ?? null, checkoutPath: row.checkout_path ?? null, deletedAt: row.deleted_at ?? null, steps }
  }

  private async addReleaseEvent(sql: SqlClient, releaseId: string, type: string, actor: string, payload: unknown): Promise<void> {
    await sql.query(`INSERT INTO project_release_events (id,release_id,type,actor,payload_json,created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [this.deps.newId(), releaseId, type, actor, JSON.stringify(payload), this.deps.now()])
  }
}

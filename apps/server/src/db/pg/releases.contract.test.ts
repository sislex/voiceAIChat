// Контракт домена «релизы»: один набор проверок для двух движков — SQLite-репозиторий за
// asyncPort и ReleasesPgRepo на встроенном Postgres (pglite). Если реализации расходятся,
// расходится и поведение Release Center в зависимости от VC_DB_RELEASES — этого мы не хотим.
import { afterEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from '../database.js'
import { ReleasesPgRepo } from './releasesPg.js'
import { createPgliteClient, type SqlClient } from './sqlClient.js'

const OWNER = 'owner'
const MEMBER = 'member'
const STRANGER = 'stranger'
const SHA = 'a'.repeat(40)

type Engine = 'sqlite' | 'pglite'

async function makeDb(engine: Engine): Promise<{ db: VoiceChatDb; close: () => Promise<void> }> {
  let id = 0, clock = 1_700_000_000_000
  const deps = { newId: () => `id-${++id}`, now: () => (clock += 1000) }
  if (engine === 'sqlite') {
    const db = new VoiceChatDb(':memory:', deps)
    return { db, close: async () => db.close() }
  }
  const sql: SqlClient = await createPgliteClient(':memory:')
  let repo: ReleasesPgRepo | null = null
  const db = new VoiceChatDb(':memory:', { ...deps, ports: { releases: (ports) => (repo = new ReleasesPgRepo({ sql, projects: ports.projects, ...deps })) } })
  await repo!.ensureSchema()
  return { db, close: async () => { db.close(); await sql.close() } }
}

async function seed(db: VoiceChatDb): Promise<string> {
  await db.identity.createUser(OWNER, '', 'developer')
  await db.identity.createUser(MEMBER, '', 'developer')
  await db.identity.createUser(STRANGER, '', 'developer')
  const project = await db.projects.createProject(OWNER, { name: 'P' })
  await db.projects.addMember(OWNER, project.id, MEMBER)
  return project.id
}

const closers: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })

describe.each<Engine>(['sqlite', 'pglite'])('релизы на движке %s', (engine) => {
  const setup = async () => {
    const made = await makeDb(engine)
    closers.push(made.close)
    return { db: made.db, projectId: await seed(made.db) }
  }

  it('создаёт релиз с шагами и событием, возвращает его через get/list', async () => {
    const { db, projectId } = await setup()
    const release = await db.releases.createProjectRelease(OWNER, projectId, { branch: 'release/1.0.0', version: '1.0.0', sha: SHA })
    expect(release).toMatchObject({ projectId, version: '1.0.0', branch: 'release/1.0.0', sha: SHA, status: 'preparing', triggeredBy: OWNER, attempt: 1, previousReleaseId: null })
    expect(release.steps.map((step) => step.status)).toEqual(release.steps.map(() => 'queued'))
    expect(release.steps.length).toBeGreaterThan(0)
    expect(await db.releases.getProjectRelease(MEMBER, projectId, release.id)).toEqual(release)
    expect((await db.releases.listProjectReleases(MEMBER, projectId)).map((r) => r.id)).toEqual([release.id])
  })

  it('не владелец создать не может, чужой не видит, а член видит', async () => {
    const { db, projectId } = await setup()
    await expect(db.releases.createProjectRelease(MEMBER, projectId, { branch: 'b', version: '1', sha: SHA })).rejects.toThrow('release permission required')
    const release = await db.releases.createProjectRelease(OWNER, projectId, { branch: 'b', version: '1', sha: SHA })
    expect(await db.releases.getProjectRelease(STRANGER, projectId, release.id)).toBeNull()
    expect(await db.releases.listProjectReleases(STRANGER, projectId)).toEqual([])
    expect(await db.releases.listProjectReleaseSummaries(STRANGER, projectId)).toEqual([])
  })

  it('номер попытки — max+1 по ветке; повтор от предыдущего релиза не падает в UNIQUE', async () => {
    const { db, projectId } = await setup()
    const first = await db.releases.createProjectRelease(OWNER, projectId, { branch: 'b', version: '1', sha: SHA })
    const second = await db.releases.createProjectRelease(OWNER, projectId, { branch: 'b', version: '1', sha: SHA })
    expect([first.attempt, second.attempt]).toEqual([1, 2])
    const retry = await db.releases.createProjectRelease(OWNER, projectId, { branch: 'b', version: '1', sha: SHA, previousReleaseId: first.id })
    expect(retry.attempt).toBe(3)
    expect(retry.previousReleaseId).toBe(first.id)
    await expect(db.releases.createProjectRelease(OWNER, projectId, { branch: 'other', version: '1', sha: SHA, previousReleaseId: first.id })).rejects.toThrow('invalid previous release')
  })

  it('статус, sha и шаги меняются; сводка считает длительность по шагам', async () => {
    const { db, projectId } = await setup()
    const release = await db.releases.createProjectRelease(OWNER, projectId, { branch: 'b', version: '1', sha: SHA })
    const kind = release.steps[0]!.kind
    await db.releases.setProjectReleaseStep(release.id, kind, 'running', 'пошли', OWNER)
    let summaries = await db.releases.listProjectReleaseSummaries(OWNER, projectId)
    expect(summaries[0]).toMatchObject({ id: release.id, status: 'preparing' })
    expect(summaries[0]!.durationMs).toBeGreaterThan(0)
    await db.releases.setProjectReleaseStep(release.id, kind, 'passed', 'готово', OWNER)
    await db.releases.setProjectReleaseSha(release.id, 'b'.repeat(40))
    await db.releases.setProjectReleaseStatus(release.id, 'released', OWNER)
    const updated = (await db.releases.getProjectRelease(OWNER, projectId, release.id))!
    expect(updated.sha).toBe('b'.repeat(40))
    expect(updated.status).toBe('released')
    expect(updated.releasedAt).not.toBeNull()
    const step = updated.steps.find((s) => s.kind === kind)!
    expect(step).toMatchObject({ status: 'passed', log: 'готово' })
    expect(step.startedAt).not.toBeNull()
    expect(step.finishedAt).not.toBeNull()
    summaries = await db.releases.listProjectReleaseSummaries(OWNER, projectId)
    expect(summaries[0]!.durationMs).toBe(step.finishedAt! - step.startedAt!)
  })

  it('активные релизы — только в фазах switching/building/health_check', async () => {
    const { db, projectId } = await setup()
    const a = await db.releases.createProjectRelease(OWNER, projectId, { branch: 'a', version: '1', sha: SHA })
    const b = await db.releases.createProjectRelease(OWNER, projectId, { branch: 'b', version: '1', sha: SHA })
    await db.releases.setProjectReleaseStatus(a.id, 'building', OWNER)
    await db.releases.setProjectReleaseStatus(b.id, 'ready', OWNER)
    expect((await db.releases.listActiveProjectReleases()).map((r) => r.id)).toEqual([a.id])
  })

  it('soft delete: готовый и упавший удаляются, в работе и с потомками — нет', async () => {
    const { db, projectId } = await setup()
    const ready = await db.releases.createProjectRelease(OWNER, projectId, { branch: 'a', version: '1', sha: SHA, status: 'ready' })
    const failed = await db.releases.createProjectRelease(OWNER, projectId, { branch: 'b', version: '1', sha: SHA, status: 'failed' })
    const building = await db.releases.createProjectRelease(OWNER, projectId, { branch: 'c', version: '1', sha: SHA, status: 'building' })
    await expect(db.releases.softDeleteProjectRelease(MEMBER, projectId, ready.id)).rejects.toThrow('release permission required')
    await expect(db.releases.softDeleteProjectRelease(OWNER, projectId, building.id)).rejects.toThrow('Этот релиз нельзя удалить')
    await expect(db.releases.softDeleteProjectRelease(OWNER, projectId, 'missing')).rejects.toThrow('Этот релиз нельзя удалить')
    // У релиза есть активный deploy-потомок — удалять нельзя.
    const child = await db.releases.createProjectRelease(OWNER, projectId, { branch: 'a', version: '1', sha: SHA, status: 'queued', previousReleaseId: ready.id })
    await expect(db.releases.softDeleteProjectRelease(OWNER, projectId, ready.id)).rejects.toThrow('У релиза есть активный deploy')
    await db.releases.setProjectReleaseStatus(child.id, 'failed', OWNER)
    expect(await db.releases.softDeleteProjectRelease(OWNER, projectId, failed.id)).toBe(true)
    expect((await db.releases.listProjectReleases(OWNER, projectId)).map((r) => r.id).sort()).toEqual([building.id, child.id, ready.id].sort())
    expect((await db.releases.getProjectRelease(OWNER, projectId, failed.id))?.deletedAt).not.toBeNull()
  })
})

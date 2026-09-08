// События таймлайна релиза: живой лог шага не плодит событий, чистка оставляет по одному `step.running` на шаг.
import { describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'

async function setup(): Promise<{ db: VoiceChatDb; projectId: string; releaseId: string }> {
  const db = new VoiceChatDb(':memory:')
  await db.ready
  await db.identity.createUser('owner', '', 'developer')
  const projectId = (await db.projects.createProject('owner', { name: 'P' })).id
  const release = await db.releases.createProjectRelease('owner', projectId, { branch: 'release/1.0.0', version: '1.0.0', sha: 'sha', status: 'preparing' })
  return { db, projectId, releaseId: release.id }
}

async function events(db: VoiceChatDb, releaseId: string): Promise<Array<{ type: string; kind: string }>> {
  const rows = (await (db as unknown as { sql: { all(sql: string, params: unknown[]): Promise<unknown[]> } }).sql.all(
    `SELECT type, payload_json FROM project_release_events WHERE release_id = ? ORDER BY created_at, rowid`, [releaseId]
  )) as Array<{ type: string; payload_json: string }>
  return rows.map((r) => ({ type: r.type, kind: (JSON.parse(r.payload_json) as { kind?: string }).kind ?? '' }))
}

describe('события релиза и живой лог шага', () => {
  it('обновление лога работающего шага не пишет событие; смена статуса — пишет', async () => {
    const { db, releaseId } = await setup()
    await db.releases.setProjectReleaseStep(releaseId, 'regression', 'running', '', 'owner')
    await db.releases.setProjectReleaseStep(releaseId, 'regression', 'running', 'строка 1', 'owner')
    await db.releases.setProjectReleaseStep(releaseId, 'regression', 'running', 'строка 1\nстрока 2', 'owner')
    await db.releases.setProjectReleaseStep(releaseId, 'regression', 'passed', 'строка 1\nстрока 2', 'owner')
    const list = (await events(db, releaseId)).filter((e) => e.type.startsWith('step.'))
    expect(list).toEqual([{ type: 'step.running', kind: 'regression' }, { type: 'step.passed', kind: 'regression' }])
    await db.close()
  })

  it('pruneProgressEvents удаляет дубли step.running по шагу и не трогает остальное', async () => {
    const { db, releaseId } = await setup()
    const sql = (db as unknown as { sql: { run(sql: string, params: unknown[]): Promise<unknown> } }).sql
    // Старая база: событие на каждый чанк.
    for (let i = 0; i < 7; i++) await sql.run(`INSERT INTO project_release_events (id, release_id, type, actor, payload_json, created_at) VALUES (?, ?, 'step.running', 'owner', ?, ?)`, [`e-${i}`, releaseId, JSON.stringify({ kind: i < 5 ? 'regression' : 'building', log: `лог ${i}` }), 1000 + i])
    await sql.run(`INSERT INTO project_release_events (id, release_id, type, actor, payload_json, created_at) VALUES ('e-done', ?, 'step.passed', 'owner', ?, 2000)`, [releaseId, JSON.stringify({ kind: 'regression', log: 'ok' })])
    expect(await db.releases.pruneProgressEvents(2)).toBe(5)
    const list = await events(db, releaseId)
    expect(list.filter((e) => e.type === 'step.running')).toEqual([{ type: 'step.running', kind: 'regression' }, { type: 'step.running', kind: 'building' }])
    expect(list.some((e) => e.type === 'step.passed')).toBe(true)
    expect(await db.releases.pruneProgressEvents()).toBe(0)
    await db.close()
  })
})

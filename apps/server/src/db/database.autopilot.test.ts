// Auto-pilot task settings Core still persists: the per-task manual-QA stop and the
// project Automated QA scenario settings. Stage-failure handling moved to Kanban.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import * as dbSeed from '../test/seed.js'

let db: VoiceChatDb
beforeEach(async () => {
  let id = 0
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => 1000 })
  await db.identity.createUser('alice', '', 'developer')
})
afterEach(() => db.close())

describe('остановка на ручном QA для отдельной задачи', () => {
  it('миграция сохраняет прежнюю остановку и не перезаписывает выбор при следующем открытии', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vc-autopilot-migration-'))
    const path = join(directory, 'db.sqlite')
    let migrated = new VoiceChatDb(path)
    try {
      await migrated.identity.createUser('alice', '', 'developer')
      const project = await migrated.projects.createProject('alice', { name: 'P' })
      await dbSeed.updateProject(migrated, 'alice', project.id, { autoPilotRequiresManualQa: true })
      const board = (await migrated.tasks.getBoard('alice', project.id))!
      const task = (await migrated.tasks.createTask('alice', project.id, { title: 'Legacy', columnId: board.columns[0].id }))!
      await migrated.close()
      const legacy = new Database(path)
      legacy.exec('ALTER TABLE tasks DROP COLUMN auto_pilot_requires_manual_qa')
      legacy.close()
      migrated = new VoiceChatDb(path)
      await migrated.ready
      expect((await migrated.tasks.getTaskDetail('alice', project.id, task.id))!.autoPilotRequiresManualQa).toBe(true)
      await dbSeed.updateTask(migrated, 'alice', project.id, task.id, { autoPilotRequiresManualQa: false })
      await migrated.close()
      migrated = new VoiceChatDb(path)
      await migrated.ready
      expect((await migrated.tasks.getTaskDetail('alice', project.id, task.id))!.autoPilotRequiresManualQa).toBe(false)
    } finally {
      await migrated.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  // @testCase TC-GATE-01
  it('наследуется при создании, затем сохраняется независимо от проекта', async () => {
    const project = await db.projects.createProject('alice', { name: 'P' })
    await dbSeed.updateProject(db, 'alice', project.id, { autoPilotDefault: true, autoPilotRequiresManualQa: true })
    const board = (await db.tasks.getBoard('alice', project.id))!
    const task = (await db.tasks.createTask('alice', project.id, { title: 'QA', columnId: board.columns[0].id }))!
    expect(task.autoPilotRequiresManualQa).toBe(true)
    await dbSeed.updateProject(db, 'alice', project.id, { autoPilotRequiresManualQa: false })
    await dbSeed.updateTask(db, 'alice', project.id, task.id, { autoPilotRequiresManualQa: false })
    expect((await db.tasks.getTaskDetail('alice', project.id, task.id))!.autoPilot).toBe(true)
    expect((await db.tasks.getBoard('alice', project.id))!.tasks[0].autoPilotRequiresManualQa).toBe(false)
    await dbSeed.updateTask(db, 'alice', project.id, task.id, { autoPilotRequiresManualQa: true })
    expect((await db.tasks.getTaskDetail('alice', project.id, task.id))!.autoPilotRequiresManualQa).toBe(true)
  })
})

describe('этап Automated QA: шаг рана и настройки', () => {

  it('режим и сценарий этапа сохраняются и переживают чтение проекта', async () => {
    const project = await db.projects.createProject('alice', { name: 'P' })
    await dbSeed.updateProject(db, 'alice', project.id, {
      automatedQaMode: 'playwright',
      automatedQaScenarios: [{ startUrl: 'http://localhost:5173', steps: [{ id: 's1', title: 'Кнопка', action: { kind: 'click', selector: '#create' } }] }]
    })
    const detail = (await db.projects.getProject('alice', project.id))!
    expect(detail.automatedQaMode).toBe('playwright')
    expect(detail.automatedQaScenarios?.[0]?.steps).toHaveLength(1)
  })

  it('шаг с неизвестным действием отбрасывается, а не роняет прогон', async () => {
    const project = await db.projects.createProject('alice', { name: 'P' })
    await dbSeed.updateProject(db, 'alice', project.id, {
      automatedQaScenarios: [{
        startUrl: 'http://localhost:5173',
        steps: [
          { id: 's1', title: 'Кнопка', action: { kind: 'click', selector: '#create' } },
          { id: 's2', title: 'Мусор', action: { kind: 'teleport' } as never }
        ]
      }]
    })
    expect((await db.projects.getProject('alice', project.id))!.automatedQaScenarios?.[0]?.steps.map((step) => step.id)).toEqual(['s1'])
  })
})

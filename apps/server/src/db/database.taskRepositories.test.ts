import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
beforeEach(async () => {
  db = new VoiceChatDb(':memory:')
  await db.identity.createUser('owner', '', 'developer')
})
afterEach(() => db.close())

describe('task repositories', () => {
  it('tracks task repositories per machine and hides them from outsiders', async () => {
    const project = await db.projects.createProject('owner', { name: 'Task repos' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    await db.tasks.upsertTaskRepository(project.id, task.id, 'agent-x', '/repos/chatai/CHAT-1', 'dev-workspace')
    await db.tasks.upsertTaskRepository(project.id, task.id, 'agent-y', '/repos2/chatai/CHAT-1.merge-r1', 'merge-clone')
    await db.tasks.upsertTaskRepository(project.id, task.id, 'agent-y', '/repos2/chatai/CHAT-1.merge-r1', 'merge-clone')
    const all = await db.tasks.listTaskRepositories('owner', project.id, task.id)
    expect(all.map((repo) => repo.agentId).sort()).toEqual(['agent-x', 'agent-y'])
    expect(await db.tasks.listTaskRepositories('stranger', project.id, task.id)).toHaveLength(0)
  })
})

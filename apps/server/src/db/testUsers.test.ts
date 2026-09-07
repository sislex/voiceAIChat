// Тестовые пользователи проекта и гейт доступа к машине для loopback-моста превью.

import { beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database'

const U = 'admin'

function makeDb(): VoiceChatDb {
  let idCounter = 0
  let clock = 1_000
  return new VoiceChatDb(':memory:', {
    newId: () => `id-${++idCounter}`,
    now: () => (clock += 10)
  })
}

describe('тестовые пользователи проекта', () => {
  let db: VoiceChatDb
  beforeEach(async () => {
    db = makeDb()
    await db.identity.ensureAdmin()
  })

  it('сохраняются владельцем и читаются в ProjectDetail', async () => {
    const project = await db.projects.createProject(U, { name: 'Магазин' })
    const updated = await db.projects.updateProject(U, project.id, {
      testUsers: [
        { name: 'tester', password: 'test-pass', role: 'admin', note: 'полный доступ' },
        { name: 'viewer', password: '' }
      ]
    })
    expect(updated?.testUsers).toEqual([
      { name: 'tester', password: 'test-pass', role: 'admin', note: 'полный доступ' },
      { name: 'viewer', password: '' }
    ])
    expect((await db.projects.getProject(U, project.id))?.testUsers).toHaveLength(2)
  })

  it('проект без тестовых пользователей отдаёт пустой список', async () => {
    const project = await db.projects.createProject(U, { name: 'Пустой' })
    expect((await db.projects.getProject(U, project.id))?.testUsers).toEqual([])
  })
})

describe('canUseAgentForPreview', () => {
  let db: VoiceChatDb
  beforeEach(async () => {
    db = makeDb()
    await db.identity.ensureAdmin()
    await db.identity.createUser('member', '', 'developer')
    await db.identity.createUser('stranger', '', 'developer')
  })

  it('владелец машины имеет доступ, посторонний — нет', async () => {
    const agent = await db.machines.createAgent(U, 'Мак')
    expect(await db.machines.canUseAgentForPreview(U, agent.id)).toBe(true)
    expect(await db.machines.canUseAgentForPreview('stranger', agent.id)).toBe(false)
  })

  it('участник проекта получает доступ через share машины, не-участник — нет', async () => {
    const agent = await db.machines.createAgent(U, 'Мак')
    const project = await db.projects.createProject(U, { name: 'Магазин' })
    await db.projects.addMember(U, project.id, 'member')
    await db.machines.setMachineSharedWithProject(U, project.id, agent.id, true)
    expect(await db.machines.canUseAgentForPreview('member', agent.id)).toBe(true)
    expect(await db.machines.canUseAgentForPreview('stranger', agent.id)).toBe(false)
    await db.machines.setMachineSharedWithProject(U, project.id, agent.id, false)
    expect(await db.machines.canUseAgentForPreview('member', agent.id)).toBe(false)
  })
})

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
  beforeEach(() => {
    db = makeDb()
    db.identity.ensureAdmin()
  })

  it('сохраняются владельцем и читаются в ProjectDetail', () => {
    const project = db.projects.createProject(U, { name: 'Магазин' })
    const updated = db.projects.updateProject(U, project.id, {
      testUsers: [
        { name: 'tester', password: 'test-pass', role: 'admin', note: 'полный доступ' },
        { name: 'viewer', password: '' }
      ]
    })
    expect(updated?.testUsers).toEqual([
      { name: 'tester', password: 'test-pass', role: 'admin', note: 'полный доступ' },
      { name: 'viewer', password: '' }
    ])
    expect(db.projects.getProject(U, project.id)?.testUsers).toHaveLength(2)
  })

  it('проект без тестовых пользователей отдаёт пустой список', () => {
    const project = db.projects.createProject(U, { name: 'Пустой' })
    expect(db.projects.getProject(U, project.id)?.testUsers).toEqual([])
  })
})

describe('canUseAgentForPreview', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
    db.identity.ensureAdmin()
    db.identity.createUser('member', '', 'developer')
    db.identity.createUser('stranger', '', 'developer')
  })

  it('владелец машины имеет доступ, посторонний — нет', () => {
    const agent = db.machines.createAgent(U, 'Мак')
    expect(db.machines.canUseAgentForPreview(U, agent.id)).toBe(true)
    expect(db.machines.canUseAgentForPreview('stranger', agent.id)).toBe(false)
  })

  it('участник проекта получает доступ через share машины, не-участник — нет', () => {
    const agent = db.machines.createAgent(U, 'Мак')
    const project = db.projects.createProject(U, { name: 'Магазин' })
    db.projects.addMember(U, project.id, 'member')
    db.machines.setMachineSharedWithProject(U, project.id, agent.id, true)
    expect(db.machines.canUseAgentForPreview('member', agent.id)).toBe(true)
    expect(db.machines.canUseAgentForPreview('stranger', agent.id)).toBe(false)
    db.machines.setMachineSharedWithProject(U, project.id, agent.id, false)
    expect(db.machines.canUseAgentForPreview('member', agent.id)).toBe(false)
  })
})

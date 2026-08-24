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
    db.ensureAdmin()
  })

  it('сохраняются владельцем и читаются в ProjectDetail', () => {
    const project = db.createProject(U, { name: 'Магазин' })
    const updated = db.updateProject(U, project.id, {
      testUsers: [
        { name: 'tester', password: 'test-pass', role: 'admin', note: 'полный доступ' },
        { name: 'viewer', password: '' }
      ]
    })
    expect(updated?.testUsers).toEqual([
      { name: 'tester', password: 'test-pass', role: 'admin', note: 'полный доступ' },
      { name: 'viewer', password: '' }
    ])
    expect(db.getProject(U, project.id)?.testUsers).toHaveLength(2)
  })

  it('проект без тестовых пользователей отдаёт пустой список', () => {
    const project = db.createProject(U, { name: 'Пустой' })
    expect(db.getProject(U, project.id)?.testUsers).toEqual([])
  })
})

describe('canUseAgentForPreview', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
    db.ensureAdmin()
    db.createUser('member', '', 'developer')
    db.createUser('stranger', '', 'developer')
  })

  it('владелец машины имеет доступ, посторонний — нет', () => {
    const agent = db.createAgent(U, 'Мак')
    expect(db.canUseAgentForPreview(U, agent.id)).toBe(true)
    expect(db.canUseAgentForPreview('stranger', agent.id)).toBe(false)
  })

  it('участник проекта получает доступ через share машины, не-участник — нет', () => {
    const agent = db.createAgent(U, 'Мак')
    const project = db.createProject(U, { name: 'Магазин' })
    db.addMember(U, project.id, 'member')
    db.setMachineSharedWithProject(U, project.id, agent.id, true)
    expect(db.canUseAgentForPreview('member', agent.id)).toBe(true)
    expect(db.canUseAgentForPreview('stranger', agent.id)).toBe(false)
    db.setMachineSharedWithProject(U, project.id, agent.id, false)
    expect(db.canUseAgentForPreview('member', agent.id)).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { createCommandGate, commandGateMessage } from './commandGate'

const gate = createCommandGate({
  projectPolicy: async (id) => (id === 'p1' ? { denyPatterns: ['docker'], allowPatterns: [], confirmDangerous: true } : id === 'p2' ? { denyPatterns: [], allowPatterns: [], confirmDangerous: false } : null),
  rolePolicies: async () => ({ tester: { denyPatterns: ['git push'], allowPatterns: [] } }),
  userRole: async (u) => (u === 'tester1' ? 'tester' : u === 'dev' ? 'developer' : null)
})

describe('commandGate', () => {
  it('проектный deny и ролевой deny отказывают с указанием слоя', async () => {
    expect(await gate({ command: 'docker ps', projectId: 'p1', userId: 'dev', source: 'console' })).toMatchObject({ allowed: false, layer: 'project' })
    expect(await gate({ command: 'git push origin x', userId: 'tester1', source: 'console' })).toMatchObject({ allowed: false, layer: 'role' })
    expect(await gate({ command: 'git push origin x', userId: 'dev', source: 'console' })).toEqual({ allowed: true })
  })

  it('опасная команда в чате ждёт confirm, в консоли — нет; проект может отключить подтверждение', async () => {
    const v = await gate({ command: 'rm -rf build', projectId: 'p1', source: 'chat' })
    expect(v).toMatchObject({ allowed: false, needsConfirmation: true, layer: 'confirm' })
    expect(commandGateMessage(v)).toContain('confirm: true')
    expect(await gate({ command: 'rm -rf build', projectId: 'p1', source: 'chat', confirm: true })).toEqual({ allowed: true })
    expect(await gate({ command: 'rm -rf build', projectId: 'p1', source: 'console' })).toEqual({ allowed: true })
    expect(await gate({ command: 'rm -rf build', projectId: 'p2', source: 'chat' })).toEqual({ allowed: true })
    // без проекта — дефолт: подтверждение нужно
    expect(await gate({ command: 'git push --force', source: 'chat' })).toMatchObject({ needsConfirmation: true })
  })
})

import { describe, it, expect } from 'vitest'
import { createCommandGate, commandGateMessage } from './commandGate'

const gate = createCommandGate({
  projectPolicy: (id) => (id === 'p1' ? { denyPatterns: ['docker'], allowPatterns: [], confirmDangerous: true } : id === 'p2' ? { denyPatterns: [], allowPatterns: [], confirmDangerous: false } : null),
  rolePolicies: () => ({ tester: { denyPatterns: ['git push'], allowPatterns: [] } }),
  userRole: (u) => (u === 'tester1' ? 'tester' : u === 'dev' ? 'developer' : null)
})

describe('commandGate', () => {
  it('проектный deny и ролевой deny отказывают с указанием слоя', () => {
    expect(gate({ command: 'docker ps', projectId: 'p1', userId: 'dev', source: 'console' })).toMatchObject({ allowed: false, layer: 'project' })
    expect(gate({ command: 'git push origin x', userId: 'tester1', source: 'console' })).toMatchObject({ allowed: false, layer: 'role' })
    expect(gate({ command: 'git push origin x', userId: 'dev', source: 'console' })).toEqual({ allowed: true })
  })

  it('опасная команда в чате ждёт confirm, в консоли — нет; проект может отключить подтверждение', () => {
    const v = gate({ command: 'rm -rf build', projectId: 'p1', source: 'chat' })
    expect(v).toMatchObject({ allowed: false, needsConfirmation: true, layer: 'confirm' })
    expect(commandGateMessage(v)).toContain('confirm: true')
    expect(gate({ command: 'rm -rf build', projectId: 'p1', source: 'chat', confirm: true })).toEqual({ allowed: true })
    expect(gate({ command: 'rm -rf build', projectId: 'p1', source: 'console' })).toEqual({ allowed: true })
    expect(gate({ command: 'rm -rf build', projectId: 'p2', source: 'chat' })).toEqual({ allowed: true })
    // без проекта — дефолт: подтверждение нужно
    expect(gate({ command: 'git push --force', source: 'chat' })).toMatchObject({ needsConfirmation: true })
  })
})

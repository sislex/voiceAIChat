import { describe, expect, it } from 'vitest'
import { parseTestPlanLibrary } from './testPlan'

const check = { id: 'chat.new.answer', title: 'T', steps: ['a'], expected: 'e', role: 'user', builds: ['minimal', 'full'], needsModel: true, priority: 'smoke' }

describe('parseTestPlanLibrary', () => {
  it('accepts a valid library and drops duplicate builds', () => {
    const parsed = parseTestPlanLibrary({ id: 'chat', title: 'Чат', checks: [{ ...check, builds: ['minimal', 'minimal'] }] })
    expect(parsed.checks[0]!.builds).toEqual(['minimal'])
  })
  it('rejects ids outside the library, duplicates and unknown enums', () => {
    expect(() => parseTestPlanLibrary({ id: 'chat', title: 'x', checks: [{ ...check, id: 'make.a.b' }] })).toThrow(/must look like chat/)
    expect(() => parseTestPlanLibrary({ id: 'chat', title: 'x', checks: [check, check] })).toThrow(/duplicate/)
    expect(() => parseTestPlanLibrary({ id: 'chat', title: 'x', checks: [{ ...check, priority: 'p1' }] })).toThrow(/priority/)
    expect(() => parseTestPlanLibrary({ id: 'chat', title: 'x', checks: [{ ...check, builds: [] }] })).toThrow(/builds/)
    expect(() => parseTestPlanLibrary({ id: 'chat', title: 'x', checks: [{ ...check, steps: [] }] })).toThrow(/steps/)
  })
})

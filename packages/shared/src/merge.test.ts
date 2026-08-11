import { describe, it, expect } from 'vitest'
import { canStartMerge, isActiveMergeStatus } from './merge'

describe('merge availability', () => {
  const ready = { semanticType: 'awaiting_merge' as const, sourceBranch: 'feature/171', permitted: true, machineBound: true }

  it('разрешает только подготовленную задачу в awaiting_merge', () => {
    expect(canStartMerge(ready)).toBe(true)
    expect(canStartMerge({ ...ready, semanticType: 'merge' })).toBe(false)
    expect(canStartMerge({ ...ready, sourceBranch: '' })).toBe(false)
  })

  it('блокирует повтор, слитую ветку и отсутствие прав или машины', () => {
    expect(canStartMerge({ ...ready, hasActiveRun: true })).toBe(false)
    expect(canStartMerge({ ...ready, alreadyMerged: true })).toBe(false)
    expect(canStartMerge({ ...ready, permitted: false })).toBe(false)
    expect(canStartMerge({ ...ready, machineBound: false })).toBe(false)
  })

  it('считает rollback активной обязательной стадией', () => {
    expect(isActiveMergeStatus('rolling_back')).toBe(true)
    expect(isActiveMergeStatus('success')).toBe(false)
  })
})

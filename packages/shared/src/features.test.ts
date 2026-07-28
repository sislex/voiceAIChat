import { describe, expect, it } from 'vitest'
import { canTransitionFeature, featureColumnSemantic } from './features'

describe('feature workflow', () => {
  it('разрешает только явные переходы автомата', () => {
    expect(canTransitionFeature('preparing', 'planning')).toBe(true)
    expect(canTransitionFeature('development', 'testing')).toBe(true)
    expect(canTransitionFeature('testing', 'awaiting_merge')).toBe(true)
    expect(canTransitionFeature('development', 'completed')).toBe(false)
  })

  it('отображает статус в системную колонку', () => {
    expect(featureColumnSemantic('planning')).toBe('development')
    expect(featureColumnSemantic('testing')).toBe('testing')
    expect(featureColumnSemantic('awaiting_merge')).toBe('awaiting_merge')
    expect(featureColumnSemantic('completed')).toBe('done')
    expect(featureColumnSemantic('cancelled')).toBe('ready')
  })
})

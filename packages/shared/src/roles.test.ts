import { describe, it, expect } from 'vitest'
import { CLAUDE_MODELS, clampModelForRole, isModelAllowed, modelsForRole } from './types'

describe('модели по роли', () => {
  it('admin имеет доступ ко всем моделям', () => {
    expect(modelsForRole('admin')).toHaveLength(CLAUDE_MODELS.length)
    for (const m of CLAUDE_MODELS) expect(isModelAllowed(m.id, 'admin')).toBe(true)
  })

  it('user — без opus и fable (только sonnet/haiku)', () => {
    expect(modelsForRole('user').map((m) => m.id).sort()).toEqual(['haiku', 'sonnet'])
    expect(isModelAllowed('opus', 'user')).toBe(false)
    expect(isModelAllowed('fable', 'user')).toBe(false)
    expect(isModelAllowed('sonnet', 'user')).toBe(true)
    expect(isModelAllowed('haiku', 'user')).toBe(true)
  })

  it('clampModelForRole откатывает запрещённую модель к sonnet', () => {
    expect(clampModelForRole('opus', 'user')).toBe('sonnet')
    expect(clampModelForRole('fable', 'user')).toBe('sonnet')
    expect(clampModelForRole('haiku', 'user')).toBe('haiku')
    // admin не клампится.
    expect(clampModelForRole('opus', 'admin')).toBe('opus')
  })
})

import { describe, expect, it } from 'vitest'
import { makeNextSteps } from './makeNextSteps'

describe('makeNextSteps (roadmap-4 п.8)', () => {
  const base = { hasTokens: true, hasTests: true, hasStories: true, published: true, openComments: 0, a11yIssues: null, files: 5 }
  it('приоритет замечаниям и доступности, всегда не больше трёх', () => {
    expect(makeNextSteps({ ...base, openComments: 2, a11yIssues: 1 }).map((s) => s.id)).toEqual(['comments', 'a11y', 'responsive'])
    expect(makeNextSteps(base)).toHaveLength(3)
  })
  it('без токенов предлагает токены, без тестов при сториз — тесты', () => {
    expect(makeNextSteps({ ...base, hasTokens: false }).map((s) => s.id)).toContain('tokens')
    expect(makeNextSteps({ ...base, hasTests: false }, 5).map((s) => s.id)).toContain('tests')
  })
})

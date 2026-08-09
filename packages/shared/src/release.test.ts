import { describe, expect, it } from 'vitest'
import { RELEASE_STEP_ORDER, assertReleaseBranch, releaseVersion } from './release'

describe('release branch contract', () => {
  it.each([
    ['release/1.2.3', '1.2.3'],
    ['release/0.0.1', '0.0.1'],
    ['origin/release/1.2.3', null],
    ['feature/1.2.3', null],
    ['release/01.2.3', null],
    ['release/1.2', null],
    ['release/1.2.3/evil', null]
  ])('validates %s', (branch, version) => expect(releaseVersion(branch)).toBe(version))

  it('rejects an arbitrary deploy branch', () => {
    expect(() => assertReleaseBranch('main')).toThrow('release/x.y.z')
  })

  it('keeps all release gates ordered and mandatory', () => {
    expect(RELEASE_STEP_ORDER).toEqual([
      'regression', 'knowledge_base', 'merge_main', 'push_main',
      'production_deploy', 'health_check', 'cleanup'
    ])
  })
})

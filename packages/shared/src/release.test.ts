import { describe, expect, it } from 'vitest'
import { RELEASE_STEP_ORDER, assertReleaseBranch, releaseFailureSummary, releaseVersion } from './release'

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
      'regression', 'knowledge_base', 'switching', 'building', 'health_check'
    ])
  })

  it('summarizes a failed gate while preserving the diagnostic log separately', () => {
    const log = '> npm run kb:index\ndiff --git a/docs/kb/README.md b/docs/kb/README.md'
    expect(releaseFailureSummary('knowledge_base', log)).toBe('База знаний не синхронизирована с кодом')
    expect(releaseFailureSummary('health_check', 'error: connection refused\nstack trace')).toBe('connection refused')
    expect(releaseFailureSummary('switching', '')).toBe('Не удалось переключить production checkout')
  })

  it('summarizes historical release steps unknown to the current contract', () => {
    expect(releaseFailureSummary('cleanup', 'Машина не в сети')).toBe('Машина не в сети')
    expect(releaseFailureSummary('push_main', 'Updated tag\nerror: tag already exists')).toBe('tag already exists')
    expect(releaseFailureSummary('legacy_step', '')).toBe('Шаг релиза завершился ошибкой')
  })
})

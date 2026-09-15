import { describe, expect, it } from 'vitest'
import { RELEASE_STEP_ORDER, assertReleaseBranch, compareReleaseBranches, normalizeReleaseVersionInput, productionReadiness, releaseFailureSummary, releaseVersion, suggestNextReleaseVersion } from './release'

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

  it('compares release branches numerically', () => {
    expect(compareReleaseBranches('release/0.1.15', 'release/0.1.10')).toBeGreaterThan(0)
    expect(compareReleaseBranches('release/2.0.0', 'release/10.0.0')).toBeLessThan(0)
    expect(compareReleaseBranches('release/1.2.3', 'release/1.2.3')).toBe(0)
    expect(compareReleaseBranches('main', 'release/1.2.3')).toBeNull()
  })

  it('keeps all release gates ordered and mandatory', () => {
    expect(RELEASE_STEP_ORDER).toEqual([
      'checkout', 'regression', 'knowledge_base', 'switching', 'building', 'health_check'
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

describe('suggestNextReleaseVersion', () => {
  it('берёт старшую ветку и увеличивает patch', () => {
    expect(suggestNextReleaseVersion(['release/0.1.9', 'release/0.1.300', 'release/0.1.42'])).toBe('0.1.301')
    expect(suggestNextReleaseVersion(['release/1.2.3', 'release/2.0.0', 'release/1.9.9'])).toBe('2.0.1')
  })
  it('игнорирует невалидные ветки и без релизов даёт стартовую версию', () => {
    expect(suggestNextReleaseVersion(['main', 'origin/release/3.0.0'])).toBe('0.1.0')
    expect(suggestNextReleaseVersion([], '1.0.0')).toBe('1.0.0')
  })
})

describe('productionReadiness', () => {
  const full = { gitUrl: 'git@github.com:x/y.git', productionAgentId: 'prod', productionDeployCommand: 'voicechat-deploy', productionHealthCheckCommand: 'curl …', productionCheckoutPath: '/root/ChatAI', machines: [{ agentId: 'prod' }] }
  it('готов, когда настроено всё, что требует сервер', () => {
    expect(productionReadiness(full)).toEqual({ ready: true, mode: 'legacy', missing: [] })
    expect(productionReadiness({ ...full, productionCheckoutPath: '', productionEnvironmentMode: 'managed' }).ready).toBe(true)
  })
  it('перечисляет недостающее по порядку формы настроек', () => {
    expect(productionReadiness({ ...full, productionAgentId: null, productionDeployCommand: ' ' }).missing).toEqual(['production-машина', 'команда деплоя'])
    expect(productionReadiness({ ...full, machines: [{ agentId: 'other' }] }).missing).toEqual(['production-машина не привязана к проекту'])
    expect(productionReadiness({ ...full, productionCheckoutPath: undefined }).missing).toEqual(['production checkout'])
  })
})
describe('normalizeReleaseVersionInput', () => {
  it('снимает release/ и v, обрезает пробелы', () => {
    expect(normalizeReleaseVersionInput(' release/0.1.302 ')).toBe('0.1.302')
    expect(normalizeReleaseVersionInput('v1.2.3')).toBe('1.2.3')
    expect(normalizeReleaseVersionInput('1.2.3')).toBe('1.2.3')
  })
})

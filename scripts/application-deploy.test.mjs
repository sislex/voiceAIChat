import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applicationCompositionMatches,
  deployApplications,
  parseDeploymentConfig
} from './application-deploy.mjs'
const release = (id, version = '1.0.0') => ({
  schemaVersion: 1,
  applicationId: id,
  version,
  apiVersion: '1.0.0',
  commit: 'a'.repeat(40),
  dataVersion: '1.0.0',
  requires:
    id === 'make'
      ? [
          {
            applicationId: 'core',
            minVersion: '1.0.0',
            maxVersionExclusive: '2.0.0',
            minApiVersion: '1.0.0',
            maxApiVersionExclusive: '2.0.0'
          }
        ]
      : [],
  capabilities: [],
  artifacts: [
    {
      service: id === 'core' ? 'voicechat' : id,
      kind: 'oci',
      reference:
        'registry.test/' +
        id +
        '@sha256:' +
        (version === '1.0.0' ? 'a' : 'b').repeat(64)
    }
  ]
})
const environment = (...releases) => ({
  schemaVersion: 1,
  revision: 1,
  applications: releases.map((manifest) => ({
    manifest,
    healthy: true,
    installedAt: 1
  }))
})
function fixture(options = {}) {
  const previous = environment(release('core'), release('make')),
    next = release('make', '1.1.0'),
    calls = []
  let current = structuredClone(previous),
    replaced = 0
  const runtime = {
    observe: () => structuredClone(current),
    inventory: () => [
      {
        Id: options.touchOther && replaced ? 'core-restarted' : 'core-original',
        Config: { Labels: { 'com.docker.compose.service': 'voicechat' } }
      },
      {
        Id: 'make-' + replaced,
        Config: { Labels: { 'com.docker.compose.service': 'make' } }
      }
    ],
    pull: (manifest) => {
      calls.push(['pull', manifest])
      if (options.badDigest) throw new Error('metadata mismatch')
    },
    replace: (manifests) => {
      calls.push(['replace', manifests])
      replaced++
      current = environment(release('core'), manifests[0])
      if (options.healthFailure && replaced === 1)
        current.applications[1].healthy = false
      if (options.rollbackFailure && replaced > 1)
        throw new Error('rollback failed')
    }
  }
  return { previous, next, runtime, calls }
}
test('deploy меняет только выбранные digest и проверяет здоровье', async () => {
  const { previous, next, runtime, calls } = fixture()
  const result = await deployApplications(
    { previous, releases: [next] },
    runtime,
    { attempts: 1 }
  )
  assert.equal(result.status, 'released')
  assert.deepEqual(calls.find((call) => call[0] === 'replace')[1], [next])
  assert.equal(result.environment.applications[0].manifest.version, '1.0.0')
})
test('изменившийся состав и несовместимая зависимость не вызывают pull/up', async () => {
  for (const change of ['drift', 'version']) {
    const { previous, next, runtime, calls } = fixture()
    if (change === 'drift') previous.applications[0].manifest.version = '1.1.0'
    else next.requires[0].minVersion = '1.1.0'
    await assert.rejects(
      deployApplications({ previous, releases: [next] }, runtime, {
        attempts: 1
      })
    )
    assert.deepEqual(calls, [])
  }
})
test('health failure восстанавливает точный предыдущий образ', async () => {
  const { previous, next, runtime, calls } = fixture({ healthFailure: true })
  const result = await deployApplications(
    { previous, releases: [next] },
    runtime,
    { attempts: 1 }
  )
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.environment, previous)
  assert.deepEqual(
    calls
      .filter((call) => call[0] === 'replace')
      .map((call) => call[1][0].version),
    ['1.1.0', '1.0.0']
  )
})
test('неудачный откат сохраняет неопределённое состояние', async () => {
  const { previous, next, runtime } = fixture({
    healthFailure: true,
    rollbackFailure: true
  })
  const result = await deployApplications(
    { previous, releases: [next] },
    runtime,
    { attempts: 1 }
  )
  assert.equal(result.status, 'uncertain')
  assert.equal(result.environment, null)
})
test('перезапуск постороннего контейнера не объявляется успешным deploy', async () => {
  const { previous, next, runtime } = fixture({ touchOther: true })
  assert.equal(
    (
      await deployApplications({ previous, releases: [next] }, runtime, {
        attempts: 1
      })
    ).status,
    'uncertain'
  )
})
test('подмена метаданных образа останавливает работу до replace', async () => {
  const { previous, next, runtime, calls } = fixture({ badDigest: true })
  await assert.rejects(
    deployApplications({ previous, releases: [next] }, runtime, {
      attempts: 1
    }),
    /metadata/
  )
  assert.equal(
    calls.some((call) => call[0] === 'replace'),
    false
  )
})
test('конфигурация площадки не принимает произвольный сервис или health URL', () => {
  const config = {
    projectId: 'test',
    environment: 'staging',
    projectName: 'test',
    composeFiles: ['compose.yaml'],
    stateDir: 'state',
    health: { make: { port: 8788, path: '/v1/health' } }
  }
  assert.equal(
    parseDeploymentConfig(config, '/fixture').composeFiles[0],
    '/fixture/compose.yaml'
  )
  assert.throws(() =>
    parseDeploymentConfig(
      { ...config, health: { other: { port: 1, path: '/health' } } },
      '/fixture'
    )
  )
  assert.throws(() =>
    parseDeploymentConfig(
      { ...config, health: { make: { port: 8788, path: 'https://external' } } },
      '/fixture'
    )
  )
})
test('сверка состава не зависит от порядка и проверяет удалённые приложения', () => {
  const a = environment(release('core'), release('make')),
    b = structuredClone(a)
  b.applications.reverse()
  assert.equal(applicationCompositionMatches(a, b), true)
  b.applications.pop()
  assert.equal(applicationCompositionMatches(a, b), false)
})

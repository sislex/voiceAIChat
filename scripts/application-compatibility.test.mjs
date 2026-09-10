import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planCompatibilityMatrix,
  compatibilityCompose
} from './application-compatibility.mjs'
const release = (id, version) => ({
  schemaVersion: 1,
  applicationId: id,
  version,
  apiVersion: '1.0.0',
  commit: 'a'.repeat(40),
  dataVersion: '1.0.0',
  capabilities: [],
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
  artifacts: [
    {
      service: id === 'core' ? 'voicechat' : id,
      kind: 'oci',
      reference: 'registry.test/' + id + '@sha256:' + 'b'.repeat(64)
    }
  ]
})
const candidate = release('make', '1.2.0'),
  minimum = release('core', '1.0.0'),
  current = release('core', '1.1.0')
const matrix = {
  schemaVersion: 1,
  current: { core: '1.1.0' },
  environments: [
    { name: 'minimum', applications: [minimum] },
    { name: 'current', applications: [current] }
  ]
}
test('матрица проверяет минимум и явно заявленную текущую версию', () => {
  assert.equal(planCompatibilityMatrix(candidate, matrix).length, 2)
  assert.throws(
    () =>
      planCompatibilityMatrix(candidate, {
        ...matrix,
        environments: [matrix.environments[1]]
      }),
    /минимальной/
  )
  assert.throws(
    () =>
      planCompatibilityMatrix(candidate, {
        ...matrix,
        environments: [matrix.environments[0]]
      }),
    /текущего/
  )
})
test('матрица не разрешает неизвестную зависимость и подмену кандидата', () => {
  assert.throws(
    () =>
      planCompatibilityMatrix(candidate, {
        ...matrix,
        environments: [
          { name: 'bad', applications: [release('core', '2.0.0')] }
        ]
      }),
    /требуется/
  )
  assert.throws(
    () =>
      planCompatibilityMatrix(candidate, {
        ...matrix,
        environments: [{ name: 'bad', applications: [minimum, candidate] }]
      }),
    /подменять/
  )
  assert.throws(() => planCompatibilityMatrix(candidate, null), /матрица/)
})
test('стенд использует только заданные digest и случайно опубликованные loopback-порты', () => {
  const compose = compatibilityCompose(candidate, [minimum])
  assert.deepEqual(Object.keys(compose.services).sort(), ['make', 'voicechat'])
  assert.equal(compose.services.make.image, candidate.artifacts[0].reference)
  assert.deepEqual(compose.services.make.ports, ['127.0.0.1::8080'])
  assert.equal(compose.services.voicechat.environment.VC_MAKE_MODE, 'remote')
  assert.equal(compose.services.voicechat.build, undefined)
  assert.equal(compose.services.voicechat.volumes, undefined)
})

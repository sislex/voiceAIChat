import assert from 'node:assert/strict'
import test from 'node:test'
import { fastCheckForPackage, runFastChecks, runPackageGates, selectAffected } from './affected-check.mjs'

const ids = (decision) => decision.packages.map((pkg) => pkg.id)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function timedStart(events, { fail } = {}) {
  let active = 0
  let maxActive = 0
  return {
    start(pkg, script, { maxWorkers }) {
      active += 1
      maxActive = Math.max(maxActive, active)
      events.push({ type: 'start', pkg: pkg.id, script, maxWorkers })
      let stopped = false
      const done = (async () => {
        await delay(30)
        active -= 1
        events.push({ type: 'end', pkg: pkg.id, script })
        if (fail?.(pkg, script)) throw Object.assign(new Error('expected failure'), { code: 23 })
      })()
      return {
        done,
        stop() {
          if (stopped) return
          stopped = true
          events.push({ type: 'stop', pkg: pkg.id, script })
        }
      }
    },
    maxActive: () => maxActive
  }
}

test('selectAffected выбирает пакеты и безопасный fallback', async (t) => {
  await t.test('правка только server', () => {
    const decision = selectAffected(['apps/server/src/server.ts'])
    assert.equal(decision.full, false)
    assert.deepEqual(ids(decision), ['server'])
  })

  await t.test('shared проверяет себя и всех известных потребителей', () => {
    const decision = selectAffected(['packages/shared/src/ci.ts'])
    assert.equal(decision.full, false)
    assert.deepEqual(ids(decision), ['shared', 'server', 'runner', 'agent', 'ui', 'web'])
  })

  for (const file of ['package-lock.json', 'package.json', 'scripts/kb.mjs', '.github/workflows/ci.yml', 'unknown/critical.ts']) {
    await t.test(`${file} включает полный гейт`, () => {
      const decision = selectAffected([file])
      assert.equal(decision.full, true)
      assert.deepEqual(ids(decision), ['shared', 'server', 'runner', 'agent', 'ui', 'web'])
      assert.match(decision.reason, /общий конфиг|нераспознанный/)
    })
  }

  await t.test('пустой diff ничего не запускает', () => {
    const decision = selectAffected([])
    assert.equal(decision.full, false)
    assert.deepEqual(ids(decision), [])
  })

  await t.test('некорректный diff включает полный гейт', () => {
    const decision = selectAffected(['apps/server/src/x.ts', ''])
    assert.equal(decision.full, true)
    assert.deepEqual(ids(decision), ['shared', 'server', 'runner', 'agent', 'ui', 'web'])
  })
})

test('runPackageGates ограничивает два независимых гейта и замеряет ускорение', async () => {
  const packages = [{ id: 'one' }, { id: 'two' }]

  const sequentialEvents = []
  const sequentialRunner = timedStart(sequentialEvents)
  const sequentialStarted = Date.now()
  await runPackageGates(packages, { jobs: 1, start: sequentialRunner.start })
  const sequentialMs = Date.now() - sequentialStarted

  const parallelEvents = []
  const parallelRunner = timedStart(parallelEvents)
  const parallelStarted = Date.now()
  await runPackageGates(packages, { jobs: 2, start: parallelRunner.start })
  const parallelMs = Date.now() - parallelStarted

  assert.equal(sequentialRunner.maxActive(), 1)
  assert.equal(parallelRunner.maxActive(), 2)
  assert.ok(parallelMs < sequentialMs, `parallel ${parallelMs}ms must be faster than sequential ${sequentialMs}ms`)
  const parallelTests = parallelEvents.filter((event) => event.type === 'start' && event.script === 'test')
  const sequentialTests = sequentialEvents.filter((event) => event.type === 'start' && event.script === 'test')
  assert.ok(parallelTests.every((event) => event.maxWorkers === 1))
  assert.ok(sequentialTests.every((event) => event.maxWorkers === undefined))
})

test('runPackageGates останавливает активные процессы и не выдаёт новые после ошибки', async () => {
  const events = []
  const runner = timedStart(events, { fail: (pkg, script) => pkg.id === 'one' && script === 'typecheck' })

  await assert.rejects(
    runPackageGates([{ id: 'one' }, { id: 'two' }, { id: 'three' }], { jobs: 2, start: runner.start }),
    (error) => error.code === 23
  )

  assert.ok(events.some((event) => event.type === 'stop' && event.pkg === 'two'))
  assert.equal(events.some((event) => event.type === 'start' && event.pkg === 'three'), false)
})

test('fastCheckForPackage пропускает shared, конфиги и миграции к полному гейту', () => {
  const shared = { id: 'shared', path: 'packages/shared' }
  const server = { id: 'server', path: 'apps/server' }

  assert.equal(fastCheckForPackage(shared, ['packages/shared/src/ci.ts']).reason, 'shared-контракт')
  assert.equal(fastCheckForPackage(server, ['apps/server/vitest.config.ts']).reason, 'конфиг, схема или миграция')
  assert.equal(fastCheckForPackage(server, ['apps/server/src/db/migrations/001.sql']).reason, 'конфиг, схема или миграция')
  assert.deepEqual(fastCheckForPackage(server, ['apps/server/src/ci/runManager.ts']).files, ['src/ci/runManager.ts'])
})

test('related проходит до обязательного полного гейта и ноль тестов не даёт успех', async () => {
  const pkg = { id: 'server', path: 'apps/server' }
  const events = []
  const startedAt = Date.now()
  const fast = (check) => {
    events.push(`fast:${check.pkg.id}`)
    return { done: delay(20).then(() => ({ found: false })), stop() {} }
  }
  const full = (current, script) => {
    events.push(`full:${current.id}:${script}`)
    return { done: delay(20), stop() {} }
  }

  await runFastChecks([fastCheckForPackage(pkg, ['apps/server/src/ci/runManager.ts'])], { jobs: 1, start: fast })
  const fastMs = Date.now() - startedAt
  await runPackageGates([pkg], { jobs: 1, start: full })
  const fullMs = Date.now() - startedAt - fastMs

  assert.deepEqual(events, ['fast:server', 'full:server:typecheck', 'full:server:test'])
  assert.ok(fastMs >= 15, `fast stage duration: ${fastMs}ms`)
  assert.ok(fullMs >= 35, `full stage duration: ${fullMs}ms`)
})

test('ошибка related останавливает этап до полного гейта', async () => {
  const events = []
  const pkg = { id: 'server', path: 'apps/server' }
  const fast = () => ({
    done: Promise.reject(Object.assign(new Error('related failed'), { code: 31 })),
    stop() { events.push('fast:stop') }
  })

  await assert.rejects(
    runFastChecks([fastCheckForPackage(pkg, ['apps/server/src/ci/runManager.ts'])], { start: fast }),
    (error) => error.code === 31
  )
  assert.deepEqual(events, ['fast:stop'])
})

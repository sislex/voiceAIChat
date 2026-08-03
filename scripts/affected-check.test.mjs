import assert from 'node:assert/strict'
import test from 'node:test'
import { selectAffected } from './affected-check.mjs'

const ids = (decision) => decision.packages.map((pkg) => pkg.id)

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

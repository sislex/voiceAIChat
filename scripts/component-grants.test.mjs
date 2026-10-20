import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('component grant maintenance: disposable registry and crash recovery suite', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('./prod/component-grants.test.py', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

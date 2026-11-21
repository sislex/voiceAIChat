import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { dailyLimitPolicyScript } from './public-build.mjs'

test('the daily limit script writes and then replaces Billing\'s saved policy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'public-limit-'))
  try {
    const file = join(dir, 'billing.sqlite')
    execFileSync(process.execPath, ['-e', dailyLimitPolicyScript(100000, 'Europe/Minsk'), file], { stdio: 'ignore' })
    execFileSync(process.execPath, ['-e', dailyLimitPolicyScript(250000, 'UTC'), file], { stdio: 'ignore' })
    const db = new DatabaseSync(file)
    assert.deepEqual(JSON.parse(String(db.prepare('SELECT value FROM daily_admission_policy WHERE id = 1').get().value)), { limitMicroUsd: 250000, timeZone: 'UTC' })
    db.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a --from-dev build bundles the dev Identity UI package and restores the pinned copy', async () => {
  const { withDevIdentityPackage } = await import('./public-build.mjs')
  const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'public-identity-test-'))
  try {
    const ui = join(root, 'ui'), identity = join(root, 'identity')
    for (const dir of [join(ui, 'node_modules', '@sislexa', 'identity'), join(ui, 'packages', 'app', 'node_modules', '@sislexa', 'identity'), identity]) mkdirSync(dir, { recursive: true })
    for (const dir of [join(ui, 'node_modules', '@sislexa', 'identity'), join(ui, 'packages', 'app', 'node_modules', '@sislexa', 'identity')]) {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@sislexa/identity', version: '1.0.0' }))
      writeFileSync(join(dir, 'marker.txt'), 'pinned')
    }
    writeFileSync(join(identity, 'package.json'), JSON.stringify({ name: '@sislexa/identity', version: '9.9.9', files: ['marker.txt'] }))
    writeFileSync(join(identity, 'marker.txt'), 'dev')
    const seen = []
    withDevIdentityPackage(ui, identity, () => {
      seen.push(readFileSync(join(ui, 'node_modules', '@sislexa', 'identity', 'marker.txt'), 'utf8'))
      seen.push(readFileSync(join(ui, 'packages', 'app', 'node_modules', '@sislexa', 'identity', 'marker.txt'), 'utf8'))
    })
    assert.deepEqual(seen, ['dev', 'dev'])
    assert.equal(readFileSync(join(ui, 'node_modules', '@sislexa', 'identity', 'marker.txt'), 'utf8'), 'pinned')
    assert.throws(() => withDevIdentityPackage(ui, identity, () => { throw Error('build failed') }), /build failed/)
    assert.equal(readFileSync(join(ui, 'packages', 'app', 'node_modules', '@sislexa', 'identity', 'marker.txt'), 'utf8'), 'pinned')
    assert.equal(existsSync(join(ui, 'node_modules', '@sislexa', 'identity', 'package.json')), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

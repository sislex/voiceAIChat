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

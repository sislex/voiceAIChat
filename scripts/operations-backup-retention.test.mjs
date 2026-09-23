import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyRetention, retentionPlan } from './operations-backup-retention.mjs'

const DAY = 86_400_000

test('retention keeps recent recovery points and one representative per older bucket', () => {
  const now = Date.UTC(2026, 8, 23)
  const entries = Array.from({ length: 50 }, (_, index) => ({
    name: `backup-${String(index).padStart(2, '0')}`,
    mtimeMs: now - index * DAY
  }))
  const plan = retentionPlan(entries, { now, latest: 5, daily: 7, weekly: 4, monthly: 2 })
  assert.deepEqual(plan.keep.slice(0, 5).map(item => item.name), ['backup-00', 'backup-01', 'backup-02', 'backup-03', 'backup-04'])
  assert.ok(plan.keep.length < entries.length)
  assert.equal(new Set([...plan.keep, ...plan.remove].map(item => item.name)).size, entries.length)
  assert.throws(() => retentionPlan(entries, { latest: 1 }), /at least two/)
})

test('retention is dry-run by default and deletes only direct real directories when applied', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sislexa-retention-'))
  try {
    const now = Date.now()
    for (let index = 0; index < 8; index++) {
      const path = join(root, `backup-${index}`)
      mkdirSync(path)
      const at = new Date(now - index * 40 * DAY)
      utimesSync(path, at, at)
    }
    const preview = await applyRetention({ root, now, latest: 2, daily: 0, weekly: 0, monthly: 1 })
    assert.equal(preview.applied, false)
    assert.ok(preview.removed.length > 0)
    for (const name of preview.removed) assert.equal(statSync(join(root, name)).isDirectory(), true)
    const applied = await applyRetention({ root, now, latest: 2, daily: 0, weekly: 0, monthly: 1, apply: true })
    assert.deepEqual(applied.removed, preview.removed)
    for (const name of applied.removed) assert.throws(() => statSync(join(root, name)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

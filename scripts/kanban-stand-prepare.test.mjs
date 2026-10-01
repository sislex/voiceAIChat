import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { kanbanCacheDir, pinnedKanbanCommit, prepareKanbanStand } from './kanban-stand-prepare.mjs'

test('the stand uses exactly the Kanban commit pinned by Core compose', () => {
  assert.match(pinnedKanbanCommit(), /^[0-9a-f]{40}$/)
  assert.equal(pinnedKanbanCommit('    image: ${SISLEXA_KANBAN_IMAGE:-sislexa-kanban:' + 'a'.repeat(40) + '}'), 'a'.repeat(40))
  assert.throws(() => pinnedKanbanCommit('image: postgres:16'), /не закрепляет/)
})

test('preparation clones once per pinned commit and is idempotent', () => {
  const cache = mkdtempSync(join(tmpdir(), 'kanban-stand-'))
  const calls = []
  const run = (command, args) => calls.push([command, args[0]])
  const dir = prepareKanbanStand({ VC_E2E_KANBAN_CACHE: cache }, run)
  assert.equal(dir, kanbanCacheDir(pinnedKanbanCommit(), { VC_E2E_KANBAN_CACHE: cache }))
  assert.deepEqual(calls, [['git', 'init'], ['git', 'fetch'], ['git', 'checkout'], ['npm', 'ci']])
  assert.equal(readFileSync(join(dir, '.sislexa-e2e-ready'), 'utf8').trim(), pinnedKanbanCommit())
  prepareKanbanStand({ VC_E2E_KANBAN_CACHE: cache }, run)
  assert.equal(calls.length, 4)
  assert.ok(existsSync(dir))
})

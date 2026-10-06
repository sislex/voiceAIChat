import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { kanbanCacheDir, pinnedKanbanCommit, prepareKanbanStand, pruneKanbanCache } from './kanban-stand-prepare.mjs'

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

test('the cache keeps only the most recently used checkouts and the current one', () => {
  const cache = mkdtempSync(join(tmpdir(), 'kanban-stand-'))
  const commits = ['1', '2', '3', '4', '5'].map((digit) => digit.repeat(40))
  commits.forEach((commit, index) => {
    mkdirSync(join(cache, commit))
    const ready = join(cache, commit, '.sislexa-e2e-ready')
    writeFileSync(ready, commit + '\n')
    const used = new Date(Date.UTC(2026, 9, 1 + index))
    utimesSync(ready, used, used)
  })
  mkdirSync(join(cache, 'notes'))
  const env = { VC_E2E_KANBAN_CACHE: cache, VC_E2E_KANBAN_CACHE_KEEP: '3' }
  assert.deepEqual(pruneKanbanCache(env, commits[0]).sort(), [commits[1], commits[2]])
  assert.deepEqual(readdirSync(cache).sort(), [commits[0], commits[3], commits[4], 'notes'])
})

test('a cached stand refreshes its last use and prunes older checkouts', () => {
  const cache = mkdtempSync(join(tmpdir(), 'kanban-stand-'))
  const env = { VC_E2E_KANBAN_CACHE: cache, VC_E2E_KANBAN_CACHE_KEEP: '1' }
  const stale = 'f'.repeat(40)
  mkdirSync(join(cache, stale))
  prepareKanbanStand(env, () => {})
  assert.deepEqual(readdirSync(cache), [pinnedKanbanCommit()])
  mkdirSync(join(cache, stale))
  prepareKanbanStand(env, () => { throw new Error('a cached stand must not be prepared again') })
  assert.deepEqual(readdirSync(cache), [pinnedKanbanCommit()])
})

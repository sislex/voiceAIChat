import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { parseRestoreManifest, runRestoreDrill, safeArchiveEntries } from './operations-restore-drill.mjs'

test('restore drill validates PostgreSQL, SQLite and file archive inputs without exposing their contents', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sislexa-restore-test-'))
  try {
    const sqlite = join(root, 'billing.sqlite')
    const database = new DatabaseSync(sqlite)
    database.exec('CREATE TABLE reservations (id TEXT PRIMARY KEY); INSERT INTO reservations VALUES (\'r1\')')
    database.close()
    const archiveRoot = join(root, 'runner')
    execFileSync('mkdir', ['-p', archiveRoot])
    writeFileSync(join(archiveRoot, 'receipts.json'), '{"secret":"not-in-report"}')
    const archive = join(root, 'runner.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', archiveRoot, 'receipts.json'])
    const postgres = join(root, 'core.dump')
    writeFileSync(postgres, 'synthetic-dump')
    const manifestFile = join(root, 'manifest.json')
    writeFileSync(manifestFile, JSON.stringify({
      version: 1,
      postgres: [{ name: 'core', archive: 'core.dump', expectedTables: ['public.users'] }],
      sqlite: [{ name: 'billing', database: 'billing.sqlite', expectedTables: ['reservations'] }],
      archives: [{ name: 'runner', archive: 'runner.tar.gz', requiredEntries: ['receipts.json'] }]
    }))
    const calls = []
    const run = async (program, args) => {
      calls.push({ program, args })
      if (program === 'docker') return { code: 0, stdout: 'public.projects\npublic.users\n', stderr: '' }
      return { code: 0, stdout: execFileSync(program, args, { encoding: 'utf8' }), stderr: '' }
    }
    const report = await runRestoreDrill({
      manifestFile,
      run,
      now: (() => {
        const dates = [new Date('2026-09-23T10:00:00Z'), new Date('2026-09-23T10:00:02Z')]
        return () => dates.shift()
      })()
    })
    assert.equal(report.ok, true)
    assert.deepEqual(report.results.map(item => [item.kind, item.name]), [['postgres', 'core'], ['sqlite', 'billing'], ['archive', 'runner']])
    assert.equal(JSON.stringify(report).includes('secret'), false)
    assert.equal(calls[0].program, 'docker')
    assert.ok(calls[0].args.includes('none'))
    assert.ok(calls[0].args.some(value => value.includes('readonly')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('manifest and archive validation reject ambiguous or unsafe restore inputs', () => {
  const file = '/tmp/manifest.json'
  assert.throws(() => parseRestoreManifest({ version: 1 }, file), /at least one/)
  assert.throws(() => parseRestoreManifest({ version: 1, sqlite: [{ name: 'same', database: 'a' }], archives: [{ name: 'same', archive: 'b' }] }, file), /unique/)
  assert.throws(() => safeArchiveEntries('ok/file\n../escape'), /unsafe/)
  assert.throws(() => safeArchiveEntries('/absolute'), /unsafe/)
})


import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COMPRESSION, checkRoutes, compareRoutes, resourceSet, totals, sizes, completedResource } from './route-budgets.mjs'

const fixture = () => {
  const resources = {
    'entry.js': { type: 'js', raw: 100, gzip: 80, brotli: 70, imports: ['shared.js'] },
    'shared.js': { type: 'js', raw: 50, gzip: 40, brotli: 30, imports: [] },
    'screen.css': { type: 'css', raw: 50, gzip: 40, brotli: 30, imports: [] }
  }
  for (const resource of Object.values(resources)) { resource.sha256 = 'a'.repeat(64); resource.dynamicImports = [] }
  const initial = Object.keys(resources)
  const route = { ready: true, errors: [], totals: totals(resources, initial), initial, waterfall: initial.map(resource => ({ resource, ok: true, start: 0, duration: 1 })) }
  const report = { schemaVersion: 1, commit: 'a'.repeat(40), conditions: { scenario: 'fixture', theme: 'light', transport: 'fixture', node: process.version, zlib: 'fixture', brotli: 'fixture', cpu: 'fixture', network: 'fixture', cache: 'fixture', actualViewports: { web: { width: 1440, height: 900, deviceScaleFactor: 1 }, electron: { width: 1440, height: 875, deviceScaleFactor: 1 } }, viewport: { width: 1440, height: 900 }, settleMs: 5000 }, tools: { web: 'fixture', electron: 'fixture' }, compression: COMPRESSION, resources, routes: { 'web/chat/cold': route } }
  return { report, budget: { schemaVersion: 1, routes: { 'web/chat/cold': totals(resources, initial) } } }
}
// @testCase TC-BUNDLE
test('recognizes completed cache revalidation and file transport without accepting failures', () => {
  for (const status of [200, 304]) assert.equal(completedResource({ url: 'http://localhost/entry.js', status, finished: true }), true)
  assert.equal(completedResource({ url: 'file:///entry.js', status: 0, finished: true }), true)
  for (const status of [-1, 0, 404, 500]) assert.equal(completedResource({ url: 'http://localhost/entry.js', status, finished: true }), false)
  assert.equal(completedResource({ url: 'http://localhost/entry.js', status: 304, finished: false }), false)
})
// @testCase TC-BUNDLE
test('includes shared dependencies once regardless of index-like names', () => {
  const { report } = fixture()
  assert.deepEqual(resourceSet(report.resources, ['entry.js', 'shared.js']), ['entry.js', 'shared.js'])
  assert.equal(totals(report.resources, ['entry.js']).js.raw, 150)
  assert.ok(sizes(Buffer.from('a'.repeat(1000))).brotli < 1000)
})
// @testCase TC-BUDGET
test('accepts the exact limit and identifies a one-byte regression with resources', () => {
  const { report, budget } = fixture()
  assert.equal(checkRoutes(budget, report).length, 6)
  budget.routes['web/chat/cold'].js.gzip--
  assert.throws(() => checkRoutes(budget, report), /web\/chat\/cold.*js.gzip.*actual.*120.*limit.*119.*delta.*1.*entry.js/)
})
// @testCase TC-BUDGET
test('fails closed for incomplete measurements and malformed budgets', () => {
  for (const mutate of [
    ({ report }) => { delete report.routes['web/chat/cold'] },
    ({ report }) => { delete report.resources['shared.js'] },
    ({ report }) => { report.routes['web/chat/cold'].ready = false },
    ({ report }) => { report.routes['web/chat/cold'].waterfall = [] },
    ({ report }) => { report.routes['web/chat/cold'].initial = ['entry.js'] },
    ({ report }) => { report.compression = {} },
    ({ report }) => { report.conditions = {} },
    ({ report }) => { delete report.conditions.actualViewports.electron },
    ({ report }) => { report.routes['web/chat/cold'].totals.js.gzip++ },
    ({ report }) => { report.resources['screen.css'].dynamicImports = ['missing.js'] },
    ({ report }) => { delete report.routes['web/chat/cold'].errors },
    ({ report }) => { report.routes['web/chat/cold'].waterfall[0].ok = false },
    ({ report }) => { report.routes['web/chat/cold'].waterfall[0].duration = null },
    ({ budget }) => { budget.routes['web/chat/cold'].js.gzip = null },
    ({ budget }) => { delete budget.routes['web/chat/cold'].css },
    ({ budget }) => { budget.routes = {} }
  ]) {
    const value = fixture(); mutate(value)
    assert.throws(() => checkRoutes(value.budget, value.report))
  }
})
// @testCase TC-BUNDLE
test('rejects incomplete before/after data and changed measurement conditions', () => {
  const { report } = fixture()
  const after = structuredClone(report)
  assert.equal(compareRoutes(report, after).length, 6)
  after.conditions.theme = 'dark'
  assert.throws(() => compareRoutes(report, after), /incomparable condition/)
  after.conditions.theme = 'light'
  after.routes['web/chat/cold'].waterfall = []
  assert.throws(() => compareRoutes(report, after), /incomplete ready/)
  after.routes['web/chat/cold'].waterfall = structuredClone(report.routes['web/chat/cold'].waterfall)
  report.routes['web/chat/cold'].ready = false
  assert.throws(() => compareRoutes(report, after), /incomplete ready/)
})
// @testCase TC-BUDGET
test('enforces every JS and CSS raw/gzip/Brotli metric', () => {
  for (const type of ['js', 'css']) for (const metric of ['raw', 'gzip', 'brotli']) {
    const { budget, report } = fixture()
    budget.routes['web/chat/cold'][type][metric]--
    assert.throws(() => checkRoutes(budget, report), new RegExp(type + '.' + metric))
  }
})
// @testCase TC-GATES
// @testCase TC-BUDGET
test('CLI returns nonzero for violations and incomplete reports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'route-budget-'))
  try {
    const { budget, report } = fixture()
    const b = join(dir, 'budget.json'), r = join(dir, 'report.json')
    writeFileSync(b, JSON.stringify(budget)); writeFileSync(r, JSON.stringify(report))
    assert.equal(spawnSync(process.execPath, ['scripts/route-budgets.mjs', b, r]).status, 0)
    delete report.routes['web/chat/cold']
    writeFileSync(r, JSON.stringify(report))
    const failed = spawnSync(process.execPath, ['scripts/route-budgets.mjs', b, r], { encoding: 'utf8' })
    assert.notEqual(failed.status, 0)
    assert.match(failed.stderr, /incomplete route set/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

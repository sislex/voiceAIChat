// Integration acceptance: node --test scripts/development-readiness.test.mjs
// Exercise Core's pinned Kanban pipeline with the owner's fake LLM clients.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pinnedKanbanCommit, prepareKanbanStand } from './kanban-stand-prepare.mjs'

let owner
function checkScenarios(t, scenarios) {
  owner ??= prepareKanbanStand()
  const git = (...args) => execFileSync('git', args, { cwd: owner, encoding: 'utf8' }).trim()
  assert.equal(git('rev-parse', 'HEAD'), pinnedKanbanCommit(), 'Test the exact deployed owner pin')
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Owner sources must be clean')
  const dir = mkdtempSync(join(tmpdir(), 'readiness-contract-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const report = join(dir, 'vitest.json')
  const pattern = scenarios.map(([name]) => name.replace(/[.*+?^()|[\]\\]/g, '\\// Integration acceptance tests.')).join('|')
  const env = { ...process.env }
  // The upstream harness requires isolated SQLite, never an external database.
  delete env.VC_TEST_DB_URL
  delete env.VC_DB_URL
  execFileSync(process.execPath, [
    join(owner, 'node_modules/vitest/vitest.mjs'), 'run', 'src/taskPreparation.test.ts',
    '--testNamePattern', pattern, '--reporter=json', '--outputFile', report,
  ], { cwd: join(owner, 'apps/server'), env, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
  const result = JSON.parse(readFileSync(report, 'utf8'))
  assert.equal(result.success, true)
  const assertions = result.testResults.flatMap(suite => suite.assertionResults)
  for (const [name, count] of scenarios) {
    const selected = assertions.filter(item => item.title.startsWith(name))
    assert.equal(selected.length, count, 'Missing or renamed owner scenarios: ' + name)
    assert.ok(selected.every(item => item.status === 'passed'), 'Skipped or failing owner scenario: ' + name)
  }
  t.diagnostic('Verified pinned Kanban ' + pinnedKanbanCommit() + ': ' + scenarios.reduce((n, [, count]) => n + count, 0) + ' scenarios')
}

// @testCase TC-07
test('strict DevelopmentReadiness format and prompt through the pinned owner pipeline', { timeout: 300000 }, t => {
  checkScenarios(t, [
    ['requires a complete brief without contradictory output instructions', 1],
    ['rejects familiar prefixes before validating the entire brief:', 2],
    ['rejects invalid Brief format:', 6],
    ['rejects incompatible recovery content without inventing data:', 7],
  ])
})

// @testCase TC-08
test('compatible normalization preserves the complete brief and rejects ambiguity', { timeout: 300000 }, t => {
  checkScenarios(t, [
    ['preserves the whole brief through every compatible conversion and a second preparation', 1],
    ['normalizes only an absent decision link:', 3],
    ['rejects duplicate keys before requirements or provenance can be overwritten:', 4],
    ['rejects ambiguous or damaged input:', 8],
    ['не подменяет неоднозначный статус источника на available', 1],
    ['отклоняет несовместимые kind источников, но сохраняет однозначный refs', 1],
    ['rejects incomplete dependent Brief constraints:', 5],
  ])
})

// @testCase TC-09
test('strict schema rejects invalid types, enums, links and conditional UI requirements', { timeout: 300000 }, t => {
  checkScenarios(t, [
    ['requires a complete brief without contradictory output instructions', 1],
    ['rejects incompatible recovery content without inventing data:', 7],
    ['rejects invalid Brief format:', 6],
    ['rejects unknown test-type enumerations without repairing requirements', 1],
    ['rejects incomplete dependent Brief constraints:', 5],
  ])
})

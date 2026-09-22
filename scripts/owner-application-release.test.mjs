import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ownerReleasePlan, ownerSourceRelease, prepareOwnerRelease } from './owner-application-release.mjs'
const input = { applicationId: 'make', version: '1.1.5', baseBranch: 'main', image: 'registry.test/make', requires: [{ applicationId: 'core', minVersion: '1.0.0', maxVersionExclusive: '2.0.0', minApiVersion: '1.0.0', maxApiVersionExclusive: '2.0.0' }] }
test('owner plan chooses a catalog repository, never a caller supplied URL or Core source', () => {
  const plan = ownerReleasePlan({ ...input, repository: 'https://attacker.test/source' })
  assert.equal(plan.repository, 'https://github.com/sislex/make')
  assert.equal(plan.target, 'api')
  assert.equal(plan.branch, 'release/make/1.1.5')
  for (const applicationId of ['core', 'ui-kit', '../../make']) assert.throws(() => ownerReleasePlan({ ...input, applicationId }))
  for (const baseBranch of ['--upload-pack=x', 'main;echo x', '../main', 'main.lock']) assert.throws(() => ownerReleasePlan({ ...input, baseBranch }))
})
test('owner metadata preserves owner version/API and rejects version relabeling', () => {
  const root = mkdtempSync(join(tmpdir(), 'owner-metadata-test-'))
  try {
    mkdirSync(join(root, 'apps/make'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: input.version, scripts: { gate: 'full gate' } }))
    writeFileSync(join(root, 'apps/make/release.json'), JSON.stringify({ schemaVersion: 1, apiVersion: '1.1.0', dataVersion: '1.0.0', capabilities: [] }))
    const release = ownerSourceRelease(ownerReleasePlan(input), root, 'a'.repeat(40), input.requires)
    assert.equal(release.apiVersion, '1.1.0')
    assert.equal(release.commit, 'a'.repeat(40))
    assert.throws(() => ownerSourceRelease(ownerReleasePlan({ ...input, version: '1.2.0' }), root, 'a'.repeat(40), input.requires), /does not match/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('missing owner compatibility evidence stops before gate, publication or release branch', async () => {
  const calls = []
  await assert.rejects(prepareOwnerRelease(input, { execute(command, args, cwd) {
    calls.push([command, ...args])
    if (args[0] === 'clone') {
      const source = args.at(-1)
      mkdirSync(join(source, 'apps/make'), { recursive: true })
      writeFileSync(join(source, 'package.json'), JSON.stringify({ version: input.version, scripts: { gate: 'full gate' } }))
      writeFileSync(join(source, 'apps/make/release.json'), JSON.stringify({ schemaVersion: 1, apiVersion: '1.1.0', dataVersion: '1.0.0', capabilities: [] }))
    }
    if (args[0] === 'rev-parse') return 'a'.repeat(40)
    return ''
  } }), /requires compatibility/)
  assert.equal(calls.some(([command]) => command === 'npm' || command === 'docker'), false)
  assert.equal(calls.some(([, action]) => action === 'push'), false)
})

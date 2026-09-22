import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { verifyCoreUi } from './core-ui-artifact.mjs'
test('owner artifact rejects corruption, missing provenance and unsafe entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'core-ui-'))
  try {
    const source = { repository: 'https://github.com/sislex/sislexa-core-ui', version: '1.0.0', commit: 'a'.repeat(40), dirty: false, requires: { coreApi: '^1.0.0' } }
    const manifest = { schemaVersion: 1, version: source.version, commit: source.commit, files: {} }
    for (const part of ['web', 'renderer', 'storybook']) { mkdirSync(join(root, part)); writeFileSync(join(root, part, 'index.html'), 'fixture'); manifest.files[part + '/index.html'] = createHash('sha256').update('fixture').digest('hex') }
    const save = () => { writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest)); writeFileSync(join(root, 'release-source.json'), JSON.stringify(source)) }
    save(); assert.equal(verifyCoreUi(root).version, '1.0.0')
    source.dirty = true; save(); assert.throws(() => verifyCoreUi(root), /provenance/)
    source.dirty = false; save(); writeFileSync(join(root, 'web/index.html'), 'modified'); assert.throws(() => verifyCoreUi(root), /integrity/)
    writeFileSync(join(root, 'web/index.html'), 'fixture'); manifest.files['../outside'] = '0'.repeat(64); save(); assert.throws(() => verifyCoreUi(root), /path/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

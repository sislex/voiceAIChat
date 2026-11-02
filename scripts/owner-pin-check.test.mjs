import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pack as tarPack } from 'tar-stream'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { checkOwnerBundles } from './owner-pin-check.mjs'

test('checks exact production bytes, provenance, API and installed archive identity', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'pin-check-'))
  const name = '@sislexa/core-ui', commit = 'a'.repeat(40), version = '1.0.0'
  const directory = join(repo, 'node_modules', name)
  const json = (path, value) => writeFileSync(path, JSON.stringify(value))
  mkdirSync(directory, { recursive: true }); mkdirSync(join(repo, 'vendor'))
  const source = { repository: 'https://github.com/sislex/sislexa-core-ui', version, commit, dirty: false, requires: { coreApi: '^1.0.0' } }
  const files = {}
  for (const part of ['web', 'renderer', 'storybook']) {
    mkdirSync(join(directory, part))
    writeFileSync(join(directory, part, 'index.html'), '<html>production</html>')
    files[`${part}/index.html`] = createHash('sha256').update('<html>production</html>').digest('hex')
  }
  json(join(directory, 'package.json'), { name, version })
  const pack = async () => {
    json(join(directory, 'release-source.json'), source)
    json(join(directory, 'manifest.json'), { schemaVersion: 1, version, commit, files })
    // npm archives use the package/ prefix.
    const stream = tarPack(), chunks = []
    stream.on('data', chunk => chunks.push(chunk))
    const done = new Promise(resolve => stream.on('end', resolve))
    for (const file of ['package.json', 'release-source.json', 'manifest.json', ...Object.keys(files)]) stream.entry({ name: `package/${file}` }, readFileSync(join(directory, file)))
    stream.finalize()
    await done
    const bytes = gzipSync(Buffer.concat(chunks))
    writeFileSync(join(repo, 'vendor/ui.tgz'), bytes)
    const row = { name, version, commit, repository: source.repository, asset: 'ui.tgz', sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') }
    json(join(repo, 'vendor/owner-artifacts.json'), { packages: [row] })
    json(join(repo, 'package-lock.json'), { packages: { [`node_modules/${name}`]: { version, resolved: 'file:vendor/ui.tgz', integrity: row.integrity } } })
  }
  try {
    await pack()
    await checkOwnerBundles([name], repo)
    writeFileSync(join(directory, 'web/index.html'), 'tampered')
    await assert.rejects(checkOwnerBundles([name], repo), /Installed artifact mismatch/)
    writeFileSync(join(directory, 'web/index.html'), '<html>production</html>')
    source.requires.coreApi = '^2.0.0'; await pack()
    await assert.rejects(checkOwnerBundles([name], repo), /Unsupported Core UI API/)
    source.requires.coreApi = '^1.0.0'; source.dirty = true; await pack()
    await assert.rejects(checkOwnerBundles([name], repo), /provenance mismatch/)
    const archive = join(repo, 'vendor/ui.tgz')
    writeFileSync(archive, Buffer.concat([readFileSync(archive), Buffer.from('corrupt')]))
    await assert.rejects(checkOwnerBundles([name], repo), /checksum/i)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

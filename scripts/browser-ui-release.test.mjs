import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import Fastify from 'fastify'
import { registerBrowserUi } from '../apps/server/src/browserUi/routes.ts'
import { main } from './browser-ui-release.mjs'

function fixture(root) {
  const id = '1.0.0-' + 'a'.repeat(40), directory = join(root, 'candidate')
  mkdirSync(join(directory, 'assets'), { recursive: true })
  const files = { 'index.html': `<script src="/ui/releases/${id}/assets/main.js"></script>`, 'assets/main.js': 'console.log("candidate")' }
  for (const [path, value] of Object.entries(files)) writeFileSync(join(directory, path), value)
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, repository: 'https://github.com/sislex/sislexa-core-ui', version: '1.0.0', commit: 'a'.repeat(40), id, dirty: false, requires: { coreApi: { min: '1.0.0', maxExclusive: '2.0.0' }, applicationHost: { min: '1.1.0', maxExclusive: '2.0.0' } }, files: Object.fromEntries(Object.entries(files).map(([path, value]) => [path, createHash('sha256').update(value).digest('hex')])) }))
  return { id, directory }
}
test('deployment command preflights live Core, activates and rolls back on the same server', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ui-command-')), bundled = join(root, 'bundled'), releases = join(root, 'installed')
  mkdirSync(bundled); writeFileSync(join(bundled, 'index.html'), 'bundled')
  const candidate = fixture(root), app = Fastify()
  try {
    await registerBrowserUi(app, bundled, releases)
    const origin = await app.listen({ host: '127.0.0.1', port: 0 })
    const flags = ['--root', releases, '--core', origin, '--actor', 'release test']
    const before = app.server.address()
    await main(['install', '--directory', candidate.directory, ...flags])
    assert.match(await (await fetch(origin)).text(), new RegExp(candidate.id))
    assert.equal((await main(['status', ...flags])).active, candidate.id)
    await main(['rollback', ...flags])
    assert.equal(await (await fetch(origin)).text(), 'bundled')
    assert.match(await (await fetch(`${origin}/ui/releases/${candidate.id}/assets/main.js`)).text(), /candidate/)
    assert.deepEqual(app.server.address(), before)
    await assert.rejects(main(['activate', '--release', 'bad-id', ...flags]), /Invalid/)
    assert.equal(await (await fetch(origin)).text(), 'bundled')
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})

test('production launcher only executes the running container, without rebuild/restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'ui-launcher-')), log = join(root, 'commands')
  const docker = join(root, 'docker')
  writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$UI_TEST_LOG"\nif [ "$1" = compose ]; then echo test-container; fi\n', { mode: 0o755 })
  try {
    const result = spawnSync('bash', ['scripts/prod/ui-deploy.sh', 'status'], { encoding: 'utf8', env: { ...process.env, VC_REPO_DIR: root, UI_TEST_LOG: log, PATH: root + ':' + process.env.PATH } })
    assert.equal(result.status, 0, result.stderr)
    const commands = readFileSync(log, 'utf8')
    assert.match(commands, /exec --user node test-container node --import tsx scripts\/browser-ui-release.mjs status/)
    assert.doesNotMatch(commands, /\b(?:up|build|restart|stop|pull)\b/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, linkSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { BROWSER_UI_COMPATIBILITY, BROWSER_UI_REPOSITORY } from '@voicechat/shared'
import { activateBrowserUi, BrowserUiReleases, installBrowserUi, readBrowserUiActivation, verifyBrowserUi } from './releases.js'
import { registerBrowserUi } from './routes.js'

const temporary: string[] = []
function directory() { const path = mkdtempSync(join(tmpdir(), 'browser-ui-')); temporary.push(path); return path }
function fixture(commit = 'a'.repeat(40)) {
  const root = directory(), id = '1.0.0-' + commit
  mkdirSync(join(root, 'assets'))
  const files: Record<string, string> = { 'index.html': `<html><script type="module" src="/ui/releases/${id}/assets/main.js"></script></html>`, 'assets/main.js': `import('./lazy.js'); // ${commit}`, 'assets/lazy.js': `export const release = '${commit}'` }
  for (const [file, content] of Object.entries(files)) writeFileSync(join(root, file), content)
  const manifest = { schemaVersion: 1, repository: BROWSER_UI_REPOSITORY, version: '1.0.0', commit, id, dirty: false, requires: { coreApi: { min: '1.0.0', maxExclusive: '2.0.0' }, applicationHost: { min: '1.1.0', maxExclusive: '2.0.0' } }, files: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, createHash('sha256').update(content).digest('hex')])) }
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest))
  return { root, id, manifest }
}
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe('browser UI release store', () => {
  it('validates complete immutable files and rejects corruption, omissions and links', () => {
    const source = fixture()
    expect(verifyBrowserUi(source.root).id).toBe(source.id)
    linkSync(join(source.root, 'index.html'), join(source.root, 'linked.html'))
    expect(() => verifyBrowserUi(source.root)).toThrow('links')
    rmSync(join(source.root, 'linked.html'))
    writeFileSync(join(source.root, 'extra.js'), 'unlisted')
    expect(() => verifyBrowserUi(source.root)).toThrow('Unlisted')
    rmSync(join(source.root, 'extra.js'))
    writeFileSync(join(source.root, 'assets/main.js'), 'corrupt')
    expect(() => verifyBrowserUi(source.root)).toThrow('integrity')
    rmSync(join(source.root, 'assets/main.js'))
    expect(() => verifyBrowserUi(source.root)).toThrow('Missing')
    symlinkSync(join(source.root, 'index.html'), join(source.root, 'assets/main.js'))
    expect(() => verifyBrowserUi(source.root)).toThrow('links')
  })
  it('keeps active UI intact when a candidate is incompatible and refuses ID reuse', () => {
    const root = directory(), first = fixture(), next = fixture('b'.repeat(40))
    installBrowserUi(root, first.root, BROWSER_UI_COMPATIBILITY)
    const active = activateBrowserUi(root, first.id, BROWSER_UI_COMPATIBILITY, 'test')
    expect(() => installBrowserUi(root, next.root, { ...BROWSER_UI_COMPATIBILITY, coreApi: '2.0.0' })).toThrow('Incompatible')
    expect(readBrowserUiActivation(root)).toEqual(active)
    first.manifest.requires.coreApi.min = '1.0.1'
    writeFileSync(join(first.root, 'manifest.json'), JSON.stringify(first.manifest))
    expect(() => installBrowserUi(root, first.root, { ...BROWSER_UI_COMPATIBILITY, coreApi: '1.1.0' })).toThrow('immutable')
  })
  it('switches, rolls back, detects concurrent changes, and keeps the last valid record on corruption', () => {
    const root = directory(), bundled = directory(), a = fixture(), b = fixture('b'.repeat(40))
    const runtime = new BrowserUiReleases(root, bundled)
    for (const release of [a, b]) installBrowserUi(root, release.root, BROWSER_UI_COMPATIBILITY)
    expect(runtime.directory()).toBe(bundled)
    const first = activateBrowserUi(root, a.id, BROWSER_UI_COMPATIBILITY, 'test', null)
    expect(runtime.runtime().active).toBe(a.id)
    const second = activateBrowserUi(root, b.id, BROWSER_UI_COMPATIBILITY, 'test', first.generation)
    expect(second.previous).toBe(a.id)
    expect(runtime.runtime().active).toBe(b.id)
    expect(() => activateBrowserUi(root, a.id, BROWSER_UI_COMPATIBILITY, 'stale', first.generation)).toThrow('changed')
    activateBrowserUi(root, second.previous, BROWSER_UI_COMPATIBILITY, 'rollback', second.generation)
    expect(runtime.runtime().active).toBe(a.id)
    writeFileSync(join(root, 'active.json'), '{broken')
    expect(runtime.runtime().active).toBe(a.id)
    expect(readFileSync(join(root, 'releases', b.id, 'assets/lazy.js'), 'utf8')).toContain(b.manifest.commit)
  })
  it('serves old-tab chunks, no-store root HTML and API routes across activation without restart', async () => {
    const root = directory(), bundled = directory(), first = fixture(), second = fixture('b'.repeat(40))
    writeFileSync(join(bundled, 'index.html'), '<html>bundled</html>')
    const app = Fastify()
    app.get('/api/test', () => ({ ok: true }))
    await registerBrowserUi(app, bundled, root)
    try {
      expect((await app.inject('/')).body).toContain('bundled')
      for (const release of [first, second]) {
        installBrowserUi(root, release.root, BROWSER_UI_COMPATIBILITY)
        activateBrowserUi(root, release.id, BROWSER_UI_COMPATIBILITY, 'test')
        const response = await app.inject('/')
        expect(response.body).toContain(release.id)
        expect(response.headers['cache-control']).toBe('no-store')
        expect((await app.inject('/api/test')).json()).toEqual({ ok: true })
      }
      const oldChunk = await app.inject(`/ui/releases/${first.id}/assets/lazy.js`)
      expect(oldChunk.statusCode).toBe(200)
      expect(oldChunk.body).toContain(first.manifest.commit)
      expect(oldChunk.headers['cache-control']).toContain('immutable')
      expect((await app.inject(`/ui/releases/${first.id}/missing.js`)).statusCode).toBe(404)
      expect((await app.inject('/assets/missing.js')).statusCode).toBe(404)
      expect((await app.inject('/ui/releases/bad/index.html')).statusCode).toBe(404)
      activateBrowserUi(root, null, BROWSER_UI_COMPATIBILITY, 'bundled rollback')
      expect((await app.inject('/index.html')).body).toContain('bundled')
      expect((await app.inject('/ui/runtime.json')).json().active).toBe(null)
    } finally { await app.close() }
  })
})

it('can return to bundled UI after a Core upgrade rejects a persisted browser API requirement', () => {
  const root = directory(), bundled = directory(), source = fixture()
  installBrowserUi(root, source.root, BROWSER_UI_COMPATIBILITY)
  const active = activateBrowserUi(root, source.id, BROWSER_UI_COMPATIBILITY, 'before upgrade')
  const upgraded = { ...BROWSER_UI_COMPATIBILITY, coreApi: '2.0.0' }
  const runtime = new BrowserUiReleases(root, bundled, upgraded)
  expect(runtime.runtime()).toMatchObject({ active: null, generation: null, configuredGeneration: active.generation })
  activateBrowserUi(root, null, upgraded, 'compatibility recovery', runtime.runtime().configuredGeneration)
  expect(runtime.runtime()).toMatchObject({ active: null })
  expect(runtime.runtime().generation).not.toBeNull()
})

// Core owns release switching and asset routing; product UI assertions stay with the UI owner.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../apps/server/src/server.js'
import { loadConfig } from '../apps/server/src/config.js'
import { activateBrowserUi, installBrowserUi } from '../apps/server/src/browserUi/releases.js'
import { BROWSER_UI_COMPATIBILITY, BROWSER_UI_REPOSITORY } from '../packages/shared/src/browserUiRelease'

let app: FastifyInstance, browser: Browser, root: string, releases: string, base: string
function candidate(label: 'a' | 'b') {
  const commit = label.repeat(40), id = '1.0.0-' + commit, directory = join(root, id)
  mkdirSync(join(directory, 'assets'), { recursive: true })
  const files = {
    'index.html': `<html><head><title>UI release fixture</title></head><body><p id="version"></p><input aria-label="Draft"><button>Load lazy screen</button><p id="lazy"></p><script type="module" src="/ui/releases/${id}/assets/main.js"></script></body></html>`,
    'assets/main.js': `document.querySelector('#version').textContent='${label}';document.querySelector('button').onclick=async()=>{document.querySelector('#lazy').textContent=(await import('./lazy.js')).value}`,
    'assets/lazy.js': `export const value='${label}-lazy'`
  }
  for (const [file, content] of Object.entries(files)) writeFileSync(join(directory, file), content)
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, repository: BROWSER_UI_REPOSITORY, version: '1.0.0', commit, id, dirty: false, requires: { coreApi: { min: '1.0.0', maxExclusive: '2.0.0' }, applicationHost: { min: '1.1.0', maxExclusive: '2.0.0' } }, files: Object.fromEntries(Object.entries(files).map(([file, value]) => [file, createHash('sha256').update(value).digest('hex')])) }))
  installBrowserUi(releases, directory, BROWSER_UI_COMPATIBILITY)
  return id
}
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ui-switch-browser-')); releases = join(root, 'browser-ui')
  const bundled = join(root, 'bundled'); mkdirSync(bundled); writeFileSync(join(bundled, 'index.html'), '<html>Bundled fixture</html>')
  app = await buildServer({ config: { ...loadConfig({ PORT: '0', VC_DATA_DIR: root, VC_ADMIN_PASSWORD: 'ui-release-test-only' }), webDir: bundled }, createWsHandlers: () => ({ onMessage: async () => {}, onBinary: async () => {} }) })
  base = await app.listen({ host: '127.0.0.1', port: 0 })
  browser = await chromium.launch()
})
afterAll(async () => { await browser?.close(); await app?.close(); if (root) rmSync(root, { recursive: true, force: true }) })
it('switches and rolls back without losing old-tab lazy assets, drafts or Core API availability', async () => {
  const a = candidate('a'), b = candidate('b'), address = app.server.address()
  const errors: string[] = [], oldTab = await browser.newPage(), newTab = await browser.newPage()
  for (const page of [oldTab, newTab]) page.on('pageerror', error => errors.push(error.message))
  activateBrowserUi(releases, a, BROWSER_UI_COMPATIBILITY, 'browser test')
  await oldTab.goto(base)
  await expect.poll(() => oldTab.locator('#version').textContent()).toBe('a')
  await oldTab.getByRole('textbox', { name: 'Draft' }).fill('unsaved text')
  const second = activateBrowserUi(releases, b, BROWSER_UI_COMPATIBILITY, 'browser test')
  await newTab.goto(base)
  await expect.poll(() => newTab.locator('#version').textContent()).toBe('b')
  await oldTab.getByRole('button', { name: 'Load lazy screen' }).click()
  await expect.poll(() => oldTab.locator('#lazy').textContent()).toBe('a-lazy')
  expect(await oldTab.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('unsaved text')
  expect((await fetch(base + '/api/health')).ok).toBe(true)
  expect((await fetch(base + '/api/settings')).status).toBe(401)
  activateBrowserUi(releases, second.previous, BROWSER_UI_COMPATIBILITY, 'rollback', second.generation)
  await newTab.reload()
  await expect.poll(() => newTab.locator('#version').textContent()).toBe('a')
  expect((await fetch(`${base}/ui/releases/${b}/assets/lazy.js`)).status).toBe(200)

  const switching = (async () => {
    for (let i = 0; i < 12; i++) {
      activateBrowserUi(releases, i % 2 ? a : b, BROWSER_UI_COMPATIBILITY, 'concurrency test')
      await new Promise(done => setTimeout(done, 5))
    }
  })()
  const documents = await Promise.all(Array.from({ length: 24 }, async () => {
    const response = await fetch(base)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    return response.text()
  }))
  await switching
  expect(documents.every(html => html.includes(a) || html.includes(b))).toBe(true)
  expect(app.server.address()).toEqual(address)
  expect(errors).toEqual([])
})

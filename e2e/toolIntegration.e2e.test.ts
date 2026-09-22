// Core owns authenticated routing and loading published panels, not their internal UI behavior.
import { beforeAll, afterAll, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../apps/server/src/server.js'
import { freePort } from './free-port'
import { previewOriginTarget } from '@sislexa/playwright-reader/browser-runner/security'
import { loadConfig } from '../apps/server/src/config.js'
import { buildBrowserRunner } from '@sislexa/playwright-reader/browser-runner/server'
let app: FastifyInstance, runner: FastifyInstance, browser: Browser, page: Page, directory: string, base: string, token: string
const password = 'core-tool-integration-fixture'
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sislexa-tools-'))
  const port = await freePort(); base = 'http://127.0.0.1:' + port
  runner = await buildBrowserRunner({ token: password, profilesRoot: join(directory, 'profiles'), previewOrigin: previewOriginTarget(base), idleMs: 0 })
  const runnerUrl = await runner.listen({ host: '127.0.0.1', port: 0 })
  app = await buildServer({ config: loadConfig({ ...process.env, HOST: '127.0.0.1', PORT: String(port), VC_BROWSER_PREVIEW_BASE: base, VC_DB_URL: '', VC_BROWSER_RUNNER_URL: runnerUrl, VC_BROWSER_RUNNER_TOKEN: password, VC_DATA_DIR: directory, VC_ADMIN_PASSWORD: password, VC_WEB_DIR: resolve('node_modules/@sislexa/core-ui/web') }) })
  await app.listen({ host: '127.0.0.1', port })
  const response = await fetch(base + '/api/session/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password }) })
  expect(response.ok).toBe(true); token = (await response.json()).token
  const settings = await fetch(base + '/api/settings', { method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ onboarded: true }) })
  expect(settings.ok).toBe(true)
  browser = await chromium.launch(); page = await browser.newPage()
  await page.addInitScript(token => { localStorage.setItem('vc.session.token', token); localStorage.setItem('vc:shell:admin:tour', 'true') }, token)
})
afterAll(async () => { await browser?.close(); await runner?.close(); await app?.close(); if (directory) await rm(directory, { recursive: true, force: true }) })
it.each([
  { kind: 'make', route: 'make', panel: '[data-testid="make-pane"]' },
  { kind: 'images', route: 'images', panel: '.image-studio' },
  { kind: 'playwright-reader', route: 'playwright-reader', panel: '.playwright-browser-pane' },
  { kind: 'web-recorder', route: 'web-reader', panel: '.webpreview' }
])('loads the published $kind panel through authenticated Core routing', async ({ kind, route, panel }) => {
  const response = await fetch(base + '/api/conversations', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Core integration ' + kind, assistantKind: kind }) })
  expect(response.ok).toBe(true)
  const created = await response.json(); const id = created.id ?? created.conversation.id
  const unauthorized = await fetch(base + '/api/conversations/' + id)
  expect(unauthorized.status).toBe(401)
  const errors: string[] = []; const onError = (error: Error) => errors.push(error.message)
  page.on('pageerror', onError)
  try { await page.goto(base + '/#/' + route + '/' + id); await page.locator(panel).waitFor(); if (kind === 'playwright-reader') await expect.poll(() => page.getByRole('textbox', { name: 'Адрес страницы', exact: true }).isEnabled()).toBe(true); expect(errors).toEqual([]) }
  finally { page.off('pageerror', onError) }
})

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { beforeAll, afterAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const root = resolve(__dirname, '../../../..')
const source = process.env.CHAT468_BASELINE_ROOT ?? root
const baseline = Boolean(process.env.CHAT468_BASELINE_ROOT)
const apiPort = 21000 + Math.floor(Math.random() * 1000)
const webPort = apiPort + 1000
const base = 'http://127.0.0.1:' + webPort
const apiBase = 'http://127.0.0.1:' + apiPort
const artifacts = resolve(root, '.generated_images/chat468')
let server: ChildProcess, web: ChildProcess, browser: Browser, dataDir: string, token: string, projectId: string
let ttsFixture: Server
async function waitReady(url: string) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('Test service unavailable: ' + url)
}
async function api(path: string, body?: unknown) {
  const response = await fetch(apiBase + path, {
    method: body === undefined ? 'GET' : path === '/api/settings' ? 'PUT' : 'POST',
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  if (!response.ok) throw new Error(path + ': ' + response.status)
  return response.json()
}
beforeAll(async () => {
  await mkdir(artifacts, { recursive: true })
  dataDir = await mkdtemp(join(tmpdir(), 'chat468-'))
  // Read-only runner fixture: exercise the real HTTP adapter without external speech services.
  ttsFixture = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET' && request.url === '/v1/voices') {
      response.end(JSON.stringify([{ id: 'ru_RU-ruslan-medium', label: 'Fixture voice' }]))
    } else { response.statusCode = 404; response.end('{}') }
  })
  await new Promise<void>(resolve => ttsFixture.listen(0, '127.0.0.1', resolve))
  const ttsUrl = 'http://127.0.0.1:' + (ttsFixture.address() as AddressInfo).port
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: join(root, 'apps/server'), stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: String(apiPort), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_TTS_RUNNER_URL: ttsUrl, VC_TTS_RUNNER_TOKEN: 'fixture-token', VC_ADMIN_PASSWORD: 'chat468-fixture-password', VC_WEB_DIR: join(root, 'apps/web/dist') }
  })
  await waitReady(apiBase + '/api/health')
  token = (await api('/api/session/login', { name: 'admin', password: 'chat468-fixture-password' })).token
  await api('/api/settings', { onboarded: true })
  await api('/api/conversations', { title: 'Route cache fixture' })
  projectId = (await api('/api/projects', { name: 'Route cache fixture', typeId: 'type-general' })).id
  web = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], {
    cwd: join(source, 'apps/web'), stdio: 'ignore', detached: true,
    env: { ...process.env, VC_WEB_PORT: String(webPort), VC_API_PORT: String(apiPort) }
  })
  await waitReady(base)
  browser = await chromium.launch({ args: ['--no-sandbox'] })
}, 150_000)
afterAll(async () => {
  await browser?.close()
  for (const child of [web, server]) if (child?.pid) try { process.kill(-child.pid, 'SIGTERM') } catch {}
  if (ttsFixture) await new Promise<void>(resolve => ttsFixture.close(() => resolve()))
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
}, 120_000)
async function newPage(width = 1440, height = 900) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: width <= 720 })
  await page.addInitScript(value => {
    localStorage.setItem('vc.session.token', value)
    localStorage.setItem('vc:shell:admin:tour', 'true')
  }, token)
  return page
}
const sections = () => [
  { name: 'chat', route: '/chat', selector: '.voicebar' },
  { name: 'Account', route: '/account/usage', selector: '[data-testid="usage-tab"] .vcp-usage__metrics' },
  { name: 'Machines', route: '/machines', selector: '[data-testid="machines-overlay"]' },
  { name: 'Settings', route: '/settings/llm', selector: '[data-testid="settings-pane"]' },
  { name: 'board', route: '/projects/' + projectId, selector: '[data-testid="kanban-board"]' }
]
async function settle(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 60_000 })
  await page.waitForLoadState('networkidle')
}
// @testCase TC1
it('records comparable cold/warm request counts, transferred bytes and content/data times for five routes', async () => {
  const measurements = []
  for (const section of sections()) {
    const page = await newPage()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 1_000_000, uploadThroughput: 500_000 })
    let count = 0, bytes = 0, last = 0, activity = Date.now()
    const paths: string[] = []
    const requestIds = new Set<string>()
    cdp.on('Network.requestWillBeSent', event => {
      const url = new URL(event.request.url)
      if (url.pathname.startsWith('/api/')) { requestIds.add(event.requestId); paths.push(url.pathname); count++; activity = Date.now() }
    })
    cdp.on('Network.loadingFinished', event => {
      if (requestIds.delete(event.requestId)) { bytes += event.encodedDataLength; last = Date.now(); activity = last }
    })
    cdp.on('Network.loadingFailed', event => { if (requestIds.delete(event.requestId)) activity = Date.now() })
    const waitForReads = async () => {
      const deadline = Date.now() + 30_000
      do {
        await new Promise(resolve => setTimeout(resolve, 100))
        if (requestIds.size === 0 && Date.now() - activity >= 600) return
      } while (Date.now() < deadline)
      throw new Error('Route reads did not settle')
    }
    let started = Date.now()
    await page.goto(base + '/#' + section.route, { timeout: 60_000 })
    await page.locator(section.selector).first().waitFor({ timeout: 60_000 })
    const contentMs = Date.now() - started
    await page.waitForLoadState('networkidle')
    await waitForReads()
    measurements.push({ section: section.name, mode: 'cold', requests: count, transferredBytes: bytes, contentMs, dataMs: last - started })
    if (!baseline && section.name === 'chat') {
      for (const path of ['/api/agents', '/api/me/profile', '/api/me/security', '/api/me/usage', '/api/mcp', '/api/tts/catalog', '/api/stt/models']) {
        expect(paths).not.toContain(path)
      }
    }
    const away = section.name === 'chat' ? sections().find(item => item.name === 'Settings')! : sections()[0]
    await page.evaluate(route => { location.hash = route }, away.route)
    await settle(page, away.selector)
    await waitForReads()
    count = 0; bytes = 0; last = 0; paths.length = 0; requestIds.clear(); activity = Date.now()
    started = Date.now()
    await page.evaluate(route => { location.hash = route }, section.route)
    await page.locator(section.selector).first().waitFor()
    const warmContentMs = Date.now() - started
    await page.waitForLoadState('networkidle')
    await waitForReads()
    measurements.push({ section: section.name, mode: 'warm', requests: count, transferredBytes: bytes, contentMs: warmContentMs, dataMs: last ? last - started : 0 })
    if (!baseline) {
      const sharedResourceReads = paths.filter(path => /\/api\/(me\/(profile|usage)|agents$|mcp|system\/capabilities)/.test(path))
      const offRouteBoardReads = section.name === 'board' ? [] : paths.filter(path => /\/board(?:\/|$)/.test(path))
      expect([...sharedResourceReads, ...offRouteBoardReads]).toEqual([])
    }
    await page.close()
  }
  await writeFile(join(artifacts, baseline ? 'before.json' : 'after.json'), JSON.stringify({ fixture: 'isolated admin, one chat, one general project', latencyMs: 40, measurements }, null, 2))
}, 240_000)

// @testCase TC4
it('keeps routes navigable in both themes at all five sizes with touch and keyboard input', async () => {
  if (baseline) return
  for (const [width, height] of [[1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 700]]) {
    for (const theme of ['light', 'dark']) {
      await api('/api/settings', { ...(await api('/api/settings')), onboarded: true, theme })
      const page = await newPage(width, height)
      await page.goto(base + '/#/chat')
      await settle(page, '.voicebar')
      for (const section of sections()) {
        await page.evaluate(route => { location.hash = route }, section.route)
        await settle(page, section.selector)
        expect(await page.locator('html').getAttribute('data-theme')).toBe(theme)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        await page.keyboard.press('Tab')
        expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true)
        // A focused skip link intentionally overlays navigation. Follow it before
        // switching from keyboard navigation to tapping a control underneath.
        if (await page.locator('.vc-skip-link').evaluate(node => node === document.activeElement)) {
          await page.keyboard.press('Enter')
          expect(await page.getByRole('main').evaluate(node => node === document.activeElement)).toBe(true)
        }
        if (width <= 720) {
          const overlay = page.locator('[data-testid="overlay"]:visible, [data-testid="onboarding-overlay"]:visible').last()
          const button = await overlay.count() ? overlay.locator('button:visible').first() : page.locator('button:visible').first()
          await button.tap()
          await page.keyboard.press('Escape')
          await page.evaluate(route => { location.hash = route }, section.route)
          await settle(page, section.selector)
        }
        if (section.name === 'board' && width <= 720) {
          const create = await page.locator('.jboard-mobile-create').boundingBox()
          const navigation = await page.getByRole('navigation', { name: 'Основные разделы' }).boundingBox()
          expect(create).not.toBeNull()
          expect(navigation).not.toBeNull()
          expect(create!.y + create!.height).toBeLessThanOrEqual(navigation!.y)
        }
        if (section.name === 'Account') {
          const filter = page.getByLabel('Период расхода')
          await filter.scrollIntoViewIfNeeded()
          expect(await filter.evaluate(element => {
            const rect = element.getBoundingClientRect()
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
            return hit === element || Boolean(hit && element.contains(hit))
          })).toBe(true)
        }
        expect(await page.getByTestId('toast-error').count()).toBe(0)
        await page.screenshot({ path: join(artifacts, section.name + '-' + width + '-' + theme + '.png'), fullPage: true })
      }
      await page.close()
    }
  }
}, 300_000)

// @testCase TC3
// @testCase TC4
it('keeps Account identity and navigation usable while an offline block retries', async () => {
  if (baseline) return
  const page = await newPage(390, 844)
  let usageCalls = 0, profileCalls = 0
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/me/profile') profileCalls++ })
  await page.route('**/api/me/usage?*', async route => {
    usageCalls++
    if (usageCalls === 1) await route.abort('internetdisconnected')
    else await route.continue()
  })
  try {
    await page.goto(base + '/#/account/usage')
    await page.getByTestId('profile-head').waitFor()
    const alert = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить данные вкладки' })
    await alert.waitFor()
    expect(profileCalls).toBe(1)
    await page.screenshot({ path: join(artifacts, 'Account-offline-390.png'), fullPage: true })
    await alert.getByRole('button', { name: 'Повторить' }).tap()
    await page.getByTestId('usage-tab').waitFor()
    expect(usageCalls).toBe(2)
    expect(profileCalls).toBe(1)
    await alert.waitFor({ state: 'hidden' })
  } finally { await page.close() }
}, 60_000)

// @testCase TC4
it.skipIf(!process.env.CHAT468_TOUCH_BROWSER_WS || !process.env.CHAT468_TOUCH_APP_URL)('keeps the composer above a real mobile screen keyboard', async () => {
  // The endpoint must be a dedicated touch test browser, with the fixture server
  // forwarded to TOUCH_APP_URL. Do not replace this with setViewportSize.
  const mobile = await chromium.connectOverCDP(process.env.CHAT468_TOUCH_BROWSER_WS!)
  const context = mobile.contexts()[0]
  if (!context) throw new Error('The mobile browser must expose its test context')
  const page = await context.newPage()
  try {
    await page.addInitScript(value => {
      localStorage.setItem('vc.session.token', value)
      localStorage.setItem('vc:shell:admin:tour', 'true')
    }, token)
    await page.goto(process.env.CHAT468_TOUCH_APP_URL! + '/#/chat')
    const composer = page.locator('.voicebar textarea').first()
    await composer.waitFor()
    const before = await page.evaluate(() => visualViewport!.height)
    await composer.tap()
    await page.waitForFunction(height => visualViewport!.height < height - 100, before, { timeout: 15_000 })
    const geometry = await composer.evaluate(element => ({
      bottom: element.getBoundingClientRect().bottom,
      visibleBottom: visualViewport!.offsetTop + visualViewport!.height
    }))
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.visibleBottom + 1)
    await page.screenshot({ path: join(artifacts, 'real-screen-keyboard.png') })
  } finally {
    await page.close()
    await mobile.close()
  }
}, 60_000)

// @testCase TC10
it.skipIf(!process.env.CHAT468_PRODUCTION_URL)('supports a read-only post-publication health check with explicit production URL', async () => {
  const production = process.env.CHAT468_PRODUCTION_URL
  const target = production ?? apiBase
  const response = await fetch(target + '/api/health')
  expect(response.ok).toBe(true)
  expect(response.headers.get('content-type')).toContain('application/json')
  const body = await response.json()
  expect(body).toBeTypeOf('object')
  const productionToken = process.env.CHAT468_PRODUCTION_TOKEN
  const productionProject = process.env.CHAT468_PRODUCTION_PROJECT_ID
  if (!productionToken || !productionProject) throw new Error('Route health-check requires an authorized read-only test token and project id')
  const page = await browser.newPage()
  const failures: number[] = []
  page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 500) failures.push(response.status()) })
  try {
    await page.addInitScript(value => {
      localStorage.setItem('vc.session.token', value)
      localStorage.setItem('vc:shell:admin:tour', 'true')
    }, productionToken)
    await page.goto(target + '/#/chat')
    for (const section of sections()) {
      const route = section.name === 'board' ? '/projects/' + encodeURIComponent(productionProject) : section.route
      await page.evaluate(route => { location.hash = route }, route)
      await settle(page, section.selector)
    }
    expect(failures).toEqual([])
    await writeFile(join(artifacts, 'production-health.json'), JSON.stringify({ checkedAt: new Date().toISOString(), status: response.status, routes: sections().map(section => section.name) }))
  } finally { await page.close() }
})

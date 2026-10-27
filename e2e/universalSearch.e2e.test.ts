import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { chromium, type Browser, type Page, type Request, type Response } from 'playwright'
import { VoiceChatDb } from '../apps/server/src/db/database.js'
import { SEARCH_SOURCES, SEARCH_LABELS, type SearchHit, type UniversalSearchResult } from '../packages/shared/src/universalSearch'

const ROOT = resolve(__dirname, '..')
const PASSWORD = 'palette-e2e-password'
let server: ChildProcess | undefined
let browser: Browser | undefined
let page: Page
let dataDir = ''
let base = ''
let token = ''
let chatId = ''
let messageId = ''
let makeId = ''
let expected: SearchHit[] = []
const artifacts = process.env.VC_VISUAL_ARTIFACTS
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + path, {
    method, headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  expect(response.ok, await response.clone().text()).toBe(true)
  return response
}
const SEARCH_TIMEOUT = 10_000

function matchesSearch(request: Request, target: Page, query: string) {
  if (request.url() !== base + '/api/universal-search' || request.method() !== 'POST'
    || request.frame() !== target.mainFrame()) return false
  try { return request.postDataJSON()?.query === query } catch { return false }
}

// Observe request identity as well as its payload: an older in-flight response
// with the same query cannot complete a newly armed search.
async function observeSearch(target: Page, query: string, action: () => Promise<void>,
  mark: (stage: string) => void = () => {}, timeout = SEARCH_TIMEOUT) {
  let current: Request | undefined
  let resolveResponse!: (response: Response) => void
  let rejectResponse!: (error: Error) => void
  const response = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve; rejectResponse = reject
  })
  const onRequest = (request: Request) => {
    if (!current && matchesSearch(request, target, query)) {
      current = request; mark('request')
    }
  }
  const onResponse = (value: Response) => {
    if (current && value.request() === current) {
      void value.finished().then(error => {
        if (error) rejectResponse(new Error('Search response failed: ' + error.message))
        else { mark('response'); resolveResponse(value) }
      }, rejectResponse)
    }
  }
  const onFailed = (request: Request) => {
    if (request === current) rejectResponse(new Error('Search request failed: ' + request.failure()?.errorText))
  }
  target.on('request', onRequest)
  target.on('response', onResponse)
  target.on('requestfailed', onFailed)
  const timer = setTimeout(() => rejectResponse(new Error(
    'Search "' + query + '" timed out waiting for ' + (current ? 'response' : 'browser request')
  )), timeout)
  try {
    const [value] = await Promise.all([response, action()])
    return value
  } finally {
    clearTimeout(timer)
    target.off('request', onRequest)
    target.off('response', onResponse)
    target.off('requestfailed', onFailed)
  }
}

async function open(query = 'PaletteNeedle', wanted = expected, target = page) {
  const started = performance.now()
  const stages: Record<string, number> = {}
  const mark = (stage: string) => { stages[stage] = Math.round(performance.now() - started) }
  const dialog = target.getByRole('dialog', { name: 'Командная палитра' })
  try {
    // A mounted input with the same value does not retrigger the published
    // client's effect. Clear it explicitly before arming a fresh query.
    if (await dialog.isVisible() && await dialog.getByRole('combobox').inputValue() === query) {
      await dialog.getByRole('combobox').fill('', { timeout: SEARCH_TIMEOUT })
    }
    const response = await observeSearch(target, query, async () => {
      if (!await dialog.isVisible()) {
        await target.locator('.cmdk-open').waitFor({ state: 'attached', timeout: SEARCH_TIMEOUT })
        await target.locator('#app-content').focus()
        await target.keyboard.press('Control+k')
      }
      await dialog.waitFor({ timeout: SEARCH_TIMEOUT })
      mark('opened')
      await dialog.getByRole('combobox').fill(query, { timeout: SEARCH_TIMEOUT })
      mark('filled')
    }, mark)
    const body = await response.text()
    expect(response.ok(), 'Search "' + query + '" HTTP ' + response.status() + ': ' + body).toBe(true)
    const result = JSON.parse(body) as UniversalSearchResult
    expect(result.groups.filter(group => group.status !== 'ok'), 'Unavailable search sources for ' + query).toEqual([])
    const hits = result.groups.flatMap(group => group.hits)
    expect(hits.length, 'No search results for ' + query).toBeGreaterThan(0)
    for (const hit of wanted) {
      expect(hits.some(value => value.id === hit.id && value.href === hit.href),
        'Missing expected search hit: ' + hit.source + '/' + hit.title).toBe(true)
      // A successful response precedes React's commit; wait for the specific option.
      await dialog.getByRole('group', { name: SEARCH_LABELS[hit.source], exact: true })
        .getByRole('option').filter({ hasText: hit.title }).first().waitFor({ timeout: SEARCH_TIMEOUT })
    }
    mark('options')
    return dialog
  } finally {
    console.log('[palette:timing] ' + JSON.stringify({ query, ...stages, total: Math.round(performance.now() - started) }))
  }
}

// Explicit acceptance mode avoids recursively running gates during ordinary E2E.
// Run with VC_SEARCH_ACCEPTANCE=1 and Vitest -t '^acceptance:'.
const acceptance = process.env.VC_SEARCH_ACCEPTANCE === '1'
if (acceptance) {
  const evidence = resolve(ROOT, 'artifacts/universal-search-acceptance')
  const sourceHash = () => createHash('sha256').update(readFileSync(join(ROOT, 'e2e/universalSearch.e2e.test.ts'))).digest('hex')
  const revision = sourceHash()
  const run = (name: string, command: string, args: string[], extra: Record<string, string> = {}) => {
    mkdirSync(evidence, { recursive: true })
    const result = spawnSync(command, args, {
      cwd: ROOT, env: { ...process.env, VC_SEARCH_ACCEPTANCE: '0', ...extra },
      encoding: 'utf8', timeout: 900_000, maxBuffer: 32 * 1024 * 1024
    })
    writeFileSync(join(evidence, name + '.log'), (result.stdout ?? '') + (result.stderr ?? ''))
    writeFileSync(join(evidence, name + '.exit.json'), JSON.stringify({
      command: [command, ...args], sourceSha256: revision,
      exitCode: result.status, signal: result.signal, error: result.error?.message ?? null
    }, null, 2))
    expect(result.status, name + ' failed; see ' + evidence).toBe(0)
    expect(sourceHash(), 'Acceptance source changed during the run').toBe(revision)
  }

  // @testCase TC-3
  it('acceptance: three consecutive complete browser gates with two workers', async () => {
    const { integrationBrowserFiles } = await import('../scripts/browser-gate.mjs')
    for (let index = 1; index <= 3; index++) {
      const name = 'browser-' + index
      const report = join(evidence, name + '.tests.json')
      run(name, process.execPath, ['scripts/browser-gate.mjs', '--integration'], {
        VC_E2E_WORKERS: '2', GATE_TEST_REPORT: report
      })
      copyFileSync(join(ROOT, 'artifacts/gate-timings/browser.json'), join(evidence, name + '.batches.json'))
      const batches = JSON.parse(readFileSync(join(evidence, name + '.batches.json'), 'utf8')).results
      expect(batches.flatMap((batch: { files: string[] }) => batch.files).sort()).toEqual(integrationBrowserFiles().sort())
      expect(batches.every((batch: { exitCode: number }) => batch.exitCode === 0)).toBe(true)
      expect(batches.find((batch: { files: string[] }) => batch.files.includes('e2e/universalSearch.e2e.test.ts')).workers).toBe(2)
      const search = JSON.parse(readFileSync(report, 'utf8')).testResults
        .find((file: { name: string }) => file.name.endsWith('/e2e/universalSearch.e2e.test.ts'))
      expect(search?.status).toBe('passed')
      expect(search.assertionResults.length).toBeGreaterThanOrEqual(18)
      expect(search.assertionResults.every((result: { status: string; retryReasons?: unknown[] }) =>
        result.status === 'passed' && !result.retryReasons?.length)).toBe(true)
      console.log('acceptance browser run ' + index + ': exit 0; universalSearch passed with two workers')
    }
  }, 2_700_000)

  // @testCase TC-4
  it('acceptance: quick gate for the actual task diff', () => {
    const baseSha = process.env.VC_SEARCH_BASE ?? ''
    expect(baseSha).toMatch(/^[0-9a-f]{40}$/)
    run('quick', 'npm', ['run', 'gate:quick', '--', '--base', baseSha])
  }, 900_000)
}

beforeAll(async () => {
  if (acceptance) return
  dataDir = await mkdtemp(join(tmpdir(), 'vc-palette-e2e-'))
  const reservation = createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  const port = address.port
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  base = 'http://127.0.0.1:' + port
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: join(ROOT, 'apps/server'),
    env: { ...process.env, VC_DB_URL: '', PORT: String(port), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_WEB_DIR: join(ROOT, 'node_modules/@sislexa/core-ui/web'), VC_ADMIN_PASSWORD: PASSWORD },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  server.stdout?.on('data', chunk => { output = (output + chunk).slice(-4000) })
  server.stderr?.on('data', chunk => { output = (output + chunk).slice(-4000) })
  await vi.waitFor(async () => {
    if (server?.exitCode !== null) throw new Error('Server exited: ' + output)
    expect((await fetch(base + '/api/health')).ok).toBe(true)
  }, { timeout: 45_000, interval: 250 })
  const login = await fetch(base + '/api/session/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: PASSWORD })
  })
  expect(login.ok).toBe(true)
  token = (await login.json() as { token: string }).token
  await api('/api/settings', 'PUT', { onboarded: true, theme: 'light' })
  // Fixture writes use the real repositories; no CLI, production data or external services.
  const db = new VoiceChatDb(join(dataDir, 'voicechat.db'))
  await db.ready
  try {
    const chat = await db.chat.createConversation('admin', 'PaletteNeedle chat')
    chatId = chat.id
    messageId = (await db.chat.addMessage('admin', chatId, 'u1', 'PaletteNeedle message target\npassword=never-return-this', '12:00')).id
    const project = await db.projects.createProject('admin', { name: 'PaletteNeedle project' })
    const board = (await db.tasks.getBoardSkeleton('admin', project.id))!
    const task = (await db.tasks.createTask('admin', project.id, { title: 'PaletteNeedle task', columnId: board.columns[0].id }))!
    const taskChat = (await db.chat.openOrCreateTaskChat('admin', project.id, task.id))!
    await db.chat.addMessage('admin', taskChat.id, 'u1', 'KanbanMessageNeedle', '12:02')
    const make = await db.chat.createConversation('admin', 'Workshop', 'make')
    makeId = make.id
    await db.kb.saveKbDocument({ scope: 'user', ownerId: 'admin', title: 'PaletteNeedle KB', body: 'PaletteNeedle document body', createdBy: 'admin' })
  } finally { await db.close() }
  await api('/api/make/' + makeId + '/file', 'PUT', { path: 'PaletteNeedle folder/файл # 1.txt', content: 'File navigation target' })
  expected = (await (await api('/api/universal-search', 'POST', { query: 'PaletteNeedle' })).json() as UniversalSearchResult).groups.flatMap(group => group.hits)
  expect(new Set(expected.map(hit => hit.source)).size).toBe(6)
  browser = await chromium.launch({ args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', hasTouch: true })
  page = await context.newPage()
  await page.addInitScript(value => {
    // Seed once: re-injecting a migrated legacy token races cookie/CSRF refresh on reload.
    if (!sessionStorage.getItem('qa-palette-auth-seeded')) {
      localStorage.setItem('vc.session.token', value)
      localStorage.setItem('vc:shell:admin:tour', 'true')
      sessionStorage.setItem('qa-palette-auth-seeded', 'true')
    }
  }, token)
  await page.goto(base + '/#/chat/' + chatId)
  await page.locator('.cmdk-open').waitFor()
})

afterAll(async () => {
  await browser?.close()
  if (server && server.exitCode === null) {
    const stopped = new Promise<void>(resolve => server!.once('exit', () => resolve()))
    server.kill('SIGTERM')
    await stopped
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

// @testCase TC-GATES
// @testCase TC-SECURITY
it('checks the running application health, authenticated search and anonymous denial', async () => {
  expect((await fetch(base + '/api/health')).ok).toBe(true)
  const denied = await fetch(base + '/api/universal-search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'PaletteNeedle' }) })
  expect(denied.status).toBe(401)
  const body = await (await api('/api/universal-search', 'POST', { query: 'never-return-this' })).text()
  expect(body).not.toContain('never-return-this')
  expect((JSON.parse(body) as UniversalSearchResult).groups.every(group => !group.hits.length)).toBe(true)
})

// @testCase TC-2
it('observes only a new matching browser request, including a response before action completion', async () => {
  const probe = await page.context().newPage()
  const pending: import('playwright').Route[] = []
  try {
    await probe.goto(base + '/#/chat/' + chatId)
    await probe.route('**/api/universal-search', route => { pending.push(route) })
    const send = (query: string, origin = base, method = 'POST') => probe.evaluate(
      ({ query, origin, method }) => { void fetch(origin + '/api/universal-search', {
        method, ...(method === 'POST' ? { body: JSON.stringify({ query }) } : {})
      }).catch(() => {}) }, { query, origin, method })
    // This request predates observation; its otherwise identical response is stale.
    await send('PaletteNeedle')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    let completed = false
    let actionRelease!: () => void
    const actionBarrier = new Promise<void>(resolve => { actionRelease = resolve })
    const observed = observeSearch(probe, 'PaletteNeedle', async () => {
      await send('different-query')
      await send('PaletteNeedle', base.replace('127.0.0.1', 'localhost'))
      await send('PaletteNeedle', base, 'GET')
      await send('PaletteNeedle')
      await actionBarrier
    }).then(response => { completed = true; return response })
    await vi.waitFor(() => expect(pending).toHaveLength(5))
    for (const route of pending.slice(0, 4)) {
      const received = probe.waitForResponse(response => response.request() === route.request())
      await route.fulfill({ status: 200, body: '{"groups":[]}', headers: { 'access-control-allow-origin': '*' } })
      await received
    }
    expect(completed).toBe(false)
    const current = pending[4]
    const received = probe.waitForResponse(response => response.request() === current.request())
    await current.fulfill({ status: 200, body: '{"groups":[]}' })
    await received
    actionRelease()
    expect((await observed).request()).toBe(current.request())
  } finally { await probe.close() }
})

// @testCase TC-2
it.each([
  [400, { error: 'invalid_search_cursor' }, /HTTP 400.*invalid_search_cursor/],
  [503, { error: 'search_unavailable' }, /HTTP 503.*search_unavailable/],
  [200, { groups: [{ source: 'chats', status: 'unavailable', hits: [] }] }, /Unavailable search sources/],
  [200, { groups: [{ source: 'chats', status: 'ok', hits: [] }] }, /No search results/],
] as const)('diagnoses search response %s (%j) before waiting for options', async (status, body, message) => {
  const probe = await page.context().newPage()
  try {
    await probe.goto(base + '/#/chat/' + chatId)
    await probe.route('**/api/universal-search', route => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body)
    }))
    await expect(open('PaletteNeedle', expected, probe)).rejects.toThrow(message)
  } finally { await probe.close() }
})

// @testCase TC-2
it('reports a missing expected hit and an aborted browser request separately', async () => {
  const probe = await page.context().newPage()
  try {
    await probe.goto(base + '/#/chat/' + chatId)
    await probe.route('**/api/universal-search', route => route.fulfill({
      json: { groups: [{ source: 'chats', status: 'ok', hits: [expected.find(hit => hit.source === 'chats')] }] }
    }))
    await expect(open('PaletteNeedle', [expected.find(hit => hit.source === 'messages')!], probe))
      .rejects.toThrow('Missing expected search hit: messages/')
    await probe.unroute('**/api/universal-search')
    await probe.route('**/api/universal-search', route => route.abort('aborted'))
    await expect(open('PaletteNeedle', expected, probe)).rejects.toThrow('Search request failed:')
  } finally { await probe.close() }
})

// @testCase TC-2
it('does not treat local command options as readiness for a delayed search response', async () => {
  const probe = await page.context().newPage()
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let intercepted = false
  let completed = false
  try {
    await probe.goto(base + '/#/chat/' + chatId)
    await probe.route('**/api/universal-search', async route => {
      if (route.request().postDataJSON()?.query !== 'Настройки') return route.continue()
      intercepted = true
      await held
      await route.fulfill({ json: {
        groups: SEARCH_SOURCES.map(source => ({ source, status: 'ok', hits: expected.filter(hit => hit.source === source) })),
        nextCursor: null
      } })
    })
    const opened = open('Настройки', expected, probe).then(dialog => { completed = true; return dialog })
    await vi.waitFor(() => expect(intercepted).toBe(true), { timeout: SEARCH_TIMEOUT })
    const dialog = probe.getByRole('dialog', { name: 'Командная палитра' })
    const localOptions = await dialog.getByRole('option').count()
    expect(localOptions).toBeGreaterThan(0)
    expect(completed).toBe(false)
    console.log('[palette:diagnostic] localOptionsBeforeSearchResponse=' + localOptions)
    release()
    await opened
  } finally { release(); await probe.close() }
})

// @testCase TC-2
it('waits for a visible expected option after the successful real response', async () => {
  const probe = await page.context().newPage()
  try {
    await probe.goto(base + '/#/chat/' + chatId)
    const style = await probe.addStyleTag({ content: '.cmdk-item { display: none !important; }' })
    let completed = false
    const response = probe.waitForResponse(value => matchesSearch(value.request(), probe, 'PaletteNeedle'))
    const opened = open('PaletteNeedle', expected, probe).then(dialog => { completed = true; return dialog })
    expect((await response).ok()).toBe(true)
    const option = probe.getByRole('dialog', { name: 'Командная палитра' }).locator('.cmdk-item').filter({ hasText: expected[0].title }).first()
    await option.waitFor({ state: 'attached', timeout: SEARCH_TIMEOUT })
    expect(await option.isVisible()).toBe(false)
    expect(completed).toBe(false)
    await style.evaluate(node => node.remove())
    await opened
  } finally { await probe.close() }
})

// @testCase TC-2
it('checks unchanged input and reopening on the published client', async () => {
  await page.goto(base + '/#/chat/' + chatId)
  const dialog = await open()
  // Negative bounded observation: unchanged React state sends no request.
  await expect(observeSearch(page, 'PaletteNeedle',
    () => dialog.getByRole('combobox').fill('PaletteNeedle'), () => {}, 750))
    .rejects.toThrow('timed out waiting for browser request')
  await open()
  await page.keyboard.press('Escape')
  await open()
  await page.keyboard.press('Escape')
})

// @testCase TC-UI
it('keeps keyboard, touch, focus and geometry usable at all five sizes in both themes', async () => {
  for (const theme of ['light', 'dark']) {
    await api('/api/settings', 'PUT', { theme })
    await page.evaluate(value => { document.documentElement.dataset.theme = value }, theme)
    for (const [width, height] of [[1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 700]]) {
      await page.setViewportSize({ width: width!, height: height! })
      // A same-hash navigation retains the drawer left open after focus restoration.
      // Start each viewport from a fresh document while retaining authenticated storage.
      await page.goto('about:blank')
      await page.goto(base + '/#/chat/' + chatId)
      // Mobile opens the existing sidebar before the same touch control.
      if (width! <= 720) {
        await page.getByRole('button', { name: 'Ещё', exact: true }).click()
      }
      const button = page.locator('.cmdk-open')
      await button.waitFor({ state: 'visible' })
      await button.tap()
      const dialog = await open()
      for (const source of SEARCH_SOURCES) await dialog.getByRole('group', { name: SEARCH_LABELS[source], exact: true }).waitFor()
      for (let step = 0; step < 4; step++) {
        await page.keyboard.press('Tab')
        expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true)
      }
      await dialog.getByRole('combobox').focus()
      await dialog.getByRole('combobox').press('End')
      await dialog.getByRole('combobox').press('ArrowUp')
      const geometry = await dialog.evaluate(node => {
        const box = node.getBoundingClientRect()
        const input = node.querySelector('input')!.getBoundingClientRect()
        const active = node.querySelector('[data-active="true"]')!.getBoundingClientRect()
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, inputTop: input.top, inputBottom: input.bottom, activeTop: active.top, activeBottom: active.bottom, overflow: node.scrollWidth > node.clientWidth + 1 }
      })
      expect(geometry.x).toBeGreaterThanOrEqual(-1)
      expect(geometry.y).toBeGreaterThanOrEqual(-1)
      expect(geometry.right).toBeLessThanOrEqual(width! + 1)
      expect(geometry.bottom).toBeLessThanOrEqual(height! + 1)
      expect(geometry.inputTop).toBeGreaterThanOrEqual(geometry.y)
      expect(geometry.activeTop).toBeGreaterThanOrEqual(geometry.inputBottom)
      expect(geometry.activeBottom).toBeLessThanOrEqual(geometry.bottom)
      expect(geometry.overflow).toBe(false)
      if (artifacts) {
        await mkdir(artifacts, { recursive: true })
        await page.screenshot({ path: join(artifacts, 'palette-' + theme + '-' + width + '.png') })
      }
      await page.keyboard.press('Escape')
      await expect.poll(() => page.getByRole('dialog', { name: 'Командная палитра' }).isVisible()).toBe(false)
      expect(await button.evaluate(node => node === document.activeElement)).toBe(true)
      await page.keyboard.press('Control+k')
      await page.getByRole('dialog', { name: 'Командная палитра' }).waitFor()
      await page.keyboard.press('Escape')
    }
  }
})

// @testCase TC-1
// @testCase TC-NAV
it('opens a kanban message by its explicit context after reload', async () => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(base + '/#/chat/' + chatId)
  const response = await (await api('/api/universal-search', 'POST', { query: 'KanbanMessageNeedle' })).json() as UniversalSearchResult
  const hit = response.groups.flatMap(group => group.hits).find(hit => hit.source === 'messages')!
  expect(hit.href).toContain('scope=kanban')
  const dialog = await open('KanbanMessageNeedle', [hit])
  await dialog.getByRole('group', { name: SEARCH_LABELS.messages }).getByRole('option').first().click()
  await expect.poll(() => page.url()).toContain(hit.href)
  await page.getByText('KanbanMessageNeedle', { exact: true }).waitFor()
  await page.reload()
  await page.getByText('KanbanMessageNeedle', { exact: true }).waitFor()
})

// @testCase TC-1
// @testCase TC-NAV
// One case per source: each navigates, reloads and waits for its page, so a single case for all
// sources ran past the per-test timeout on a loaded release machine.
it.each(SEARCH_SOURCES)('navigates %s through the real palette and retains the deep link after reload', async source => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(base + '/#/chat/' + chatId)
  const hit = expected.find(hit => hit.source === source)!
  const navigationStarted = performance.now()
  const dialog = await open('PaletteNeedle', [hit])
  await dialog.getByRole('group', { name: SEARCH_LABELS[source], exact: true }).getByRole('option').filter({ hasText: hit.title }).first().click()
  await expect.poll(() => page.url()).toContain(hit.href)
  await page.reload()
  await expect.poll(() => page.url()).toContain(hit.href)
  if (source === 'messages') {
    await expect.poll(() => page.locator('[data-mid="' + messageId + '"]').count()).toBeGreaterThan(0)
  } else if (source === 'files') {
    await page.getByText('файл # 1.txt', { exact: true }).first().waitFor()
  } else if (source === 'kb') {
    await page.getByText('PaletteNeedle document body', { exact: false }).first().waitFor()
  } else if (source !== 'projects' && source !== 'tasks') {
    await page.getByText(hit.title, { exact: false }).first().waitFor()
  }
  console.log('[palette:navigation] ' + JSON.stringify({ source, throughReload: Math.round(performance.now() - navigationStarted) }))
  // Projects and tasks are rendered by Kanban; Core verifies their deep links.
})


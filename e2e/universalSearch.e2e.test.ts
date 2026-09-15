import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
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
async function open(query = 'PaletteNeedle') {
  if (!await page.getByRole('dialog', { name: 'Командная палитра' }).isVisible()) await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Командная палитра' })
  await dialog.waitFor()
  await dialog.getByRole('combobox').fill(query)
  await expect.poll(() => dialog.locator('[role="option"]').count()).toBeGreaterThan(0)
  return dialog
}

beforeAll(async () => {
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
    env: { ...process.env, VC_DB_URL: '', PORT: String(port), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_WEB_DIR: join(ROOT, 'apps/web/dist'), VC_ADMIN_PASSWORD: PASSWORD },
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
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', hasTouch: true })
  await page.addInitScript(value => {
    localStorage.setItem('vc.session.token', value)
    localStorage.setItem('vc:shell:admin:tour', 'true')
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

// @testCase TC-UI
it('keeps keyboard, touch, focus and geometry usable at all five sizes in both themes', async () => {
  for (const theme of ['light', 'dark']) {
    await api('/api/settings', 'PUT', { theme })
    await page.evaluate(value => { document.documentElement.dataset.theme = value }, theme)
    for (const [width, height] of [[1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 700]]) {
      await page.setViewportSize({ width: width!, height: height! })
      await page.goto(base + '/#/chat/' + chatId)
      // Mobile opens the existing sidebar before the same touch control.
      if (width! <= 720) {
        await page.getByRole('button', { name: 'Ещё', exact: true }).click()
      } else if (width! <= 768) {
        await page.getByRole('button', { name: 'Открыть боковую панель', exact: true }).first().click()
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

// @testCase TC-NAV
it('opens a kanban message by its explicit context after reload', async () => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(base + '/#/chat/' + chatId)
  const response = await (await api('/api/universal-search', 'POST', { query: 'KanbanMessageNeedle' })).json() as UniversalSearchResult
  const hit = response.groups.flatMap(group => group.hits).find(hit => hit.source === 'messages')!
  expect(hit.href).toContain('scope=kanban')
  const dialog = await open('KanbanMessageNeedle')
  await dialog.getByRole('group', { name: SEARCH_LABELS.messages }).getByRole('option').first().click()
  await expect.poll(() => page.url()).toContain(hit.href)
  await page.getByText('KanbanMessageNeedle', { exact: true }).waitFor()
  await page.reload()
  await page.getByText('KanbanMessageNeedle', { exact: true }).waitFor()
})

// @testCase TC-NAV
it('navigates each source through the real palette and retains deep links after reload', async () => {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const source of SEARCH_SOURCES) {
    await page.goto(base + '/#/chat/' + chatId)
    const hit = expected.find(hit => hit.source === source)!
    const dialog = await open()
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
    } else {
      await page.getByText(source === 'tasks' ? 'PaletteNeedle task' : hit.title, { exact: false }).first().waitFor()
    }
  }
})


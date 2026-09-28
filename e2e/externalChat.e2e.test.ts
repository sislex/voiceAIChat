import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext } from 'playwright'
import type { Server } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../apps/server/src/server.js'
import { loadConfig } from '../apps/server/src/config.js'
import { VoiceChatDb } from '../apps/server/src/db/database.js'
// Consumer host serves only the pinned SDK and integration page, never Core UI.
// @ts-expect-error JavaScript host is also an operator CLI.
import { createExternalChatSampleServer } from '../scripts/external-chat-sample.mjs'
import { freePort } from './free-port'

let app: FastifyInstance, db: VoiceChatDb, host: Server, browser: BrowserContext, directory: string
let core: string, external: string, first: string, second: string
const password = randomUUID()
beforeAll(async () => {
  const assigned = process.env.DELIVERY_PORTS?.match(/\d+/g)?.map(Number)
  if (process.env.DELIVERY_ATTEMPT_ROOT && (!assigned || assigned.length < 2)) throw Error('Allocated ports required')
  const corePort = assigned?.[0] ?? await freePort()
  const hostPort = assigned?.[1] ?? await freePort()
  core = 'http://127.0.0.1:' + corePort; external = 'http://127.0.0.1:' + hostPort
  directory = await mkdtemp(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : tmpdir(), 'external-chat-'))
  db = new VoiceChatDb(':memory:')
  app = await buildServer({ db, config: loadConfig({ VC_DATA_DIR: directory, PORT: String(corePort), VC_CORS_ORIGINS: external, VC_DELEGATED_CHAT_ENABLED: 'true' }),
    delegationClient: { async introspect({ token, audience }) {
      const principal = await db.identity.introspectApplicationGrant(token, audience)
      return principal ? { version: 1, active: true, principal } : { version: 1, active: false }
    } } })
  await db.identity.createUser('browser-sample', password, 'developer')
  first = (await db.chat.createConversation('browser-sample', 'Page')).id
  second = (await db.chat.createConversation('browser-sample', 'Widget')).id
  await db.chat.addMessage('browser-sample', first, 'u0', 'Persisted page history', '12:00')
  await db.chat.addMessage('browser-sample', second, 'u0', 'Persisted widget history', '12:00')
  await app.listen({ port: corePort, host: '127.0.0.1' })
  host = await createExternalChatSampleServer()
  await new Promise<void>((resolve, reject) => { host.once('error', reject); host.listen(hostPort, '127.0.0.1', resolve) })
  browser = await chromium.launchPersistentContext(process.env.BROWSER_PROFILE_DIR ?? join(directory, 'browser'), { headless: true })
})
afterAll(async () => {
  await browser?.close()
  if (host?.listening) await new Promise<void>((resolve, reject) => host.close(error => error ? reject(error) : resolve()))
  await app?.close(); await db?.close()
  if (directory) await rm(directory, { recursive: true, force: true })
})

it('runs two real SDK browser clients across origins, including history, settings, upload and revocation', async () => {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(external + '/?core=' + encodeURIComponent(core))
  await page.getByLabel('User', { exact: true }).fill('browser-sample')
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect.poll(() => page.locator('#status').textContent()).toContain('Signed in')
  for (const id of [first, second]) {
    await page.getByLabel('Conversation', { exact: true }).fill(id)
    await page.getByRole('button', { name: 'Connect another view' }).click()
  }
  await expect.poll(() => page.locator('section > p').allTextContents()).toEqual(['Ready', 'Ready'])
  expect(await page.locator('section').first().textContent()).toContain('Persisted page history')
  expect(await page.locator('section').last().textContent()).toContain('Persisted widget history')
  await page.locator('section').first().getByLabel('Attachment', { exact: true }).setInputFiles({
    name: 'browser.txt', mimeType: 'text/plain', buffer: Buffer.from('Real browser upload')
  })
  await expect.poll(() => page.locator('section > p').first().textContent()).toBe('Attachment ready')
  await page.locator('section').first().getByRole('button', { name: 'Close view' }).click()
  expect(await page.locator('section').count()).toBe(1)
  expect(await page.locator('section > p').textContent()).toBe('Ready')
  // Request settings through a fresh SDK adapter, using the same public wire contract.
  const result = await page.evaluate(async ({ core, id }) => {
    // Keep the browser import out of Vitest's server-side transform.
    const sdk = await (new Function('path', 'return import(path)') as (path: string) => Promise<any>)('/sdk/index.js')
    const session = sdk.createBrowserChatSession({ baseUrl: core, credentials: 'include' })
    const client = sdk.createChatClient({ baseUrl: core, credentials: 'include', session, resynchronize: async () => {} })
    try {
      const initial = await client.settings.get(id)
      return await client.settings.patch({ version: 1, owner: 'conversation', expectedRevision: initial.revision, values: { title: 'External edit' } }, id)
    } finally { client.dispose() }
  }, { core, id: second })
  expect(result.conversation.title).toBe('External edit')
  await db.identity.setUserBlocked('browser-sample', true)
  await page.locator('section').getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => page.locator('section > p').textContent()).toBe('Message could not be saved')
  expect(errors).toEqual([])
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0])
})

it('uses delegated browser sessions and refuses an unlisted opaque browser origin', async () => {
  const tenantId = (await db.identity.getAccountAccess('admin'))!.tenant.id
  const chat = await db.chat.createConversation('admin', 'Delegated browser')
  await db.chat.addMessage('admin', chat.id, 'u0', 'Delegated history', '12:00')
  const application = await db.identity.createApplication('admin', tenantId, 'Browser fixture')
  const issued = (await db.identity.issueApplicationGrant('admin', tenantId, application.id, {
    audience: 'core', expiresAt: Date.now() + 60_000,
    permissions: [{ resource: { tenantId, type: 'conversation', id: chat.id }, scopes: ['read'] }]
  }))!
  const page = await browser.newPage()
  await page.goto(external + '/?core=' + encodeURIComponent(core))
  await page.evaluate(async ({ core, id, credential }) => {
    const host = await (new Function('path', 'return import(path)') as (path: string) => Promise<any>)('/client.mjs')
    host.connectExternalChat(core, id, async () => credential)
  }, { core, id: chat.id, credential: issued.token })
  await expect.poll(() => page.locator('section > p').textContent()).toBe('Ready')
  expect(await page.locator('section pre').textContent()).toContain('Delegated history')
  expect(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled()).toBe(true)
  expect(await page.getByLabel('Attachment', { exact: true }).isDisabled()).toBe(true)
  const opaque = await browser.newPage()
  await opaque.goto('data:text/html,<title>Untrusted origin</title>')
  expect(await opaque.evaluate(async core => {
    try { await fetch(core + '/api/chat/session', { method: 'POST', credentials: 'include' }); return 'allowed' }
    catch { return 'denied' }
  }, core)).toBe('denied')
  await db.identity.revokeApplication('admin', tenantId, application.id)
  await page.close(); await opaque.close()
})

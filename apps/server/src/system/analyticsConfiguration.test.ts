import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { signToken } from '@sislexa/identity/server/users/accounts'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { buildServer } from '../server.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function capabilities(managed: boolean, analytics: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'sislexa-analytics-capability-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const configFile = join(root, 'component.json')
  const tokenFile = join(root, 'analytics.token')
  await writeFile(tokenFile, 'synthetic-private-service-token', { mode: 0o600 })
  await writeFile(configFile, JSON.stringify({
    schemaVersion: 1, environmentId: 'capability-test', registryDirectory: join(root, 'registry'),
    grants: [], legacyScopes: [],
    dependencies: analytics ? [{ applicationId: 'analytics', url: 'http://127.0.0.1:1', tokenFile }] : [],
  }))
  const db = new VoiceChatDb(':memory:')
  cleanup.push(() => db.close())
  await db.identity.createUser('capability-user', '', 'developer')
  const config = loadConfig({ PORT: '0', VC_DATA_DIR: root, SISLEXA_COMPONENT_CONFIG: managed ? configFile : '',
    VC_STT_RUNNER_URL: '', VC_TTS_RUNNER_URL: '' })
  const app = await buildServer({ config, db, claude: { send: () => ({ cancel() {} }) }, sessionSecret: 'capability-test' })
  cleanup.push(() => app.close())
  const headers = { authorization: 'Bearer ' + signToken({ name: 'capability-user', role: 'developer' }, 'capability-test') }
  const response = await app.inject({ url: '/api/system/capabilities', headers })
  expect(response.statusCode).toBe(200)
  expect(response.body).not.toContain(tokenFile)
  expect(response.body).not.toContain('synthetic-private-service-token')
  expect(response.body).not.toContain('127.0.0.1:1')
  return { app, headers, result: response.json() }
}

it.each([false, true])('reports Analytics as unconfigured when absent (managed=%s)', async managed => {
  const { result } = await capabilities(managed, false)
  expect(result.analytics).toEqual({ configured: false })
})

it('keeps a configured but offline Analytics service visible independently of its availability', async () => {
  const { app, headers, result } = await capabilities(true, true)
  expect(result.analytics).toEqual({ configured: true })
  expect((await app.inject({ url: '/api/analytics/account', headers })).statusCode).toBe(503)
})

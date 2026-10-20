import { afterEach, expect, it, vi } from 'vitest'
import type { SystemCapabilities } from '@voicechat/shared'
import { signToken } from '@sislexa/identity/server/users/accounts'
import { TARIFF_DENIED } from '../accountAccess.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { buildServer, type BuildOptions } from '../server.js'
import type { SttClient } from '../stt/client.js'
import { FakeTtsClient } from '../tts/client/fakeTtsClient.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture(options: Partial<BuildOptions> = {}, denied = false) {
  const db = new VoiceChatDb(':memory:')
  cleanup.push(() => db.close())
  await db.identity.createUser('voice-config', '', 'developer')
  if (denied) {
    await db.identity.saveTariffPlan({ id: 'text-only', name: 'Text only', capabilities: ['chat.use'] })
    await db.identity.assignUserTariff('voice-config', 'text-only')
  }
  const config = loadConfig({ PORT: '0', VC_STT_RUNNER_URL: '', VC_TTS_RUNNER_URL: '' })
  config.minMemSttBytes = 0
  config.minMemTtsBytes = 0
  const app = await buildServer({ config, db, claude: { send: () => ({ cancel() {} }) }, sessionSecret: 'voice-config-test', ...options })
  cleanup.push(() => app.close())
  const token = signToken({ name: 'voice-config', role: 'developer' }, 'voice-config-test')
  const response = await app.inject({ url: '/api/system/capabilities', headers: { authorization: 'Bearer ' + token } })
  expect(response.statusCode).toBe(200)
  return response.json<SystemCapabilities>()
}

function remoteStt(health: SttClient['health']): SttClient {
  return { health, models: async () => [], deleteModel: async () => {}, downloadModel: async () => {},
    start: () => { throw Error('Capability discovery must not start recognition') } }
}

it('reports both modules unconfigured in a text-only installation', async () => {
  const result = await fixture()
  expect(result.stt).toMatchObject({ configured: false, available: false })
  expect(result.tts).toMatchObject({ configured: false, available: false })
})

it('keeps a configured STT service visible while it is offline', async () => {
  const health = vi.fn(async () => { throw Error('offline') })
  const result = await fixture({ sttClient: remoteStt(health) })
  expect(health).toHaveBeenCalled()
  expect(result.stt).toMatchObject({ configured: true, available: false })
  expect(result.tts.configured).toBe(false)
})

it('distinguishes a missing STT model from a missing service', async () => {
  const result = await fixture({ sttClient: remoteStt(async () => ({ ok: true,
    whisper: { available: true, version: 'test' }, models: [], memory: { availableBytes: null }, activeRuns: 0, queuedRuns: 0 })) })
  expect(result.stt).toMatchObject({ configured: true, available: false, reason: 'Модель распознавания речи не установлена' })
})

it('reports a TTS-only installation independently of recognition', async () => {
  const result = await fixture({ ttsClient: new FakeTtsClient() })
  expect(result.stt.configured).toBe(false)
  expect(result.tts).toMatchObject({ configured: true, available: true })
})

it('retains configuration when the user tariff denies voice', async () => {
  const sttEngine = { isReady: async () => true, transcribe: async () => { throw Error('Capability discovery must not transcribe') } }
  const result = await fixture({ sttEngine, ttsClient: new FakeTtsClient() }, true)
  expect(result.stt).toMatchObject({ configured: true, available: false, reason: TARIFF_DENIED })
  expect(result.tts).toMatchObject({ configured: true, available: false, reason: TARIFF_DENIED })
})

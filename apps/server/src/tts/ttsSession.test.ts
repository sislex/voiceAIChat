import { privateDataDir } from '../test/privateDataDir.js'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from "@sislexa/identity/server/users/accounts"
import { FakeTtsClient } from './client/fakeTtsClient.js'

const SECRET = 'test-secret'
const TOKEN = signToken({ name: 'admin', role: 'admin' }, SECRET)

const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.write('WAVE', 8)
const body = Buffer.concat([header, Buffer.from('Привет')])
const mockTts = new FakeTtsClient(
  body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  [{ id: 'ru_RU-irina-medium', label: 'Irina' }]
)

let dataDir: ReturnType<typeof privateDataDir>
let app: FastifyInstance
let db: VoiceChatDb
let port: number
const clients = new Set<WebSocket>()

beforeEach(async () => {
  dataDir = privateDataDir('core-integration-')
  db = new VoiceChatDb(':memory:')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: dataDir.path }),
    db,
    ttsClient: mockTts,
    sessionSecret: SECRET
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
})
afterEach(async () => {
  for (const ws of clients) ws.terminate()
  clients.clear()
  await app?.close()
  await db?.close()
  dataDir?.remove()
})

describe('WS: TTS-синтез + REST голоса', () => {
  it('tts.speak → tts.audio (base64 WAV)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`)
    clients.add(ws)
    ws.once('close', () => clients.delete(ws))
    await new Promise((r) => ws.on('open', r))
    const audio = new Promise<{ audio: string }>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString())
        if (m.t === 'tts.audio') resolve(m)
      })
    })
    ws.send(JSON.stringify({ t: 'tts.speak', text: 'Привет', voice: 'ru_RU-irina-medium' }))
    const msg = await audio
    const buf = Buffer.from(msg.audio, 'base64')
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buf.toString('utf8', 44)).toBe('Привет')
    ws.close()
  })

  it('GET /api/tts/voices отдаёт голоса движка', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tts/voices',
      headers: { authorization: `Bearer ${TOKEN}` }
    })
    expect(res.json()).toEqual([{ id: 'ru_RU-irina-medium', label: 'Irina' }])
  })
})

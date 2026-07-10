import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import type { TtsEngine } from './types.js'

const mockTts: TtsEngine = {
  async synthesize(text) {
    // мини-WAV с текстом в data (для проверки, что дошло)
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.write('WAVE', 8)
    const full = Buffer.concat([header, Buffer.from(text)])
    const audio = full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength)
    return { audio, mime: 'audio/wav' }
  },
  cancel() {},
  async listVoices() {
    return [{ id: 'ru_RU-irina-medium', label: 'Irina' }]
  }
}

let app: FastifyInstance
let db: VoiceChatDb
let port: number

beforeEach(async () => {
  db = new VoiceChatDb(':memory:')
  app = await buildServer({ config: loadConfig({ PORT: '0' }), db, ttsEngine: mockTts })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
})
afterEach(async () => {
  await app.close()
  db.close()
})

describe('WS: TTS-синтез + REST голоса', () => {
  it('tts.speak → tts.audio (base64 WAV)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
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
    const res = await app.inject({ method: 'GET', url: '/api/tts/voices' })
    expect(res.json()).toEqual([{ id: 'ru_RU-irina-medium', label: 'Irina' }])
  })
})

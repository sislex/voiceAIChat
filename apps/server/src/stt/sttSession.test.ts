import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import type { SttEngine } from './types.js'

// Мок STT: любой буфер → фиксированный результат.
const mockStt: SttEngine = {
  isReady: async () => true,
  transcribe: async (_pcm, _rate, opts) => ({
    segments: [{ speakerId: 1, text: 'Привет мир' }],
    text: 'Привет мир',
    isFinal: opts.final ?? false
  })
}

let app: FastifyInstance
let db: VoiceChatDb
let port: number

beforeEach(async () => {
  db = new VoiceChatDb(':memory:')
  app = await buildServer({ config: loadConfig({ PORT: '0' }), db, sttEngine: mockStt })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
})
afterEach(async () => {
  await app.close()
  db.close()
})

function connect(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  return new Promise((res, rej) => {
    ws.on('open', () => res(ws))
    ws.on('error', rej)
  })
}

describe('WS: STT-поток', () => {
  it('audio.start → чанки → audio.stop → stt.final', async () => {
    const ws = await connect()
    const final = new Promise<{ update: { text: string } }>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString())
        if (m.t === 'stt.final') resolve(m)
      })
    })
    ws.send(JSON.stringify({ t: 'audio.start', sampleRate: 16000 }))
    // немного PCM (Int16)
    ws.send(Buffer.from(new Int16Array([1, 2, 3, 4, 5, 6]).buffer))
    ws.send(JSON.stringify({ t: 'audio.stop' }))
    const msg = await final
    expect(msg.update.text).toBe('Привет мир')
    ws.close()
  })
})

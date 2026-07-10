import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'
import { loadConfig } from './config.js'

let app: FastifyInstance
let port: number

beforeAll(async () => {
  app = await buildServer({
    config: loadConfig({ PORT: '0' }),
    // тестовый обработчик: эхо типа сообщения обратно клиенту
    createWsHandlers: () => ({
      onMessage: (msg, ctx) => ctx.send({ t: 'stt.error', message: msg.t }),
      onBinary: (data, ctx) => ctx.send({ t: 'stt.error', message: `binary:${data.length}` })
    })
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
})

afterAll(async () => {
  await app.close()
})

describe('server: HTTP', () => {
  it('GET /api/health → ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true })
  })
})

describe('server: WebSocket', () => {
  function connect(): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    return new Promise((resolve, reject) => {
      ws.on('open', () => resolve(ws))
      ws.on('error', reject)
    })
  }

  it('принимает JSON-кадр и отвечает (round-trip)', async () => {
    const ws = await connect()
    const reply = new Promise<string>((resolve) => ws.on('message', (d) => resolve(d.toString())))
    ws.send(JSON.stringify({ t: 'audio.start', sampleRate: 16000 }))
    const msg = JSON.parse(await reply)
    expect(msg).toEqual({ t: 'stt.error', message: 'audio.start' })
    ws.close()
  })

  it('принимает бинарный кадр', async () => {
    const ws = await connect()
    const reply = new Promise<string>((resolve) => ws.on('message', (d) => resolve(d.toString())))
    ws.send(Buffer.from([1, 2, 3, 4]))
    const msg = JSON.parse(await reply)
    expect(msg.message).toBe('binary:4')
    ws.close()
  })
})

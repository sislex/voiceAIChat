import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('server: раздача web-статики (VC_WEB_DIR)', () => {
  let webApp: FastifyInstance
  let webDir: string

  beforeAll(async () => {
    webDir = mkdtempSync(join(tmpdir(), 'vc-web-'))
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>voiceAIChat</title>')
    mkdirSync(join(webDir, 'assets'), { recursive: true })
    writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log(1)')
    webApp = await buildServer({
      config: { ...loadConfig({ PORT: '0' }), webDir },
      createWsHandlers: () => ({ onMessage: () => {}, onBinary: () => {} })
    })
  })

  afterAll(async () => {
    await webApp.close()
    rmSync(webDir, { recursive: true, force: true })
  })

  it('GET / отдаёт index.html', async () => {
    const res = await webApp.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('voiceAIChat')
  })

  it('GET /assets/app.js отдаёт ассет', async () => {
    const res = await webApp.inject({ method: 'GET', url: '/assets/app.js' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('console.log')
  })

  it('SPA-fallback: неизвестный GET → index.html', async () => {
    const res = await webApp.inject({ method: 'GET', url: '/conversations/xyz' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('voiceAIChat')
  })

  it('неизвестный /api → 404 (не отдаём index.html)', async () => {
    const res = await webApp.inject({ method: 'GET', url: '/api/does-not-exist' })
    expect(res.statusCode).toBe(404)
  })

  it('API и здоровье продолжают работать при включённой статике', async () => {
    const res = await webApp.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
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

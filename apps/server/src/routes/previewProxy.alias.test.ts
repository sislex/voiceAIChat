import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, request } from 'node:http'
import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'node:net'
import fastify from 'fastify'
import { parseHostAliases } from '@voicechat/browser-runner/security'
import { registerPreviewProxy } from './previewProxy.js'

// Воспроизводим недоступный публичный порт из Docker, не отправляя тесты в прод.
// Разрешённый алиас ходит к настоящему HTTP-серверу на loopback тестового процесса.
vi.mock('node:http', async (original) => {
  const http = await original<typeof import('node:http')>()
  return {
    ...http,
    request: vi.fn((url, ...args) => {
      if (new URL(url).hostname === '89.125.68.35') {
        const pending = Object.assign(new EventEmitter(), {
          end: () => queueMicrotask(() => pending.emit('timeout')),
          destroy: (error: Error) => pending.emit('error', error)
        })
        return pending
      }
      return http.request(url, ...args)
    })
  }
})
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }])
}))

afterEach(() => vi.clearAllMocks())

async function fixture() {
  const calls: string[] = []
  const server = createServer((req, res) => {
    calls.push(req.url!)
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/app#/restored' }); res.end(); return
    }
    if (req.url?.startsWith('/blocked?')) {
      res.writeHead(302, { location: new URL(req.url, 'http://fixture').searchParams.get('to')! }); res.end(); return
    }
    if (req.url === '/assets/main.js') {
      res.setHeader('content-type', 'application/javascript')
      res.end('import { app } from "./chunk.js"; const lazy = () => import("./lazy.js");'); return
    }
    res.setHeader('content-type', 'text/html')
    res.end('<html><body><h1>Сохранённое приложение</h1><a href="/next">Дальше</a></body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const aliases = parseHostAliases('89.125.68.35:8787=127.0.0.1:' + port)
  const app = fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as { user: { name: string; role: string } }).user = { name: 'alias-qa', role: 'user' }
  })
  registerPreviewProxy(app, { hostAliases: aliases })
  const load = (url: string) => app.inject({ method: 'GET', url: '/api/preview?url=' + encodeURIComponent(url) })
  return { aliases, calls, port, load, close: async () => { await app.close(); await new Promise<void>((resolve) => server.close(() => resolve())) } }
}

describe('разрешённый транспорт собственного сайта в Web Reader', () => {
  // @testCase TC3
  it('исходный публичный адрес даёт 504 без алиаса, с алиасом загружает ту же страницу и сохраняет hash и ссылки', async () => {
    const f = await fixture()
    const saved = 'http://89.125.68.35:8787/#/chat/81caab96-6d29-4054-a5bd-8da334caaf79'
    try {
      const configured = new Map(f.aliases)
      f.aliases.clear()
      expect((await f.load(saved)).statusCode).toBe(504)
      expect(f.calls).toEqual([])
      for (const [key, value] of configured) f.aliases.set(key, value)
      const response = await f.load(saved)
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('Сохранённое приложение')
      expect(response.body).toContain('#/chat/81caab96-6d29-4054-a5bd-8da334caaf79')
      expect(response.body).toContain('/api/preview?url=' + encodeURIComponent('http://89.125.68.35:8787/next'))
      expect(response.body).not.toContain('127.0.0.1')
      expect(f.calls).toEqual(['/'])
      expect((await f.load('http://89.125.68.35:8787/next')).statusCode).toBe(200)
      const redirected = await f.load('http://89.125.68.35:8787/redirect')
      expect(redirected.statusCode).toBe(200)
      expect(redirected.body).toContain('#/restored')
      expect(f.calls).toEqual(['/', '/next', '/redirect', '/app'])
      const module = await f.load('http://89.125.68.35:8787/assets/main.js')
      expect(module.statusCode).toBe(200)
      expect(module.body).toContain('from "/api/preview?url=' + encodeURIComponent('http://89.125.68.35:8787/assets/chunk.js') + '"')
      expect(module.body).toContain('import("/api/preview?url=' + encodeURIComponent('http://89.125.68.35:8787/assets/lazy.js') + '")')
    } finally { await f.close() }
  })

  // @testCase TC4
  it('алиас не разрешает свою внутреннюю цель напрямую, другой порт или DNS с приватным ответом', async () => {
    const f = await fixture()
    try {
      for (const target of ['http://127.0.0.1:' + f.port + '/', 'http://10.0.0.1/', 'http://mixed-dns.test/']) {
        vi.mocked(request).mockClear()
        expect((await f.load(target)).statusCode).toBe(403)
        expect(request).not.toHaveBeenCalled()
      }
      expect((await f.load('http://89.125.68.35:8788/')).statusCode).toBe(504)
      expect(f.calls).toEqual([])
    } finally { await f.close() }
  })

  // @testCase TC4
  it('на каждом редиректе повторяет SSRF-проверку, включая внутреннюю цель разрешённого алиаса', async () => {
    const f = await fixture()
    try {
      for (const target of ['http://127.0.0.1:' + f.port + '/secret', 'http://192.168.1.1/', 'http://mixed-dns.test/']) {
        vi.mocked(request).mockClear()
        const result = await f.load('http://89.125.68.35:8787/blocked?to=' + encodeURIComponent(target))
        expect(result.statusCode).toBe(403)
        expect(request).toHaveBeenCalledTimes(1)
      }
      expect(f.calls).toHaveLength(3)
      expect(f.calls.every((path) => path.startsWith('/blocked?'))).toBe(true)
    } finally { await f.close() }
  })
})

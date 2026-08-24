// Loopback HTTP-мост: запросы уходят строго на 127.0.0.1 машины, ответ
// возвращается со статусом, заголовками и телом (base64), редиректы не следуются.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { fetchLocal, validateHttpProxyRequest } from './httpProxy.js'

let server: Server
let port = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1:' + port + '/target' })
      res.end()
      return
    }
    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ echoed: Buffer.concat(chunks).toString('utf8'), type: req.headers['content-type'] ?? '' }))
      })
      return
    }
    res.writeHead(200, { 'content-type': 'text/html', 'x-env': 'dev' })
    res.end('<h1>Тестовое окружение</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address && typeof address !== 'string') port = address.port
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe('validateHttpProxyRequest', () => {
  it('отклоняет некорректный порт, путь и метод', () => {
    expect(validateHttpProxyRequest({ method: 'GET', port: 0, path: '/', headers: {} })).toContain('порт')
    expect(validateHttpProxyRequest({ method: 'GET', port: 80, path: 'no-slash', headers: {} })).toContain('путь')
    expect(validateHttpProxyRequest({ method: 'get et', port: 80, path: '/', headers: {} })).toContain('метод')
    expect(validateHttpProxyRequest({ method: 'POST', port: 8080, path: '/x?a=1', headers: {} })).toBeNull()
  })
})

describe('fetchLocal', () => {
  it('GET возвращает статус, заголовки и тело', async () => {
    const response = await fetchLocal({ method: 'GET', port, path: '/', headers: {} })
    expect(response.status).toBe(200)
    expect(response.headers['x-env']).toBe('dev')
    expect(Buffer.from(response.bodyBase64, 'base64').toString('utf8')).toContain('Тестовое окружение')
  })

  it('POST передаёт тело и content-type', async () => {
    const body = Buffer.from('{"login":"tester"}').toString('base64')
    const response = await fetchLocal({ method: 'POST', port, path: '/login', headers: { 'content-type': 'application/json' }, bodyBase64: body })
    const parsed = JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8')) as { echoed: string; type: string }
    expect(parsed.echoed).toBe('{"login":"tester"}')
    expect(parsed.type).toBe('application/json')
  })

  it('редиректу не следует — отдаёт 302 c location серверу', async () => {
    const response = await fetchLocal({ method: 'GET', port, path: '/redirect', headers: {} })
    expect(response.status).toBe(302)
    expect(response.headers.location).toContain('/target')
  })

  it('недоступный порт → понятная ошибка', async () => {
    await expect(fetchLocal({ method: 'GET', port: 1, path: '/', headers: {} })).rejects.toThrow()
  })
})

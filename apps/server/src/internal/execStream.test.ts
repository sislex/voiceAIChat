// Клиент потокового exec: NDJSON-строки приходят в onChunk, `result` завершает вызов, `error` —
// исключение, обрыв по signal рвёт соединение, а не-200 ответ ядра — понятная ошибка.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { execOverHttp, serveExecStream, type ExecStreamRequest } from './execStream.js'

const PATH = '/internal/exec-stream'

let server: Server | null = null
let requests: Array<{ auth: string | undefined; body: ExecStreamRequest }> = []

async function serve(handler: (req: IncomingMessage, res: ServerResponse, body: ExecStreamRequest) => void): Promise<string> {
  requests = []
  server = createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (d: string) => { raw += d })
    req.on('end', () => {
      const body = JSON.parse(raw) as ExecStreamRequest
      requests.push({ auth: req.headers.authorization, body })
      expect(req.url).toBe(PATH)
      handler(req, res, body)
    })
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
}

afterEach(async () => { await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve()); server = null })

describe('execOverHttp', () => {
  it('собирает чанки и результат из NDJSON, передаёт Bearer и тело запроса', async () => {
    const coreUrl = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(`${JSON.stringify({ chunk: 'a' })}\n`)
      setTimeout(() => {
        res.write(`${JSON.stringify({ chunk: 'b' })}\n${JSON.stringify({ result: { exitCode: 0, output: 'ab', timedOut: false } })}\n`)
        res.end()
      }, 10)
    })
    const chunks: string[] = []
    const result = await execOverHttp({ baseUrl: coreUrl, token: 't', path: PATH }, { agentId: 'm', command: 'echo', timeoutMs: 1000, stream: true }, (c) => chunks.push(c))
    expect(chunks).toEqual(['a', 'b'])
    expect(result).toEqual({ exitCode: 0, output: 'ab', timedOut: false })
    expect(requests[0]!.auth).toBe('Bearer t')
    expect(requests[0]!.body).toMatchObject({ agentId: 'm', command: 'echo', stream: true })
  })

  it('строка error — исключение с текстом ядра; не-200 — ошибка со статусом', async () => {
    const coreUrl = await serve((_req, res, body) => {
      if (body.command === 'fail') { res.writeHead(200); res.end(`${JSON.stringify({ error: 'machine_offline' })}\n`); return }
      res.writeHead(401); res.end('{"error":"unauthorized"}')
    })
    await expect(execOverHttp({ baseUrl: coreUrl, token: 't', path: PATH }, { agentId: 'm', command: 'fail', timeoutMs: 1, stream: false })).rejects.toThrow('machine_offline')
    await expect(execOverHttp({ baseUrl: coreUrl, token: 't', path: PATH }, { agentId: 'm', command: 'x', timeoutMs: 1, stream: false })).rejects.toThrow(/HTTP 401/)
  })

  it('обрыв по signal завершает вызов ошибкой и закрывает соединение у ядра', async () => {
    let closed = false
    const coreUrl = await serve((req, res) => {
      res.writeHead(200)
      res.write(`${JSON.stringify({ chunk: 'start' })}\n`)
      req.on('close', () => { closed = true })
    })
    const controller = new AbortController()
    const promise = execOverHttp({ baseUrl: coreUrl, token: 't', path: PATH }, { agentId: 'm', command: 'sleep', timeoutMs: 60_000, stream: true }, () => controller.abort(), controller.signal)
    await expect(promise).rejects.toThrow(/aborted/)
    await new Promise((r) => setTimeout(r, 30))
    expect(closed).toBe(true)
  })
})

describe('serveExecStream', () => {
  it('keeps a silent command alive with blank lines that both clients skip', async () => {
    const app = Fastify()
    const machines = {
      exec: async () => { await new Promise((r) => setTimeout(r, 120)); return { exitCode: 0, output: 'done', timedOut: false } },
      execStream: async () => ({ exitCode: 0, output: '', timedOut: false }),
    }
    app.post(PATH, async (req, reply) => serveExecStream(reply, req.body as ExecStreamRequest, machines as never, 20))
    const coreUrl = await app.listen({ port: 0, host: '127.0.0.1' })
    try {
      const body: ExecStreamRequest = { agentId: 'm', command: 'pg_dump', timeoutMs: 1000, stream: false }
      const text = await (await fetch(coreUrl + PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).text()
      expect(text.match(/^\n/gm)?.length ?? 0).toBeGreaterThanOrEqual(2)
      expect(text.trim()).toBe(JSON.stringify({ result: { exitCode: 0, output: 'done', timedOut: false } }))
      await expect(execOverHttp({ baseUrl: coreUrl, token: 't', path: PATH }, body)).resolves.toEqual({ exitCode: 0, output: 'done', timedOut: false })
    } finally {
      await app.close()
    }
  })
})

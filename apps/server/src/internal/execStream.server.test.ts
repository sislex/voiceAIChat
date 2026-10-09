import { randomUUID } from 'node:crypto'
import { createServer, request, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { FastifyReply } from 'fastify'
import { afterEach, expect, it } from 'vitest'
import type { MachinesService } from '../machines/service.js'
import { EXEC_STREAM_HIGH_WATER, execOverHttp, serveExecStream } from './execStream.js'

const body = { agentId: 'm', command: 'test', stream: true, timeoutMs: 1000 }
const result = { exitCode: 0, output: '', timedOut: false }
let server: Server | undefined
afterEach(async () => {
  if (!server) return
  server.closeAllConnections()
  await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
})

async function start(execStream: MachinesService['execStream'], inspect?: (raw: ServerResponse) => void) {
  server = createServer(async (req, raw) => {
    // Consume the request before ending the response (avoids ECONNRESET).
    for await (const _chunk of req) { /* drain request */ }
    inspect?.(raw)
    await serveExecStream({ raw, hijack() {} } as unknown as FastifyReply, body, {
      execStream, exec: async () => result,
    })
  })
  // An ephemeral port: fixed ones collide with Delivery Control worker attempts on the same machine.
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${port}`, token: randomUUID(), path: '/' }
}

it('bounds 50 MiB with a paused socket, then sends the drop count and final result', async () => {
  let produce!: () => void
  const ready = new Promise<void>((resolve) => { produce = resolve })
  let produced!: () => void
  const production = new Promise<void>((resolve) => { produced = resolve })
  let maximum = 0
  let raw!: ServerResponse
  const chunk = 'x'.repeat(64 * 1024)
  const opts = await start(async (_id, _cmd, _timeout, onChunk) => {
    await ready
    for (let i = 0; i < 800; i++) {
      onChunk(chunk)
      maximum = Math.max(maximum, raw.writableLength)
    }
    produced()
    return result
  }, (response) => { raw = response })
  const req = request(opts.baseUrl, { method: 'POST' })
  req.end(JSON.stringify(body))
  const [response] = await once(req, 'response')
  response.pause()
  produce()
  await production
  expect(maximum).toBeLessThanOrEqual(EXEC_STREAM_HIGH_WATER + Buffer.byteLength(JSON.stringify({ chunk })) + 32)
  expect(maximum).toBeGreaterThanOrEqual(EXEC_STREAM_HIGH_WATER)
  let text = ''
  response.setEncoding('utf8')
  response.on('data', (data: string) => { text += data })
  const ended = once(response, 'end')
  response.resume()
  await ended
  const lines = text.trim().split('\n').map((line) => JSON.parse(line))
  expect(lines.at(-1)).toEqual({ result })
  const marker = lines.at(-2).chunk as string
  const dropped = Number(marker.match(/dropped: (\d+) bytes/)?.[1])
  expect(dropped).toBeGreaterThan(0)
  expect(marker).toBe(`\n…[stream output dropped: ${dropped} bytes, consumer too slow]\n`)
  expect(lines.slice(0, -2).reduce((sum, line) => sum + Buffer.byteLength(line.chunk), 0) + dropped).toBe(50 * 1024 ** 2)
}, 5000)

it('delivers fast output unchanged and preserves remote errors', async () => {
  const chunks = ['hello\n', 'юникод', '\u0000']
  let fail = false
  const opts = await start(async (_id, _cmd, _timeout, onChunk) => {
    if (fail) throw new Error('machine_offline')
    for (const chunk of chunks) onChunk(chunk)
    return result
  })
  const received: string[] = []
  await expect(execOverHttp(opts, body, (chunk) => received.push(chunk))).resolves.toEqual(result)
  expect(received).toEqual(chunks)
  fail = true
  await expect(execOverHttp(opts, body)).rejects.toThrow('machine_offline')
})

it('cancels the command when the consumer disconnects', async () => {
  let cancelled!: () => void
  const cancellation = new Promise<void>((resolve) => { cancelled = resolve })
  const opts = await start(async (_id, _cmd, _timeout, onChunk, signal) => {
    return await new Promise((resolve) => {
      signal!.addEventListener('abort', () => { cancelled(); resolve(result) }, { once: true })
      onChunk('started')
    })
  })
  const controller = new AbortController()
  await expect(execOverHttp(opts, body, () => controller.abort(), controller.signal)).rejects.toThrow(/aborted/)
  await cancellation
}, 3000)

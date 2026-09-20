import { it, expect, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { RemoteSttClient } from './remoteClient.js'
const input = { runId: 'managed-test', model: 'small' as const, language: 'en', diarization: false }
it('does not open a socket after cancellation while authorization is pending', async () => {
  let authorize!: (value: { url: string; token: string }) => void
  const connection = new Promise<{ url: string; token: string }>(resolve => { authorize = resolve })
  const events = vi.fn()
  const client = new RemoteSttClient({ baseUrl: 'http://127.0.0.1:1', token: '', connection: () => connection })
  const run = client.start(input, events)
  run.write(new Int16Array([1, 2])); run.cancel()
  authorize({ url: 'http://127.0.0.1:1', token: 'never-sent' })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(events).not.toHaveBeenCalled()
})
it('sends the verified grant and preserves queued PCM and end ordering', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (typeof address === 'string' || !address) throw Error('Expected TCP address')
  const frames: Array<string | Buffer> = []
  let header: string | undefined
  const received = new Promise<void>(resolve => server.once('connection', (socket, req) => {
    header = req.headers.authorization
    socket.on('message', (data, binary) => {
      frames.push(binary ? Buffer.from(data as Buffer) : data.toString())
      if (frames.length === 3) resolve()
    })
  }))
  const url = `http://127.0.0.1:${address.port}`
  const client = new RemoteSttClient({ baseUrl: url, token: 'placeholder', connection: async () => ({ url, token: 'provider-issued' }) })
  const run = client.start(input, () => {})
  try {
    run.write(new Int16Array([1, 2])); run.end()
    await received
    expect(header).toBe('Bearer provider-issued')
    expect(JSON.parse(frames[0] as string)).toMatchObject({ t: 'start', runId: input.runId })
    expect(frames[1]).toEqual(Buffer.from(new Int16Array([1, 2]).buffer))
    expect(JSON.parse(frames[2] as string)).toEqual({ t: 'end', runId: input.runId })
  } finally { run.cancel(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

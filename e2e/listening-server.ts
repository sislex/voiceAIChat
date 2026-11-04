import type { ChildProcess } from 'node:child_process'
import { connect, createServer, type Socket } from 'node:net'

export function childAddress(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); child.off('message', message); child.off('exit', exit); child.off('error', error) }
    const error = (cause: Error) => { cleanup(); reject(cause) }
    const exit = () => error(new Error('Server exited before listening'))
    const message = (value: unknown) => {
      const data = value as { type?: string; port?: number }
      if (data?.type === 'e2e:listening' && Number.isInteger(data.port) && data.port! > 0) {
        cleanup(); resolve(`http://127.0.0.1:${data.port}`)
      }
    }
    const timer = setTimeout(() => error(new Error('Server did not listen within 90 seconds')), 90_000)
    child.on('message', message); child.once('exit', exit); child.once('error', error)
  })
}

/** A stable endpoint for cyclic startup and restart tests; its socket stays open. */
export async function loopbackRelay() {
  let target: URL | undefined
  const sockets = new Set<Socket>()
  const track = (socket: Socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); return socket }
  const server = createServer(client => {
    track(client)
    if (!target) { client.destroy(); return }
    const upstream = track(connect({ host: '127.0.0.1', port: Number(target.port) }))
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
    client.once('close', () => upstream.destroy())
    upstream.once('close', () => client.destroy())
    client.pipe(upstream).pipe(client)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Relay has no TCP address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    forwardTo(url: string) { target = new URL(url) },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }
}

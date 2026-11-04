import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { childAddress, loopbackRelay } from '../e2e/listening-server.ts'

const preload = fileURLToPath(new URL('../e2e/listening-address.mjs', import.meta.url))
function child(body) {
  return spawn(process.execPath, ['--import', preload, '--input-type=module', '-e', body], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  })
}
async function stop(process) {
  if (process.exitCode !== null || process.signalCode !== null) return
  const exited = once(process, 'exit')
  process.kill('SIGTERM')
  await exited
}

test('real child listeners publish distinct owned ports; relay survives backend replacement', async () => {
  const relay = await loopbackRelay()
  const children = []
  try {
    for (const body of ['first', 'replacement']) {
      const server = child(`import { createServer } from 'node:http'; createServer((req, res) => { res.end(${JSON.stringify(body)}) }).listen(0, '127.0.0.1')`)
      children.push(server)
      const address = await childAddress(server)
      assert.notEqual(address, relay.url)
      relay.forwardTo(address)
      assert.equal(await (await fetch(relay.url)).text(), body)
      await stop(server)
    }
  } finally {
    await relay.close()
    await Promise.all(children.map(stop))
  }
})

test('child startup failure rejects promptly', async () => {
  const server = child('process.exit(1)')
  await assert.rejects(childAddress(server), /exited before listening/)
})

test('relay preserves WebSocket upgrades and closes active connections', async () => {
  const { WebSocket, WebSocketServer } = await import('ws')
  const backend = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(backend, 'listening')
  backend.on('connection', socket => socket.on('message', data => socket.send(data)))
  const relay = await loopbackRelay()
  const address = backend.address()
  relay.forwardTo(`http://127.0.0.1:${address.port}`)
  const socket = new WebSocket(relay.url.replace('http:', 'ws:'))
  try {
    await once(socket, 'open')
    const received = once(socket, 'message')
    socket.send('through relay')
    assert.equal((await received)[0].toString(), 'through relay')
    const closed = once(socket, 'close')
    await relay.close()
    await closed
  } finally {
    socket.terminate()
    for (const peer of backend.clients) peer.terminate()
    await new Promise(resolve => backend.close(resolve))
  }
})

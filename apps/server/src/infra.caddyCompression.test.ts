// Run with CADDY_BIN=/path/to/caddy npm run test:files -- apps/server/src/infra.caddyCompression.test.ts
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { createServer, get } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gunzipSync } from 'node:zlib'
import WebSocket, { WebSocketServer } from 'ws'
import { expect, it } from 'vitest'

it.skipIf(!process.env.CADDY_BIN)('proxies JSON, live SSE, exec-stream and /ws through the actual encode configuration', async () => {
  const body = JSON.stringify({ data: 'hello'.repeat(2048) })
  const upstream = createServer((req, res) => {
    if (req.url?.includes('events') || req.url?.includes('exec-stream')) {
      res.setHeader('content-type', req.url.includes('events') ? 'text/event-stream' : 'text/plain')
      res.write('data: first\n\n')
      const timer = setTimeout(() => res.end('data: last\n\n'), 2500)
      res.on('close', () => clearTimeout(timer))
    } else {
      res.setHeader('content-type', 'application/json')
      res.end(body)
    }
  })
  const wsServer = new WebSocketServer({ server: upstream, path: '/ws' })
  wsServer.on('connection', socket => socket.on('message', message => socket.send(message)))
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const upstreamPort = (upstream.address() as { port: number }).port
  const reservation = createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = (reservation.address() as { port: number }).port
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  const root = await mkdtemp(join(tmpdir(), 'caddy-compression-'))
  let child: ReturnType<typeof spawn> | undefined
  let logs = ''
  try {
    const original = await readFile(new URL('../../../Caddyfile', import.meta.url), 'utf8')
    const start = original.indexOf('https://{$VC_PUBLIC_HOST} {')
    const block = original.slice(start, original.indexOf('\n}', start) + 2)
      .replace('https://{$VC_PUBLIC_HOST}', 'http://127.0.0.1:' + port)
      .replace('tls internal', '')
      .replace(/\{\$VC_CADDY_[A-Z_]+:[^}]+\}/g, '127.0.0.1:' + upstreamPort)
      .replace('voicechat:8787', '127.0.0.1:' + upstreamPort)
    const config = join(root, 'Caddyfile')
    await writeFile(config, '{\n admin off\n auto_https off\n}\n' + block)
    child = spawn(process.env.CADDY_BIN!, ['run', '--config', config], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stderr!.on('data', chunk => { logs += chunk })
    const base = 'http://127.0.0.1:' + port
    let ready = false
    for (let i = 0; i < 100; i++) {
      try { await fetch(base); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 50)) }
    }
    expect(ready, logs).toBe(true)
    for (const path of ['/api/make/test', '/api/image-studio/test', '/api/browser/test', '/assets/test.json']) {
      const response = await new Promise<{ encoding: string | undefined; body: Buffer }>((resolve, reject) => {
        get(base + path, { headers: { 'accept-encoding': 'gzip' } }, res => {
          const chunks: Buffer[] = []
          res.on('data', chunk => chunks.push(chunk))
          res.on('end', () => resolve({ encoding: res.headers['content-encoding'], body: Buffer.concat(chunks) }))
        }).on('error', reject)
      })
      expect(response.encoding).toBe('gzip')
      expect(gunzipSync(response.body).toString()).toBe(body)
    }
    for (const path of ['/api/make/events', '/api/image-studio/events', '/api/browser/events', '/api/events', '/api/machines/exec-stream']) {
      await new Promise<void>((resolve, reject) => {
        const request = get(base + path, { headers: { 'accept-encoding': 'gzip, zstd' } }, res => {
          res.once('data', chunk => {
            try {
              expect(res.headers['content-encoding']).toBeUndefined()
              expect(chunk.toString()).toBe('data: first\n\n')
              res.destroy()
              resolve()
            } catch (error) { reject(error) }
          })
        })
        request.on('error', reject)
        request.setTimeout(1500, () => { request.destroy(); reject(new Error('stream buffered until completion')) })
      })
    }
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws', { headers: { 'accept-encoding': 'gzip, zstd' } })
    try {
      await once(ws, 'open')
      const message = once(ws, 'message')
      ws.send('round-trip')
      expect(String((await message)[0])).toBe('round-trip')
    } finally { ws.terminate() }
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
    wsServer.close()
    upstream.closeAllConnections()
    await new Promise<void>(resolve => upstream.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
}, 20000)

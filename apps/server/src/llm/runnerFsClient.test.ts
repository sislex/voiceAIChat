import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { RunnerFsClient } from './runnerFsClient.js'

interface StartedServer {
  url: string
  close(): Promise<void>
}

async function start(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<StartedServer> {
  const server: Server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  }
}

const started: StartedServer[] = []
afterEach(async () => {
  while (started.length) await started.pop()!.close()
})

describe('RunnerFsClient', () => {
  it('authStatus собирает claude и codex с разных исполнителей', async () => {
    const claude = await start((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ claude: { provider: 'claude', loggedIn: true }, codex: { provider: 'codex', loggedIn: false } }))
    })
    const codex = await start((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ claude: { provider: 'claude', loggedIn: false }, codex: { provider: 'codex', loggedIn: true } }))
    })
    started.push(claude, codex)

    const client = new RunnerFsClient({ claudeBaseUrl: claude.url, codexBaseUrl: codex.url })
    await expect(client.authStatus('admin')).resolves.toEqual({
      claude: { provider: 'claude', loggedIn: true },
      codex: { provider: 'codex', loggedIn: true }
    })
  })

  it('readFile выбирает codex-исполнитель по пути .codex', async () => {
    const claude = await start((_req, res) => {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not-found' }))
    })
    const codex = await start((req, res) => {
      expect(req.url).toContain('/v1/files/read')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ name: 'pic.png', dataBase64: 'UE5H' }))
    })
    started.push(claude, codex)

    const client = new RunnerFsClient({ claudeBaseUrl: claude.url, codexBaseUrl: codex.url })
    await expect(client.readFile('admin', '/tmp/u/.codex/generated_images/pic.png')).resolves.toEqual({
      name: 'pic.png',
      dataBase64: 'UE5H'
    })
  })

  it('watchCx переподключается по Last-Event-ID и не теряет tail', async () => {
    const seenLastIds: string[] = []
    let calls = 0
    const srv = await start((req, res) => {
      calls += 1
      seenLastIds.push(String(req.headers['last-event-id'] ?? ''))
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive'
      })
      if (calls === 1) {
        res.write('id: 10\n')
        res.write('data: {"items":[{"kind":"user","text":"one"}]}\n\n')
        res.end()
        return
      }
      res.write('id: 20\n')
      res.write('data: {"items":[{"kind":"assistant","text":"two"}]}\n\n')
    })
    started.push(srv)

    const client = new RunnerFsClient({ codexBaseUrl: srv.url, reconnectDelayMs: 10 })
    const items: string[] = []
    const stop = client.watchCx('admin', 'sess-1', (batch) => {
      for (const item of batch as Array<{ text?: string }>) if (item.text) items.push(item.text)
    })

    for (let i = 0; i < 50 && items.length < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    stop()

    expect(items).toEqual(['one', 'two'])
    expect(seenLastIds).toEqual(['', '10'])
  })
})

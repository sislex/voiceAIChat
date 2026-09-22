import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from "@sislexa/identity/server/users/accounts"

const SECRET = 'test-secret'
const USER = 'admin'
const seen: Array<{ path: string; user: string | null; token: string | undefined }> = []
let app: FastifyInstance
let db: VoiceChatDb
let token: string
let runner: Server
let runnerUrl: string

function auth() {
  return { authorization: `Bearer ${token}` }
}

beforeEach(async () => {
  seen.length = 0
  runner = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    const url = new URL(req.url ?? '/', 'http://runner.test')
    seen.push({ path: url.pathname, user: url.searchParams.get('userId'), token: req.headers.authorization })
    if (url.pathname === '/v1/mcp/servers') { res.end(JSON.stringify([{ name: 'owner-tool', status: 'connected' }])); return }
    if (url.pathname === '/v1/fs/cc/projects/demo/sessions') { res.end(JSON.stringify([{ id: 'sess-42', title: 'Почини баг' }])); return }
    if (url.pathname === '/v1/fs/cc/projects/demo/sessions/sess-42') {
      res.end(JSON.stringify({ items: [{ kind: 'user', text: 'Почини баг' }, { kind: 'assistant', text: 'Готово' }], usage: {} })); return
    }
    if (url.pathname === '/v1/auth/status') {
      res.end(JSON.stringify({ claude: { provider: 'claude', loggedIn: true }, codex: { provider: 'codex', loggedIn: false } }))
      return
    }
    if (url.pathname === '/v1/fs/cc/projects') {
      res.end(JSON.stringify([{ slug: 'demo', path: '/Users/x/demo', name: 'demo', sessionCount: 1, lastActivity: 1 }]))
      return
    }
    if (url.pathname === '/v1/fs/cx/projects') {
      res.end(JSON.stringify([{ cwd: '/Users/x/demo', name: 'demo', sessionCount: 1, lastActivity: 1 }]))
      return
    }
    if (url.pathname === '/v1/files/read') {
      res.end(JSON.stringify({ name: 'pic.png', dataBase64: 'UE5HREFUQQ==' }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not-found' }))
  })
  await new Promise<void>((resolve) => runner.listen(0, '127.0.0.1', () => resolve()))
  runnerUrl = `http://127.0.0.1:${(runner.address() as AddressInfo).port}`

  db = new VoiceChatDb(':memory:')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_LLM_RUNNER_TOKEN: 'runner-token', VC_LLM_RUNNER_CLAUDE_URL: runnerUrl, VC_LLM_RUNNER_CODEX_URL: runnerUrl }),
    db,
    sessionSecret: SECRET
  })
  token = signToken({ name: USER, role: 'admin' }, SECRET)
})

afterEach(async () => {
  await app.close()
  db.close()
  await new Promise<void>((resolve, reject) => runner.close((err) => (err ? reject(err) : resolve())))
})

describe('REST proxy to runner fs/auth api', () => {
  it('проксирует /api/auth/status, /api/cc/*, /api/cx/* и /api/files/read без смены формата', async () => {
    const authStatus = await app.inject({ method: 'GET', url: '/api/auth/status', headers: auth() })
    expect(authStatus.json()).toEqual({ claude: { provider: 'claude', loggedIn: true }, codex: { provider: 'codex', loggedIn: false } })

    const ccProjects = await app.inject({ method: 'GET', url: '/api/cc/projects', headers: auth() })
    expect(ccProjects.json()).toEqual([{ slug: 'demo', path: '/Users/x/demo', name: 'demo', sessionCount: 1, lastActivity: 1 }])

    const cxProjects = await app.inject({ method: 'GET', url: '/api/cx/projects', headers: auth() })
    expect(cxProjects.json()).toEqual([{ cwd: '/Users/x/demo', name: 'demo', sessionCount: 1, lastActivity: 1 }])

    const file = await app.inject({ method: 'GET', url: '/api/files/read?path=%2Ftmp%2Fuser%2F.codex%2Fgenerated_images%2Fpic.png', headers: auth() })
    expect(file.json()).toEqual({ name: 'pic.png', dataBase64: 'UE5HREFUQQ==' })
  })
})

it('forwards MCP and history requests with the authenticated user and imports resume into Core', async () => {
  const mcp = await app.inject({ method: 'GET', url: '/api/mcp/servers', headers: auth() })
  expect(mcp.statusCode).toBe(200)
  expect(mcp.json()).toEqual([{ name: 'owner-tool', status: 'connected' }])
  const sessions = await app.inject({ method: 'GET', url: '/api/cc/projects/demo/sessions', headers: auth() })
  expect(sessions.json()[0].title).toBe('Почини баг')
  const transcript = await app.inject({ method: 'GET', url: '/api/cc/projects/demo/sessions/sess-42', headers: auth() })
  expect(transcript.json().items.map((x: { kind: string }) => x.kind)).toEqual(['user', 'assistant'])
  const resumed = await app.inject({ method: 'POST', url: '/api/cc/resume', headers: auth(), payload: { slug: 'demo', id: 'sess-42' } })
  expect(resumed.statusCode).toBe(200)
  const { conversation, messages } = resumed.json()
  expect(messages.map((m: { role: string; text: string }) => [m.role, m.text])).toEqual([['u1', 'Почини баг'], ['ai', 'Готово']])
  expect((await db.chat.getConversation(USER, conversation.id))?.claudeSessionId).toBe('sess-42')
  expect(seen.length).toBeGreaterThanOrEqual(4)
  expect(seen.every(x => x.user === USER && x.token === 'Bearer runner-token')).toBe(true)
})

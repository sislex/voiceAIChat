import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'

const SECRET = 'test-secret'
const USER = 'admin'
let app: FastifyInstance
let db: VoiceChatDb
let token: string
let runner: Server
let runnerUrl: string

function auth() {
  return { authorization: `Bearer ${token}` }
}

beforeEach(async () => {
  runner = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    const url = new URL(req.url ?? '/', 'http://runner.test')
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
    config: loadConfig({ PORT: '0', VC_LLM_RUNNER_CLAUDE_URL: runnerUrl, VC_LLM_RUNNER_CODEX_URL: runnerUrl }),
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

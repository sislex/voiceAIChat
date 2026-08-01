import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildRunner } from './server.js'
import type { RunnerConfig } from './config.js'

const TOKEN = 'runner-secret-token'
let app: FastifyInstance
let dataDir: string
let sharedHome: string

function config(): RunnerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    dataDir,
    home: sharedHome,
    claudeBin: 'claude',
    codexBin: 'codex',
    orphanMs: 60_000
  }
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'runner-fs-'))
  sharedHome = join(dataDir, 'shared-home')
  mkdirSync(join(sharedHome, '.claude'), { recursive: true })
  mkdirSync(join(sharedHome, '.codex'), { recursive: true })
  writeFileSync(join(sharedHome, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'x' } }))
  writeFileSync(join(sharedHome, '.codex', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'tok' }))
  app = await buildRunner({ config: config() })
})

afterEach(async () => {
  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
})

function auth() {
  return { authorization: `Bearer ${TOKEN}` }
}

describe('runner fs/auth api', () => {
  it('GET /v1/auth/status читает статус из профиля пользователя исполнителя', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/status?userId=alice',
      headers: auth()
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      claude: { provider: 'claude' },
      codex: { provider: 'codex' }
    })
  })

  it('GET /v1/files/read отдаёт файл внутри профиля и режет обход пути', async () => {
    await app.inject({ method: 'GET', url: '/v1/auth/status?userId=alice', headers: auth() })
    const home = join(dataDir, 'cli-users', Buffer.from('alice').toString('base64url'))
    const dir = join(home, '.codex', 'generated_images', 'sess')
    mkdirSync(dir, { recursive: true })
    const pic = join(dir, 'pic.png')
    writeFileSync(pic, 'PNGDATA')
    const outside = join(dataDir, 'outside.png')
    writeFileSync(outside, 'NOPE')

    const ok = await app.inject({
      method: 'GET',
      url: `/v1/files/read?userId=alice&path=${encodeURIComponent(pic)}`,
      headers: auth()
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ name: 'pic.png', dataBase64: Buffer.from('PNGDATA').toString('base64') })

    const escape = await app.inject({
      method: 'GET',
      url: `/v1/files/read?userId=alice&path=${encodeURIComponent(join(home, '..', 'outside.png'))}`,
      headers: auth()
    })
    expect(escape.statusCode).toBe(404)
  })

  it('GET /v1/fs/cc/* и /v1/fs/cx/* сохраняют прежние формы ответов', async () => {
    await app.inject({ method: 'GET', url: '/v1/auth/status?userId=alice', headers: auth() })
    const home = join(dataDir, 'cli-users', Buffer.from('alice').toString('base64url'))
    const ccDir = join(home, '.claude', 'projects', '-Users-x-demo')
    mkdirSync(ccDir, { recursive: true })
    writeFileSync(
      join(ccDir, 'sess.jsonl'),
      [
        JSON.stringify({ type: 'user', cwd: '/Users/x/demo', message: { content: 'Помоги с фичей' } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Готово' }] } })
      ].join('\n')
    )

    const cxDir = join(home, '.codex', 'sessions', '2026', '08', '01')
    mkdirSync(cxDir, { recursive: true })
    writeFileSync(
      join(cxDir, 'rollout-1-12345678-1234-1234-1234-123456789abc.jsonl'),
      [
        JSON.stringify({ type: 'session_meta', payload: { id: '12345678-1234-1234-1234-123456789abc', cwd: '/Users/x/demo' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Почини' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'Сделано' } })
      ].join('\n')
    )

    const ccProjects = await app.inject({ method: 'GET', url: '/v1/fs/cc/projects?userId=alice', headers: auth() })
    expect(ccProjects.statusCode).toBe(200)
    expect(ccProjects.json()[0]).toMatchObject({ name: 'demo', path: '/Users/x/demo', sessionCount: 1 })

    const ccTranscript = await app.inject({
      method: 'GET',
      url: '/v1/fs/cc/projects/-Users-x-demo/sessions/sess?userId=alice',
      headers: auth()
    })
    expect(ccTranscript.json()).toMatchObject({ items: [{ kind: 'user' }, { kind: 'assistant' }], usage: {} })

    const cxProjects = await app.inject({ method: 'GET', url: '/v1/fs/cx/projects?userId=alice', headers: auth() })
    expect(cxProjects.statusCode).toBe(200)
    expect(cxProjects.json()[0]).toMatchObject({ cwd: '/Users/x/demo', sessionCount: 1 })

    const cxTranscript = await app.inject({
      method: 'GET',
      url: '/v1/fs/cx/transcript?userId=alice&id=12345678-1234-1234-1234-123456789abc',
      headers: auth()
    })
    expect(cxTranscript.json()).toMatchObject({ items: [{ kind: 'user' }, { kind: 'assistant' }], usage: {} })
  })
})

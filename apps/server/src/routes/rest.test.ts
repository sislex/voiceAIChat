import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'

let app: FastifyInstance
let db: VoiceChatDb
let token: string

const SECRET = 'test-secret'
const U = 'admin'

interface InjOpts {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  payload?: object
  headers?: Record<string, string>
}

/** app.inject с токеном сессии (admin) в Authorization. */
function inj(opts: InjOpts) {
  return app.inject({
    ...opts,
    headers: { authorization: `Bearer ${token}`, ...(opts.headers ?? {}) }
  })
}

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  const dataDir = join(tmpdir(), `vc-rest-test-${Date.now()}-${id}`)
  // Явно изолируем каталоги моделей/голосов во временную папку — тесты удаления
  // не должны касаться реальных файлов репозитория.
  app = await buildServer({
    config: loadConfig({
      PORT: '0',
      VC_DATA_DIR: dataDir,
      VC_MODELS_DIR: join(dataDir, 'models'),
      VC_PIPER_VOICES_DIR: join(dataDir, 'voices')
    }),
    db,
    sessionSecret: SECRET
  })
  token = signToken({ name: U, role: 'admin' }, SECRET)
})

afterEach(async () => {
  await app.close()
  db.close()
})

describe('REST: аутентификация', () => {
  it('без токена защищённый роут → 401, health и login — открыты', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/conversations' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    // Логин: верный пароль (пустой) → токен; неверный → 401.
    const ok = await app.inject({
      method: 'POST',
      url: '/api/session/login',
      payload: { name: 'user', password: '' }
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().user).toEqual({ name: 'user', role: 'user' })
    expect(typeof ok.json().token).toBe('string')
    const bad = await app.inject({
      method: 'POST',
      url: '/api/session/login',
      payload: { name: 'user', password: 'x' }
    })
    expect(bad.statusCode).toBe(401)
  })

  it('данные пользователей изолированы (user не видит разговоры admin)', async () => {
    const adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
    const userTok = signToken({ name: 'user', role: 'user' }, SECRET)
    const auth = (t: string) => ({ authorization: `Bearer ${t}` })
    await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'Секрет админа' },
      headers: auth(adminTok)
    })
    const adminList = (
      await app.inject({ method: 'GET', url: '/api/conversations', headers: auth(adminTok) })
    ).json()
    const userList = (
      await app.inject({ method: 'GET', url: '/api/conversations', headers: auth(userTok) })
    ).json()
    expect(adminList).toHaveLength(1)
    expect(userList).toHaveLength(0)
  })
})

describe('REST: conversations/messages/settings', () => {
  it('create → list → get', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Тест' } })).json()
    expect(created.title).toBe('Тест')

    const list = (await inj({ method: 'GET', url: '/api/conversations' })).json()
    expect(list.map((c: { id: string }) => c.id)).toContain(created.id)

    const got = (await inj({ method: 'GET', url: `/api/conversations/${created.id}` })).json()
    expect(got.conversation.title).toBe('Тест')
    expect(got.messages).toEqual([])
  })

  it('404 на несуществующий разговор', async () => {
    const res = await inj({ method: 'GET', url: '/api/conversations/нет' })
    expect(res.statusCode).toBe(404)
  })

  it('поиск /conversations/search находит по названию (статик-роут не конфликтует с :id)', async () => {
    await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Лиссабон' } })
    await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Погода' } })
    const res = await inj({ method: 'GET', url: '/api/conversations/search?q=лисс' })
    expect(res.statusCode).toBe(200)
    const found = res.json()
    expect(found.map((c: { title: string }) => c.title)).toEqual(['Лиссабон'])
  })

  it('cc: projects/sessions/transcript из ~/.claude/projects (VC_CC_DIR)', async () => {
    const ccDir = mkdtempSync(join(tmpdir(), 'cc-rest-'))
    const proj = join(ccDir, '-Users-x-demo')
    mkdirSync(proj, { recursive: true })
    writeFileSync(
      join(proj, 'sess.jsonl'),
      [
        JSON.stringify({ type: 'user', cwd: '/Users/x/demo', message: { content: 'Помоги с фичей' } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Готово' }] } })
      ].join('\n')
    )
    const prev = process.env.VC_CC_DIR
    process.env.VC_CC_DIR = ccDir
    try {
      const projects = (await inj({ method: 'GET', url: '/api/cc/projects' })).json()
      const demo = projects.find((p: { name: string }) => p.name === 'demo')
      expect(demo?.path).toBe('/Users/x/demo')

      const sessions = (
        await inj({ method: 'GET', url: `/api/cc/projects/${demo.slug}/sessions` })
      ).json()
      expect(sessions[0].title).toBe('Помоги с фичей')

      const items = (
        await inj({ method: 'GET', url: `/api/cc/projects/${demo.slug}/sessions/sess` })
      ).json()
      expect(items.map((i: { kind: string }) => i.kind)).toEqual(['user', 'assistant'])
    } finally {
      if (prev === undefined) delete process.env.VC_CC_DIR
      else process.env.VC_CC_DIR = prev
      rmSync(ccDir, { recursive: true, force: true })
    }
  })

  it('cc:resume создаёт разговор с импортом истории и привязкой session-id', async () => {
    const ccDir = mkdtempSync(join(tmpdir(), 'cc-resume-'))
    const proj = join(ccDir, '-Users-x-demo')
    mkdirSync(proj, { recursive: true })
    writeFileSync(
      join(proj, 'sess-42.jsonl'),
      [
        JSON.stringify({ type: 'user', cwd: '/Users/x/demo', message: { content: 'Почини баг' } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Готово' }] } })
      ].join('\n')
    )
    const prev = process.env.VC_CC_DIR
    process.env.VC_CC_DIR = ccDir
    try {
      const res = await inj({
        method: 'POST',
        url: '/api/cc/resume',
        payload: { slug: '-Users-x-demo', id: 'sess-42' }
      })
      expect(res.statusCode).toBe(200)
      const { conversation, messages } = res.json()
      // История импортирована в ленту.
      expect(messages.map((m: { role: string; text: string }) => [m.role, m.text])).toEqual([
        ['u1', 'Почини баг'],
        ['ai', 'Готово']
      ])
      // Разговор привязан к session-id → следующий ход пойдёт через --resume.
      expect(db.getConversation(U, conversation.id)?.claudeSessionId).toBe('sess-42')
    } finally {
      if (prev === undefined) delete process.env.VC_CC_DIR
      else process.env.VC_CC_DIR = prev
      rmSync(ccDir, { recursive: true, force: true })
    }
  })

  it('cc:resume без slug/id → 400', async () => {
    const res = await inj({ method: 'POST', url: '/api/cc/resume', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('добавление сообщения видно в get', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (
      await inj({
        method: 'POST',
        url: `/api/conversations/${c.id}/messages`,
        payload: { role: 'u1', text: 'Привет', time: '10:00' }
      })
    ).json()
    expect(m.text).toBe('Привет')
    const got = (await inj({ method: 'GET', url: `/api/conversations/${c.id}` })).json()
    expect(got.messages).toHaveLength(1)
  })

  it('удаление сообщения убирает его из истории', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (
      await inj({
        method: 'POST',
        url: `/api/conversations/${c.id}/messages`,
        payload: { role: 'u1', text: 'удалить меня', time: '10:00' }
      })
    ).json()
    const del = await inj({
      method: 'DELETE',
      url: `/api/conversations/${c.id}/messages/${m.id}`
    })
    expect(del.statusCode).toBe(200)
    const got = (await inj({ method: 'GET', url: `/api/conversations/${c.id}` })).json()
    expect(got.messages).toHaveLength(0)
  })

  it('удаление сообщения сбрасывает сессию Claude (модель забывает удалённое)', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (
      await inj({
        method: 'POST',
        url: `/api/conversations/${c.id}/messages`,
        payload: { role: 'u1', text: 'секрет', time: '10:00' }
      })
    ).json()
    db.setClaudeSession(U, c.id, 'sess-abc')
    expect(db.getConversation(U, c.id)?.claudeSessionId).toBe('sess-abc')

    await inj({ method: 'DELETE', url: `/api/conversations/${c.id}/messages/${m.id}` })
    expect(db.getConversation(U, c.id)?.claudeSessionId).toBeNull()
  })

  it('список моделей содержит все поддерживаемые', async () => {
    const res = await inj({ method: 'GET', url: '/api/stt/models' })
    const models = res.json() as Array<{ model: string; present: boolean; sizeBytes: number }>
    expect(models.map((m) => m.model).sort()).toEqual(['large-v3-turbo', 'medium', 'small'])
    for (const m of models) expect(typeof m.sizeBytes).toBe('number')
  })

  it('удаление модели/голоса отвечает ok (без файла — идемпотентно)', async () => {
    const m = await inj({ method: 'DELETE', url: '/api/stt/models/small' })
    expect(m.statusCode).toBe(200)
    const v = await inj({ method: 'DELETE', url: '/api/tts/voices/ru_RU-irina-medium' })
    expect(v.statusCode).toBe(200)
  })

  it('загрузка вложения возвращает id и имя', async () => {
    const res = await inj({
      method: 'POST',
      url: '/api/uploads',
      payload: { name: 'заметка.txt', dataBase64: Buffer.from('привет').toString('base64') }
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
    expect(body.name).toBe('заметка.txt')
  })

  it('rename и delete', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Старое' } })).json()
    await inj({ method: 'PATCH', url: `/api/conversations/${c.id}`, payload: { title: 'Новое' } })
    let got = await inj({ method: 'GET', url: `/api/conversations/${c.id}` })
    expect(got.json().conversation.title).toBe('Новое')
    await inj({ method: 'DELETE', url: `/api/conversations/${c.id}` })
    got = await inj({ method: 'GET', url: `/api/conversations/${c.id}` })
    expect(got.statusCode).toBe(404)
  })

  it('settings get/save', async () => {
    const def = (await inj({ method: 'GET', url: '/api/settings' })).json()
    expect(def.model).toBeDefined()
    const next = { ...def, diarization: false, voice: 'ru_RU-dmitri-medium' }
    await inj({ method: 'PUT', url: '/api/settings', payload: next })
    const saved = (await inj({ method: 'GET', url: '/api/settings' })).json()
    expect(saved.diarization).toBe(false)
    expect(saved.voice).toBe('ru_RU-dmitri-medium')
  })

  it('агенты: create → list (offline) → delete', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'MacBook' } })
    ).json()
    expect(created.name).toBe('MacBook')
    expect(typeof created.token).toBe('string')

    const list = (await inj({ method: 'GET', url: '/api/agents' })).json()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: created.id, name: 'MacBook', online: false })

    const del = await inj({ method: 'DELETE', url: `/api/agents/${created.id}` })
    expect(del.statusCode).toBe(200)
    expect((await inj({ method: 'GET', url: '/api/agents' })).json()).toHaveLength(0)
  })

  it('агенты: POST без имени → 400', async () => {
    const res = await inj({ method: 'POST', url: '/api/agents', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('агенты: список содержит политику; setPolicy сохраняет', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })
    ).json()
    const list = (await inj({ method: 'GET', url: '/api/agents' })).json()
    expect(list[0].policy.allowNetwork).toBe(true)

    const policy = {
      allowedDirs: ['/tmp'],
      allowNetwork: false,
      allowWrite: false,
      denyPatterns: ['sudo'],
      allowPatterns: [],
      skills: []
    }
    const res = await inj({
      method: 'POST',
      url: `/api/agents/${created.id}/policy`,
      payload: { policy }
    })
    expect(res.statusCode).toBe(200)
    const after = (await inj({ method: 'GET', url: '/api/agents' })).json()
    expect(after[0].policy.allowNetwork).toBe(false)
    expect(after[0].policy.allowedDirs).toEqual(['/tmp'])
  })

  it('агенты: перевыпуск токена возвращает новый токен', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })
    ).json()
    const res = await inj({ method: 'POST', url: `/api/agents/${created.id}/token` })
    expect(res.statusCode).toBe(200)
    expect(typeof res.json().token).toBe('string')
    expect(res.json().token).not.toBe(created.token)
  })

  it('скачивание: GET /api/agents/app и /api/app/desktop без .dmg → 404', async () => {
    // В тестах autodiscover артефактов отключён (VITEST), VC_*_APP не заданы.
    const agent = await inj({ method: 'GET', url: '/api/agents/app' })
    expect(agent.statusCode).toBe(404)
    expect(agent.json().error).toContain('не собрано')
    const desktop = await inj({ method: 'GET', url: '/api/app/desktop' })
    expect(desktop.statusCode).toBe(404)
  })

  it('скачивание: GET /api/agents/script отдаёт JS-бандл (attachment)', async () => {
    const res = await inj({ method: 'GET', url: '/api/agents/script' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('javascript')
    expect(res.headers['content-disposition']).toContain('voicechat-agent.cjs')
    expect(res.body.startsWith('#!')).toBe(true)
  }, 30_000)

  it('удаление агента сбрасывает execTarget на сервер', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })
    ).json()
    const def = (await inj({ method: 'GET', url: '/api/settings' })).json()
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...def, execTarget: created.id } })
    await inj({ method: 'DELETE', url: `/api/agents/${created.id}` })
    const saved = (await inj({ method: 'GET', url: '/api/settings' })).json()
    expect(saved.execTarget).toBeNull()
  })
})

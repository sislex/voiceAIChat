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
let dataDir: string

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
  dataDir = join(tmpdir(), `vc-rest-test-${Date.now()}-${id}`)
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
    db.createUser('user', '', 'user') // пользователь теперь заводится в БД
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
    db.createUser('user', '', 'user')
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

describe('REST: админ-роуты (только admin)', () => {
  it('user → 403 на /api/admin/users', async () => {
    db.createUser('user', '', 'user')
    const userTok = signToken({ name: 'user', role: 'user' }, SECRET)
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${userTok}` }
    })
    expect(res.statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/admin/users/usage-summary', headers: { authorization: `Bearer ${userTok}` } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/admin/model-prices', headers: { authorization: `Bearer ${userTok}` } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/me/usage', headers: { authorization: `Bearer ${userTok}` } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/me/llm-access', headers: { authorization: `Bearer ${userTok}` } })).statusCode).toBe(200)
  })

  it('admin: список → создание → блок → удаление', async () => {
    // admin засеян buildServer'ом.
    const list0 = (await inj({ method: 'GET', url: '/api/admin/users' })).json()
    expect(list0.map((u: { name: string }) => u.name)).toContain('admin')

    const created = await inj({
      method: 'POST',
      url: '/api/admin/users',
      payload: { name: 'bob', password: 'pw', role: 'user' }
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ name: 'bob', role: 'user', blocked: false })

    await inj({ method: 'POST', url: '/api/admin/users/bob/block', payload: { blocked: true } })
    const blocked = (await inj({ method: 'GET', url: '/api/admin/users' })).json()
    expect(blocked.find((u: { name: string }) => u.name === 'bob').blocked).toBe(true)

    // usage-отчёт отдаётся (пустой).
    const usage = (await inj({ method: 'GET', url: '/api/admin/users/bob/usage?unit=day' })).json()
    expect(usage.totals.messages).toBe(0)
    const summary = (await inj({ method: 'GET', url: '/api/admin/users/usage-summary' })).json()
    expect(summary.find((item: { name: string }) => item.name === 'bob')).toMatchObject({ totals: { messages: 0 }, byModel: [] })

    const del = await inj({ method: 'DELETE', url: '/api/admin/users/bob' })
    expect(del.statusCode).toBe(200)
    const after = (await inj({ method: 'GET', url: '/api/admin/users' })).json()
    expect(after.map((u: { name: string }) => u.name)).not.toContain('bob')
  })

  it('admin нельзя удалить', async () => {
    const res = await inj({ method: 'DELETE', url: '/api/admin/users/admin' })
    expect(res.statusCode).toBe(400)
  })
})


describe('REST: реестр LLM-исполнителей (только admin)', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('user → 403 на /api/admin/llm-engines', async () => {
    db.createUser('user', '', 'user')
    const userTok = signToken({ name: 'user', role: 'user' }, SECRET)
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/llm-engines',
      headers: { authorization: `Bearer ${userTok}` }
    })
    expect(res.statusCode).toBe(403)
  })

  it('admin: create → update → health → delete', async () => {
    const created = await inj({
      method: 'POST',
      url: '/api/admin/llm-engines',
      payload: {
        name: 'Runner Claude',
        kind: 'claude',
        baseUrl: 'http://runner.test:8080',
        token: 'secret',
        enabled: true,
        allowedRoles: ['admin', 'user'],
        isDefault: true
      }
    })
    expect(created.statusCode).toBe(200)
    const engine = created.json()
    expect(engine).toMatchObject({ name: 'Runner Claude', kind: 'claude', token: 'secret', isDefault: true })

    const list = await inj({ method: 'GET', url: '/api/admin/llm-engines' })
    expect(list.json()).toHaveLength(1)

    const updated = await inj({
      method: 'PATCH',
      url: `/api/admin/llm-engines/${engine.id}`,
      payload: {
        name: 'Runner Claude 2',
        kind: 'claude',
        baseUrl: 'http://runner.test:8081',
        token: 'secret-2',
        enabled: false,
        allowedRoles: ['admin'],
        isDefault: false
      }
    })
    expect(updated.json()).toMatchObject({ name: 'Runner Claude 2', enabled: false, allowedRoles: ['admin'] })

    globalThis.fetch = (async () => new Response(JSON.stringify({
      ok: true,
      bins: {
        claude: { present: true, version: '1.0.0' },
        codex: { present: false, version: null }
      },
      login: {
        claude: { provider: 'claude', loggedIn: true, detail: 'team' },
        codex: { provider: 'codex', loggedIn: false, detail: 'login required' }
      },
      runs: 0
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
    const health = await inj({ method: 'GET', url: `/api/admin/llm-engines/${engine.id}/health` })
    expect(health.json()).toMatchObject({ available: true, kind: 'claude' })

    globalThis.fetch = (async () => { throw new Error('connect ECONNREFUSED') }) as typeof fetch
    const offline = await inj({ method: 'GET', url: `/api/admin/llm-engines/${engine.id}/health` })
    expect(offline.statusCode).toBe(200)
    expect(offline.json()).toMatchObject({ available: false })

    const del = await inj({ method: 'DELETE', url: `/api/admin/llm-engines/${engine.id}` })
    expect(del.statusCode).toBe(200)
    expect((await inj({ method: 'GET', url: '/api/admin/llm-engines' })).json()).toEqual([])
  })

  it('валидация create/update полей работает', async () => {
    const bad = await inj({
      method: 'POST',
      url: '/api/admin/llm-engines',
      payload: { name: '', kind: 'bad', baseUrl: 'oops', token: '', enabled: true, allowedRoles: [], isDefault: false }
    })
    expect(bad.statusCode).toBe(400)
  })
})

describe('REST: conversations/messages/settings', () => {
  it('импорт desktop требует токен и идемпотентен', async () => {
    const payload = { conversations: [{ conversation: { id: 'legacy-c', title: 'Legacy', createdAt: 10, updatedAt: 20, claudeSessionId: null, execTarget: null }, messages: [{ id: 'legacy-m', conversationId: 'legacy-c', role: 'u1', text: 'hello', time: '10:00', createdAt: 15 }] }] }
    expect((await app.inject({ method: 'POST', url: '/api/migrations/desktop', payload })).statusCode).toBe(401)
    expect((await inj({ method: 'POST', url: '/api/migrations/desktop', payload })).json()).toEqual({ conversationsImported: 1, messagesImported: 1 })
    expect((await inj({ method: 'POST', url: '/api/migrations/desktop', payload })).json()).toEqual({ conversationsImported: 0, messagesImported: 0 })
  })

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

  it('чат задачи в «Готово» уходит из списка, но открывается по ссылке и из карточки', async () => {
    const project = db.createProject(U, { name: 'P' })
    const board = db.getBoard(U, project.id)!
    const done = board.columns.find((c) => c.semanticType === 'done')!
    const task = db.createTask(U, project.id, { columnId: board.columns[0]!.id, title: 'Скролл' })!
    const chat = db.openOrCreateTaskChat(U, project.id, task.id)!
    const ids = async (url: string): Promise<string[]> =>
      (await inj({ method: 'GET', url })).json().map((c: { id: string }) => c.id)

    expect(await ids('/api/conversations')).toContain(chat.id)
    db.moveTask(U, project.id, task.id, { columnId: done.id })
    expect(await ids('/api/conversations')).not.toContain(chat.id)
    expect(await ids('/api/conversations?includeCompleted=1')).toContain(chat.id)
    expect(await ids(`/api/conversations/search?q=${encodeURIComponent('Скролл')}`)).not.toContain(chat.id)
    expect(await ids(`/api/conversations/search?q=${encodeURIComponent('Скролл')}&includeCompleted=1`)).toContain(chat.id)

    // Прямая ссылка и кнопка «Открыть чат» на карточке работают как раньше.
    expect((await inj({ method: 'GET', url: `/api/conversations/${chat.id}` })).json().conversation.id).toBe(chat.id)
    const fromCard = await inj({ method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/chat` })
    expect(fromCard.json().id).toBe(chat.id)
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

      const body = (
        await inj({ method: 'GET', url: `/api/cc/projects/${demo.slug}/sessions/sess` })
      ).json()
      expect(body.items.map((i: { kind: string }) => i.kind)).toEqual(['user', 'assistant'])
      expect(body.usage).toBeDefined()
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

  it('обновляет и сохраняет состояние списка task-launch в meta сообщения', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (await inj({
      method: 'POST',
      url: `/api/conversations/${c.id}/messages`,
      payload: {
        role: 'ai',
        text: 'Выберите.',
        time: '10:00',
        meta: { taskLaunches: [
          { id: 'task-launch-1', title: 'Первая', description: 'Описание', acceptanceCriteria: 'Критерий' },
          { id: 'task-launch-2', title: 'Вторая', description: 'Описание', acceptanceCriteria: 'Критерий' }
        ] }
      }
    })).json()
    const meta = { ...m.meta, taskLaunches: m.meta.taskLaunches.map((item: { id: string }) => item.id === 'task-launch-2' ? { ...item, status: 'created' } : item) }
    const patched = await inj({ method: 'PATCH', url: `/api/conversations/${c.id}/messages/${m.id}`, payload: { meta } })
    expect(patched.statusCode).toBe(200)
    const got = (await inj({ method: 'GET', url: `/api/conversations/${c.id}` })).json()
    expect(got.messages[0].meta.taskLaunches[1].status).toBe('created')
    expect(got.messages[0].meta.taskLaunches[0].status).toBeUndefined()
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

  it('агенты: удаление снимает машину и с цели выполнения, и с дефолта', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'MacBook' } })
    ).json()
    const before = (await inj({ method: 'GET', url: '/api/settings' })).json()
    await inj({
      method: 'PUT',
      url: '/api/settings',
      payload: { ...before, execTarget: created.id, defaultAgentId: created.id }
    })

    await inj({ method: 'DELETE', url: `/api/agents/${created.id}` })

    const after = (await inj({ method: 'GET', url: '/api/settings' })).json()
    expect(after.execTarget).toBeNull()
    // Дефолт подставляется в новые разговоры: висячий id уводил бы ход на машину,
    // которой больше нет.
    expect(after.defaultAgentId).toBeNull()
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

  it('установщик Termux: GET /api/agents/install-android.sh публичен и отдаёт bash', async () => {
    // Без токена — должен быть доступен (curl с телефона до логина).
    const res = await app.inject({ method: 'GET', url: '/api/agents/install-android.sh' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('shellscript')
    expect(res.body.startsWith('#!')).toBe(true)
    expect(res.body).toContain('/api/agents/script')
  })

  it('установщик Windows: GET /api/agents/install-windows.ps1 публичен и отдаёт PowerShell', async () => {
    // Без токена — команду запускают на машине до какого-либо логина.
    const res = await app.inject({ method: 'GET', url: '/api/agents/install-windows.ps1' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('powershell')
    expect(res.body).toContain('/api/agents/script')
    expect(res.body).toContain('nodejs.org')
  })

  it('установщики Linux и macOS публичны, отдают bash и разные скрипты', async () => {
    const lin = await app.inject({ method: 'GET', url: '/api/agents/install-linux.sh' })
    const mac = await app.inject({ method: 'GET', url: '/api/agents/install-macos.sh' })
    for (const res of [lin, mac]) {
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('shellscript')
      expect(res.body).toContain('/api/agents/script')
      expect(res.body).toContain('-ge 22') // проверка Node 22+
    }
    expect(lin.body).toContain('systemctl --user')
    expect(mac.body).toContain('LaunchAgents')
    expect(lin.body).not.toBe(mac.body)
  })

  it('обновление офлайн-машины отклоняется с понятной причиной', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'Офлайн' } })
    ).json()
    const res = await inj({ method: 'POST', url: `/api/agents/${created.id}/update` })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toContain('не в сети')
  })

  it('обновление отклоняется, если сервер виден как localhost (команда ушла бы в саму машину)', async () => {
    // app.inject ходит с Host: localhost — ровно тот случай, когда база непригодна.
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'Локальная' } })
    ).json()
    const res = await inj({ method: 'POST', url: `/api/agents/${created.id}/update` })
    // Машина офлайн → 409 про сеть; проверяем, что до сборки команды дело не дошло
    // молча: в обоих случаях это 409 с объяснением, а не «ok».
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBeTruthy()
  })

  it('обновление чужой машины — 404', async () => {
    const res = await inj({ method: 'POST', url: '/api/agents/нет-такой/update' })
    expect(res.statusCode).toBe(404)
  })

  it('обновление без токена — 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/agents/x/update' })
    expect(res.statusCode).toBe(401)
  })

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

describe('REST: утилиты машины (exec/fs)', () => {
  it('exec: 404 на чужую машину; 400 на офлайн-машину владельца', async () => {
    // Своя офлайн-машина: exec → 400 (не в сети).
    const created = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })).json()
    const own = await inj({
      method: 'POST',
      url: `/api/agents/${created.id}/exec`,
      payload: { command: 'ls' }
    })
    expect(own.statusCode).toBe(400)
    expect(own.json().error).toContain('не в сети')

    // Чужая машина (создана под user) → 404 для admin.
    db.createUser('user', '', 'user')
    const other = db.createAgent('user', 'UserBox')
    const foreign = await inj({
      method: 'POST',
      url: `/api/agents/${other.id}/exec`,
      payload: { command: 'ls' }
    })
    expect(foreign.statusCode).toBe(404)
  })

  it('fs.list: 400 на офлайн-машину владельца', async () => {
    const created = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })).json()
    const res = await inj({ method: 'GET', url: `/api/agents/${created.id}/fs?path=` })
    expect(res.statusCode).toBe(400)
  })

  it('GET /api/agents/version публичен и отдаёт версию', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents/version' }) // без токена
    expect(res.statusCode).toBe(200)
    expect(typeof res.json().version).toBe('string')
  })
})

describe('REST: чтение файла с диска сервера (/api/files/read)', () => {
  // Профиль CLI создаётся при первом обращении к нему; дёргаем любой роут,
  // который его трогает, а затем кладём туда «сгенерированную» картинку.
  async function seedImage(): Promise<string> {
    await inj({ method: 'GET', url: '/api/auth/status' })
    const dir = join(dataDir, 'cli-users', Buffer.from(U).toString('base64url'), '.codex', 'generated_images', 'sess')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'pic.png')
    writeFileSync(file, 'PNGDATA')
    return file
  }

  it('отдаёт картинку из профиля пользователя', async () => {
    const file = await seedImage()
    const res = await inj({ method: 'GET', url: `/api/files/read?path=${encodeURIComponent(file)}` })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { name: string; dataBase64: string }
    expect(body.name).toBe('pic.png')
    expect(Buffer.from(body.dataBase64, 'base64').toString()).toBe('PNGDATA')
  })

  it('файл вне своей области — 404', async () => {
    await seedImage()
    const outside = join(tmpdir(), `vc-outside-${Date.now()}.png`)
    writeFileSync(outside, 'NOPE')
    const res = await inj({ method: 'GET', url: `/api/files/read?path=${encodeURIComponent(outside)}` })
    expect(res.statusCode).toBe(404)
    rmSync(outside, { force: true })
  })

  it('без токена — 401 (роут под общей защитой /api)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/files/read?path=/etc/passwd' })
    expect(res.statusCode).toBe(401)
  })

  it('системный файл не отдаётся', async () => {
    const res = await inj({ method: 'GET', url: '/api/files/read?path=/etc/passwd' })
    expect(res.statusCode).toBe(404)
  })
})

describe('REST: GET /api/search — полнотекстовый поиск по сообщениям', () => {
  /** Беседа с сообщениями пользователя (по умолчанию — admin из токена). */
  const seed = (user: string, title: string, texts: string[]): string => {
    const conv = db.createConversation(user, title)
    for (const t of texts) db.addMessage(user, conv.id, 'u1', t, '12:00')
    return conv.id
  }

  it('без токена → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/search?q=миграция' })).statusCode).toBe(401)
  })

  it('отдаёт ранжированные результаты со сниппетом и курсором', async () => {
    const id = seed(U, 'Канбан', [
      'Обсудили миграцию канбана и схему БД',
      'Ещё раз про миграцию',
      'Совсем про другое'
    ])

    const first = await inj({ method: 'GET', url: '/api/search?q=миграцию%20&limit=1' })
    expect(first.statusCode).toBe(200)
    const page1 = first.json()
    expect(page1.hits).toHaveLength(1)
    expect(page1.hits[0].conversationId).toBe(id)
    expect(page1.hits[0].conversationTitle).toBe('Канбан')
    expect(page1.hits[0].snippet).toContain('<mark>')
    expect(typeof page1.nextCursor).toBe('string')

    const second = await inj({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('миграцию ')}&limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`
    })
    const page2 = second.json()
    expect(page2.hits).toHaveLength(1)
    expect(page2.hits[0].messageId).not.toBe(page1.hits[0].messageId)
  })

  it('не выдаёт сообщения другого пользователя', async () => {
    db.createUser('mallory', '', 'user')
    const theirs = seed('mallory', 'Чужая беседа', ['чужой секрет про миграцию'])
    seed(U, 'Своя беседа', ['свой текст про миграцию'])

    const all = await inj({ method: 'GET', url: '/api/search?q=миграцию%20' })
    expect(all.json().hits.map((h: { conversationTitle: string }) => h.conversationTitle)).toEqual(['Своя беседа'])

    // Явная чужая беседа — тоже пусто, а не 403/500: чужого просто «не существует».
    const direct = await inj({ method: 'GET', url: `/api/search?q=миграцию%20&conversationId=${theirs}` })
    expect(direct.statusCode).toBe(200)
    expect(direct.json().hits).toEqual([])
  })

  it('сужает по проекту, projectId=none — только беседы без проекта', async () => {
    const project = db.createProject(U, { name: 'Проект' })
    const inProject = seed(U, 'С проектом', ['миграция схемы'])
    db.setConversationProject(U, inProject, project.id)
    seed(U, 'Без проекта', ['миграция схемы'])

    const byProject = await inj({ method: 'GET', url: `/api/search?q=миграция%20&projectId=${project.id}` })
    expect(byProject.json().hits.map((h: { conversationTitle: string }) => h.conversationTitle)).toEqual(['С проектом'])

    const none = await inj({ method: 'GET', url: '/api/search?q=миграция%20&projectId=none' })
    expect(none.json().hits.map((h: { conversationTitle: string }) => h.conversationTitle)).toEqual(['Без проекта'])
  })

  it('пробел в конце запроса приезжает и как «+» (URLSearchParams)', async () => {
    seed(U, 'Канбан', ['миграция канбана'])

    // «мигра» — префикс, находит; «мигра+» — слово закончено, не находит.
    expect((await inj({ method: 'GET', url: '/api/search?q=мигра' })).json().hits).toHaveLength(1)
    expect((await inj({ method: 'GET', url: '/api/search?q=мигра+' })).json().hits).toHaveLength(0)
  })

  it('спецсимволы и мусорные параметры не дают 500', async () => {
    seed(U, 'Канбан', ['миграция канбана'])

    const bad = ['', '*', '"', '-', 'NEAR(', '^)(', '%%%', 'a".."b', '\\\\', '(((']
    for (const q of bad) {
      const res = await inj({ method: 'GET', url: `/api/search?q=${encodeURIComponent(q)}` })
      expect(res.statusCode, `q=${JSON.stringify(q)}`).toBe(200)
      expect(Array.isArray(res.json().hits)).toBe(true)
    }
    // Мусор в limit/cursor тоже не ошибка.
    const res = await inj({ method: 'GET', url: '/api/search?q=миграция%20&limit=abc&cursor=%00%01' })
    expect(res.statusCode).toBe(200)
    expect(res.json().hits).toHaveLength(1)
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'

let app: FastifyInstance
let db: VoiceChatDb

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
    db
  })
})

afterEach(async () => {
  await app.close()
  db.close()
})

describe('REST: conversations/messages/settings', () => {
  it('create → list → get', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'Тест' } })).json()
    expect(created.title).toBe('Тест')

    const list = (await app.inject({ method: 'GET', url: '/api/conversations' })).json()
    expect(list.map((c: { id: string }) => c.id)).toContain(created.id)

    const got = (await app.inject({ method: 'GET', url: `/api/conversations/${created.id}` })).json()
    expect(got.conversation.title).toBe('Тест')
    expect(got.messages).toEqual([])
  })

  it('404 на несуществующий разговор', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conversations/нет' })
    expect(res.statusCode).toBe(404)
  })

  it('поиск /conversations/search находит по названию (статик-роут не конфликтует с :id)', async () => {
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'Лиссабон' } })
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'Погода' } })
    const res = await app.inject({ method: 'GET', url: '/api/conversations/search?q=лисс' })
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
      const projects = (await app.inject({ method: 'GET', url: '/api/cc/projects' })).json()
      const demo = projects.find((p: { name: string }) => p.name === 'demo')
      expect(demo?.path).toBe('/Users/x/demo')

      const sessions = (
        await app.inject({ method: 'GET', url: `/api/cc/projects/${demo.slug}/sessions` })
      ).json()
      expect(sessions[0].title).toBe('Помоги с фичей')

      const items = (
        await app.inject({ method: 'GET', url: `/api/cc/projects/${demo.slug}/sessions/sess` })
      ).json()
      expect(items.map((i: { kind: string }) => i.kind)).toEqual(['user', 'assistant'])
    } finally {
      if (prev === undefined) delete process.env.VC_CC_DIR
      else process.env.VC_CC_DIR = prev
      rmSync(ccDir, { recursive: true, force: true })
    }
  })

  it('добавление сообщения видно в get', async () => {
    const c = (await app.inject({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (
      await app.inject({
        method: 'POST',
        url: `/api/conversations/${c.id}/messages`,
        payload: { role: 'u1', text: 'Привет', time: '10:00' }
      })
    ).json()
    expect(m.text).toBe('Привет')
    const got = (await app.inject({ method: 'GET', url: `/api/conversations/${c.id}` })).json()
    expect(got.messages).toHaveLength(1)
  })

  it('удаление сообщения убирает его из истории', async () => {
    const c = (await app.inject({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (
      await app.inject({
        method: 'POST',
        url: `/api/conversations/${c.id}/messages`,
        payload: { role: 'u1', text: 'удалить меня', time: '10:00' }
      })
    ).json()
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/conversations/${c.id}/messages/${m.id}`
    })
    expect(del.statusCode).toBe(200)
    const got = (await app.inject({ method: 'GET', url: `/api/conversations/${c.id}` })).json()
    expect(got.messages).toHaveLength(0)
  })

  it('удаление сообщения сбрасывает сессию Claude (модель забывает удалённое)', async () => {
    const c = (await app.inject({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (
      await app.inject({
        method: 'POST',
        url: `/api/conversations/${c.id}/messages`,
        payload: { role: 'u1', text: 'секрет', time: '10:00' }
      })
    ).json()
    db.setClaudeSession(c.id, 'sess-abc')
    expect(db.getConversation(c.id)?.claudeSessionId).toBe('sess-abc')

    await app.inject({ method: 'DELETE', url: `/api/conversations/${c.id}/messages/${m.id}` })
    expect(db.getConversation(c.id)?.claudeSessionId).toBeNull()
  })

  it('список моделей содержит все поддерживаемые', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stt/models' })
    const models = res.json() as Array<{ model: string; present: boolean; sizeBytes: number }>
    expect(models.map((m) => m.model).sort()).toEqual(['large-v3-turbo', 'medium', 'small'])
    for (const m of models) expect(typeof m.sizeBytes).toBe('number')
  })

  it('удаление модели/голоса отвечает ok (без файла — идемпотентно)', async () => {
    const m = await app.inject({ method: 'DELETE', url: '/api/stt/models/small' })
    expect(m.statusCode).toBe(200)
    const v = await app.inject({ method: 'DELETE', url: '/api/tts/voices/ru_RU-irina-medium' })
    expect(v.statusCode).toBe(200)
  })

  it('загрузка вложения возвращает id и имя', async () => {
    const res = await app.inject({
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
    const c = (await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'Старое' } })).json()
    await app.inject({ method: 'PATCH', url: `/api/conversations/${c.id}`, payload: { title: 'Новое' } })
    let got = await app.inject({ method: 'GET', url: `/api/conversations/${c.id}` })
    expect(got.json().conversation.title).toBe('Новое')
    await app.inject({ method: 'DELETE', url: `/api/conversations/${c.id}` })
    got = await app.inject({ method: 'GET', url: `/api/conversations/${c.id}` })
    expect(got.statusCode).toBe(404)
  })

  it('settings get/save', async () => {
    const def = (await app.inject({ method: 'GET', url: '/api/settings' })).json()
    expect(def.model).toBeDefined()
    const next = { ...def, diarization: false, voice: 'ru_RU-dmitri-medium' }
    await app.inject({ method: 'PUT', url: '/api/settings', payload: next })
    const saved = (await app.inject({ method: 'GET', url: '/api/settings' })).json()
    expect(saved.diarization).toBe(false)
    expect(saved.voice).toBe('ru_RU-dmitri-medium')
  })

  it('агенты: create → list (offline) → delete', async () => {
    const created = (
      await app.inject({ method: 'POST', url: '/api/agents', payload: { name: 'MacBook' } })
    ).json()
    expect(created.name).toBe('MacBook')
    expect(typeof created.token).toBe('string')

    const list = (await app.inject({ method: 'GET', url: '/api/agents' })).json()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: created.id, name: 'MacBook', online: false })

    const del = await app.inject({ method: 'DELETE', url: `/api/agents/${created.id}` })
    expect(del.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/agents' })).json()).toHaveLength(0)
  })

  it('агенты: POST без имени → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/agents', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('агенты: GET /api/agents/script отдаёт JS-бандл', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents/script' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('javascript')
    expect(res.body.startsWith('#!')).toBe(true)
    expect(res.body).toContain('VC_AGENT_TOKEN')
  }, 30_000)

  it('удаление агента сбрасывает execTarget на сервер', async () => {
    const created = (
      await app.inject({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })
    ).json()
    const def = (await app.inject({ method: 'GET', url: '/api/settings' })).json()
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { ...def, execTarget: created.id } })
    await app.inject({ method: 'DELETE', url: `/api/agents/${created.id}` })
    const saved = (await app.inject({ method: 'GET', url: '/api/settings' })).json()
    expect(saved.execTarget).toBeNull()
  })
})

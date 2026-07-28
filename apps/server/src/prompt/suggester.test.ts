import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { PromptSuggester, parseVariants } from './suggester.js'
import type { LlmClient, LlmRequest } from '../claude/types.js'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'
import { REST } from '@voicechat/shared'

/** Мок движка: отдаёт заранее заданный текст ответа (и запоминает запрос). */
function fakeClient(reply: string | { error: string }): { client: LlmClient; last: () => LlmRequest | null } {
  let last: LlmRequest | null = null
  return {
    client: {
      send(req, h) {
        last = req
        if (typeof reply === 'object') h.onError(reply.error)
        else h.onDone(reply)
        return { cancel: () => {} }
      }
    },
    last: () => last
  }
}

describe('parseVariants', () => {
  it('парсит чистый JSON', () => {
    expect(parseVariants('{"variants":["а","б"]}')).toEqual(['а', 'б'])
  })
  it('снимает ```json-обёртку', () => {
    expect(parseVariants('```json\n{"variants":["x"]}\n```')).toEqual(['x'])
  })
  it('выхватывает JSON из текста вокруг', () => {
    expect(parseVariants('Вот варианты: {"variants":["y"]} — готово')).toEqual(['y'])
  })
  it('дедуплицирует, чистит пустые и режет до 4', () => {
    expect(parseVariants('{"variants":["a"," a ","","b","c","d","e"]}')).toEqual(['a', 'b', 'c', 'd'])
  })
  it('не-массив variants → пустой список', () => {
    expect(parseVariants('{"variants":"нет"}')).toEqual([])
  })
  it('неразборчивый ответ → ошибка', () => {
    expect(() => parseVariants('совсем не json')).toThrow()
  })
})

describe('PromptSuggester', () => {
  it('пустой черновик — без обращения к движку', async () => {
    const { client, last } = fakeClient('{"variants":["x"]}')
    expect(await new PromptSuggester(client).suggest('   ')).toEqual([])
    expect(last()).toBeNull()
  })
  it('шлёт запрос без сессии, в plan-режиме, без выполнения shell', async () => {
    const { client, last } = fakeClient('{"variants":["Уточни задачу"]}')
    const out = await new PromptSuggester(client).suggest('сделай штуку', 'admin')
    expect(out).toEqual(['Уточни задачу'])
    const req = last()!
    expect(req.sessionId).toBeNull()
    expect(req.permissionMode).toBe('plan')
    expect(req.executionDisabled).toBe(true)
    expect(req.model).toBe('haiku')
    expect(req.userId).toBe('admin')
    expect(req.prompt).toContain('сделай штуку')
  })
  it('ошибка движка пробрасывается', async () => {
    const { client } = fakeClient({ error: 'CLI не найден' })
    await expect(new PromptSuggester(client).suggest('текст')).rejects.toThrow('CLI не найден')
  })
})

describe('REST /api/prompt/suggest', () => {
  let app: FastifyInstance
  let db: VoiceChatDb
  let token: string
  const SECRET = 'test-secret'

  async function build(reply: string | { error: string }): Promise<void> {
    let id = 0
    let clock = 1000
    db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
    const dataDir = join(tmpdir(), `vc-prompt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    app = await buildServer({
      config: loadConfig({
        PORT: '0',
        VC_DATA_DIR: dataDir,
        VC_MODELS_DIR: join(dataDir, 'models'),
        VC_PIPER_VOICES_DIR: join(dataDir, 'voices')
      }),
      db,
      claude: fakeClient(reply).client,
      sessionSecret: SECRET
    })
    token = signToken({ name: 'admin', role: 'admin' }, SECRET)
  }

  afterEach(async () => {
    await app.close()
    db.close()
  })

  it('требует токен', async () => {
    await build('{"variants":["x"]}')
    const res = await app.inject({ method: 'POST', url: REST.promptSuggest, payload: { text: 'привет' } })
    expect(res.statusCode).toBe(401)
  })

  it('возвращает варианты для черновика', async () => {
    await build('{"variants":["Опиши задачу подробнее","Переформулируй как ТЗ"]}')
    const res = await app.inject({
      method: 'POST',
      url: REST.promptSuggest,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'сделай форму' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ variants: ['Опиши задачу подробнее', 'Переформулируй как ТЗ'] })
  })

  it('пустой текст → пустой список без обращения к движку', async () => {
    await build({ error: 'не должно вызываться' })
    const res = await app.inject({
      method: 'POST',
      url: REST.promptSuggest,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: '   ' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ variants: [] })
  })

  it('ошибка движка → 502', async () => {
    await build({ error: 'Claude CLI не найден' })
    const res = await app.inject({
      method: 'POST',
      url: REST.promptSuggest,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'сделай штуку' }
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toContain('Claude CLI не найден')
  })
})

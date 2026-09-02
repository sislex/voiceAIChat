// Интеграция «задача из Make-чата → подготовка получает файлы макета».
// Ошибка, с которой начался фикс (CHAT-391): задача создавалась без связи
// task_designs, подготовка не получала инструменты make_* и блокировалась
// вопросом «критичный источник истины недоступен» про опубликованный URL.
// Мок-CLI перехватывает LlmRequest подготовки — проверяем ровно то, что
// увидела бы модель: make-источники и заметку о дизайне в промпте.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { LlmClient, LlmRequest } from '@voicechat/shared'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'

const SECRET = 'test-secret'
let app: FastifyInstance
let db: VoiceChatDb
let tok: string
let sent: LlmRequest[]

const capturingClaude: LlmClient = {
  send(req, handlers) {
    sent.push(req)
    // Валидный вопрос: подготовка сохранит его и остановится в ожидании ответа —
    // ран не падает, а запрос уже перехвачен.
    handlers.onDone('{"question":"Проверочный вопрос?","material":true}')
    return { cancel: () => {} }
  }
}

beforeEach(async () => {
  sent = []
  db = new VoiceChatDb(':memory:')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-prep-make-${Date.now()}`) }),
    db,
    claude: capturingClaude,
    sessionSecret: SECRET
  })
  tok = signToken({ name: 'admin', role: 'admin' }, SECRET)
})
afterEach(async () => {
  await app.close()
  db.close()
})

function inj(opts: { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: object }) {
  return app.inject({ ...opts, headers: { authorization: `Bearer ${tok}` } })
}

describe('подготовка задачи из Make-чата', () => {
  it('получает make-источники и заметку о дизайне вместо публичного URL', async () => {
    const project = (await inj({ method: 'POST', url: '/api/projects', payload: { name: 'Проект 14' } })).json()
    const makeChat = db.createConversation('admin', 'Проект 14 — макет', 'make', project.id)!
    const board = (await inj({ method: 'GET', url: `/api/projects/${project.id}/board` })).json()
    const backlog = board.columns.find((column: { semanticType: string }) => column.semanticType === 'backlog')!
    const preparation = board.columns.find((column: { semanticType: string }) => column.semanticType === 'preparation')!

    // Создание из чата: клиент передаёт источник, сервер линкует макет сам.
    const task = (await inj({ method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: {
      columnId: backlog.id, title: 'Реализовать карточку', sourceConversationId: makeChat.id
    } })).json()
    expect(task.designs?.length).toBe(1)

    // Перенос в «Подготовку» запускает ран; мок-CLI перехватывает запрос.
    await inj({ method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/move`, payload: { columnId: preparation.id } })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(sent.length).toBeGreaterThan(0)
    const request = sent[0]!
    // Файлы макета доступны инструментами make-источника…
    expect(request.makeSources?.map((source) => [source.conversationId, source.mode])).toEqual([[makeChat.id, 'whole_project']])
    // …и промпт говорит об этом прямо, запрещая ходить по опубликованному URL.
    expect(request.prompt).toContain('макет лежит в Make-проекте')
    expect(request.prompt).toContain('make_read_file')
    expect(request.prompt).toContain('по URL открывать не нужно')
  })

  it('задача без дизайна готовится как раньше: без источников и без заметки', async () => {
    const project = (await inj({ method: 'POST', url: '/api/projects', payload: { name: 'Без макета' } })).json()
    const board = (await inj({ method: 'GET', url: `/api/projects/${project.id}/board` })).json()
    const backlog = board.columns.find((column: { semanticType: string }) => column.semanticType === 'backlog')!
    const preparation = board.columns.find((column: { semanticType: string }) => column.semanticType === 'preparation')!
    const task = (await inj({ method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: {
      columnId: backlog.id, title: 'Обычная задача'
    } })).json()
    await inj({ method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/move`, payload: { columnId: preparation.id } })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(sent.length).toBeGreaterThan(0)
    expect(sent[0]!.makeSources ?? []).toEqual([])
    expect(sent[0]!.prompt).not.toContain('Make-проект')
  })
})

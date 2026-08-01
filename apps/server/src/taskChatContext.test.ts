// Контекст задачи у связанного чата: REST для шапки чата и инъекция в промпт хода.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'
import { loadConfig } from './config.js'
import { VoiceChatDb } from './db/database.js'
import { signToken } from './users/accounts.js'
import type { LlmClient, LlmRequest } from './claude/types.js'
import { createTurnManager } from './turns.js'
import { DEFAULT_AGENT_POLICY } from '@voicechat/shared'

const SECRET = 'task-ctx-secret'
let app: FastifyInstance, db: VoiceChatDb, admin: string
let requests: LlmRequest[] = []

const fakeClaude: LlmClient = {
  send: (req, handlers) => {
    requests.push(req)
    queueMicrotask(() => { handlers.onDelta('ок'); handlers.onDone('ок') })
    return { cancel: () => {} }
  }
}

beforeEach(async () => {
  let id = 0
  requests = []
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => Date.now() })
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-tctx-${Date.now()}`) }),
    db, sessionSecret: SECRET, claude: fakeClaude, codex: fakeClaude
  })
  admin = signToken({ name: 'admin', role: 'admin' }, SECRET)
})
afterEach(async () => { await app.close(); db.close() })

const inj = (opts: { method: 'GET' | 'POST'; url: string; payload?: object }) =>
  app.inject({ ...opts, headers: { authorization: `Bearer ${admin}` } })

/** Проект с иерархией Эпик → Стори → Задача и связанным чатом задачи. */
function setup() {
  const project = db.createProject('admin', { name: 'Voice Chat', gitUrl: 'git@github.com:x/y.git' })
  const agent = db.createAgent('admin', 'Прод-машина')
  db.linkMachine('admin', project.id, agent.id)
  db.setProjectMachinePath('admin', project.id, agent.id, '/srv/app')
  db.setProjectDefaultMachine('admin', project.id, agent.id)
  const board = db.getBoard('admin', project.id)!
  const backlog = board.columns.find((c) => c.semanticType === 'backlog')!
  const epic = db.createTask('admin', project.id, { columnId: backlog.id, title: 'Канбан', type: 'epic' })!
  const story = db.createTask('admin', project.id, { columnId: backlog.id, title: 'Карточка', type: 'story', parentId: epic.id })!
  const task = db.createTask('admin', project.id, {
    columnId: backlog.id, title: 'Скролл в модалке', type: 'task', parentId: story.id,
    description: 'Боковая панель должна скроллиться', acceptanceCriteria: 'Появляется вертикальный скролл'
  })!
  const chat = db.openOrCreateTaskChat('admin', project.id, task.id)!
  return { project, epic, story, task, chat, columnName: backlog.name }
}

describe('GET /api/conversations/:id/task-context', () => {
  it('отдаёт иерархию, этап, машину и папку разработки', async () => {
    const { project, epic, story, task, chat, columnName } = setup()
    const res = await inj({ method: 'GET', url: `/api/conversations/${chat.id}/task-context` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      // Контекст помечен своим чатом: клиент рисует виджет только в нём.
      conversationId: chat.id,
      projectId: project.id,
      projectName: 'Voice Chat',
      epic: { id: epic.id, title: 'Канбан', key: 'VC-1' },
      story: { id: story.id, title: 'Карточка', key: 'VC-2' },
      task: { id: task.id, title: 'Скролл в модалке', key: 'VC-3', type: 'task' },
      columnName,
      columnSemantic: 'backlog',
      agentName: 'Прод-машина',
      workdir: '/srv/app',
      run: null
    })
  })

  it('для чата без задачи возвращает null', async () => {
    const conv = db.createConversation('admin')
    const res = await inj({ method: 'GET', url: `/api/conversations/${conv.id}/task-context` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toBeNull()
  })
})

describe('контекст задачи в промпте хода', () => {
  it('чат задачи получает иерархию, этап, папку и критерии приёмки', async () => {
    const { chat } = setup()
    db.addMessage('admin', chat.id, 'u1', 'привет', '10:00')

    // Ход поднимаем напрямую через менеджер, как в turns.test.ts.
    const turns = createTurnManager({
      db,
      claude: fakeClaude,
      agents: { isOnline: () => true, nameOf: () => 'Прод-машина', policyOf: () => DEFAULT_AGENT_POLICY },
      mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret'
    })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((m) => {
        if (m.t === 'claude.done' || m.t === 'claude.error') {
          off()
          resolve()
        }
      })
      void turns.start({ userId: 'admin', conversationId: chat.id, segments: [{ speakerId: 1, text: 'привет' }] })
    })

    const prompt = requests[0]?.prompt ?? ''
    expect(prompt).toContain('## Контекст задачи')
    expect(prompt).toContain('VC-3 · Скролл в модалке')
    expect(prompt).toContain('Эпик: VC-1 · Канбан')
    expect(prompt).toContain('История: VC-2 · Карточка')
    expect(prompt).toContain('Рабочая директория: /srv/app')
    expect(prompt).toContain('Критерии приёмки: Появляется вертикальный скролл')
  })
})

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
    queueMicrotask(async () => { void handlers.onDelta('ок'); void handlers.onDone('ок') })
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
async function setup() {
  const project = await db.projects.createProject('admin', { name: 'Voice Chat', gitUrl: 'git@github.com:x/y.git' })
  const agent = await db.machines.createAgent('admin', 'Прод-машина')
  await db.machines.linkMachine('admin', project.id, agent.id)
  await db.machines.setProjectMachinePath('admin', project.id, agent.id, '/srv/app')
  await db.projects.setProjectDefaultMachine('admin', project.id, agent.id)
  const board = (await db.tasks.getBoard('admin', project.id))!
  const backlog = board.columns.find((c) => c.semanticType === 'backlog')!
  const epic = (await db.tasks.createTask('admin', project.id, { columnId: backlog.id, title: 'Канбан', type: 'epic' }))!
  const story = (await db.tasks.createTask('admin', project.id, { columnId: backlog.id, title: 'Карточка', type: 'story', parentId: epic.id }))!
  const task = (await db.tasks.createTask('admin', project.id, {
    columnId: backlog.id, title: 'Скролл в модалке', type: 'task', parentId: story.id,
    description: 'Боковая панель должна скроллиться', acceptanceCriteria: 'Появляется вертикальный скролл'
  }))!
  const chat = (await db.chat.openOrCreateTaskChat('admin', project.id, task.id))!
  return { project, epic, story, task, chat, columnName: backlog.name }
}

describe('GET /api/conversations/:id/task-context', () => {
  it('отдаёт иерархию, этап, машину и папку разработки', async () => {
    const { project, epic, story, task, chat, columnName } = await setup()
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
      // В buildServer реестр не содержит online-подключения: REST не должен
      // показывать project default как фактически доступную машину чата.
      agentName: null,
      workdir: null,
      run: null
    })
  })

  it('для чата без задачи возвращает null', async () => {
    const conv = await db.chat.createConversation('admin')
    const res = await inj({ method: 'GET', url: `/api/conversations/${conv.id}/task-context` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toBeNull()
  })

  it('использует персональный default чата и online-fallback, но не заменяет явный override', async () => {
    const { project, chat } = await setup()
    const fallback = await db.machines.createAgent('admin', 'Резервная')
    await db.machines.linkMachine('admin', project.id, fallback.id)
    await db.machines.setProjectMachinePath('admin', project.id, fallback.id, '/srv/fallback')
    const projectDefault = (await db.projects.getProject('admin', project.id))!.defaultAgentId!
    await db.machines.setUserProjectDefaultMachine('admin', project.id, projectDefault)

    expect(await db.chat.resolveConversationMachine('admin', chat.id, { isOnline: (id) => id === fallback.id })).toEqual({
      agentId: fallback.id, source: 'fallback', error: null
    })
    await db.machines.setUserProjectDefaultMachine('admin', project.id, fallback.id)
    expect(await db.chat.resolveConversationMachine('admin', chat.id, { isOnline: (id) => id === fallback.id })).toEqual({
      agentId: fallback.id, source: 'personal_default', error: null
    })
    await db.chat.setConversationExecTarget('admin', chat.id, projectDefault)
    expect(await db.chat.resolveConversationMachine('admin', chat.id, { isOnline: (id) => id === fallback.id })).toEqual({
      agentId: projectDefault, source: 'explicit', error: 'offline'
    })

    await db.chat.restoreTaskChatWorkdir('admin', chat.id, project.id)
    expect(await db.chat.getConversation('admin', chat.id)).toMatchObject({ execTarget: null, workdir: null })
  })

  // Машину могли удалить мимо чата: висячий id оставлял чат навсегда в
  // «машина недоступна», и человеку приходилось переключать её руками.
  it('забывает машину чата, которой больше нет в реестре', async () => {
    const { project, chat } = await setup()
    const gone = await db.machines.createAgent('admin', 'Удалённая')
    await db.machines.linkMachine('admin', project.id, gone.id)
    await db.machines.setProjectMachinePath('admin', project.id, gone.id, '/srv/gone')
    await db.chat.setConversationExecTarget('admin', chat.id, gone.id)
    await db.machines.deleteAgent('admin', gone.id)

    const resolved = await db.chat.resolveConversationMachine('admin', chat.id, { isOnline: () => true })

    expect(resolved?.source).not.toBe('explicit')
    expect(resolved?.error).toBeNull()
    expect((await db.chat.getConversation('admin', chat.id))?.execTarget).toBeNull()
  })

  // А машину, которая просто офлайн или временно недоступна в проекте,
  // забывать нельзя — это осознанный выбор человека.
  it('не забывает существующую машину, которая сейчас недоступна', async () => {
    const { chat } = await setup()
    await db.identity.createUser('stranger', 'password-stranger', 'developer')
    const foreign = await db.machines.createAgent('stranger', 'Чужая машина')
    await db.chat.setConversationExecTarget('admin', chat.id, foreign.id)

    const resolved = await db.chat.resolveConversationMachine('admin', chat.id, { isOnline: () => true })

    // Машина есть в реестре, просто недоступна этому чату — забывать нечего.
    expect(resolved).toMatchObject({ agentId: foreign.id, source: 'explicit', error: 'unavailable' })
    expect((await db.chat.getConversation('admin', chat.id))?.execTarget).toBe(foreign.id)
  })
})

describe('контекст задачи в промпте хода', () => {
  it('чат задачи получает иерархию, этап, папку и критерии приёмки', async () => {
    const { chat } = await setup()
    await db.chat.addMessage('admin', chat.id, 'u1', 'привет', '10:00')

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

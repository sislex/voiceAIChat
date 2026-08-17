// Паузы CI-рана: уточняющие вопросы модели и гейт одобрения плана.
// Проверяем через настоящий REST + менеджер, с моком LlmClient: сколько ходов
// сделала модель, что ушло в промптах, что попало в связанный чат.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'
import type { CommandExecutor } from './types.js'
import type { LlmClient, LlmRequest } from '../claude/types.js'

const SECRET = 'ci-interactions-secret'
let app: FastifyInstance, db: VoiceChatDb, admin: string
let requests: LlmRequest[] = []
/** Что модель отвечает на N-й ход (по индексу); дальше — последний элемент. */
let replies: string[] = []

const QUESTION_BLOCK = '```questions\n[{"q":"Какую БД взять?","options":["SQLite","Postgres"]}]\n```'

const fakeClaude: LlmClient = {
  send: (req, handlers) => {
    requests.push(req)
    const text = replies[Math.min(requests.length - 1, replies.length - 1)] ?? 'готово'
    queueMicrotask(() => {
      handlers.onSession(`sess-${requests.length}`)
      handlers.onDelta(text)
      handlers.onDone(text)
    })
    return { cancel: () => {} }
  }
}

const ciExecutor: CommandExecutor = { run: async () => ({ exitCode: 0, timedOut: false }) }

beforeEach(async () => {
  let id = 0
  requests = []
  replies = ['готово']
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => Date.now() })
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-cii-${Date.now()}`) }),
    db, sessionSecret: SECRET, ciExecutor, claude: fakeClaude, codex: fakeClaude
  })
  admin = signToken({ name: 'admin', role: 'admin' }, SECRET)
})
afterEach(async () => { await app.close(); db.close() })

const inj = (opts: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: object }) =>
  app.inject({ ...opts, headers: { authorization: `Bearer ${admin}` } })

function setup(): { projectId: string; taskId: string } {
  const project = db.createProject('admin', { name: 'P', gitUrl: 'git@github.com:x/y.git' })
  const agent = db.createAgent('admin', 'M')
  db.linkMachine('admin', project.id, agent.id)
  db.setProjectMachineReposRoot('admin', project.id, agent.id, '/repos')
  db.setProjectDefaultMachine('admin', project.id, agent.id)
  db.setUserProjectDefaultMachine('admin', project.id, agent.id)
  const board = db.getBoard('admin', project.id)!
  const ready = board.columns.find((c) => c.semanticType === 'ready')!
  const task = db.createTask('admin', project.id, { columnId: ready.id, title: 'T1' })!
  return { projectId: project.id, taskId: task.id }
}

async function startRun(projectId: string, taskId: string, payload?: object): Promise<string> {
  const res = await inj({ method: 'POST', url: `/api/projects/${projectId}/tasks/${taskId}/ci/run`, payload })
  expect(res.statusCode).toBe(202)
  return res.json().id as string
}

/** Дождаться, пока ран встанет на паузу, и вернуть pending-интеракцию. */
async function waitPending(runId: string): Promise<{ id: string; kind: string; planText: string | null; conversationId: string | null }> {
  for (let i = 0; i < 200; i++) {
    const d = (await inj({ method: 'GET', url: `/api/ci/runs/${runId}` })).json()
    const pending = (d.interactions ?? []).find((x: { status: string }) => x.status === 'pending')
    if (pending && d.run.status === 'awaiting_input') return pending
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('пауза не наступила')
}

async function waitTerminal(runId: string): Promise<{ run: { status: string }; steps: Array<{ kind: string; status: string; title: string }> }> {
  for (let i = 0; i < 300; i++) {
    const d = (await inj({ method: 'GET', url: `/api/ci/runs/${runId}` })).json()
    if (['success', 'failed', 'cancelled', 'timeout'].includes(d.run.status)) return d
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('ран не завершился')
}

describe('уточняющие вопросы модели', () => {
  it('ставит ран на паузу, дублирует вопрос в связанный чат и продолжает диалог по sessionId', async () => {
    const { projectId, taskId } = setup()
    replies = [`Нужно уточнить.\n\n${QUESTION_BLOCK}`, 'реализовано']
    const runId = await startRun(projectId, taskId)

    const pending = await waitPending(runId)
    expect(pending.kind).toBe('clarify')

    // Вопрос виден в связанном чате как обычное AI-сообщение с блоком questions.
    expect(pending.conversationId).toBeTruthy()
    const chat = (await inj({ method: 'GET', url: `/api/conversations/${pending.conversationId}` })).json()
    const asked = chat.messages.find((m: { role: string }) => m.role === 'ai')
    expect(asked.text).toContain('```questions')
    expect(asked.meta.ciInteraction).toEqual({ runId, interactionId: pending.id })

    const ans = await inj({ method: 'POST', url: `/api/ci/runs/${runId}/interactions/${pending.id}`, payload: { text: 'SQLite' } })
    expect(ans.statusCode).toBe(200)

    const detail = await waitTerminal(runId)
    expect(detail.run.status).toBe('success')
    // Второй ход продолжает ту же сессию CLI и несёт ответ пользователя.
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(requests[0].sessionId).toBeNull()
    expect(requests[1].sessionId).toBe('sess-1')
    expect(requests[1].prompt).toContain('SQLite')
    // Ответ продублирован в чат репликой пользователя.
    const chat2 = (await inj({ method: 'GET', url: `/api/conversations/${pending.conversationId}` })).json()
    expect(chat2.messages.some((m: { role: string; text: string }) => m.role === 'u1' && m.text === 'SQLite')).toBe(true)
  })

  it('повторный ответ отклоняется — побеждает первый (лента vs чат)', async () => {
    const { projectId, taskId } = setup()
    replies = [`Нужно уточнить.\n\n${QUESTION_BLOCK}`, 'реализовано']
    const runId = await startRun(projectId, taskId)
    const pending = await waitPending(runId)

    const first = await inj({ method: 'POST', url: `/api/ci/runs/${runId}/interactions/${pending.id}`, payload: { text: 'SQLite' } })
    const second = await inj({ method: 'POST', url: `/api/ci/runs/${runId}/interactions/${pending.id}`, payload: { text: 'Postgres' } })
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(409)
    await waitTerminal(runId)
  })

  it('степень уточнения «без вопросов» не даёт хинта и не тормозит ран', async () => {
    const { projectId, taskId } = setup()
    db.setCiLlmConfig('project', projectId, { provider: 'claude', model: 'sonnet', mode: 'development', clarifyLevel: 'none', clarifyMax: 3 })
    replies = [`Нужно уточнить.\n\n${QUESTION_BLOCK}`]
    const runId = await startRun(projectId, taskId)

    const detail = await waitTerminal(runId)
    expect(detail.run.status).toBe('success')
    expect(requests[0].prompt).not.toContain('```questions')
    expect(db.listCiInteractions(runId)).toHaveLength(0)
  })

  it('бюджет ограничивает число пауз', async () => {
    const { projectId, taskId } = setup()
    // Уровень few = 3 вопроса; модель спрашивает по одному и никогда не замолкает.
    replies = [`?\n\n${QUESTION_BLOCK}`]
    const runId = await startRun(projectId, taskId)
    for (let i = 0; i < 3; i++) {
      const p = await waitPending(runId)
      await inj({ method: 'POST', url: `/api/ci/runs/${runId}/interactions/${p.id}`, payload: { text: `ответ ${i}` } })
    }
    const detail = await waitTerminal(runId)
    expect(detail.run.status).toBe('success')
    expect(db.listCiInteractions(runId)).toHaveLength(3)
  })
})

describe('гейт одобрения плана', () => {
  it('план ждёт одобрения, затем тот же ран продолжает разработкой', async () => {
    const { projectId, taskId } = setup()
    db.setCiLlmConfig('project', projectId, { provider: 'claude', model: 'sonnet', mode: 'plan', clarifyLevel: 'none', clarifyMax: 3 })
    replies = ['План: 1) сделать 2) проверить', 'реализовано']
    const runId = await startRun(projectId, taskId)

    const pending = await waitPending(runId)
    expect(pending.kind).toBe('plan_approval')
    expect(pending.planText).toContain('План:')
    // Планирование — не CLI-режим `plan` (он глушит remote MCP), а `default` с
    // remote-bash только на чтение: иначе модель не видит рабочую копию.
    expect(requests[0].permissionMode).toBe('default')
    expect(requests[0].readOnlyRemote).toBe(true)

    await inj({ method: 'POST', url: `/api/ci/runs/${runId}/interactions/${pending.id}`, payload: { decision: 'approved' } })
    const detail = await waitTerminal(runId)
    expect(detail.run.status).toBe('success')
    // После одобрения — тот же диалог, но уже с правом править файлы.
    expect(requests[1].sessionId).toBe('sess-1')
    expect(requests[1].permissionMode).toBe('acceptEdits')
    expect(detail.steps.some((st) => st.kind === 'model_summary' && st.status === 'success')).toBe(true)
  })

  it('доработка плана возвращает модель в режим планирования с комментарием', async () => {
    const { projectId, taskId } = setup()
    db.setCiLlmConfig('project', projectId, { provider: 'claude', model: 'sonnet', mode: 'plan', clarifyLevel: 'none', clarifyMax: 3 })
    replies = ['План v1', 'План v2', 'реализовано']
    const runId = await startRun(projectId, taskId)

    const first = await waitPending(runId)
    await inj({ method: 'POST', url: `/api/ci/runs/${runId}/interactions/${first.id}`, payload: { decision: 'rework', text: 'учти миграции' } })
    const second = await waitPending(runId)
    expect(second.planText).toBe('План v2')
    expect(requests[1].permissionMode).toBe('default')
    expect(requests[1].readOnlyRemote).toBe(true)
    expect(requests[1].prompt).toContain('учти миграции')

    await inj({ method: 'POST', url: `/api/ci/runs/${runId}/interactions/${second.id}`, payload: { decision: 'approved' } })
    expect((await waitTerminal(runId)).run.status).toBe('success')
  })

  it('отклонение плана останавливает ран, слот «после» не запускается', async () => {
    const { projectId, taskId } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId, name: 'after', script: 'echo after', availableToModel: false })
    db.setCiSlotCommands('project', projectId, 'after_model', [cmd.id])
    db.setCiLlmConfig('project', projectId, { provider: 'claude', model: 'sonnet', mode: 'plan', clarifyLevel: 'none', clarifyMax: 3 })
    replies = ['План v1']
    const runId = await startRun(projectId, taskId)

    const pending = await waitPending(runId)
    // Отмена рана снимает паузу без ответа.
    await inj({ method: 'POST', url: `/api/ci/runs/${runId}/cancel` })
    const detail = await waitTerminal(runId)
    expect(detail.run.status).toBe('cancelled')
    expect(detail.steps.some((st) => st.kind === 'command' && st.title === 'after')).toBe(false)
    expect(db.getCiInteraction(pending.id)?.status).toBe('cancelled')
  })

  it('разовый оверрайд режима в запросе перебивает настройку задачи', async () => {
    const { projectId, taskId } = setup()
    db.setCiLlmConfig('project', projectId, { provider: 'claude', model: 'sonnet', mode: 'development', clarifyLevel: 'none', clarifyMax: 3 })
    replies = ['План v1', 'реализовано']
    const runId = await startRun(projectId, taskId, { mode: 'plan' })
    const pending = await waitPending(runId)
    expect(pending.kind).toBe('plan_approval')
    await inj({ method: 'POST', url: `/api/ci/runs/${runId}/interactions/${pending.id}`, payload: { decision: 'approved' } })
    expect((await waitTerminal(runId)).run.status).toBe('success')
  })
})

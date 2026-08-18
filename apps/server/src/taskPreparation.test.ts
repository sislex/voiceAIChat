// Этап «Подготовка к разработке»: движок и модель берутся из настроек, а CLI
// запускается в профиле нажавшего кнопку. Клиенты обоих движков — фейковые:
// реальный CLI в тестах не стартует.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer, taskPreparationFailure, taskPreparationModel } from './server.js'
import { loadConfig } from './config.js'
import { VoiceChatDb } from './db/database.js'
import { signToken } from './users/accounts.js'
import { DEFAULT_CODEX_MODEL, DEFAULT_SETTINGS, type Board, type LlmClient, type LlmHandle, type LlmRequest, type ProjectDetail, type Task, type TaskPreparationRun } from '@voicechat/shared'

const SECRET = 'test-secret'

const READINESS = JSON.stringify({
  functionalRequirements: 'Подробные требования',
  acceptanceCriteria: '1. Первый критерий',
  testCases: [{
    id: 'TC-1', title: 'Сценарий', description: 'Цель', preconditions: 'Вошли в приложение',
    testData: 'Фикстура', steps: 'Открыть карточку', expectedResult: 'Карточка открыта',
    required: true, testType: 'manual', automatable: false, automationLinks: [],
    notAutomatedReason: '', alternativeManualVerification: '', comments: ''
  }],
  uiImpact: 'none',
  affectedComponents: [],
  acceptanceCriteriaConflict: false
})

/** Что фейковый CLI сделает на очередном ходе: ответить текстом, упасть или молчать. */
type Answer = { text: string } | { error: string } | { silent: true }

let app: FastifyInstance
let db: VoiceChatDb
let adminTok: string
let bobTok: string
let claudeCalls: LlmRequest[]
let codexCalls: LlmRequest[]
let cancelled: number
let claudeAnswer: (attempt: number) => Answer
let codexAnswer: (attempt: number) => Answer

function fakeCli(calls: LlmRequest[], answer: () => (attempt: number) => Answer): LlmClient {
  return {
    send(req: LlmRequest, handlers): LlmHandle {
      calls.push(req)
      const attempt = calls.length
      const reply = answer()(attempt)
      const timer = setTimeout(() => {
        if ('error' in reply) handlers.onError(reply.error)
        else if ('text' in reply) handlers.onDone(reply.text)
      }, 0)
      return { cancel: () => { cancelled++; clearTimeout(timer) } }
    }
  }
}

function inj(token: string, opts: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: object }) {
  return app.inject({ ...opts, headers: { authorization: `Bearer ${token}` } })
}

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.createUser('bob', '', 'developer')
  claudeCalls = []
  codexCalls = []
  cancelled = 0
  claudeAnswer = () => ({ text: READINESS })
  codexAnswer = () => ({ text: READINESS })
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-prep-${Date.now()}-${id}`) }),
    db,
    sessionSecret: SECRET,
    claude: fakeCli(claudeCalls, () => claudeAnswer),
    codex: fakeCli(codexCalls, () => codexAnswer)
  })
  adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
  bobTok = signToken({ name: 'bob', role: 'developer' }, SECRET)
})

afterEach(async () => {
  await app.close()
  db.close()
})

/** Проект с системным workflow, участник bob и задача в бэклоге. */
async function taskInBacklog(): Promise<{ project: ProjectDetail; task: Task; backlogId: string }> {
  const project = (await inj(adminTok, { method: 'POST', url: '/api/projects', payload: { name: 'P' } })).json() as ProjectDetail
  await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/members`, payload: { username: 'bob' } })
  const board = (await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/board` })).json() as Board
  const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
  const task = (await inj(adminTok, {
    method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: { columnId: backlog.id, title: 'Задача' }
  })).json() as Task
  return { project, task, backlogId: backlog.id }
}

async function launch(token: string, projectId: string, taskId: string, selection?: { llmEngineId?: string | null; provider: 'claude' | 'codex'; model: string }): Promise<TaskPreparationRun> {
  const res = await inj(token, { method: 'POST', url: `/api/projects/${projectId}/tasks/${taskId}/preparation/run`, payload: selection ?? {} })
  expect(res.statusCode).toBe(200)
  return res.json() as TaskPreparationRun
}

async function settled(token: string, runId: string): Promise<TaskPreparationRun> {
  for (let i = 0; i < 100; i++) {
    const run = (await inj(token, { method: 'GET', url: `/api/task-preparation/runs/${runId}` })).json() as TaskPreparationRun
    if (run.status !== 'running') return run
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('подготовка не завершилась')
}

function useCodex(userId: string): void {
  db.saveSettings(userId, { ...DEFAULT_SETTINGS, llmProvider: 'codex' })
}

describe('подготовка к разработке: движок из настроек', () => {
  it('пользователь на Codex: запрос уходит в Codex-клиент и подготовка проходит', async () => {
    const { project, task } = await taskInBacklog()
    useCodex('bob')

    const run = await settled(bobTok, (await launch(bobTok, project.id, task.id)).id)

    expect(claudeCalls).toHaveLength(0)
    expect(codexCalls).toHaveLength(1)
    // CLI работает в профиле нажавшего кнопку — иначе подготовка снова упрётся
    // в чужую авторизацию.
    expect(codexCalls[0]).toMatchObject({ userId: 'bob', model: DEFAULT_CODEX_MODEL, sessionId: null, executionDisabled: true })
    expect(run.status).toBe('success')
  })

  it('явный выбор при запуске перебивает наследование и сохраняется снимком попытки', async () => {
    const { project, task } = await taskInBacklog()
    const launched = await launch(adminTok, project.id, task.id, { provider: 'codex', model: 'gpt-5.4-mini', llmEngineId: null })
    const run = await settled(adminTok, launched.id)

    expect(claudeCalls).toHaveLength(0)
    expect(codexCalls.map((call) => call.model)).toEqual(['gpt-5.4-mini'])
    expect(run).toMatchObject({ provider: 'codex', model: 'gpt-5.4-mini', llmEngineId: null })
  })

  it('Claude без явной модели: прежний sonnet', async () => {
    const { project, task } = await taskInBacklog()

    const run = await settled(adminTok, (await launch(adminTok, project.id, task.id)).id)

    expect(codexCalls).toHaveLength(0)
    expect(claudeCalls.map((call) => call.model)).toEqual(['sonnet'])
    expect(run.status).toBe('success')
  })

  it('сброс LLM проекта и effective planning возвращаются к настройкам пользователя', async () => {
    const { project, task } = await taskInBacklog()
    useCodex('admin')
    await inj(adminTok, { method: 'PUT', url: `/api/projects/${project.id}/ci/llm`, payload: { provider: 'claude', model: 'haiku', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 } })

    const reset = await inj(adminTok, { method: 'DELETE', url: `/api/projects/${project.id}/ci/llm` })
    expect(reset.json()).toMatchObject({ config: { provider: 'codex', model: DEFAULT_CODEX_MODEL }, inherited: { provider: 'codex', model: DEFAULT_CODEX_MODEL }, overridden: false })
    const planning = await inj(adminTok, { method: 'GET', url: `/api/projects/${project.id}/tasks/${task.id}/ci/stages/planning/llm` })
    expect(planning.json()).toMatchObject({ effective: { provider: 'codex', model: DEFAULT_CODEX_MODEL } })
  })

  it('наследование: этап задачи → этап проекта → модель проекта → настройки пользователя', async () => {
    const { project, task, backlogId } = await taskInBacklog()
    useCodex('bob')
    // Успешная подготовка увозит задачу в Ready for Development, а запускать её
    // можно только из бэклога или подготовки — возвращаем карточку между шагами.
    const prepare = async (): Promise<void> => {
      await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/move`, payload: { columnId: backlogId } })
      await settled(bobTok, (await launch(bobTok, project.id, task.id)).id)
    }

    // Модель проекта перебивает настройки пользователя.
    db.setCiLlmConfig('project', project.id, { provider: 'claude', model: 'haiku', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    await prepare()
    expect(codexCalls).toHaveLength(0)
    expect(claudeCalls.map((call) => call.model)).toEqual(['haiku'])

    // Этап проекта перебивает модель проекта.
    db.setCiStageLlmConfig('project', project.id, 'planning', { provider: 'claude', model: 'fable' })
    // Этап задачи перебивает всё остальное.
    db.setCiStageLlmConfig('task', task.id, 'planning', { provider: 'codex', model: 'gpt-5.4-mini' })
    await prepare()
    expect(claudeCalls).toHaveLength(1)
    expect(codexCalls.map((call) => call.model)).toEqual(['gpt-5.4-mini'])

    db.clearCiStageLlmConfig('task', task.id, 'planning')
    await prepare()
    expect(claudeCalls.map((call) => call.model)).toEqual(['haiku', 'fable'])
  })
})

describe('подготовка к разработке: диагностика и контракт', () => {
  it('ошибка авторизации CLI называет движок и профиль пользователя', async () => {
    const { project, task } = await taskInBacklog()
    useCodex('bob')
    codexAnswer = () => ({ error: 'Failed to authenticate: OAuth session expired and could not be refreshed' })

    const run = await settled(bobTok, (await launch(bobTok, project.id, task.id)).id)

    expect(run.status).toBe('failed')
    expect(codexCalls).toHaveLength(2) // две внутренние попытки — как раньше
    expect(run.error).toContain('Codex')
    expect(run.error).toContain('bob')
    expect(run.error).toContain('не авторизован')
    expect(run.error).toContain('OAuth session expired')
    // Лента показывает, чем шла подготовка, ещё до разбора ошибки.
    expect(run.log).toContain('Движок: Codex')
    expect(run.log).toContain('CLI-профиль: bob')
  })

  it('гейт готовности и вторая попытка исправления работают как раньше', async () => {
    const { project, task } = await taskInBacklog()
    const broken = JSON.stringify({ ...JSON.parse(READINESS), acceptanceCriteria: '' })
    claudeAnswer = (attempt) => ({ text: attempt === 1 ? broken : READINESS })

    const run = await settled(adminTok, (await launch(adminTok, project.id, task.id)).id)

    expect(run.status).toBe('success')
    expect(claudeCalls).toHaveLength(2)
    expect(claudeCalls[1].prompt).toContain('missing_acceptance_criteria')
  })

  it('отмена гасит CLI и закрывает попытку', async () => {
    const { project, task } = await taskInBacklog()
    claudeAnswer = () => ({ silent: true })

    const started = await launch(adminTok, project.id, task.id)
    const cancelledRun = (await inj(adminTok, { method: 'DELETE', url: `/api/task-preparation/runs/${started.id}` })).json() as TaskPreparationRun

    expect(cancelledRun.status).toBe('cancelled')
    expect(cancelled).toBe(1)
    expect(claudeCalls).toHaveLength(1)
  })
})

describe('подготовка к разработке: выбор модели и текст ошибки', () => {
  it('модель по умолчанию зависит от движка, явная — сохраняется', () => {
    expect(taskPreparationModel('claude', '')).toBe('sonnet')
    expect(taskPreparationModel('claude', 'default')).toBe('sonnet')
    expect(taskPreparationModel('claude', 'opus[1m]')).toBe('opus[1m]')
    expect(taskPreparationModel('codex', '')).toBe(DEFAULT_CODEX_MODEL)
    expect(taskPreparationModel('codex', 'gpt-5.5')).toBe('gpt-5.5')
  })

  it('не-авторизационная ошибка остаётся сырой, но с движком и профилем', () => {
    const message = taskPreparationFailure('claude', 'admin', 'spawn claude ENOENT')
    expect(message).toContain('Claude')
    expect(message).toContain('admin')
    expect(message).toContain('spawn claude ENOENT')
    expect(message).not.toContain('не авторизован')
  })
})

describe('интерактивная попытка, события и экспорт', () => {
  it('сохраняет монотонную ленту, атомарно принимает первый ответ и продолжает ту же попытку', async () => {
    const { project, task } = await taskInBacklog()
    claudeAnswer = (attempt) => ({ text: attempt === 1 ? JSON.stringify({ question: 'Какой публичный контракт обязателен?', material: true }) : READINESS })
    const started = await launch(adminTok, project.id, task.id)
    let waiting: TaskPreparationRun | null = null
    for (let i = 0; i < 100; i++) {
      const current = (await inj(adminTok, { method: 'GET', url: `/api/task-preparation/runs/${started.id}` })).json() as TaskPreparationRun
      if (current.status === 'waiting_for_answer') { waiting = current; break }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(waiting?.questions).toHaveLength(1)
    const questionId = waiting!.questions![0].questionId
    const first = await inj(adminTok, { method: 'POST', url: `/api/task-preparation/questions/${questionId}/answer`, payload: { answer: 'REST v2' } })
    const duplicate = await inj(adminTok, { method: 'POST', url: `/api/task-preparation/questions/${questionId}/answer`, payload: { answer: 'Другое решение' } })
    expect(first.json()).toMatchObject({ accepted: true, alreadyAnswered: false })
    expect(duplicate.json()).toMatchObject({ accepted: false, alreadyAnswered: true, question: { answer: 'REST v2' } })
    const done = await settled(adminTok, started.id)
    expect(done.id).toBe(started.id)
    expect(done.events!.map((event) => event.sequence)).toEqual(done.events!.map((_event, index) => index + 1))
    expect(done.events!.some((event) => event.type === 'answer_accepted')).toBe(true)
  })

  it('редактирует секреты до хранения и экспортирует один сохранённый снимок', async () => {
    const { project, task } = await taskInBacklog()
    claudeAnswer = () => ({ error: 'Authorization: Bearer super-secret-token-value' })
    const run = await settled(adminTok, (await launch(adminTok, project.id, task.id)).id)
    expect(run.error).not.toContain('super-secret-token-value')
    const exported = await inj(adminTok, { method: 'GET', url: `/api/task-preparation/runs/${run.id}/export/json` })
    expect(exported.statusCode).toBe(200)
    expect(exported.headers['content-disposition']).toContain('preparation-attempt-1-')
    expect(exported.body).not.toContain('super-secret-token-value')
    expect(exported.json()).toMatchObject({ schemaVersion: 1, attemptId: run.id, taskId: task.id })
  })
})

describe('task-launch создаёт сразу в подготовке', () => {
  const payload = { proposalId: 'message-1:proposal-1:preparation', title: 'Новая задача', description: 'Описание', acceptanceCriteria: 'Критерий', priority: 'high', skills: ['typescript'] }

  it('находит переименованную колонку только по semantic type и идемпотентен', async () => {
    const { project } = await taskInBacklog()
    const board = db.getBoard('admin', project.id)!
    const preparation = board.columns.find((column) => column.semanticType === 'preparation')!
    db.updateColumn('admin', project.id, preparation.id, { name: 'Любое новое имя' })
    claudeAnswer = () => ({ silent: true })

    const first = await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/task-launch/preparation`, payload })
    const second = await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/task-launch/preparation`, payload })

    expect(first.statusCode).toBe(200)
    expect(second.json()).toEqual(first.json())
    const result = first.json() as { taskId: string; runId: string; status: string }
    expect(result.status).toBe('success')
    expect(db.getBoard('admin', project.id)!.tasks.find((task) => task.id === result.taskId)?.columnId).toBe(preparation.id)
    expect(db.listTaskPreparationRuns('admin', project.id, result.taskId)).toHaveLength(1)
    expect(claudeCalls).toHaveLength(1)
  })

  it('без semantic preparation возвращает ошибку конфигурации и ничего не создаёт', async () => {
    const { project } = await taskInBacklog()
    const before = db.getBoard('admin', project.id)!.tasks.length
    ;(db as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db.prepare(`DELETE FROM kanban_columns WHERE project_id=? AND semantic_type='preparation'`).run(project.id)

    const response = await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/task-launch/preparation`, payload })

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toContain('semantic type preparation')
    expect(db.getBoard('admin', project.id)!.tasks).toHaveLength(before)
  })
})

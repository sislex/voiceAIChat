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

function compatibleReadiness(): string {
  return JSON.stringify({
    ...JSON.parse(READINESS),
    schemaVersion: 2,
    goal: 'Цель', scope: ['В scope'], outOfScope: ['Вне scope'],
    businessRules: ['Правило'], errorsAndEdgeCases: [], uiStates: [],
    contractChanges: [], dataChanges: [], constraints: [], contradictions: [],
    acceptanceCriteriaItems: [{ id: 'AC-1', title: 'Критерий', precondition: 'Условие', action: 'Действие', observableResult: 'Результат' }],
    openQuestions: [], decisions: [], assumptions: [], sources: [{ id: 'kb', kind: 'knowledge', status: 'available', summary: 'Раздел БЗ прочитан', refs: ['features/task-preparation'], critical: true }, { id: 'code', kind: 'code', status: 'available', summary: 'Контракт прочитан', refs: ['packages/shared/src/qa.ts'], critical: true }]
  })
}

const READINESS = JSON.stringify({
  functionalRequirements: 'Подробные требования',
  acceptanceCriteria: '1. Первый критерий',
  testCases: [{
    id: 'TC-1', title: 'Сценарий', description: 'Цель', preconditions: 'Вошли в приложение',
    testData: 'Фикстура', steps: 'Открыть карточку', expectedResult: 'Карточка открыта',
    required: true, testType: 'regression', automatable: true, automationLinks: [],
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
  it('проект на Codex: запрос уходит в Codex-клиент и подготовка проходит', async () => {
    const { project, task } = await taskInBacklog()
    db.setCiLlmConfig('project', project.id, { provider: 'codex', model: DEFAULT_CODEX_MODEL, mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })

    const run = await settled(bobTok, (await launch(bobTok, project.id, task.id)).id)

    expect(claudeCalls).toHaveLength(0)
    expect(codexCalls).toHaveLength(1)
    // CLI работает в профиле нажавшего кнопку — иначе подготовка снова упрётся
    // в чужую авторизацию.
    expect(codexCalls[0]).toMatchObject({ userId: 'bob', model: DEFAULT_CODEX_MODEL, sessionId: null, executionDisabled: true })
    expect(run.status).toBe('success')
  })

  it('подключает БЗ и настроенную рабочую директорию машины только для чтения с явным бюджетом', async () => {
    const { project, task } = await taskInBacklog()
    const machine = db.createAgent('admin', 'Project machine')
    db.linkMachine('admin', project.id, machine.id)
    db.setProjectMachinePath('admin', project.id, machine.id, '/srv/project')

    const run = await settled(adminTok, (await launch(adminTok, project.id, task.id)).id)

    expect(run.status).toBe('success')
    expect(claudeCalls).toHaveLength(1)
    expect(claudeCalls[0]).toMatchObject({
      permissionMode: 'default',
      readOnlyRemote: true,
      remote: { agentName: 'Project machine' }
    })
    expect(claudeCalls[0].executionDisabled).toBeUndefined()
    expect(claudeCalls[0].remote?.mcpUrl).toContain(`agent=${machine.id}`)
    expect(claudeCalls[0].remote?.mcpUrl).toContain('cwd=%2Fsrv%2Fproject')
    expect(claudeCalls[0].kbMcpUrl).toContain('/mcp/kb')
    expect(claudeCalls[0].prompt).toContain('Сначала найди тему через mcp__kb__search')
    expect(claudeCalls[0].prompt).toContain('не более 12 вызовов инструментов')
    expect(claudeCalls[0].prompt).toContain('не более 8 файлов')
    expect(claudeCalls[0].prompt).toContain('любые команды, меняющие файлы')
  })

  it('без настроенной машины передаёт конкретную диагностику вместо запроса доступа', async () => {
    const { project, task } = await taskInBacklog()

    await settled(adminTok, (await launch(adminTok, project.id, task.id)).id)

    expect(claudeCalls[0]).toMatchObject({ executionDisabled: true, readOnlyRemote: true })
    expect(claudeCalls[0].prompt).toContain('в конфигурации проекта нет доступной машины с рабочей директорией')
    expect(claudeCalls[0].prompt).toContain('Не спрашивай доступ к машине или репозиторию')
  })

  it('разовый выбор при запуске не перебивает модель проекта', async () => {
    const { project, task } = await taskInBacklog()
    db.setCiLlmConfig('project', project.id, { provider: 'codex', model: 'gpt-5.6-sol', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    const launched = await launch(adminTok, project.id, task.id, { provider: 'claude', model: 'haiku', llmEngineId: null })
    const run = await settled(adminTok, launched.id)

    expect(claudeCalls).toHaveLength(0)
    expect(codexCalls.map((call) => call.model)).toEqual(['gpt-5.6-sol'])
    expect(run).toMatchObject({ provider: 'codex', model: 'gpt-5.6-sol', llmEngineId: null })
  })

  it('отклоняет недоступную проектную модель до создания попытки без скрытой подмены', async () => {
    const { project, task } = await taskInBacklog()
    db.setCiLlmConfig('project', project.id, { provider: 'codex', model: 'gpt-5.6-sol', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    db.setUserLlmAccess('bob', [{ provider: 'codex', modelId: 'gpt-5.6-sol' }])

    const response = await inj(bobTok, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/preparation/run`, payload: {} })

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toContain('Проектная модель codex:gpt-5.6-sol недоступна пользователю')
    expect(db.listTaskPreparationRuns('bob', project.id, task.id)).toHaveLength(0)
    expect(claudeCalls).toHaveLength(0)
    expect(codexCalls).toHaveLength(0)
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

  it('игнорирует настройки planning и использует модель проекта для каждой новой попытки', async () => {
    const { project, task, backlogId } = await taskInBacklog()
    useCodex('bob')
    // Успешная подготовка увозит задачу в Ready for Development, а запускать её
    // можно только из бэклога или подготовки — возвращаем карточку между шагами.
    const prepare = async (): Promise<void> => {
      await inj(adminTok, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/move`, payload: { columnId: backlogId } })
      await settled(bobTok, (await launch(bobTok, project.id, task.id)).id)
    }

    db.setCiLlmConfig('project', project.id, { provider: 'claude', model: 'haiku', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    db.setCiStageLlmConfig('project', project.id, 'planning', { provider: 'claude', model: 'fable' })
    db.setCiStageLlmConfig('task', task.id, 'planning', { provider: 'codex', model: 'gpt-5.4-mini' })
    await prepare()
    expect(codexCalls).toHaveLength(0)
    expect(claudeCalls.map((call) => call.model)).toEqual(['haiku'])

    db.setCiLlmConfig('project', project.id, { provider: 'codex', model: 'gpt-5.6-sol', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    await prepare()
    expect(codexCalls.map((call) => call.model)).toEqual(['gpt-5.6-sol'])
  })
})

describe('подготовка к разработке: диагностика и контракт', () => {
  it('ошибка авторизации CLI называет движок и профиль пользователя', async () => {
    const { project, task } = await taskInBacklog()
    db.setCiLlmConfig('project', project.id, { provider: 'codex', model: DEFAULT_CODEX_MODEL, mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
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

  it('repair-ход получает точные пути полей, если модель заменила строки массивами и объекты произвольной формой', async () => {
    const { project, task } = await taskInBacklog()
    const structurallyWrong = JSON.stringify({
      schemaVersion: 2,
      goal: 'Цель',
      scope: ['scope'],
      outOfScope: ['out'],
      functionalRequirements: ['Требование'],
      acceptanceCriteria: ['Критерий'],
      uiImpact: { kind: 'new_components' },
      affectedComponents: [{ name: 'ComponentPlayground', storybookStoryId: 'docs--playground' }],
      acceptanceCriteriaItems: [],
      testCases: [{
        id: 'TC-1', title: 'Сценарий', description: 'Цель', preconditions: ['Storybook запущен'],
        testData: { code: '<Button />' }, steps: ['Изменить код'], expectedResult: 'Preview обновлён',
        required: true, automatable: false, notAutomatedReason: null, alternativeManualVerification: null
      }],
      openQuestions: [],
      assumptions: ['Sandpack работает в браузере'],
      sources: [{ id: 'task', type: 'userRequirement' }],
      acceptanceCriteriaConflict: false
    })
    claudeAnswer = (attempt) => ({ text: attempt === 1 ? structurallyWrong : READINESS })

    const run = await settled(adminTok, (await launch(adminTok, project.id, task.id)).id)

    expect(run.status).toBe('success')
    expect(claudeCalls).toHaveLength(2)
    expect(claudeCalls[1].prompt).toContain('functionalRequirements должен быть строкой')
    expect(claudeCalls[1].prompt).toContain('testCases[0].preconditions должен быть строкой')
    expect(claudeCalls[0].prompt).toContain('Не заменяй строки массивами или объектами')
  })

  it('принимает совместимые { id, text } в строковых списках и сохраняет канонические строки', async () => {
    const { project, task } = await taskInBacklog()
    const compatible = JSON.stringify({
      ...JSON.parse(READINESS),
      schemaVersion: 2,
      goal: 'Цель',
      scope: ['В scope'],
      outOfScope: ['Вне scope'],
      businessRules: [{ id: 'BR-1', text: 'Правило' }],
      errorsAndEdgeCases: [{ id: 'ERR-1', text: 'Ошибка' }],
      uiStates: [],
      contractChanges: [],
      dataChanges: [],
      acceptanceCriteriaItems: [{ id: 'AC-1', title: 'Критерий', precondition: 'Условие', action: 'Действие', observableResult: 'Результат' }],
      constraints: [],
      contradictions: [],
      openQuestions: [],
      decisions: [],
      assumptions: [],
      sources: [{ id: 'kb', kind: 'knowledge', status: 'available', summary: 'Раздел БЗ прочитан', refs: ['features/task-preparation'], critical: true }, { id: 'code', kind: 'code', status: 'available', summary: 'Контракт прочитан', refs: ['packages/shared/src/qa.ts'], critical: true }]
    })
    claudeAnswer = () => ({ text: compatible })

    const run = await settled(adminTok, (await launch(adminTok, project.id, task.id)).id)

    expect(run.status).toBe('success')
    expect(claudeCalls).toHaveLength(1)
    expect(claudeCalls[0].prompt).toContain('Строковые списки scope, outOfScope, businessRules')
    expect(claudeCalls[0].prompt).not.toContain('Не возвращай элементы этих списков простыми строками')
    expect(run.readiness).toMatchObject({ businessRules: ['Правило'], errorsAndEdgeCases: ['Ошибка'] })
  })

  it('отклоняет объект строкового списка без непустого text и передаёт путь в repair-ход', async () => {
    const { project, task } = await taskInBacklog()
    const malformed = JSON.stringify({
      ...JSON.parse(READINESS),
      schemaVersion: 2,
      goal: 'Цель', scope: ['В scope'], outOfScope: ['Вне scope'],
      businessRules: [{ id: 'BR-1', text: '' }], errorsAndEdgeCases: [], uiStates: [],
      contractChanges: [], dataChanges: [], constraints: [], contradictions: [],
      acceptanceCriteriaItems: [{ id: 'AC-1', title: 'Критерий', precondition: 'Условие', action: 'Действие', observableResult: 'Результат' }],
      openQuestions: [], decisions: [], assumptions: [], sources: [{ id: 'kb', kind: 'knowledge', status: 'available', summary: 'Раздел БЗ прочитан', refs: ['features/task-preparation'], critical: true }, { id: 'code', kind: 'code', status: 'available', summary: 'Контракт прочитан', refs: ['packages/shared/src/qa.ts'], critical: true }]
    })
    claudeAnswer = (attempt) => ({ text: attempt === 1 ? malformed : compatibleReadiness() })

    const run = await settled(adminTok, (await launch(adminTok, project.id, task.id)).id)

    expect(run.status).toBe('success')
    expect(claudeCalls).toHaveLength(2)
    expect(claudeCalls[1].prompt).toContain('businessRules[0] должен быть непустой строкой')
  })

  it('нормализует совместимые kind и одиночный refs до общего контракта', async () => {
    const { project, task } = await taskInBacklog()
    const normalized = JSON.parse(compatibleReadiness())
    normalized.sources = [
      { id: 'kb-1', kind: 'knowledge_base', status: 'available', summary: 'БЗ', refs: 'docs/kb/features/task-preparation.md', critical: true },
      { id: 'kb-2', kind: 'knowledge-base', status: 'available', summary: 'БЗ', refs: ['kb'], critical: false },
      { id: 'kb-3', kind: 'knowledge-base-gap', status: 'absent', summary: 'Пробел', refs: 'gap', critical: false },
      { id: 'code', kind: 'code-search', status: 'available', summary: 'Код', refs: 'apps/server/src/server.ts', critical: true }
    ]
    claudeAnswer = () => ({ text: JSON.stringify(normalized) })

    const run = await settled(adminTok, (await launch(adminTok, project.id, task.id)).id)

    expect(run.status).toBe('success')
    expect(run.readiness?.sources?.map((source) => source.kind)).toEqual(['knowledge', 'knowledge', 'knowledge', 'code'])
    expect(run.readiness?.sources?.map((source) => source.refs)).toEqual([
      ['docs/kb/features/task-preparation.md'], ['kb'], ['gap'], ['apps/server/src/server.ts']
    ])
    expect(claudeCalls).toHaveLength(1)
  })

  it('после двух невалидных ответов выполняет recovery той же проектной моделью', async () => {
    const { project, task } = await taskInBacklog()
    const broken = JSON.stringify({ ...JSON.parse(compatibleReadiness()), functionalRequirements: ['сломанный тип'] })
    const recovered = JSON.parse(compatibleReadiness())
    recovered.scope.push('Усилить prompt/schema', 'Нормализовать совместимые значения', 'Добавить регрессионные тесты', 'Актуализировать БЗ')
    recovered.acceptanceCriteria += '\\n2. Дефект подготовки предотвращён проверяемыми инфраструктурными изменениями'
    recovered.acceptanceCriteriaItems.push({ id: 'AC-INFRA', title: 'Защита подготовки', precondition: 'Модель вернула совместимый вариант', action: 'Выполнена нормализация и валидация', observableResult: 'Brief проходит без повторения класса ошибки' })
    recovered.testCases.push({ ...recovered.testCases[0], id: 'TC-INFRA', title: 'Регрессия recovery' })
    db.setCiLlmConfig('project', project.id, { provider: 'codex', model: 'gpt-5.6-sol', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    codexAnswer = (attempt) => ({ text: attempt < 3 ? broken : JSON.stringify(recovered) })

    const run = await settled(adminTok, (await launch(adminTok, project.id, task.id)).id)

    expect(run.status).toBe('success')
    expect(claudeCalls).toHaveLength(0)
    expect(codexCalls).toHaveLength(3)
    expect(codexCalls.map((call) => call.model)).toEqual(['gpt-5.6-sol', 'gpt-5.6-sol', 'gpt-5.6-sol'])
    expect(codexCalls[2].prompt).toContain('Исходный ответ:')
    expect(codexCalls[2].prompt).toContain('Повторный ответ:')
    expect(codexCalls[2].prompt).toContain('functionalRequirements должен быть строкой')
    expect(codexCalls[2].prompt).toContain('kind:knowledge|hierarchy|related_tasks|code|tests|storybook')
    expect(run.readiness?.scope).toEqual(expect.arrayContaining(['Усилить prompt/schema', 'Актуализировать БЗ']))
    expect(run.events?.some((event) => event.type === 'recovery_started' && event.text.includes('codex:gpt-5.6-sol'))).toBe(true)
    expect(run.events?.some((event) => event.type === 'recovery_completed')).toBe(true)
  })

  it('ограничивает recovery одной попыткой и завершает диагностируемо без brief', async () => {
    const { project, task } = await taskInBacklog()
    const broken = JSON.stringify({ ...JSON.parse(compatibleReadiness()), functionalRequirements: ['сломанный тип'] })
    claudeAnswer = () => ({ text: broken })

    const run = await settled(adminTok, (await launch(adminTok, project.id, task.id)).id)

    expect(run.status).toBe('blocked')
    expect(claudeCalls).toHaveLength(3)
    expect(codexCalls).toHaveLength(0)
    expect(run.readiness).toBeNull()
    expect(run.error).toContain('Recovery Development Brief завершился ошибкой')
    expect(run.error).toContain('functionalRequirements должен быть строкой')
    expect(run.events?.filter((event) => event.type === 'recovery_started')).toHaveLength(1)
    expect(run.events?.filter((event) => event.type === 'recovery_failed')).toHaveLength(1)
  })

  it('не отправляет неизвестный kind в recovery и завершает с точным путём', async () => {
    const { project, task } = await taskInBacklog()
    const unknown = JSON.parse(compatibleReadiness())
    unknown.sources[0].kind = 'internet'
    claudeAnswer = () => ({ text: JSON.stringify(unknown) })

    const run = await settled(adminTok, (await launch(adminTok, project.id, task.id)).id)

    expect(run.status).toBe('blocked')
    expect(claudeCalls).toHaveLength(2)
    expect(codexCalls).toHaveLength(0)
    expect(run.error).toContain('sources[0].kind имеет недопустимое значение: internet')
    expect(run.readiness).toBeNull()
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
  it('сохраняет монотонную ленту и продолжает попытку через её LLM-снимок после смены проекта', async () => {
    const { project, task } = await taskInBacklog()
    db.setCiLlmConfig('project', project.id, { provider: 'codex', model: 'gpt-5.6-sol', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    codexAnswer = (attempt) => ({ text: attempt === 1 ? JSON.stringify({ question: 'Какой публичный контракт обязателен?', material: true }) : READINESS })
    const started = await launch(adminTok, project.id, task.id)
    let waiting: TaskPreparationRun | null = null
    for (let i = 0; i < 100; i++) {
      const current = (await inj(adminTok, { method: 'GET', url: `/api/task-preparation/runs/${started.id}` })).json() as TaskPreparationRun
      if (current.status === 'waiting_for_answer') { waiting = current; break }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(waiting?.questions).toHaveLength(1)
    expect(waiting).toMatchObject({ provider: 'codex', model: 'gpt-5.6-sol' })
    db.setCiLlmConfig('project', project.id, { provider: 'claude', model: 'haiku', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    const questionId = waiting!.questions![0].questionId
    const first = await inj(adminTok, { method: 'POST', url: `/api/task-preparation/questions/${questionId}/answer`, payload: { answer: 'REST v2' } })
    const duplicate = await inj(adminTok, { method: 'POST', url: `/api/task-preparation/questions/${questionId}/answer`, payload: { answer: 'Другое решение' } })
    expect(first.json()).toMatchObject({ accepted: true, alreadyAnswered: false })
    expect(duplicate.json()).toMatchObject({ accepted: false, alreadyAnswered: true, question: { answer: 'REST v2' } })
    const done = await settled(adminTok, started.id)
    expect(done.id).toBe(started.id)
    expect(done.events!.map((event) => event.sequence)).toEqual(done.events!.map((_event, index) => index + 1))
    expect(done.events!.some((event) => event.type === 'answer_accepted')).toBe(true)
    expect(claudeCalls).toHaveLength(0)
    expect(codexCalls.map((call) => call.model)).toEqual(['gpt-5.6-sol', 'gpt-5.6-sol'])
  })

  it('восстанавливает и дедуплицирует уведомление, хранит закрытие и убирает его после ответа', async () => {
    const { project, task } = await taskInBacklog()
    claudeAnswer = (attempt) => ({ text: attempt === 1 ? JSON.stringify({ question: 'Какой контракт выбрать?', material: true }) : READINESS })
    const started = await launch(adminTok, project.id, task.id)
    let questionId = ''
    for (let i = 0; i < 100; i++) {
      const current = (await inj(adminTok, { method: 'GET', url: `/api/task-preparation/runs/${started.id}` })).json() as TaskPreparationRun
      questionId = current.questions?.find((question) => question.status === 'open')?.questionId ?? ''
      if (questionId) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const first = await inj(adminTok, { method: 'GET', url: '/api/task-preparation/notifications' })
    const repeated = await inj(adminTok, { method: 'GET', url: '/api/task-preparation/notifications' })
    expect(first.json()).toEqual(repeated.json())
    expect(first.json()).toMatchObject([{ questionId, projectId: project.id, taskId: task.id, taskTitle: task.title, dismissedAt: null }])

    const dismissed = await inj(adminTok, { method: 'POST', url: `/api/task-preparation/notifications/${questionId}/dismiss` })
    expect(dismissed.json()).toEqual({ dismissed: true })
    expect((await inj(adminTok, { method: 'POST', url: `/api/task-preparation/notifications/${questionId}/dismiss` })).json()).toEqual({ dismissed: true })
    expect((await inj(adminTok, { method: 'GET', url: '/api/task-preparation/notifications' })).json()).toMatchObject([{ questionId, dismissedAt: expect.any(Number) }])

    await inj(adminTok, { method: 'POST', url: `/api/task-preparation/questions/${questionId}/answer`, payload: { answer: 'REST v2' } })
    expect((await inj(adminTok, { method: 'GET', url: '/api/task-preparation/notifications' })).json()).toEqual([])
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

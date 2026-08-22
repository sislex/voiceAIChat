import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { PROD_REBUILD_TASK_TITLE, VoiceChatDb } from '../db/database.js'
import { CI_KB_UPDATE_COMMAND_ID, DEFAULT_CI_STAGE_MODELS, DEFAULT_SETTINGS, issueKey } from '@voicechat/shared'
import { signToken } from '../users/accounts.js'
import type { CommandExecutor } from './types.js'
import type { LlmClient, LlmRequest } from '../claude/types.js'
import { ciToolBroker } from './ciCommandsMcp.js'

const SECRET = 'ci-secret'
let app: FastifyInstance, db: VoiceChatDb, admin: string
let scripts: string[] = []
let workdirs: string[] = []
let executorEnvs: Array<Record<string, string>> = []
let failManagedBootstrap = false
let failClaude = false
let failPush = false
/** Управляемое падение шага TOGGLE: «сломано» → «починили» между ранами. */
let failStep = false
let repoMissing = false
/** Проверка результата модели отвечает «в копии пусто» (боевой exit 70). */
let emptyModelWork = false
/** Локальные правки в рабочей копии: шаг CLONE отвечает на них exit 66, как боевой. */
let dirtyWorkspace = false
let onModelSend: (() => void) | null = null
/** Снять состояние доски ровно в момент шага (после ответа ран может успеть закончиться). */
let onExec: ((script: string) => void) | null = null
/** Задержать ответ модели: нужно тестам, которым важен ран «в работе». */
let modelGate: Promise<void> | null = null
let codexModel = ''
let modelRequests: LlmRequest[] = []

const fakeClaude: LlmClient = {
  send: (req, handlers) => {
    modelRequests.push(req)
    onModelSend?.()
    void (async () => {
      if (modelGate) await modelGate
      if (failClaude) { handlers.onError('лимит исчерпан'); return }
      // Эмуляция MCP-вызова: если модели доступна команда 'model-tool', вызываем её
      // через брокер по токену из ciMcpUrl (как реальный /mcp/ci-commands эндпоинт).
      const m = /run=([^&]+)/.exec(req.remote?.ciMcpUrl ?? '')
      if (m) {
        const entry = ciToolBroker.get(m[1])
        if (entry?.list().some((c) => c.name === 'model-tool')) await entry.invoke('model-tool')
      }
      handlers.onDelta('готово')
      handlers.onDone('готово')
    })()
    return { cancel: () => {} }
  }
}

const fakeCodex: LlmClient = {
  send: (req, handlers) => {
    modelRequests.push(req)
    onModelSend?.()
    codexModel = req.model
    queueMicrotask(() => { handlers.onDelta('готово codex'); handlers.onDone('готово codex') })
    return { cancel: () => {} }
  }
}

const counts = new Map<string, number>()
const ciExecutor: CommandExecutor = {
  run: async (req, onChunk) => {
    scripts.push(req.script)
    workdirs.push(req.workdir)
    executorEnvs.push(req.env)
    onExec?.(req.script)
    const n = (counts.get(req.script) ?? 0) + 1
    counts.set(req.script, n)
    onChunk(`run:${req.script.slice(0, 20)}\n`)
    // FLAKY падает на первом прогоне и проходит на повторе (эмуляция «исправлено моделью»).
    const flakyOk = req.script.includes('FLAKY') && n >= 2
    if (req.script === 'git rev-parse --show-toplevel >/dev/null') return { exitCode: repoMissing ? 128 : 0, timedOut: false }
    if (req.script.includes('commits=$(git log')) return { exitCode: emptyModelWork ? 70 : 0, timedOut: false }
    if (req.script === 'DIRTY') return { exitCode: 66, timedOut: false }
    if (req.script.includes('MachineStorage недоступен') && failManagedBootstrap) return { exitCode: 73, timedOut: false }
    if (req.script.includes('Рабочая копия содержит локальные изменения') && dirtyWorkspace) return { exitCode: 66, timedOut: false }
    // Боевой шаг клонирования: существующая копия с правками → exit 66.
    if (req.script === 'CLONE') return { exitCode: dirtyWorkspace ? 66 : 0, timedOut: false }
    // Падение шага «оставляет» в копии правки модели — как в реальном ране.
    if (req.script === 'TOGGLE' && failStep) { dirtyWorkspace = true; return { exitCode: 1, timedOut: false } }
    if (req.script.includes('git push')) {
      if (!failPush) onChunk(`Ветка отправлена (${'a'.repeat(40)})\n`)
      return { exitCode: failPush ? 1 : 0, timedOut: false }
    }
    const fail = req.script.includes('FAIL') || (req.script.includes('FLAKY') && !flakyOk)
    return { exitCode: fail ? 1 : 0, timedOut: false }
  }
}

beforeEach(async () => {
  let id = 0
  scripts = []
  workdirs = []
  executorEnvs = []
  failManagedBootstrap = false
  failClaude = false
  failPush = false
  failStep = false
  repoMissing = false
  emptyModelWork = false
  dirtyWorkspace = false
  onModelSend = null
  onExec = null
  modelGate = null
  codexModel = ''
  modelRequests = []
  counts.clear()
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => Date.now() })
  app = await buildServer({ config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-ci-${Date.now()}`) }), db, sessionSecret: SECRET, ciExecutor, claude: fakeClaude, codex: fakeCodex })
  admin = signToken({ name: 'admin', role: 'admin' }, SECRET)
})
afterEach(async () => { await app.close(); db.close() })

const inj = (token: string, opts: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: object }) =>
  app.inject({ ...opts, headers: { authorization: `Bearer ${token}` } })

function setup() {
  const project = db.createProject('admin', { name: 'P', gitUrl: 'git@github.com:x/y.git' })
  const agent = db.createAgent('admin', 'M')
  db.linkMachine('admin', project.id, agent.id)
  db.setProjectMachineReposRoot('admin', project.id, agent.id, '/repos')
  db.setProjectMachinePath('admin', project.id, agent.id, '/existing/project')
  db.setProjectDefaultMachine('admin', project.id, agent.id)
  db.setUserProjectDefaultMachine('admin', project.id, agent.id)
  const board = db.getBoard('admin', project.id)!
  const ready = board.columns.find((c) => c.semanticType === 'ready')!
  const task = db.createTask('admin', project.id, { columnId: ready.id, title: 'T1' })!
  return { project, task, agent, readyColId: ready.id }
}

it('каталог машин задачи объединяет личные и проектные машины без дублей', async () => {
  const { project, task } = setup()
  const personal = db.createAgent('admin', 'Личный ноутбук')
  const foreign = db.createAgent('other', 'Чужая машина')
  const response = await inj(admin, { method: 'GET', url: `/api/projects/${project.id}/tasks/${task.id}/ci/machines` })

  expect(response.statusCode).toBe(200)
  const body = response.json()
  expect(body.machines).toHaveLength(2)
  expect(body.machines).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'M', personal: true, project: true, projectDefault: true }),
    expect.objectContaining({ agentId: personal.id, name: 'Личный ноутбук', personal: true, project: false })
  ]))
  expect(body.machines.some((machine: { agentId: string }) => machine.agentId === foreign.id)).toBe(false)
})

it('задача без override использует project default, а не персональный default инициатора', async () => {
  const { project, task, agent } = setup()
  const personal = db.createAgent('admin', 'Персональная')
  db.setUserProjectDefaultMachine('admin', project.id, personal.id)

  const response = await inj(admin, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/ci/run` })
  expect(response.statusCode).toBe(202)
  expect(response.json()).toMatchObject({ agentId: agent.id, agentSelectionSource: 'project_default' })
})

async function run(projectId: string, taskId: string, payload?: object): Promise<string> {
  const res = await inj(admin, { method: 'POST', url: `/api/projects/${projectId}/tasks/${taskId}/ci/run`, ...(payload ? { payload } : {}) })
  expect(res.statusCode).toBe(202)
  return res.json().id as string
}

async function waitRun(runId: string): Promise<{ run: { status: string; taskId: string; llmProvider: string; llmModel: string }; steps: Array<{ kind: string; status: string }> }> {
  for (let i = 0; i < 100; i++) {
    const r = await inj(admin, { method: 'GET', url: `/api/ci/runs/${runId}` })
    const d = r.json()
    if (['success', 'failed', 'cancelled', 'timeout'].includes(d.run.status)) return d
    await new Promise((res) => setTimeout(res, 10))
  }
  throw new Error('run did not finish')
}

describe('ci run manager', () => {
  it('заново разрешает project default при каждом запуске задачи без override', async () => {
    const { project, task, agent } = setup()
    const second = db.createAgent('admin', 'M2')
    db.linkMachine('admin', project.id, second.id)
    db.setProjectMachineReposRoot('admin', project.id, second.id, '/repos-2')
    db.setProjectMachinePath('admin', project.id, second.id, '/existing/project-2')

    const firstId = await run(project.id, task.id)
    expect((await inj(admin, { method: 'GET', url: `/api/ci/runs/${firstId}` })).json().run.agentId).toBe(agent.id)
    await waitRun(firstId)

    db.setProjectDefaultMachine('admin', project.id, second.id)
    const secondId = await run(project.id, task.id)
    expect((await inj(admin, { method: 'GET', url: `/api/ci/runs/${secondId}` })).json().run).toMatchObject({
      agentId: second.id,
      agentSelectionSource: 'project_default'
    })
  })

  it('подготавливает отсутствующий repos_root из существующей папки проекта', async () => {
    const { project, task, agent } = setup()
    db.setProjectMachineReposRoot('admin', project.id, agent.id, '')
    const runId = await run(project.id, task.id)
    await waitRun(runId)

    expect(scripts[0]).toContain("'/existing/.npm-cache/p-1'")
    expect(workdirs[0]).toBe('/existing/project')
  })

  it('bootstrap managed workspace стартует из storage root и согласует env', async () => {
    const { project, task, agent } = setup()
    db.saveMachineStorage('admin', agent.id, '/storage', 1)

    const runId = await run(project.id, task.id)
    const detail = await waitRun(runId)

    expect(detail.run.status).toBe('success')
    const expectedRepository = `/storage/projects/${project.id}/tasks/${task.id}/environments/test/temporary/repository`
    expect(workdirs[0]).toBe('/storage')
    expect(scripts[0]).toContain(`mkdir -p '${expectedRepository}'`)
    expect(executorEnvs[0]).toMatchObject({
      REPO_ROOT: `/storage/projects/${project.id}/tasks/${task.id}/environments/test/temporary`,
      WORKSPACE: `${expectedRepository}/P-1`,
      NPM_CACHE_DIR: `/storage/projects/${project.id}/tasks/${task.id}/environments/test/temporary/.npm-cache/P-1`,
      npm_config_cache: `/storage/projects/${project.id}/tasks/${task.id}/environments/test/temporary/.npm-cache/P-1`
    })
  })

  it('managed retry переиспользует стабильный чистый checkout, а частичная структура не считается Git checkout', async () => {
    const { project, task, agent } = setup()
    db.saveMachineStorage('admin', agent.id, '/storage', 1)
    const clone = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'Клонировать репозиторий задачи', script: 'CLONE' })
    db.setCiSlotCommands('task', task.id, 'before_model', [clone.id])

    const first = await run(project.id, task.id)
    expect((await waitRun(first)).run.status).toBe('success')
    const firstWorkspace = executorEnvs[0].WORKSPACE
    scripts = []
    workdirs = []
    executorEnvs = []

    const second = await run(project.id, task.id)
    expect((await waitRun(second)).run.status).toBe('success')
    expect(executorEnvs[0].WORKSPACE).toBe(firstWorkspace)
    expect(scripts[0]).toContain('git -C')
    expect(scripts[0]).toContain('rev-parse --is-inside-work-tree')
    expect(scripts[0]).toContain('Рабочая директория не является Git-репозиторием')
    expect(scripts).toContain('CLONE')
  })

  it('dirty managed checkout останавливает ран до clone с предметной ошибкой', async () => {
    const { project, task, agent } = setup()
    db.saveMachineStorage('admin', agent.id, '/storage', 1)
    dirtyWorkspace = true

    const runId = await run(project.id, task.id)
    const detail = await waitRun(runId)

    expect(detail.run.status).toBe('failed')
    expect(scripts[0]).toContain('Рабочая копия содержит локальные изменения')
    expect(scripts).not.toContain('CLONE')
  })

  it('ошибка записи managed storage обнаруживается до clone', async () => {
    const { project, task, agent } = setup()
    db.saveMachineStorage('admin', agent.id, '/read-only', 1)
    failManagedBootstrap = true

    const runId = await run(project.id, task.id)
    const detail = await waitRun(runId)

    expect(detail.run.status).toBe('failed')
    expect(workdirs[0]).toBe('/read-only')
    expect(scripts[0]).toContain('MachineStorage недоступен для записи: /read-only')
    expect(scripts).not.toContain('CLONE')
  })

  it('при запуске переносит карточку в development и наследует модель проекта', async () => {
    const { project, task } = setup()
    db.saveSettings('admin', { ...DEFAULT_SETTINGS, llmProvider: 'codex', codexModel: 'gpt-5.6-luna' })
    // Модель проекта — третий уровень после настроек этапа задачи и проекта.
    db.setCiLlmConfig('project', project.id, { provider: 'claude', model: 'opus', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    // Колонку снимаем в момент запроса к модели: к концу успешного рана карточка
    // уходит в «Ожидает мержа», и проверка после `waitRun` ловила бы уже её.
    let columnAtModel: string | null = null
    onModelSend = () => { if (columnAtModel === null) columnAtModel = db.getBoard('admin', project.id)!.tasks.find((t) => t.id === task.id)!.columnId }
    const runId = await run(project.id, task.id)
    const detail = await waitRun(runId)
    const development = db.getBoard('admin', project.id)!.columns.find((c) => c.semanticType === 'development')!
    expect(columnAtModel).toBe(development.id)
    expect(detail.run.status).toBe('success')
    expect(modelRequests[0]?.model).toBe('opus')
  })

  it('разовый выбор окна запуска фиксирует пару модели только в новом ране', async () => {
    const { project, task } = setup()
    const runId = await run(project.id, task.id, { provider: 'codex', model: 'gpt-5.6-luna' })
    const detail = await waitRun(runId)
    expect(detail.run).toMatchObject({ llmProvider: 'codex', llmModel: 'gpt-5.6-luna' })
    expect(codexModel).toBe('gpt-5.6-luna')
  })

  it('проект без явной настройки CI наследует пользовательский Claude default, резюме — на дешёвой модели', async () => {
    const { project, task } = setup()
    const runId = await run(project.id, task.id)
    const detail = await waitRun(runId)
    expect(detail.run.status).toBe('success')
    expect(detail.run.llmProvider).toBe('claude')
    expect(detail.run.llmModel).toBe(DEFAULT_SETTINGS.model)
    // Модель рана — только у разработки: резюме идёт по своей стадии.
    // Подготовка тест-кейсов теперь выполняется до development-run.
    expect(modelRequests.map((r) => r.model)).toEqual([DEFAULT_SETTINGS.model, DEFAULT_CI_STAGE_MODELS.summary])
  })

  it('DELETE ci/llm снимает переопределение задачи и возвращает наследование', async () => {
    const { project, task } = setup()
    db.setCiLlmConfig('project', project.id, { provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    await inj(admin, { method: 'PUT', url: `/api/projects/${project.id}/tasks/${task.id}/ci/llm`, payload: { provider: 'claude', model: 'haiku', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 } })
    const before = await inj(admin, { method: 'GET', url: `/api/projects/${project.id}/tasks/${task.id}/ci/llm` })
    expect(before.json()).toMatchObject({ config: { provider: 'claude', model: 'haiku', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 }, overridden: true })

    const res = await inj(admin, { method: 'DELETE', url: `/api/projects/${project.id}/tasks/${task.id}/ci/llm` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      config: { provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 },
      overridden: false,
      projectDefault: { provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 }
    })
    // настройка проекта не затронута, GET согласован с ответом DELETE
    const after = await inj(admin, { method: 'GET', url: `/api/projects/${project.id}/tasks/${task.id}/ci/llm` })
    expect(after.json()).toEqual(res.json())
  })

  it('DELETE ci/llm для несуществующей задачи → 404', async () => {
    const { project } = setup()
    const res = await inj(admin, { method: 'DELETE', url: `/api/projects/${project.id}/tasks/нет-такой/ci/llm` })
    expect(res.statusCode).toBe(404)
  })

  it('пустые слоты: ран = работа модели + резюме → success', async () => {
    const { project, task } = setup()
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('success')
    expect(d.steps.map((s) => s.kind)).toContain('model_work')
    expect(d.steps.map((s) => s.kind)).toContain('model_summary')
    const workRequest = modelRequests.find((req) => req.permissionMode === 'acceptEdits')!
    expect(workRequest.cwd).toBeUndefined()
    expect(workRequest.remote?.mcpUrl).toContain('cwd=%2Frepos%2Fp%2FP-1')
    const chat = db.getConversation('admin', db.getCiRunRaw(runId)!.conversationId!)!
    expect(chat.execTarget).toBeTruthy()
    expect(chat.workdir).toBe('/repos/p/P-1')
    // Лог рана содержит строки.
    const log = (await inj(admin, { method: 'GET', url: `/api/ci/runs/${runId}/log` })).json()
    expect(Array.isArray(log)).toBe(true)
    expect(log.length).toBeGreaterThan(0)
  })

  it('выполняет только выбранные этапы, сохраняя их относительный порядок', async () => {
    const { project, task } = setup()
    db.setTaskProcessStages(task.id, ['summary', 'model_work'])
    const runId = await run(project.id, task.id)
    const detail = await waitRun(runId)

    expect(detail.run.status).toBe('success')
    expect(detail.steps.map((step) => step.kind)).toEqual(['model_work', 'command', 'model_summary'])
    expect(detail.steps.some((step) => step.kind === 'model_summary')).toBe(true)
    expect(modelRequests).toHaveLength(2)
    expect(scripts.some((script) => script.includes('mkdir -p'))).toBe(false)
    expect(scripts.some((script) => script === 'git rev-parse --show-toplevel >/dev/null')).toBe(false)
    expect(scripts.some((script) => script.includes('git push'))).toBe(false)
  })

  it('не запускает модель и валит ран, если клон отсутствует в ожидаемой папке', async () => {
    const { project, task, readyColId } = setup()
    repoMissing = true
    const runId = await run(project.id, task.id)
    const detail = await waitRun(runId)
    expect(detail.run.status).toBe('failed')
    expect(modelRequests).toHaveLength(0)
    expect(db.getBoard('admin', project.id)!.tasks.find((item) => item.id === task.id)!.columnId).toBe(readyColId)
    const steps = db.getCiRun('admin', runId)!.steps
    expect(steps.find((step) => step.title === 'Проверка рабочей директории модели')?.status).toBe('failed')
  })

  it('резюме рана уходит отдельным сообщением в связанный чат задачи', async () => {
    const { project, task } = setup()
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('success')
    const chatId = db.getCiRunRaw(runId)!.conversationId!
    expect(chatId).toBeTruthy()
    const summary = db.listMessages('admin', chatId).find((m) => m.meta?.ciRunSummary)!
    expect(summary.role).toBe('ai')
    expect(summary.meta!.ciRunSummary).toEqual({ runId })
    // Шапка сообщения — ключ и заголовок задачи, дальше текст модели.
    expect(summary.text).toContain('Резюме по задаче P-1 · T1')
    expect(summary.text).toContain('готово')
    // Тот же текст остаётся и в ленте рана: чат её не заменяет.
    const log = (await inj(admin, { method: 'GET', url: `/api/ci/runs/${runId}/log` })).json() as Array<{ chunk: string }>
    expect(log.some((l) => l.chunk.includes('готово'))).toBe(true)
  })

  it('резюме приходит по WS сообщением chat.message — открытый чат обновляется сам', async () => {
    const { project, task } = setup()
    // Чат создаём заранее, чтобы знать его id до старта рана.
    const chat = db.openOrCreateTaskChat('admin', project.id, task.id)!
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as AddressInfo).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${admin}`)
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
    const got = new Promise<{ conversationId: string; message: { text: string } }>((resolve) => {
      ws.on('message', (d: Buffer) => {
        const m = JSON.parse(d.toString()) as { t: string; conversationId: string; message: { text: string } }
        if (m.t === 'chat.message') resolve({ conversationId: m.conversationId, message: m.message })
      })
    })
    const runId = await run(project.id, task.id)
    const pushed = await got
    expect(pushed.conversationId).toBe(chat.id)
    expect(pushed.message.text).toContain('Резюме по задаче')
    await waitRun(runId)
    ws.close()
  })

  it('WS snapshot меняет фактическую модель при переходе model_work → summary', async () => {
    const { project, task } = setup()
    db.setCiStageLlmConfig('task', task.id, 'model_work', { provider: 'codex', model: 'gpt-5.6-sol' })
    db.setCiStageLlmConfig('task', task.id, 'summary', { provider: 'claude', model: 'sonnet' })
    let releaseModel!: () => void
    modelGate = new Promise<void>((resolve) => { releaseModel = resolve })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as AddressInfo).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${admin}`)
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
    const stages: string[] = []
    const summarySeen = new Promise<void>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString()) as { t: string; detail?: { executionLlm?: { stage: string | null; model: string | null } } }
        if (message.t !== 'ci.snapshot' || !message.detail?.executionLlm?.stage) return
        stages.push(`${message.detail.executionLlm.stage}:${message.detail.executionLlm.model}`)
        if (message.detail.executionLlm.stage === 'summary') resolve()
      })
    })
    const runId = await run(project.id, task.id, { provider: 'codex', model: 'gpt-5.6-luna' })
    ws.send(JSON.stringify({ t: 'ci.subscribe', runId }))
    await vi.waitFor(() => expect(stages).toContain('model_work:gpt-5.6-sol'))
    releaseModel()
    await summarySeen
    expect(stages).toContain('summary:sonnet')
    await waitRun(runId)
    ws.close()
  })

  it('упавший слот «после»: резюме всё равно попадает в чат', async () => {
    const { project, task } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'test', script: 'FAIL test' })
    db.setCiSlotCommands('task', task.id, 'after_model', [cmd.id])
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('failed')
    const chatId = db.getCiRunRaw(runId)!.conversationId!
    expect(db.listMessages('admin', chatId).some((m) => m.meta?.ciRunSummary?.runId === runId)).toBe(true)
  })

  it('legacy kb_update из старого снимка слота не создаёт шаг development-рана', async () => {
    const { project, task } = setup()
    db.setCiSlotCommands('task', task.id, 'after_model', [CI_KB_UPDATE_COMMAND_ID])
    const runId = await run(project.id, task.id)
    const detail = await waitRun(runId)
    expect(detail.run.status).toBe('success')
    const persistedSteps = db.getCiRun('admin', runId)!.steps
    expect(persistedSteps.some((step) => step.title === 'Актуализировать базу знаний')).toBe(false)
    expect(persistedSteps.filter((step) => step.title === 'Отправить ветку задачи в origin')).toHaveLength(1)
  })

  it('падение в слоте «до» → ран failed и откат задачи в предыдущую колонку', async () => {
    const { project, task, readyColId } = setup()
    // Двигаем задачу в development, чтобы откат был виден.
    const devCol = db.getBoard('admin', project.id)!.columns.find((c) => c.semanticType === 'development')!
    db.moveTask('admin', project.id, task.id, { columnId: devCol.id })
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'clone', script: 'FAIL clone' })
    db.setCiSlotCommands('task', task.id, 'before_model', [cmd.id])
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('failed')
    // model_work НЕ должен появиться (слот «до» упал).
    expect(d.steps.map((s) => s.kind)).not.toContain('model_work')
    // Задача откатилась в колонку, где была на старте рана (development).
    const t = db.getBoard('admin', project.id)!.tasks.find((x) => x.id === task.id)!
    expect(t.columnId).toBe(devCol.id)
  })

  it('allow_failure: упавшая команда не останавливает ран', async () => {
    const { project, task } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'lint', script: 'FAIL lint', allowFailure: true })
    db.setCiSlotCommands('task', task.id, 'before_model', [cmd.id])
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('success')
  })

  it('legacy cleanup не выполняется, workspace сохраняется, branch пушится один раз', async () => {
    const { project, task } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'cleanup', script: 'rm -rf', isCleanup: true })
    db.setCiSlotCommands('task', task.id, 'after_model', [cmd.id])
    const runId = await run(project.id, task.id)
    const detail = await waitRun(runId)
    expect(detail.run.status).toBe('success')
    expect(scripts).not.toContain('rm -rf')
    expect(scripts.filter((x) => x.includes('git push origin "HEAD:refs/heads/$BRANCH"'))).toHaveLength(1)
    const persistedSteps = db.getCiRun('admin', runId)!.steps
    expect(persistedSteps.some((step) => step.title === 'cleanup')).toBe(false)
    expect(persistedSteps.filter((step) => step.title === 'Отправить ветку задачи в origin')).toHaveLength(1)
    const report = db.listCiWorkspaceReport('admin', project.id)
    expect(report.some((w) => w.state === 'active')).toBe(true)
    expect(db.findLatestPushedCiWorkspace(project.id, task.id)?.commitSha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('пуш ветки не удался → cleanup не выполняется, рабочая директория сохранена', async () => {
    const { project, task } = setup()
    failPush = true
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'cleanup', script: 'rm -rf', isCleanup: true })
    db.setCiSlotCommands('task', task.id, 'after_model', [cmd.id])
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('failed')
    expect(scripts).not.toContain('rm -rf')
    const report = db.listCiWorkspaceReport('admin', project.id)
    expect(report.some((w) => w.state === 'released')).toBe(false)
  })

  it('модель работала, а в рабочей копии пусто → ран failed, слот «после» пропущен, копия сохранена', async () => {
    const { project, task } = setup()
    emptyModelWork = true
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'cleanup', script: 'rm -rf', isCleanup: true })
    db.setCiSlotCommands('task', task.id, 'after_model', [cmd.id])
    // Вызовы инструментов считает разбор потока CLI, а фейковая модель его не
    // даёт — поднимаем счётчик рана в момент самой проверки.
    onExec = (script) => {
      if (!script.includes('commits=$(git log')) return
      const runs = db.listCiRunsForTask('admin', project.id, task.id)
      if (runs[0]) db.addCiRunToolCalls(runs[0].id, { bash: 12 })
    }
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('failed')
    // Ни пуша ветки, ни удаления копии: слот «после» не запускался вовсе.
    expect(scripts).not.toContain('rm -rf')
    expect(db.listCiWorkspaceReport('admin', project.id).some((w) => w.state === 'released')).toBe(false)
    const steps = db.getCiRun('admin', runId)!.steps
    expect(steps.find((s) => s.title === 'Проверка результата модели')?.status).toBe('failed')
    expect(new Set(steps.map((s) => s.position)).size).toBe(steps.length)
    // Карточка осталась в рабочей колонке, а не уехала в «Готово»/«Ожидает мержа».
    const board = db.getBoard('admin', project.id)!
    const development = board.columns.find((c) => c.semanticType === 'development')!
    expect(board.tasks.find((t) => t.id === task.id)!.columnId).toBe(development.id)
    // Причина доезжает до чата отдельной строкой резюме, а не только в ленту.
    const chatId = db.getCiRunRaw(runId)!.conversationId!
    const summary = db.listMessages('admin', chatId).find((m) => m.meta?.ciRunSummary?.runId === runId)!
    expect(summary.text).toContain('Работа не сдана')
  })

  it('модель не вызывала инструменты — пустая рабочая копия ран не валит', async () => {
    const { project, task } = setup()
    emptyModelWork = true
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('success')
    const steps = db.getCiRun('admin', runId)!.steps
    expect(steps.find((s) => s.title === 'Проверка результата модели')?.status).toBe('success')
  })

  it('пока модель разбирается с упавшим шагом, в прогрессе рана поднят fixing', async () => {
    const { project, task } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'build', script: 'FLAKY build' })
    db.setCiSlotCommands('task', task.id, 'after_model', [cmd.id])
    // Снимок сводки доски на каждый запрос к модели: первый — работа, второй — fix-loop.
    const fixingSeen: boolean[] = []
    onModelSend = () => {
      const summary = db.latestCiRunSummaries(project.id)[0]
      if (summary) fixingSeen.push(summary.slotProgress.fixing === true)
    }
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('success')
    expect(fixingSeen[0]).toBe(false)
    expect(fixingSeen).toContain(true)
    // После fix-loop флаг снят — карточка снова «голубая».
    expect(db.getCiRunRaw(runId)!.slotProgress.fixing).toBe(false)
  })

  it('ready → development автоматически создаёт один queued development-run и возвращает его id', async () => {
    const { project, task, readyColId } = setup()
    const board = db.getBoard('admin', project.id)!
    const development = board.columns.find((column) => column.semanticType === 'development')!
    let release: () => void = () => {}
    modelGate = new Promise<void>((resolve) => { release = resolve })

    const [first, second] = await Promise.all([
      inj(admin, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/move`, payload: { columnId: development.id, fromColumnId: readyColId } }),
      inj(admin, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/move`, payload: { columnId: development.id, fromColumnId: readyColId } })
    ])

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(first.headers['x-ci-run-id']).toBeTruthy()
    expect(second.headers['x-ci-run-id']).toBe(first.headers['x-ci-run-id'])
    expect(db.listCiRunsForTask('admin', project.id, task.id)).toHaveLength(1)
    expect(db.getBoard('admin', project.id)!.tasks.find((item) => item.id === task.id)!.columnId).toBe(development.id)
    expect(db.getCiRunRaw(first.headers['x-ci-run-id'] as string)?.prevColumnId).toBe(readyColId)

    release()
    await waitRun(first.headers['x-ci-run-id'] as string)
  })

  it('ошибка автозапуска оставляет карточку в ready, а прочие переходы в development не создают ран', async () => {
    const project = db.createProject('admin', { name: 'Без машины', gitUrl: 'git@github.com:x/y.git' })
    const board = db.getBoard('admin', project.id)!
    const ready = board.columns.find((column) => column.semanticType === 'ready')!
    const development = board.columns.find((column) => column.semanticType === 'development')!
    const task = db.createTask('admin', project.id, { columnId: ready.id, title: 'T без машины' })!
    const readyColId = ready.id

    const failed = await inj(admin, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/move`, payload: { columnId: development.id } })
    expect(failed.statusCode).toBe(409)
    expect(failed.json().error).toContain('машина')
    expect(db.getBoard('admin', project.id)!.tasks.find((item) => item.id === task.id)!.columnId).toBe(readyColId)
    expect(db.listCiRunsForTask('admin', project.id, task.id)).toHaveLength(0)

    const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
    db.moveTask('admin', project.id, task.id, { columnId: backlog.id })
    const ordinary = await inj(admin, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/move`, payload: { columnId: development.id } })
    expect(ordinary.statusCode).toBe(200)
    expect(db.listCiRunsForTask('admin', project.id, task.id)).toHaveLength(0)
    const reorder = await inj(admin, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/move`, payload: { columnId: development.id } })
    expect(reorder.statusCode).toBe(200)
    expect(db.listCiRunsForTask('admin', project.id, task.id)).toHaveLength(0)
  })

  it('второй запуск той же задачи отклоняется 409, пока первый не закончился', async () => {
    const { project, task } = setup()
    // Держим первый ран на работе модели: пока он активен, задача занята.
    let release: () => void = () => {}
    modelGate = new Promise<void>((res) => { release = res })
    const r1 = await run(project.id, task.id)
    for (let i = 0; i < 200 && !modelRequests.length; i++) await new Promise((res) => setTimeout(res, 5))

    const second = await inj(admin, { method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/ci/run` })
    expect(second.statusCode).toBe(409)
    expect(second.json().error).toContain('уже выполняется')
    // Ран у задачи ровно один — второй даже не создался.
    expect(db.latestCiRunSummaries(project.id).filter((x) => x.taskId === task.id)).toHaveLength(1)

    release()
    expect((await waitRun(r1)).run.status).toBe('success')
    // Задача освободилась — запускать снова можно.
    const r2 = await run(project.id, task.id)
    expect((await waitRun(r2)).run.status).toBe('success')
  })
  it('перенос из development в TODO снимает ожидающий ран, но не прячет уже запущенный', async () => {
    const { project, task } = setup()
    const board = db.getBoard('admin', project.id)!
    const todo = board.columns.find((column) => column.semanticType === 'backlog')!
    const ready = board.columns.find((column) => column.semanticType === 'ready')!
    const queuedTask = db.createTask('admin', project.id, { columnId: ready.id, title: 'В очереди' })!
    const plainTask = db.createTask('admin', project.id, { columnId: ready.id, title: 'Без рана' })!
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    let release: () => void = () => {}
    modelGate = new Promise<void>((res) => { release = res })

    const runningRun = await run(project.id, task.id)
    for (let i = 0; i < 200 && !modelRequests.length; i++) await new Promise((res) => setTimeout(res, 5))
    const queuedRun = await run(project.id, queuedTask.id)
    expect(db.getCiRunRaw(queuedRun)!.status).toBe('queued')

    const dequeueByMove = await inj(admin, {
      method: 'POST',
      url: `/api/projects/${project.id}/tasks/${queuedTask.id}/move`,
      payload: { columnId: todo.id }
    })
    expect(dequeueByMove.statusCode).toBe(200)
    expect(db.getCiRunRaw(queuedRun)!.status).toBe('cancelled')
    expect(db.getCiRun('admin', queuedRun)!.steps).toEqual([])
    expect(db.getBoard('admin', project.id)!.tasks.find((item) => item.id === queuedTask.id)!.columnId).toBe(todo.id)

    const runningByMove = await inj(admin, {
      method: 'POST',
      url: `/api/projects/${project.id}/tasks/${task.id}/move`,
      payload: { columnId: todo.id }
    })
    expect(runningByMove.statusCode).toBe(409)
    expect(runningByMove.json().error).toContain('сначала остановите')
    expect(db.getBoard('admin', project.id)!.tasks.find((item) => item.id === task.id)!.columnId).not.toBe(todo.id)

    db.moveTask('admin', project.id, plainTask.id, { columnId: board.columns.find((column) => column.semanticType === 'development')!.id })
    const plainMove = await inj(admin, {
      method: 'POST',
      url: `/api/projects/${project.id}/tasks/${plainTask.id}/move`,
      payload: { columnId: todo.id }
    })
    expect(plainMove.statusCode).toBe(200)
    expect(db.getBoard('admin', project.id)!.tasks.find((item) => item.id === plainTask.id)!.columnId).toBe(todo.id)

    release()
    expect((await waitRun(runningRun)).run.status).toBe('success')
  })

  it('fix-loop: модель чинит упавший шаг → ран success, зафиксирована попытка', async () => {
    const { project, task } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'build', script: 'FLAKY build' })
    db.setCiSlotCommands('task', task.id, 'after_model', [cmd.id])
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('success')
    const detail = db.getCiRun('admin', runId)!
    expect(detail.fixAttempts.length).toBeGreaterThanOrEqual(1)
    expect(detail.fixAttempts.some((f) => f.result === 'fixed')).toBe(true)
  })

  it('исчерпание max_fix_attempts → ран failed и откат задачи', async () => {
    const { project, task } = setup()
    db.updateCiSettings({ maxFixAttempts: 1 })
    const devCol = db.getBoard('admin', project.id)!.columns.find((c) => c.semanticType === 'development')!
    db.moveTask('admin', project.id, task.id, { columnId: devCol.id })
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'clone', script: 'FAIL clone' })
    db.setCiSlotCommands('task', task.id, 'before_model', [cmd.id])
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('failed')
    const detail = db.getCiRun('admin', runId)!
    expect(detail.fixAttempts.some((f) => f.result === 'gave_up')).toBe(true)
    const t = db.getBoard('admin', project.id)!.tasks.find((x) => x.id === task.id)!
    expect(t.columnId).toBe(devCol.id)
  })
  it('успешный development-run переводит карточку в Component QA', async () => {
    const { project, task } = setup()
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('success')
    const board = db.getBoard('admin', project.id)!
    const manualQa = board.columns.find((c) => c.semanticType === 'component_qa')!
    expect(board.tasks.find((t) => t.id === task.id)!.columnId).toBe(manualQa.id)
    // Причина переноса видна в ленте рана.
    const log = (await inj(admin, { method: 'GET', url: `/api/ci/runs/${runId}/log` })).json() as Array<{ chunk: string }>
    expect(log.some((l) => l.chunk.includes('Component QA'))).toBe(true)
  })

  it.skip('legacy: merge выполнялся внутри разработки', async () => {
    const { project, task } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'Влить ветку задачи в прод-ветку', script: 'git merge --no-edit "$BRANCH"' })
    db.setCiSlotCommands('task', task.id, 'after_model', [cmd.id])
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('success')
    const board = db.getBoard('admin', project.id)!
    const done = board.columns.find((c) => c.semanticType === 'done')!
    expect(board.tasks.find((t) => t.id === task.id)!.columnId).toBe(done.id)
    // Перенос ровно один: карточка не заезжает сначала в «Ожидает мержа».
    const log = (await inj(admin, { method: 'GET', url: `/api/ci/runs/${runId}/log` })).json() as Array<{ chunk: string }>
    expect(log.some((l) => l.chunk.includes('переехала в «Готово»'))).toBe(true)
    expect(log.some((l) => l.chunk.includes('ждёт мержа'))).toBe(false)
    // Резюме записано ДО переноса — иначе оно ушло бы в скрытый чат завершённой задачи.
    const chatId = db.getCiRunRaw(runId)!.conversationId!
    expect(db.listMessages('admin', chatId).some((m) => m.meta?.ciRunSummary)).toBe(true)
  })

  it.skip('legacy: отсутствие done при merge внутри разработки', async () => {
    const { project, task } = setup()
    const devCol = db.getBoard('admin', project.id)!.columns.find((c) => c.semanticType === 'development')!
    const real = db.getColumnIdBySemantic.bind(db)
    const spy = vi.spyOn(db, 'getColumnIdBySemantic').mockImplementation((pid, semantic) => (semantic === 'done' ? null : real(pid, semantic)))
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'Влить ветку задачи в прод-ветку', script: 'git merge --no-edit "$BRANCH"' })
    db.setCiSlotCommands('task', task.id, 'after_model', [cmd.id])
    const d = await waitRun(await run(project.id, task.id))
    expect(d.run.status).toBe('success')
    expect(db.getBoard('admin', project.id)!.tasks.find((t) => t.id === task.id)!.columnId).toBe(devCol.id)
    spy.mockRestore()
  })

  it.skip('legacy: падение merge внутри разработки', async () => {
    const { project, task, readyColId } = setup()
    db.updateCiSettings({ maxFixAttempts: 1 })
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'Влить ветку задачи в прод-ветку', script: 'FAIL git merge --no-edit' })
    db.setCiSlotCommands('task', task.id, 'after_model', [cmd.id])
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('failed')
    expect(db.getBoard('admin', project.id)!.tasks.find((t) => t.id === task.id)!.columnId).toBe(readyColId)
  })

  it('нет колонки qa_preparation в проекте — ран success и карточка не двигается', async () => {
    const { project, task } = setup()
    const real = db.getColumnIdBySemantic.bind(db)
    const spy = vi.spyOn(db, 'getColumnIdBySemantic').mockImplementation((pid, semantic) => (semantic === 'component_qa' ? null : real(pid, semantic)))
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('success')
    const board = db.getBoard('admin', project.id)!
    const development = board.columns.find((c) => c.semanticType === 'development')!
    expect(board.tasks.find((t) => t.id === task.id)!.columnId).toBe(development.id)
    spy.mockRestore()
  })

  it('консоль: read-only пропускает ls и отклоняет rm', async () => {
    const { project, task } = setup()
    const runId = await run(project.id, task.id)
    await waitRun(runId)
    const ok = await inj(admin, { method: 'POST', url: `/api/ci/runs/${runId}/console`, payload: { command: 'ls -la' } })
    expect(ok.json().rejected).toBe(false)
    const denied = await inj(admin, { method: 'POST', url: `/api/ci/runs/${runId}/console`, payload: { command: 'rm -rf /' } })
    expect(denied.json().rejected).toBe(true)
  })

  it('dirty workspace: по подтверждению сбрасывает файлы и запускает новый полный ран', async () => {
    const { project, task } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'checkout', script: 'DIRTY' })
    db.setCiSlotCommands('task', task.id, 'before_model', [cmd.id])
    const runId = await run(project.id, task.id)
    const failed = await waitRun(runId)
    expect(failed.run.status).toBe('failed')
    const response = await inj(admin, { method: 'POST', url: `/api/ci/runs/${runId}/discard-and-retry` })
    expect(response.statusCode).toBe(202)
    expect(response.json().id).not.toBe(runId)
    expect(scripts.some((script) => script.includes('reset --hard HEAD') && script.includes('clean -fdx'))).toBe(true)
  })

  it('ошибка модели останавливает after-слот; выбор другой модели продолжает с model_work', async () => {
    const { project, task } = setup()
    const before = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'prepare', script: 'PREPARE' })
    const after = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'tests', script: 'TESTS' })
    db.setCiSlotCommands('task', task.id, 'before_model', [before.id])
    db.setCiSlotCommands('task', task.id, 'after_model', [after.id])
    failClaude = true
    const runId = await run(project.id, task.id)
    const failed = await waitRun(runId)
    expect(failed.run.status).toBe('failed')
    expect(scripts).toEqual(expect.arrayContaining(['PREPARE']))
    expect(scripts).not.toContain('TESTS')
    expect(failed.steps.some((s) => s.kind === 'model_summary')).toBe(false)

    failClaude = false
    const retry = await inj(admin, { method: 'POST', url: `/api/ci/runs/${runId}/retry-from-step`, payload: { provider: 'codex', model: '', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 } })
    expect(retry.statusCode).toBe(202)
    const done = await waitRun(runId)
    expect(done.run.status).toBe('success')
    expect(scripts.filter((x) => x === 'PREPARE')).toHaveLength(1)
    expect(scripts).toContain('TESTS')
    expect(codexModel).toBe('')
    expect(db.getCiRunRaw(runId)).toMatchObject({ llmProvider: 'codex', llmModel: '' })
  })

  it('модель вызывает команду справочника как MCP-инструмент → вложенный шаг model_command', async () => {
    const { project, task } = setup()
    // Команда доступна модели, но НЕ привязана к слотам (вызывается самой моделью).
    db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'model-tool', script: 'echo tool', availableToModel: true })
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('success')
    const detail = db.getCiRun('admin', runId)!
    const modelWork = detail.steps.find((s) => s.kind === 'model_work')!
    const nested = detail.steps.find((s) => s.kind === 'model_command' && s.parentStepId === modelWork.id)
    expect(nested).toBeTruthy()
    expect(nested!.title).toBe('model-tool')
  })
  it('повтор с упавшего шага: тот же ран возобновляется, успешный шаг не перезапускается', async () => {
    const { project, task } = setup()
    db.updateCiSettings({ maxFixAttempts: 0 }) // без авто-фикса — чтобы ран упал
    const ok = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'ok', script: 'echo ok' })
    const flaky = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'flaky', script: 'FLAKY build' })
    db.setCiSlotCommands('task', task.id, 'before_model', [ok.id, flaky.id])
    const runId = await run(project.id, task.id)
    const d1 = await waitRun(runId)
    expect(d1.run.status).toBe('failed')
    expect(scripts.filter((x) => x === 'echo ok').length).toBe(1)
    // Повтор с упавшего шага — тот же runId.
    const res = await inj(admin, { method: 'POST', url: `/api/ci/runs/${runId}/retry-from-step` })
    expect(res.statusCode).toBe(202)
    expect(res.json().id).toBe(runId)
    const d2 = await waitRun(runId)
    expect(d2.run.status).toBe('success')
    // Успешный шаг «echo ok» НЕ перезапускался (по-прежнему один вызов).
    expect(scripts.filter((x) => x === 'echo ok').length).toBe(1)
    // FLAKY выполнялся дважды (упал, затем прошёл на повторе).
    expect(scripts.filter((x) => x === 'FLAKY build').length).toBe(2)
  })
  // --- Автозадача «Пересборка прода» (мерж в прод-ветку без пересборки прода) ---

  /** Команда мержа ветки задачи в прод-ветку (шаг раннер узнаёт по названию/скрипту). */
  const mergeCommand = (projectId: string) =>
    db.createCiCommand('admin', { scope: 'project', projectId, name: 'Влить ветку задачи в прод-ветку', script: 'git merge --no-edit "$BRANCH"' })
  const openRebuildTasks = (projectId: string) => {
    const board = db.getBoard('admin', projectId)!
    const done = board.columns.find((c) => c.semanticType === 'done')!
    return board.tasks.filter((t) => t.title === PROD_REBUILD_TASK_TITLE && t.columnId !== done.id)
  }

  it.skip('legacy: разработка сама заводила задачу пересборки прода', async () => {
    const { project, task, readyColId } = setup()
    const merge = mergeCommand(project.id)
    db.setCiSlotCommands('project', project.id, 'after_model', [merge.id])
    const second = db.createTask('admin', project.id, { columnId: readyColId, title: 'T2' })!

    const firstRun = await run(project.id, task.id)
    expect((await waitRun(firstRun)).run.status).toBe('success')
    expect((await waitRun(await run(project.id, second.id))).run.status).toBe('success')

    const rebuild = openRebuildTasks(project.id)
    expect(rebuild.length).toBe(1)
    const card = rebuild[0]
    // Заводим в колонке ready, тип task, без исполнителя.
    expect(card.columnId).toBe(readyColId)
    expect(card.type).toBe('task')
    expect(card.assignee).toBe(null)
    const lines = card.description.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toEqual([`- ${issueKey(project.name, task)}: T1`, `- ${issueKey(project.name, second)}: T2`])
    // Причина видна в ленте рана.
    const log = (await inj(admin, { method: 'GET', url: `/api/ci/runs/${firstRun}/log` })).json() as Array<{ chunk: string }>
    expect(log.some((l) => l.chunk.includes(PROD_REBUILD_TASK_TITLE))).toBe(true)
  })

  it.skip('legacy: повтор разработки после встроенного merge', async () => {
    const { project, task } = setup()
    const merge = mergeCommand(project.id)
    db.setCiSlotCommands('task', task.id, 'after_model', [merge.id])
    expect((await waitRun(await run(project.id, task.id))).run.status).toBe('success')
    expect((await waitRun(await run(project.id, task.id))).run.status).toBe('success')
    const rebuild = openRebuildTasks(project.id)
    expect(rebuild.length).toBe(1)
    expect(rebuild[0].description.split('\n').filter((l) => l.startsWith('- '))).toEqual([`- ${issueKey(project.name, task)}: T1`])
  })

  it('успешный шаг пересборки прода в ране — автозадача не заводится', async () => {
    const { project, task } = setup()
    const merge = mergeCommand(project.id)
    const rebuild = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'Обновить прод-контейнер', script: 'docker compose up --build -d' })
    db.setCiSlotCommands('task', task.id, 'after_model', [merge.id, rebuild.id])
    expect((await waitRun(await run(project.id, task.id))).run.status).toBe('success')
    expect(openRebuildTasks(project.id).length).toBe(0)
  })

  it('ран без мержа в прод-ветку автозадачу не заводит', async () => {
    const { project, task } = setup()
    expect((await waitRun(await run(project.id, task.id))).run.status).toBe('success')
    expect(openRebuildTasks(project.id).length).toBe(0)
  })

  it.skip('legacy: новая автозадача после встроенного merge', async () => {
    const { project, task, readyColId } = setup()
    const merge = mergeCommand(project.id)
    db.setCiSlotCommands('project', project.id, 'after_model', [merge.id])
    expect((await waitRun(await run(project.id, task.id))).run.status).toBe('success')
    const first = openRebuildTasks(project.id)[0]
    const doneCol = db.getBoard('admin', project.id)!.columns.find((c) => c.semanticType === 'done')!
    db.moveTask('admin', project.id, first.id, { columnId: doneCol.id })

    const second = db.createTask('admin', project.id, { columnId: readyColId, title: 'T2' })!
    expect((await waitRun(await run(project.id, second.id))).run.status).toBe('success')
    const open = openRebuildTasks(project.id)
    expect(open.length).toBe(1)
    expect(open[0].id).not.toBe(first.id)
    expect(open[0].description.split('\n').filter((l) => l.startsWith('- '))).toEqual([`- ${issueKey(project.name, second)}: T2`])
    // Закрытая карточка не дополняется.
    expect(db.getBoard('admin', project.id)!.tasks.find((t) => t.id === first.id)!.description).toContain('T1')
    expect(db.getBoard('admin', project.id)!.tasks.find((t) => t.id === first.id)!.description).not.toContain('T2')
  })
})

// База знаний в ране: обращения привязаны к рану (их видно в ленте и в модалке
// задачи), итог попадает в резюме, а сбой базы знаний ран не роняет.
describe('ci run manager: база знаний', () => {
  const hit = {
    documentId: 'ci-runner', chunkId: 'ci-runner#model', title: 'CI-раннер', heading: 'Работа модели',
    excerpt: 'Хуки модели живут в modelHooks.', score: 12, matchTypes: ['symbol' as const],
    explanation: 'символ', freshness: 'current' as const, sourcePath: 'docs/kb/features/ci-runner.md',
    anchor: 'model', symbols: [], relatedFiles: []
  }
  const kbStub = (search: () => Promise<typeof hit[]>) => ({
    status: () => ({ available: true, mode: 'source' as const, searchMode: 'lexical' as const, version: 'x', createdAt: 'now', documents: 1, chunks: 1, staleDocuments: 0 }),
    topics: () => [],
    document: () => null,
    search,
    context: async () => ({ query: '', confidence: 'low' as const, autoInjectAllowed: false, sections: [], relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0 })
  })

  /** Пересобрать сервер с подменённой базой знаний (остальное — как в beforeEach). */
  async function rebuild(kbService: ReturnType<typeof kbStub>): Promise<void> {
    await app.close()
    app = await buildServer({
      config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-ci-kb-${Date.now()}`) }),
      db, sessionSecret: SECRET, ciExecutor, claude: fakeClaude, codex: fakeCodex, kbService
    })
  }

  it('обращения рана записаны с ci_run_id и видны в отчётах по ране и задаче', async () => {
    await rebuild(kbStub(async () => [hit]))
    const { project, task } = setup()
    const runId = await run(project.id, task.id)
    expect((await waitRun(runId)).run.status).toBe('success')

    const report = db.kbUsageRunReport('admin', runId)!
    expect(report.totals.queries).toBeGreaterThan(0)
    expect(report.recent.every((q) => q.ciRunId === runId)).toBe(true)
    expect(report.sections[0]).toMatchObject({ documentId: 'ci-runner', anchor: 'model' })
    // Тот же ран виден и в агрегате по задаче (блок в модалке).
    expect(db.kbUsageTaskReport('admin', project.id, task.id)!.runs).toBe(1)
    // И в промпте модели: блок контекста ушёл вместе с задачей.
    expect(modelRequests[0].prompt).toContain('### CI-раннер / Работа модели')
    expect(modelRequests[0].kbMcpUrl).toContain('/mcp/kb?k=')
  })

  it('резюме в чате содержит строку с итогами по базе знаний', async () => {
    await rebuild(kbStub(async () => [hit]))
    const { project, task } = setup()
    const runId = await run(project.id, task.id)
    await waitRun(runId)
    const chatId = db.getCiRunRaw(runId)!.conversationId!
    const summary = db.listMessages('admin', chatId).find((m) => m.meta?.ciRunSummary)!
    expect(summary.text).toMatch(/БЗ: \d+ обращений, \d+ разделов, ≈\d+ токенов/)
    // Попадание — часть той же строки: без доли счётчик разделов не говорит,
    // пригодился ли хоть один из них.
    expect(summary.text).toMatch(/пригодились \d+ из \d+ \(\d+%\)/)
  })

  it('режим «off» у проекта: ни контекста, ни инструментов, телеметрия пустая', async () => {
    await rebuild(kbStub(async () => [hit]))
    const { project, task } = setup()
    db.updateProject('admin', project.id, { ciKbContextMode: 'off' })
    const runId = await run(project.id, task.id)
    expect((await waitRun(runId)).run.status).toBe('success')
    expect(db.getCiRunRaw(runId)!.kbContextMode).toBe('off')
    expect(modelRequests[0].kbMcpUrl).toBeUndefined()
    expect(modelRequests[0].prompt).not.toContain('### CI-раннер')
    expect(db.kbUsageRunReport('admin', runId)!.totals.queries).toBe(0)
    const chatId = db.getCiRunRaw(runId)!.conversationId!
    expect(db.listMessages('admin', chatId).find((m) => m.meta?.ciRunSummary)!.text).not.toContain('БЗ:')
  })

  it('сломанная база знаний не меняет статус рана', async () => {
    await rebuild(kbStub(async () => { throw new Error('индекс недоступен') }))
    const { project, task } = setup()
    const runId = await run(project.id, task.id)
    expect((await waitRun(runId)).run.status).toBe('success')
    expect(db.kbUsageRunReport('admin', runId)!.totals.errors).toBeGreaterThan(0)
  })

  it('отчёты по ране и задаче: свой — 200, чужой — 404', async () => {
    await rebuild(kbStub(async () => [hit]))
    const { project, task } = setup()
    const runId = await run(project.id, task.id)
    await waitRun(runId)
    db.createUser('bob', '', 'developer')
    const bob = signToken({ name: 'bob', role: 'developer' }, SECRET)

    const mine = await inj(admin, { method: 'GET', url: `/api/ci/runs/${runId}/kb-usage` })
    expect(mine.statusCode).toBe(200)
    expect(mine.json()).toMatchObject({ runId, taskId: task.id, kbContextMode: 'auto' })
    const mineTask = await inj(admin, { method: 'GET', url: `/api/projects/${project.id}/tasks/${task.id}/kb-usage` })
    expect(mineTask.statusCode).toBe(200)

    expect((await inj(bob, { method: 'GET', url: `/api/ci/runs/${runId}/kb-usage` })).statusCode).toBe(404)
    expect((await inj(bob, { method: 'GET', url: `/api/projects/${project.id}/tasks/${task.id}/kb-usage` })).statusCode).toBe(404)
  })
})

/**
 * Терминальный статус прошлого рана не имеет права пережить следующий успешный
 * запуск: карточка после падения/отмены и последующего успеха обязана оказаться
 * ровно там же, где после обычного успешного рана.
 */
describe('карточка после падения, отмены и повтора', () => {
  /** Пайплайн «сломанный шаг + мерж» в слоте «после» — как боевой. */
  function pipeline(projectId: string, taskId: string): void {
    const gate = db.createCiCommand('admin', { scope: 'project', projectId, name: 'Запустить тестирование', script: 'TOGGLE' })
    const merge = db.createCiCommand('admin', { scope: 'project', projectId, name: 'Влить ветку задачи в прод-ветку', script: 'git merge --no-edit "$BRANCH"' })
    db.setCiSlotCommands('task', taskId, 'after_model', [gate.id, merge.id])
  }

  it('ран упал → починили → новый ран доводит карточку до «Готово», лозенг свежий', async () => {
    const { project, task, readyColId } = setup()
    db.updateCiSettings({ maxFixAttempts: 1 })
    pipeline(project.id, task.id)
    failStep = true

    const first = await run(project.id, task.id)
    expect((await waitRun(first)).run.status).toBe('failed')
    // Исход B: карточка вернулась туда, где была, мержа не было.
    expect(db.getBoard('admin', project.id)!.tasks.find((t) => t.id === task.id)!.columnId).toBe(readyColId)

    failStep = false
    dirtyWorkspace = false // пользователь устранил локальные изменения
    const second = await run(project.id, task.id)
    expect((await waitRun(second)).run.status).toBe('success')
    const board = db.getBoard('admin', project.id)!
    expect(board.tasks.find((t) => t.id === task.id)!.columnId).toBe(board.columns.find((c) => c.semanticType === 'component_qa')!.id)
    // Сводка на доске — про новый ран, а не про упавший.
    const summary = db.latestCiRunSummary(task.id)!
    expect(summary.id).toBe(second)
    expect(summary.status).toBe('success')
    expect(db.latestCiRunSummaries(project.id).find((x) => x.taskId === task.id)!.id).toBe(second)
  })

  it('повторный ран после падения останавливается на dirty checkout до clone', async () => {
    const { project, task } = setup()
    db.updateCiSettings({ maxFixAttempts: 1 })
    const clone = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'Клонировать репозиторий задачи', script: 'CLONE' })
    db.setCiSlotCommands('task', task.id, 'before_model', [clone.id])
    const gate = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'Запустить тестирование', script: 'TOGGLE' })
    db.setCiSlotCommands('task', task.id, 'after_model', [gate.id])
    failStep = true

    const first = await run(project.id, task.id)
    expect((await waitRun(first)).run.status).toBe('failed')
    // Упавший шаг оставил в копии правки модели — прежде это ловил только exit 66.
    expect(dirtyWorkspace).toBe(true)

    failStep = false
    const second = await run(project.id, task.id)
    const d = await waitRun(second)
    expect(d.run.status).toBe('failed')
    expect(scripts.some((x) => x.includes('Рабочая копия содержит локальные изменения'))).toBe(true)
    expect(scripts.filter((x) => x === 'CLONE')).toHaveLength(1)
  })

  it('повтор с упавшего шага: карточка уходит в разработку и после успеха доезжает до «Готово»', async () => {
    const { project, task, readyColId } = setup()
    db.updateCiSettings({ maxFixAttempts: 1 })
    pipeline(project.id, task.id)
    failStep = true

    const runId = await run(project.id, task.id)
    expect((await waitRun(runId)).run.status).toBe('failed')
    expect(db.getBoard('admin', project.id)!.tasks.find((t) => t.id === task.id)!.columnId).toBe(readyColId)

    failStep = false
    const columns = db.getBoard('admin', project.id)!.columns
    // Колонку снимаем в момент повторяемого шага: к концу рана карточка уже в «Готово».
    let columnAtStep: string | null = null
    onExec = (script) => { if (script === 'TOGGLE') columnAtStep = db.getBoard('admin', project.id)!.tasks.find((t) => t.id === task.id)!.columnId }
    const retry = await inj(admin, { method: 'POST', url: `/api/ci/runs/${runId}/retry-from-step` })
    expect(retry.statusCode).toBe(202)

    const done = await waitRun(runId)
    expect(done.run.status).toBe('success')
    // Повтор — это работа, а не простой: карточка вернулась в разработку на время рана.
    expect(columnAtStep).toBe(columns.find((c) => c.semanticType === 'development')!.id)
    expect(db.getBoard('admin', project.id)!.tasks.find((t) => t.id === task.id)!.columnId).toBe(columns.find((c) => c.semanticType === 'component_qa')!.id)
    expect(db.latestCiRunSummary(task.id)!.status).toBe('success')
  })

  it('берёт выбранную машину карточки, разрешает личную и отклоняет чужую', async () => {
    const { project, task } = setup()
    const selected = db.createAgent('admin', 'Вторая машина')
    db.linkMachine('admin', project.id, selected.id)
    db.setProjectMachineReposRoot('admin', project.id, selected.id, '/repos-2')
    const saved = await inj(admin, {
      method: 'PATCH', url: `/api/projects/${project.id}/tasks/${task.id}`, payload: { agentId: selected.id }
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().agentId).toBe(selected.id)

    const runId = await run(project.id, task.id)
    expect(db.getCiRunRaw(runId)!.agentId).toBe(selected.id)

    const personal = db.createAgent('admin', 'Личная не в проекте')
    const accepted = await inj(admin, {
      method: 'PATCH', url: `/api/projects/${project.id}/tasks/${task.id}`, payload: { agentId: personal.id }
    })
    expect(accepted.statusCode).toBe(200)

    const foreign = db.createAgent('other', 'Чужая')
    const rejected = await inj(admin, {
      method: 'PATCH', url: `/api/projects/${project.id}/tasks/${task.id}`, payload: { agentId: foreign.id }
    })
    expect(rejected.statusCode).toBe(400)
  })
})

// Модель сама запускает опубликованный ей гейт; после неуспеха workflow
// продолжает fix-loop. Здесь проверяем промпт, доступность команды как MCP-инструмента
// и продолжение слота «после» после зелёного повтора.

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
import { ciToolBroker } from './ciCommandsMcp.js'

const SECRET = 'ci-secret'
let app: FastifyInstance, db: VoiceChatDb, admin: string

/** Скрипт шага тестирования: единственный, который умеет падать. */
const GATE = 'npm run -w @voicechat/server test'

let scripts: string[] = []
let modelRequests: LlmRequest[] = []
/** Инструменты, которые модель увидела на шаге работы (список брокера MCP). */
let toolNames: string[] = []
/** Сколько первых прогонов гейта падают (Infinity — не чинится никогда). */
let gateFailures = 0
/** Гейт падает инфраструктурным сбоем машины (повреждённый кэш npm). */
let gateInfra = false
let runTargeted = false
let runModelCommand = false
let sessionNo = 0
const counts = new Map<string, number>()

const fakeClaude: LlmClient = {
  send: (req, handlers) => {
    modelRequests.push(req)
    // Резюм сессии: клиент возвращает тот же id, если ход продолжает диалог.
    const sid = req.sessionId ?? `sess-${++sessionNo}`
    void (async () => {
      const m = /run=([^&]+)/.exec(req.remote?.ciMcpUrl ?? '')
      if (m) {
        const entry = ciToolBroker.get(m[1])
        toolNames = (entry?.list() ?? []).map((c) => c.name)
        if (runTargeted && req.prompt.startsWith('Упал шаг воркфлоу')) {
          await entry?.runTargetedTests?.('npm run -w @voicechat/server test -- src/x1.test.ts -t "падает проверка 1"')
        }
        if (runModelCommand && !req.prompt.startsWith('Упал шаг воркфлоу')) {
          await entry?.invoke('Установить зависимости')
          await entry?.invoke('Запустить тестирование (npm test)')
        }
      }
      handlers.onSession(sid)
      handlers.onDelta('диагноз: правлю код')
      handlers.onDone('диагноз: правлю код')
    })()
    return { cancel: () => {} }
  }
}
const fakeCodex: LlmClient = { send: (_req, handlers) => { queueMicrotask(() => handlers.onDone('ok')); return { cancel: () => {} } } }

const ciExecutor: CommandExecutor = {
  run: async (req, onChunk) => {
    scripts.push(req.script)
    const n = (counts.get(req.script) ?? 0) + 1
    counts.set(req.script, n)
    if (req.script !== GATE) {
      onChunk(`run:${req.script}\n`)
      return { exitCode: 0, timedOut: false }
    }
    if (gateInfra) {
      onChunk('npm ERR! code EEXIST\nnpm ERR! /root/.npm/_cacache/content-v2/sha512\n')
      return { exitCode: 254, timedOut: false }
    }
    if (n > gateFailures) {
      onChunk('Test Files  12 passed (12)\n')
      return { exitCode: 0, timedOut: false }
    }
    // Хвост настоящего vitest — сотни строк: по сорока последним упавшего теста не видно.
    onChunk(`gate attempt ${n}\n`)
    for (let i = 1; i <= 200; i++) onChunk(`FAIL src/x${i}.test.ts > падает проверка ${i}\n`)
    return { exitCode: 1, timedOut: false }
  }
}

beforeEach(async () => {
  let id = 0
  scripts = []
  modelRequests = []
  toolNames = []
  gateFailures = 0
  gateInfra = false
  runTargeted = false
  runModelCommand = false
  sessionNo = 0
  counts.clear()
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => Date.now() })
  app = await buildServer({ config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-gate-${Date.now()}`) }), db, sessionSecret: SECRET, ciExecutor, claude: fakeClaude, codex: fakeCodex })
  admin = signToken({ name: 'admin', role: 'admin' }, SECRET)
})
afterEach(async () => { await app.close(); db.close() })

const inj = (opts: { method: 'GET' | 'POST'; url: string; payload?: object }) =>
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

/** Стандартный слот «после»: тесты → база знаний → коммит → пуш → мерж → прод. */
function afterSlot(projectId: string, taskId: string): void {
  const names: Array<[string, string]> = [
    ['Запустить тестирование (npm test)', GATE],
    ['Актуализировать базу знаний', 'node scripts/kb.mjs index'],
    ['Закоммитить изменения', 'git commit -am wip'],
    ['Отправить ветку задачи в origin', 'git push origin HEAD'],
    ['Влить ветку задачи в прод-ветку', 'git merge --no-edit "$BRANCH"'],
    ['Обновить прод-контейнер', 'npm run docker']
  ]
  const ids = names.map(([name, script]) => db.createCiCommand('admin', { scope: 'project', projectId, name, script }).id)
  db.setCiSlotCommands('task', taskId, 'after_model', ids)
}

async function run(projectId: string, taskId: string): Promise<string> {
  const res = await inj({ method: 'POST', url: `/api/projects/${projectId}/tasks/${taskId}/ci/run` })
  expect(res.statusCode).toBe(202)
  return res.json().id as string
}

async function waitRun(runId: string): Promise<{ run: { status: string } }> {
  for (let i = 0; i < 300; i++) {
    const d = (await inj({ method: 'GET', url: `/api/ci/runs/${runId}` })).json()
    if (['success', 'failed', 'cancelled', 'timeout'].includes(d.run.status)) return d
    await new Promise((res) => setTimeout(res, 10))
  }
  throw new Error('run did not finish')
}

/** Запросы fix-loop: у них в промпте диагноз упавшего шага. */
const fixRequests = (): LlmRequest[] => modelRequests.filter((r) => r.prompt.startsWith('Упал шаг воркфлоу'))

describe.skip('legacy after_model gate (обязательный гейт перенесён в merge)', () => {
  it('промпт разработки требует самостоятельной проверки затронутых пакетов', async () => {
    const { projectId, taskId } = setup()
    const runId = await run(projectId, taskId)
    expect((await waitRun(runId)).run.status).toBe('success')
    const work = modelRequests[0]
    expect(work.prompt).toContain('npm run affected-check')
    expect(work.prompt).toContain('не отдавай работу с падающими тестами или ошибками типов')
  })

  it('доступная модели команда-проверка публикуется и запускается вложенным шагом', async () => {
    const { projectId, taskId } = setup()
    db.createCiCommand('admin', { scope: 'project', projectId, name: 'Установить зависимости', script: 'npm ci', availableToModel: true })
    db.createCiCommand('admin', { scope: 'project', projectId, name: 'Запустить тестирование (npm test)', script: GATE, availableToModel: true })
    db.createCiCommand('admin', { scope: 'project', projectId, name: 'Проверка типов', script: 'npm run typecheck', availableToModel: false })
    expect(db.getCiSettings().maxModelCommandCalls).toBeGreaterThanOrEqual(2)
    runModelCommand = true
    const runId = await run(projectId, taskId)
    expect((await waitRun(runId)).run.status).toBe('success')
    expect(toolNames).toContain('Установить зависимости')
    expect(toolNames).toContain('Запустить тестирование (npm test)')
    expect(toolNames).not.toContain('Проверка типов')
    expect(scripts).toContain('npm ci')
    expect(scripts).toContain(GATE)
    const commandStep = db.getCiRun('admin', runId)!.steps.find((s) => s.kind === 'model_command' && s.title === 'Запустить тестирование (npm test)')
    expect(commandStep).toMatchObject({ title: 'Запустить тестирование (npm test)', status: 'success' })
  })

  it('упавший гейт: правка модели → повтор шага → зелёный, слот «после» доходит до конца', async () => {
    const { projectId, taskId } = setup()
    afterSlot(projectId, taskId)
    gateFailures = 1
    const runId = await run(projectId, taskId)
    expect((await waitRun(runId)).run.status).toBe('success')
    // Гейт прогнан дважды (упал и прошёл на повторе), остальные шаги — по разу и после него.
    expect(scripts.filter((s) => s === GATE)).toHaveLength(2)
    expect(scripts.filter((s) => s === 'git commit -am wip')).toHaveLength(1)
    expect(scripts.slice(scripts.lastIndexOf(GATE) + 1)).toEqual([
      'node scripts/kb.mjs index',
      'git commit -am wip',
      'git push origin HEAD'
    ])
    const detail = db.getCiRun('admin', runId)!
    expect(detail.fixAttempts).toHaveLength(1)
    expect(detail.fixAttempts[0]).toMatchObject({ attemptNo: 1, result: 'fixed' })
    expect(detail.fixAttempts[0].diagnosis).toContain('диагноз')
    const gateSteps = detail.steps.filter((s) => s.title.startsWith('Запустить тестирование'))
    // Первый прогон помечен «исправлено моделью», повтор прошёл сам.
    expect(gateSteps.some((s) => s.fixedByModel && s.status === 'success')).toBe(true)
    expect(gateSteps.every((s) => s.status === 'success')).toBe(true)
  })

  it('fix-loop даёт модели ограниченную точечную проверку и сохраняет её в попытке', async () => {
    const { projectId, taskId } = setup()
    afterSlot(projectId, taskId)
    gateFailures = 1
    runTargeted = true
    const runId = await run(projectId, taskId)
    expect((await waitRun(runId)).run.status).toBe('success')
    const attempt = db.getCiRun('admin', runId)!.fixAttempts[0]!
    expect(attempt.targetedTests).toHaveLength(1)
    expect(attempt.targetedTests[0]).toMatchObject({ exitCode: 0, timedOut: false })
    expect(attempt.targetedTests[0].command).toContain('src/x1.test.ts')
    expect(attempt.fullRerun).toMatchObject({ exitCode: 0, timedOut: false })
    expect(attempt.failures[0]).toMatchObject({ file: 'src/x1.test.ts' })
  })

  it('правки fix-loop идут той же сессией CLI, что и работа модели', async () => {
    const { projectId, taskId } = setup()
    afterSlot(projectId, taskId)
    gateFailures = 2
    const runId = await run(projectId, taskId)
    expect((await waitRun(runId)).run.status).toBe('success')
    const work = modelRequests[0]
    expect(work.sessionId).toBeNull()
    const fixes = fixRequests()
    expect(fixes).toHaveLength(2)
    // Обе попытки продолжают диалог работы модели (--resume), а не начинают с нуля.
    expect(fixes.map((f) => f.sessionId)).toEqual(['sess-1', 'sess-1'])
    // Вторая попытка знает, что первая не помогла.
    expect(fixes[1].prompt).toContain('Попытка 2 из 10')
    expect(fixes[1].prompt).toContain('gate attempt 2')
  })

  it('в промпт fix-loop уходит длинный хвост теста и запрет ослаблять гейт', async () => {
    const { projectId, taskId } = setup()
    afterSlot(projectId, taskId)
    gateFailures = 1
    const runId = await run(projectId, taskId)
    expect((await waitRun(runId)).run.status).toBe('success')
    const fix = fixRequests()[0]
    // Сорока строк хвоста хватило бы только на конец вывода — нужны сами упавшие тесты.
    expect(fix.prompt).toContain('падает проверка 1\n')
    expect(fix.prompt).toContain('падает проверка 200')
    expect(fix.prompt).toContain('НЕ ослабляй саму команду ради обхода ошибки')
  })

  it('гейт не чинится за десять попыток → ран failed, в ленте десять диагнозов', async () => {
    const { projectId, taskId } = setup()
    afterSlot(projectId, taskId)
    gateFailures = Infinity
    const runId = await run(projectId, taskId)
    expect((await waitRun(runId)).run.status).toBe('failed')
    // Дефолтные лимиты: десять попыток, значит одиннадцать прогонов гейта (первый + десять повторов).
    expect(scripts.filter((s) => s === GATE)).toHaveLength(11)
    // До остальных шагов слота ран не дошёл.
    expect(scripts).not.toContain('git commit -am wip')
    const detail = db.getCiRun('admin', runId)!
    expect(detail.fixAttempts).toHaveLength(10)
    expect(detail.fixAttempts.slice(0, -1).every((f) => f.result === 'retrying')).toBe(true)
    expect(detail.fixAttempts.at(-1)?.result).toBe('gave_up')
    expect(detail.fixAttempts.every((f) => f.diagnosis.includes('диагноз'))).toBe(true)
  })

  it('инфраструктурный сбой машины идёт мимо fix-loop', async () => {
    const { projectId, taskId } = setup()
    afterSlot(projectId, taskId)
    gateInfra = true
    const runId = await run(projectId, taskId)
    expect((await waitRun(runId)).run.status).toBe('failed')
    expect(scripts.filter((s) => s === GATE)).toHaveLength(1)
    expect(db.getCiRun('admin', runId)!.fixAttempts).toHaveLength(0)
    expect(fixRequests()).toHaveLength(0)
  })
})

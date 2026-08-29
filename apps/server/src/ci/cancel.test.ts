// Отмена рана в фазе модели, сторожевой таймаут очереди сервера, изолированный
// кэш npm и отказ гонять инфраструктурные ошибки через fix-loop.
// Очередь проверяем при `maxConcurrentRuns: 1` — иначе раны разных задач идут
// параллельно (см. parallel.test.ts) и «следующий в очереди» просто не возникает.
// Менеджер собираем напрямую (без buildServer): нужен контроль над хуком модели
// и коротким `cancelGraceMs`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { createCiRunManager, type CiRunManager, type CiRunManagerDeps } from './runManager.js'
import { createCiModelHooks } from './modelHooks.js'
import type { CommandExecutor, CiFixHook, CiModelContext, CiModelWorkHook } from './types.js'
import type { LlmClient } from '../claude/types.js'

/** Хвост лога повреждённого кэша npm — по нему шаг признаётся инфраструктурным. */
const CACACHE_LOG = `npm error code EEXIST
npm error EEXIST: file already exists, rename '/root/.npm/_cacache/tmp/a1' -> '/root/.npm/_cacache/content-v2/sha512/aa/bb/cc'
`

let db: VoiceChatDb
let execs: Array<{ script: string; env: Record<string, string> }> = []

const executor: CommandExecutor = {
  run: async (req, onChunk, signal) => {
    execs.push({ script: req.script, env: req.env })
    if (signal?.aborted) throw new Error('Команда отменена')
    onChunk(`run:${req.script.slice(0, 24)}\n`)
    if (req.script.includes('NPM_CACHE_BROKEN')) {
      onChunk(CACACHE_LOG)
      return { exitCode: 254, timedOut: false }
    }
    return { exitCode: 0, timedOut: false }
  }
}

beforeEach(() => {
  let id = 0
  execs = []
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => Date.now() })
})
afterEach(() => db.close())

function setup(): { projectId: string; taskIds: string[]; prevColumnId: string } {
  const project = db.createProject('admin', { name: 'P', gitUrl: 'git@github.com:x/y.git' })
  const agent = db.createAgent('admin', 'M')
  db.linkMachine('admin', project.id, agent.id)
  db.setProjectMachineReposRoot('admin', project.id, agent.id, '/repos')
  db.setProjectDefaultMachine('admin', project.id, agent.id)
  db.setUserProjectDefaultMachine('admin', project.id, agent.id)
  const board = db.getBoard('admin', project.id)!
  const ready = board.columns.find((c) => c.semanticType === 'ready')!
  const taskIds = ['T1', 'T2'].map((title) => db.createTask('admin', project.id, { columnId: ready.id, title })!.id)
  return { projectId: project.id, taskIds, prevColumnId: ready.id }
}

function manager(over: Partial<CiRunManagerDeps> = {}): CiRunManager {
  return createCiRunManager({ db, executor, boardChanged: () => {}, cancelGraceMs: 150, ...over })
}

/** Дождаться терминального статуса рана (или упасть по таймауту). */
async function waitStatus(runId: string, ms = 3000): Promise<string> {
  for (let i = 0; i < ms / 10; i++) {
    const st = db.getCiRunRaw(runId)?.status
    if (st && ['success', 'failed', 'cancelled', 'timeout'].includes(st)) return st
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`ран ${runId} не завершился: ${db.getCiRunRaw(runId)?.status}`)
}

function startRun(ci: CiRunManager, projectId: string, taskId: string): string {
  const r = ci.start('admin', projectId, taskId)
  if ('error' in r) throw new Error(r.error)
  return r.run.id
}

describe('отмена рана в фазе модели', () => {
  it('останавливает работу модели и пропускает следующий ран из очереди', async () => {
    const { projectId, taskIds, prevColumnId } = setup()
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    let sawAbort = false
    let firstStarted: () => void = () => {}
    const started = new Promise<void>((res) => { firstStarted = res })
    // Хук ведёт себя как реальный `runTurn`: слушает ctx.signal и гасит ход.
    const modelWork: CiModelWorkHook = async (ctx) => {
      if (ctx.task.id !== taskIds[0]) return { ok: true }
      firstStarted()
      await new Promise<void>((res) => {
        if (ctx.signal.aborted) return res()
        ctx.signal.addEventListener('abort', () => res(), { once: true })
      })
      sawAbort = ctx.signal.aborted
      return { ok: false, cancelled: true }
    }
    const ci = manager({ modelWork })
    const first = startRun(ci, projectId, taskIds[0])
    const second = startRun(ci, projectId, taskIds[1])
    await started

    expect(ci.cancel('admin', first)).toBe(true)
    expect(await waitStatus(first)).toBe('cancelled')
    expect(sawAbort).toBe(true)
    // Шаг модели закрыт как cancelled, слот «после» и резюме не запускались.
    const steps = db.getCiRun('admin', first)!.steps
    expect(steps.find((s) => s.kind === 'model_work')!.status).toBe('cancelled')
    expect(steps.some((s) => s.kind === 'model_summary')).toBe(false)
    // Карточка вернулась в колонку, где была до рана.
    expect(db.getBoard('admin', projectId)!.tasks.find((t) => t.id === taskIds[0])!.columnId).toBe(prevColumnId)
    // Главное: очередь не залипла — следующий ран доехал сам.
    expect(await waitStatus(second)).toBe('success')
    expect(ci.activeRunIds()).toEqual([])
  })

  it('отмена посередине работы очищает checkout, и следующий ран проходит подготовку', async () => {
    const { projectId, taskIds } = setup()
    let dirty = false
    let modelStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => { modelStarted = resolve })
    let modelCalls = 0
    const cleaningExecutor: CommandExecutor = {
      run: async (req, onChunk, signal) => {
        execs.push({ script: req.script, env: req.env })
        if (req.script.includes('reset --hard HEAD') && req.script.includes('clean -fdx')) {
          dirty = false
          return { exitCode: 0, timedOut: false }
        }
        if (req.script.includes('Рабочая копия содержит локальные изменения') && dirty) {
          return { exitCode: 66, timedOut: false }
        }
        return executor.run(req, onChunk, signal)
      }
    }
    const ci = manager({
      executor: cleaningExecutor,
      modelWork: async (ctx) => {
        modelCalls++
        if (modelCalls > 1) return { ok: true }
        dirty = true
        modelStarted()
        await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }))
        return { ok: false, cancelled: true }
      }
    })
    const first = startRun(ci, projectId, taskIds[0])
    await started
    expect(ci.cancel('admin', first)).toBe(true)
    expect(await waitStatus(first)).toBe('cancelled')

    const second = startRun(ci, projectId, taskIds[0])
    expect(await waitStatus(second, 5000)).toBe('success')
    expect(dirty).toBe(false)
    expect(execs.some((entry) => entry.script.includes('reset --hard HEAD') && entry.script.includes('clean -fdx'))).toBe(true)
  })

  it('исполнитель проигнорировал отмену → слот очереди освобождается по сторожевому таймауту', async () => {
    const { projectId, taskIds } = setup()
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    // Хук намеренно глухой к ctx.signal — так вёл себя modelWork до этой задачи.
    const modelWork: CiModelWorkHook = async (ctx) => {
      if (ctx.task.id !== taskIds[0]) return { ok: true }
      await new Promise<void>(() => {})
      return { ok: true }
    }
    const ci = manager({ modelWork })
    const first = startRun(ci, projectId, taskIds[0])
    const second = startRun(ci, projectId, taskIds[1])
    for (let i = 0; i < 100 && db.getCiRunRaw(first)?.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 10))

    ci.cancel('admin', first)
    expect(await waitStatus(first)).toBe('cancelled')
    // Незавершённый шаг тоже закрыт, в логе видно, что это принудительное закрытие.
    expect(db.getCiRun('admin', first)!.steps.find((s) => s.kind === 'model_work')!.status).toBe('cancelled')
    expect(db.getCiRunLog('admin', first).some((l) => l.chunk.includes('закрыт принудительно'))).toBe(true)
    expect(await waitStatus(second)).toBe('success')
  })

  it('повторный «Выполнить» сразу после отмены проходит: задача не считается занятой', async () => {
    const { projectId, taskIds } = setup()
    let firstStarted: () => void = () => {}
    const started = new Promise<void>((res) => { firstStarted = res })
    let hangs = true
    // Исполнитель глух к отмене: запись о ране живёт в `active` до сторожевого
    // таймаута — раньше всё это окно «Выполнить» отвечал «уже выполняется ран».
    const modelWork: CiModelWorkHook = async () => {
      if (!hangs) return { ok: true }
      hangs = false
      firstStarted()
      await new Promise<void>(() => {})
      return { ok: true }
    }
    const ci = manager({ modelWork })
    const first = startRun(ci, projectId, taskIds[0])
    await started

    expect(ci.cancel('admin', first)).toBe(true)
    // Ровно то, что делает пользователь: нажимает «Выполнить» сразу после отмены.
    const second = ci.start('admin', projectId, taskIds[0])
    expect('error' in second).toBe(false)
    const secondId = (second as { run: { id: string } }).run.id

    expect(await waitStatus(first)).toBe('cancelled')
    expect(await waitStatus(secondId, 5000)).toBe('success')
    // Конечное состояние — как у обычного успешного рана без мержа.
    const preparation = db.getBoard('admin', projectId)!.columns.find((c) => c.semanticType === 'component_qa')!
    expect(db.getBoard('admin', projectId)!.tasks.find((t) => t.id === taskIds[0])!.columnId).toBe(preparation.id)
    expect(db.latestCiRunSummary(taskIds[0])!.id).toBe(secondId)
  })

  it('отменённый ран из очереди закрывается сразу, не дожидаясь слота сервера', async () => {
    const { projectId, taskIds, prevColumnId } = setup()
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    let release: () => void = () => {}
    const hold = new Promise<void>((res) => { release = res })
    const ci = manager({ modelWork: async (ctx) => { if (ctx.task.id === taskIds[0]) await hold; return { ok: true } } })
    const first = startRun(ci, projectId, taskIds[0])
    const second = startRun(ci, projectId, taskIds[1])
    for (let i = 0; i < 100 && db.getCiRunRaw(first)?.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 10))

    ci.cancel('admin', second)
    // Статус честный сразу, а не «в очереди» до освобождения слота.
    expect(db.getCiRunRaw(second)!.status).toBe('cancelled')
    expect(db.getBoard('admin', projectId)!.tasks.find((t) => t.id === taskIds[1])!.columnId).toBe(prevColumnId)
    release()
    expect(await waitStatus(first)).toBe('success')
    expect(db.getCiRun('admin', second)!.steps).toEqual([])
  })

  it('ручное исключение из очереди переносит карточку в backlog и идемпотентно', async () => {
    const { projectId, taskIds } = setup()
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    let release: () => void = () => {}
    const hold = new Promise<void>((res) => { release = res })
    const ci = manager({ modelWork: async (ctx) => { if (ctx.task.id === taskIds[0]) await hold; return { ok: true } } })
    const first = startRun(ci, projectId, taskIds[0])
    const queued = startRun(ci, projectId, taskIds[1])
    for (let i = 0; i < 100 && db.getCiRunRaw(first)?.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 10))

    expect(ci.dequeue('admin', queued)).toMatchObject({ status: 'removed', run: { id: queued, status: 'cancelled' } })
    const backlog = db.getBoard('admin', projectId)!.columns.find((c) => c.semanticType === 'backlog')!
    expect(db.getBoard('admin', projectId)!.tasks.find((t) => t.id === taskIds[1])!.columnId).toBe(backlog.id)
    // Повтор не возвращает ложную ошибку и не запускает ран снова.
    expect(ci.dequeue('admin', queued)).toMatchObject({ status: 'removed', run: { id: queued, status: 'cancelled' } })
    expect(db.getCiRun('admin', queued)!.steps).toEqual([])
    release()
    await waitStatus(first)
  })

  it('ручное исключение сообщает running, если ран уже успел стартовать', async () => {
    const { projectId, taskIds } = setup()
    const ci = manager({ modelWork: async () => ({ ok: true }) })
    const runId = startRun(ci, projectId, taskIds[0])
    // Моделируем границу между нажатием в UI и обработкой запроса: статус уже
    // сменился в execute, поэтому dequeue не должен отменять ран как queued.
    const live = db.updateCiRun(runId, { status: 'running' })!
    expect(ci.dequeue('admin', runId)).toEqual({ status: 'running', run: live })
  })

  it('отмена рана из очереди закрывает его как cancelled, не начиная работу', async () => {
    const { projectId, taskIds, prevColumnId } = setup()
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    let release: () => void = () => {}
    const hold = new Promise<void>((res) => { release = res })
    const ci = manager({
      modelWork: async (ctx) => {
        if (ctx.task.id === taskIds[0]) await hold
        return { ok: true }
      }
    })
    const first = startRun(ci, projectId, taskIds[0])
    const second = startRun(ci, projectId, taskIds[1])
    for (let i = 0; i < 100 && db.getCiRunRaw(first)?.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 10))
    // Второй ещё стоит в очереди сервера — отменяем именно его.
    expect(db.getCiRunRaw(second)!.status).toBe('queued')
    expect(ci.cancel('admin', second)).toBe(true)
    release()
    expect(await waitStatus(first)).toBe('success')
    expect(await waitStatus(second)).toBe('cancelled')
    // Ни одного шага: ран не начинался.
    expect(db.getCiRun('admin', second)!.steps).toEqual([])
    expect(db.getBoard('admin', projectId)!.tasks.find((t) => t.id === taskIds[1])!.columnId).toBe(prevColumnId)
  })

  it('отмена в слоте команд закрывает ран как cancelled, а не failed', async () => {
    const { projectId, taskIds } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId, name: 'clone', script: 'git clone' })
    db.setCiSlotCommands('task', taskIds[0], 'before_model', [cmd.id])
    let cancelHere: () => void = () => {}
    const hold = new Promise<void>((res) => { cancelHere = res })
    const slowExecutor: CommandExecutor = {
      run: async (req, onChunk, signal) => {
        if (req.script !== 'git clone') return executor.run(req, onChunk, signal)
        cancelHere()
        await new Promise<void>((res) => signal?.addEventListener('abort', () => res(), { once: true }))
        throw new Error('Команда отменена')
      }
    }
    const ci = manager({ executor: slowExecutor, modelWork: async () => ({ ok: true }) })
    const runId = startRun(ci, projectId, taskIds[0])
    await hold
    ci.cancel('admin', runId)
    expect(await waitStatus(runId)).toBe('cancelled')
    expect(db.getCiRun('admin', runId)!.steps.some((s) => s.kind === 'model_work')).toBe(false)
  })
})

describe('изолированный кэш npm', () => {
  it('шаг получает свой npm_config_cache рядом с рабочими копиями', async () => {
    const { projectId, taskIds } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId, name: 'npm ci', script: 'npm ci' })
    db.setCiSlotCommands('project', projectId, 'before_model', [cmd.id])
    const ci = manager({ modelWork: async () => ({ ok: true }) })
    expect(await waitStatus(startRun(ci, projectId, taskIds[0]))).toBe('success')
    expect(await waitStatus(startRun(ci, projectId, taskIds[1]))).toBe('success')

    const npmSteps = execs.filter((e) => e.script === 'npm ci')
    expect(npmSteps).toHaveLength(2)
    // Кэш свой на задачу → два одновременных `npm ci` не делят _cacache.
    expect(npmSteps[0].env.npm_config_cache).toBe('/repos/.npm-cache/p-1')
    expect(npmSteps[1].env.npm_config_cache).toBe('/repos/.npm-cache/p-2')
    expect(npmSteps[0].env.NPM_CACHE_DIR).toBe(npmSteps[0].env.npm_config_cache)
    // Кэш лежит НЕ в рабочей директории: её сносит cleanup в конце рана.
    expect(npmSteps[0].env.npm_config_cache.startsWith(npmSteps[0].env.WORKSPACE)).toBe(false)
    // Подготовка создаёт каталог кэша и подчищает старые.
    const prep = execs[0].script
    expect(prep).toContain(`'/repos/.npm-cache/p-1'`)
    expect(prep).toContain(`find '/repos/.npm-cache'`)
  })
})

describe('инфраструктурные ошибки шага', () => {
  it('повреждённый кэш npm не уходит в fix-loop — ран падает сразу с объяснением', async () => {
    const { projectId, taskIds } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId, name: 'npm ci', script: 'npm ci NPM_CACHE_BROKEN' })
    db.setCiSlotCommands('task', taskIds[0], 'before_model', [cmd.id])
    let fixCalls = 0
    const attemptFix: CiFixHook = async () => { fixCalls++; return { fixed: false } }
    const ci = manager({ modelWork: async () => ({ ok: true }), attemptFix })
    const runId = startRun(ci, projectId, taskIds[0])
    expect(await waitStatus(runId)).toBe('failed')
    expect(fixCalls).toBe(0)
    const log = db.getCiRunLog('admin', runId).map((l) => l.chunk).join('')
    expect(log).toContain('Повреждён кэш npm')
    expect(log).toContain('npm cache clean --force')
    // Модель не запускалась: слот «до» упал.
    expect(db.getCiRun('admin', runId)!.steps.some((s) => s.kind === 'model_work')).toBe(false)
    // Фаза рана называет причину: это машина, а не задача.
    expect(db.getCiRunRaw(runId)!.slotProgress.phase).toContain('повреждён кэш npm')
  })

  it('обычное падение шага по-прежнему идёт в fix-loop', async () => {
    const { projectId, taskIds } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId, name: 'test', script: 'FAILING npm test' })
    const failing: CommandExecutor = {
      run: async (req, onChunk) => {
        execs.push({ script: req.script, env: req.env })
        onChunk('1 test failed\n')
        return { exitCode: req.script.includes('FAILING') ? 1 : 0, timedOut: false }
      }
    }
    db.setCiSlotCommands('task', taskIds[0], 'before_model', [cmd.id])
    let fixCalls = 0
    const ci = manager({ executor: failing, modelWork: async () => ({ ok: true }), attemptFix: async () => { fixCalls++; return { fixed: false } } })
    expect(await waitStatus(startRun(ci, projectId, taskIds[0]))).toBe('failed')
    expect(fixCalls).toBe(1)
  })
})

describe('хук работы модели слушает отмену', () => {
  it('abort гасит процесс CLI и закрывает ход как cancelled', async () => {
    const { projectId, taskIds } = setup()
    const ctl = new AbortController()
    let cancelled = 0
    // Клиент, который «думает» бесконечно: без реакции на signal ход не закрылся бы.
    const silent: LlmClient = { send: () => ({ cancel: () => { cancelled++ } }) }
    const hooks = createCiModelHooks({
      db,
      claude: silent,
      codex: silent,
      mcpBaseUrl: 'http://x/mcp?k=1',
      ciMcpBaseUrl: 'http://x/ci?k=1',
      agentNameOf: () => 'M'
    })
    const task = db.getCiTask('admin', projectId, taskIds[0])!
    const project = db.getProject('admin', projectId)!
    const run = db.createCiRun({
      projectId, taskId: task.id, agentId: null, triggeredBy: 'admin', prevColumnId: null,
      llmProvider: 'claude', llmModel: 'sonnet', mode: 'development', clarifyLevel: 'none', clarifyMax: 0,
      conversationId: null, slotProgress: { done: 0, total: 2, phase: 'Модель работает' }
    })
    const step = db.addCiRunStep({ runId: run.id, slot: null, position: 0, kind: 'model_work', title: 'Работа модели', status: 'running' })
    const ctx: CiModelContext = {
      runId: run.id,
      agentId: null,
      workspacePath: '/repos/p/1',
      env: {},
      signal: ctl.signal,
      addStep: () => step,
      finishStep: () => {},
      log: () => {},
      runCommandById: async () => ({ exitCode: 0, timedOut: false, output: '' }),
      setModelSessionId: () => {},
      recordFix: () => {},
      suggest: () => {},
      askUser: async () => null,
      askPlanApproval: async () => null,
      run,
      task,
      project,
      parentStepId: step.id
    }
    const work = hooks.modelWork(ctx)
    await new Promise((r) => setTimeout(r, 10))
    ctl.abort()
    await expect(work).resolves.toEqual({ ok: false, cancelled: true })
    expect(cancelled).toBe(1)
  })
})

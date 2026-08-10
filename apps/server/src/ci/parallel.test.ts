// Параллельные раны разных задач одного проекта: изоляция (своя папка, своя
// ветка), сериализация шагов с общими ресурсами (мерж в прод-ветку, пересборка
// прода), один активный ран на задачу и освобождение слота при отмене.
// Менеджер собираем напрямую (без buildServer): нужен контроль над хуком модели.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { createCiRunManager, isSharedResourceCommand, type CiRunManager, type CiRunManagerDeps } from './runManager.js'
import type { CommandExecutor, CiModelWorkHook } from './types.js'

let db: VoiceChatDb
let projectId = ''
let taskIds: string[] = []

/** Исполнитель, который умеет держать шаг до внешнего сигнала. */
interface Gate { entered: Promise<void>; release: () => void }
const gates = new Map<string, { open: Promise<void>; release: () => void; entered: () => void }>()

function gate(marker: string): Gate {
  let release: () => void = () => {}
  let entered: () => void = () => {}
  const open = new Promise<void>((res) => { release = res })
  const enteredP = new Promise<void>((res) => { entered = res })
  gates.set(marker, { open, release, entered })
  return { entered: enteredP, release }
}

/** Кто сейчас внутри шага с общим ресурсом — по маркеру скрипта. */
let inShared = 0
let maxInShared = 0
const sharedOrder: string[] = []

const executor: CommandExecutor = {
  run: async (req, onChunk, signal) => {
    if (signal?.aborted) throw new Error('Команда отменена')
    onChunk(`run:${req.script.slice(0, 24)}\n`)
    const shared = /merge/.test(req.script)
    if (shared) {
      inShared++
      maxInShared = Math.max(maxInShared, inShared)
      sharedOrder.push(`in:${req.env.TASK_NUMBER}`)
    }
    for (const [marker, g] of gates) {
      if (req.script.includes(marker)) {
        g.entered()
        await g.open
      }
    }
    if (shared) {
      inShared--
      sharedOrder.push(`out:${req.env.TASK_NUMBER}`)
    }
    return { exitCode: req.script.includes('FAIL') ? 1 : 0, timedOut: false }
  }
}

beforeEach(() => {
  let id = 0
  gates.clear()
  inShared = 0
  maxInShared = 0
  sharedOrder.length = 0
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => Date.now() })
  const project = db.createProject('admin', { name: 'P', gitUrl: 'git@github.com:x/y.git' })
  const agent = db.createAgent('admin', 'M')
  db.linkMachine('admin', project.id, agent.id)
  db.setProjectMachineReposRoot('admin', project.id, agent.id, '/repos')
  db.setProjectDefaultMachine('admin', project.id, agent.id)
  const ready = db.getBoard('admin', project.id)!.columns.find((c) => c.semanticType === 'ready')!
  projectId = project.id
  taskIds = ['T1', 'T2'].map((title) => db.createTask('admin', project.id, { columnId: ready.id, title })!.id)
})
afterEach(() => db.close())

function manager(over: Partial<CiRunManagerDeps> = {}): CiRunManager {
  return createCiRunManager({ db, executor, boardChanged: () => {}, cancelGraceMs: 150, modelWork: async () => ({ ok: true }), ...over })
}

function startRun(ci: CiRunManager, taskId: string): string {
  const r = ci.start('admin', projectId, taskId)
  if ('error' in r) throw new Error(r.error)
  return r.run.id
}

async function waitStatus(runId: string, ms = 5000): Promise<string> {
  for (let i = 0; i < ms / 10; i++) {
    const st = db.getCiRunRaw(runId)?.status
    if (st && ['success', 'failed', 'cancelled', 'timeout'].includes(st)) return st
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`ран ${runId} не завершился: ${db.getCiRunRaw(runId)?.status}`)
}

/** Команда мержа в слот «после» для обеих задач. */
function giveMergeStep(): void {
  const cmd = db.createCiCommand('admin', { scope: 'project', projectId, name: 'Влить ветку задачи в прод-ветку', script: 'git merge --no-edit "$BRANCH"' })
  db.setCiSlotCommands('project', projectId, 'after_model', [cmd.id])
}

describe('параллельные раны разных задач', () => {
  it('два рана двух задач одного проекта работают одновременно', async () => {
    let both: () => void = () => {}
    const bothStarted = new Promise<void>((res) => { both = res })
    const live = new Set<string>()
    let maxLive = 0
    const modelWork: CiModelWorkHook = async (ctx) => {
      live.add(ctx.task.id)
      maxLive = Math.max(maxLive, live.size)
      if (live.size === 2) both()
      await bothStarted
      live.delete(ctx.task.id)
      return { ok: true }
    }
    const ci = manager({ modelWork })
    const first = startRun(ci, taskIds[0])
    const second = startRun(ci, taskIds[1])
    // Оба рана дошли до модели, не дожидаясь друг друга.
    await bothStarted
    expect(maxLive).toBe(2)
    expect(await waitStatus(first)).toBe('success')
    expect(await waitStatus(second)).toBe('success')
    expect(ci.activeRunIds()).toEqual([])
  })

  it('раны работают в разных папках и разных ветках', async () => {
    const envs: Array<Record<string, string>> = []
    const spy: CommandExecutor = {
      run: async (req, onChunk, signal) => {
        envs.push(req.env)
        return executor.run(req, onChunk, signal)
      }
    }
    const ci = manager({ executor: spy })
    const first = startRun(ci, taskIds[0])
    const second = startRun(ci, taskIds[1])
    expect(await waitStatus(first)).toBe('success')
    expect(await waitStatus(second)).toBe('success')
    const paths = new Set(envs.map((e) => e.WORKSPACE))
    const branches = new Set(envs.map((e) => e.BRANCH))
    expect(paths).toEqual(new Set(['/repos/p/1', '/repos/p/2']))
    expect(branches.size).toBe(2)
  })

  it('очередь берёт ожидающие раны в текущем порядке development при нескольких свободных слотах', async () => {
    db.updateCiSettings({ maxConcurrentRuns: 2 })
    const board = db.getBoard('admin', projectId)!
    const ready = board.columns.find((column) => column.semanticType === 'ready')!
    const third = db.createTask('admin', projectId, { columnId: ready.id, title: 'T3', priority: 'medium' })!
    const fourth = db.createTask('admin', projectId, { columnId: ready.id, title: 'T4', priority: 'high' })!
    const fifth = db.createTask('admin', projectId, { columnId: ready.id, title: 'T5', priority: 'urgent' })!
    const releases = new Map<string, () => void>()
    const started: string[] = []
    const ci = manager({
      modelWork: async (ctx) => {
        started.push(ctx.task.title)
        if (ctx.task.id === taskIds[0] || ctx.task.id === taskIds[1]) {
          await new Promise<void>((resolve) => releases.set(ctx.task.id, resolve))
        }
        return { ok: true }
      }
    })

    const first = startRun(ci, taskIds[0])
    const second = startRun(ci, taskIds[1])
    for (let i = 0; i < 200 && releases.size !== 2; i++) await new Promise((r) => setTimeout(r, 5))
    const thirdRun = startRun(ci, third.id)
    const fourthRun = startRun(ci, fourth.id)
    const fifthRun = startRun(ci, fifth.id)
    expect([thirdRun, fourthRun, fifthRun].map((id) => db.getCiRunRaw(id)!.status)).toEqual(['queued', 'queued', 'queued'])

    // T5 сначала urgent, но правка ожидающей T3 поднимает её в равный приоритет;
    // одинаковый приоритет сохраняет ручный порядок (T3 создана раньше T5).
    db.updateTask('admin', projectId, third.id, { priority: 'urgent' })
    releases.get(taskIds[0])!()
    releases.get(taskIds[1])!()

    for (let i = 0; i < 200 && started.length < 4; i++) await new Promise((r) => setTimeout(r, 5))
    expect(started.slice(0, 4)).toEqual(['T1', 'T2', 'T3', 'T5'])
    expect(await waitStatus(first)).toBe('success')
    expect(await waitStatus(second)).toBe('success')
    expect(await waitStatus(thirdRun)).toBe('success')
    expect(await waitStatus(fourthRun)).toBe('success')
    expect(await waitStatus(fifthRun)).toBe('success')
  })
})

describe.skip('legacy: merge/deploy внутри разработки использовали мьютекс', () => {
  it('распознаёт шаги мержа и пересборки прода, обычные команды пропускает', () => {
    expect(isSharedResourceCommand({ name: 'Влить ветку задачи в прод-ветку', script: 'echo x' })).toBe(true)
    expect(isSharedResourceCommand({ name: 'merge', script: 'echo x' })).toBe(true)
    expect(isSharedResourceCommand({ name: 'deploy', script: 'git merge --no-edit "$BRANCH"' })).toBe(true)
    expect(isSharedResourceCommand({ name: 'Обновить прод-контейнер', script: 'echo x' })).toBe(true)
    expect(isSharedResourceCommand({ name: 'сборка', script: 'npm run docker' })).toBe(true)
    expect(isSharedResourceCommand({ name: 'Тесты', script: 'npm test' })).toBe(false)
  })

  it('мерж-шаги двух ранов не выполняются одновременно', async () => {
    giveMergeStep()
    const g = gate('merge')
    const ci = manager()
    const first = startRun(ci, taskIds[0])
    const second = startRun(ci, taskIds[1])
    // Первый занял мьютекс; второй уже дошёл до своего мержа и ждёт.
    await g.entered
    await new Promise((r) => setTimeout(r, 50))
    expect(inShared).toBe(1)
    g.release()
    expect(await waitStatus(first)).toBe('success')
    expect(await waitStatus(second)).toBe('success')
    // Ни одного пересечения: строго in→out, in→out.
    expect(maxInShared).toBe(1)
    expect(sharedOrder).toHaveLength(4)
    expect(sharedOrder[0].startsWith('in:')).toBe(true)
    expect(sharedOrder[1].startsWith('out:')).toBe(true)
    // Ожидание видно в ленте того рана, который пришёл вторым.
    const waited = [first, second].filter((id) => db.getCiRunLog('admin', id).some((l) => l.chunk.includes('жду, пока его освободит другой ран')))
    expect(waited).toHaveLength(1)
  })

  it('отмена рана, держащего мьютекс, отпускает его следующему', async () => {
    giveMergeStep()
    const g = gate('merge')
    // Исполнитель мержа глух к отмене (держит шаг до `release`) — ран закроется
    // сторожевым таймаутом, и мьютекс обязан освободиться вместе с ним, иначе
    // второй ран висит на своём мерже вечно.
    const ci = manager()
    const first = startRun(ci, taskIds[0])
    await g.entered
    const second = startRun(ci, taskIds[1])
    await new Promise((r) => setTimeout(r, 50))
    ci.cancel('admin', first)
    expect(await waitStatus(first)).toBe('cancelled')
    // Мьютекс отпущен вместе с раном: второй домержил и закрылся сам.
    g.release()
    expect(await waitStatus(second)).toBe('success')
    expect(ci.activeRunIds()).toEqual([])
  })
})

describe.skip('legacy: production rebuild внутри разработки дренировал очередь', () => {
  function giveProdRebuildStep(): void {
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId, name: 'Обновить прод-контейнер', script: 'npm run docker' })
    db.setCiSlotCommands('task', taskIds[0], 'after_model', [cmd.id])
  }

  it('освобождает слот, ждёт queued ран и не пускает новый ран перед пересборкой при maxConcurrentRuns=1', async () => {
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    giveProdRebuildStep()
    const board = db.getBoard('admin', projectId)!
    const third = db.createTask('admin', projectId, { columnId: board.columns[0].id, title: 'T3' })!
    let releaseSecondModel: () => void = () => {}
    let secondModelEntered: () => void = () => {}
    const secondModelOpen = new Promise<void>((resolve) => { releaseSecondModel = resolve })
    const secondModelEnteredP = new Promise<void>((resolve) => { secondModelEntered = resolve })
    const rebuild = gate('npm run docker')
    const modelOrder: string[] = []
    const ci = manager({
      modelWork: async (ctx) => {
        modelOrder.push(ctx.task.title)
        if (ctx.task.id === taskIds[1]) {
          secondModelEntered()
          await secondModelOpen
        }
        return { ok: true }
      }
    })
    const first = startRun(ci, taskIds[0])
    const second = startRun(ci, taskIds[1])
    await secondModelEnteredP
    const thirdRun = startRun(ci, third.id)
    expect(db.getCiRunRaw(thirdRun)!.status).toBe('queued')
    releaseSecondModel()
    await rebuild.entered
    expect(modelOrder).toContain('T2')
    expect(modelOrder).not.toContain('T3')
    rebuild.release()
    expect(await waitStatus(first)).toBe('success')
    expect(await waitStatus(second)).toBe('success')
    expect(await waitStatus(thirdRun)).toBe('success')
    expect(modelOrder.indexOf('T3')).toBeGreaterThan(modelOrder.indexOf('T2'))
    expect(db.getCiRunLog('admin', first).some((line) => line.chunk.includes('освобождаю слот и жду завершения'))).toBe(true)
  })

  it('failed ран из снимка дренирования не мешает пересборке', async () => {
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    giveProdRebuildStep()
    const rebuild = gate('npm run docker')
    const ci = manager({ modelWork: async (ctx) => ({ ok: ctx.task.id !== taskIds[1] }) })
    const first = startRun(ci, taskIds[0])
    const second = startRun(ci, taskIds[1])
    await rebuild.entered
    expect(await waitStatus(second)).toBe('failed')
    rebuild.release()
    expect(await waitStatus(first)).toBe('success')
  })

  it('awaiting_input учитывается в дренаже и отмена такого рана разблокирует пересборку', async () => {
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    giveProdRebuildStep()
    const rebuild = gate('npm run docker')
    const ci = manager({
      modelWork: async (ctx) => {
        if (ctx.task.id === taskIds[1]) await ctx.askUser(ctx.parentStepId, [{ q: 'Продолжить?', options: ['Да'] }])
        return { ok: true }
      }
    })
    const first = startRun(ci, taskIds[0])
    const second = startRun(ci, taskIds[1])
    for (let i = 0; i < 200 && db.getCiRunRaw(second)?.status !== 'awaiting_input'; i++) await new Promise((r) => setTimeout(r, 5))
    expect(db.getCiRunRaw(second)?.status).toBe('awaiting_input')
    expect(ci.cancel('admin', second)).toBe(true)
    await rebuild.entered
    rebuild.release()
    expect(await waitStatus(second)).toBe('cancelled')
    expect(await waitStatus(first)).toBe('success')
  })

  it('отмена ожидающей пересборки снимает барьер и не оставляет очередь заблокированной', async () => {
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    giveProdRebuildStep()
    let releaseSecondModel: () => void = () => {}
    let secondModelEntered: () => void = () => {}
    const secondModelOpen = new Promise<void>((resolve) => { releaseSecondModel = resolve })
    const secondModelEnteredP = new Promise<void>((resolve) => { secondModelEntered = resolve })
    const ci = manager({
      modelWork: async (ctx) => {
        if (ctx.task.id === taskIds[1]) {
          secondModelEntered()
          await secondModelOpen
        }
        return { ok: true }
      }
    })
    const first = startRun(ci, taskIds[0])
    const second = startRun(ci, taskIds[1])
    await secondModelEnteredP
    expect(ci.cancel('admin', first)).toBe(true)
    expect(await waitStatus(first)).toBe('cancelled')
    releaseSecondModel()
    expect(await waitStatus(second)).toBe('success')
  })
})

describe('один активный ран на задачу', () => {
  it('повторный старт той же задачи отклонён, соседняя задача стартует', async () => {
    let release: () => void = () => {}
    const hold = new Promise<void>((res) => { release = res })
    const ci = manager({ modelWork: async (ctx) => { if (ctx.task.id === taskIds[0]) await hold; return { ok: true } } })
    const first = startRun(ci, taskIds[0])
    for (let i = 0; i < 200 && db.getCiRunRaw(first)?.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 5))

    const again = ci.start('admin', projectId, taskIds[0])
    expect('error' in again && again.error).toContain('уже выполняется')
    // Другая задача — можно.
    const second = startRun(ci, taskIds[1])
    expect(await waitStatus(second)).toBe('success')
    release()
    expect(await waitStatus(first)).toBe('success')
    // Задача освободилась — новый ран запускается.
    expect('run' in ci.start('admin', projectId, taskIds[0])).toBe(true)
  })

  it('отмена освобождает слот: следующий ран из очереди стартует сам', async () => {
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    const ci = manager({
      modelWork: async (ctx) => {
        if (ctx.task.id !== taskIds[0]) return { ok: true }
        await new Promise<void>((res) => {
          if (ctx.signal.aborted) return res()
          ctx.signal.addEventListener('abort', () => res(), { once: true })
        })
        return { ok: false, cancelled: true }
      }
    })
    const first = startRun(ci, taskIds[0])
    const second = startRun(ci, taskIds[1])
    for (let i = 0; i < 200 && db.getCiRunRaw(first)?.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 5))
    expect(db.getCiRunRaw(second)!.status).toBe('queued')
    ci.cancel('admin', first)
    expect(await waitStatus(first)).toBe('cancelled')
    expect(await waitStatus(second)).toBe('success')
    expect(ci.activeRunIds()).toEqual([])
  })
})

describe('маршрутизация production-команд', () => {
  it('команду с PROD_DIR запускает на машине production checkout, а обычную — на машине рана', async () => {
    const productionAgent = db.createAgent('admin', 'Production')
    db.linkMachine('admin', projectId, productionAgent.id)
    db.setProjectMachinePath('admin', projectId, productionAgent.id, '/srv/voicechat')
    const regular = db.createCiCommand('admin', { scope: 'project', projectId, name: 'Обычная', script: 'echo regular' })
    const production = db.createCiCommand('admin', { scope: 'project', projectId, name: 'Прод', script: 'echo production', env: { PROD_DIR: '/srv/voicechat/' } })
    db.setCiSlotCommands('project', projectId, 'after_model', [regular.id, production.id])
    const requests: Array<{ script: string; agentId: string; workdir: string }> = []
    const ci = manager({ executor: { run: async (req) => { requests.push(req); return { exitCode: 0, timedOut: false } } } })

    expect(await waitStatus(startRun(ci, taskIds[0]))).toBe('success')
    expect(requests.find((req) => req.script === 'echo regular')).toMatchObject({ agentId: db.getProject('admin', projectId)!.defaultAgentId, workdir: '/repos/p' })
    expect(requests.find((req) => req.script === 'echo production')).toMatchObject({ agentId: productionAgent.id, workdir: '/srv/voicechat' })
  })

  it('останавливает production-команду с понятной ошибкой, если PROD_DIR не принадлежит машине проекта', async () => {
    const production = db.createCiCommand('admin', { scope: 'project', projectId, name: 'Прод', script: 'echo production', env: { PROD_DIR: '/missing/prod' } })
    db.setCiSlotCommands('project', projectId, 'after_model', [production.id])
    const ci = manager()
    const runId = startRun(ci, taskIds[0])

    expect(await waitStatus(runId)).toBe('failed')
    expect(db.getCiRunLog('admin', runId).some((line) => line.chunk.includes('PROD_DIR=/missing/prod не совпадает с папкой ни одной машины проекта'))).toBe(true)
  })
})

describe('инвариант изоляции', () => {
  it('ран на занятой папке и ветке не начинает работу', async () => {
    // Две задачи с одинаковым номером в одном проекте штатно не создать, поэтому
    // ломаем инвариант так, как это может сделать конфигурация: шаблон ветки без
    // {task_number} и {slug} — тогда ветка у обеих задач одна и та же.
    db.updateProject('admin', projectId, { ciBranchTemplate: 'feature/shared' })
    let release: () => void = () => {}
    const hold = new Promise<void>((res) => { release = res })
    const ci = manager({ modelWork: async (ctx) => { if (ctx.task.id === taskIds[0]) await hold; return { ok: true } } })
    const first = startRun(ci, taskIds[0])
    for (let i = 0; i < 200 && db.getCiRunRaw(first)?.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 5))
    const second = startRun(ci, taskIds[1])
    expect(await waitStatus(second)).toBe('failed')
    const steps = db.getCiRun('admin', second)!.steps
    expect(steps).toHaveLength(1)
    expect(steps[0].title).toBe('Проверка изоляции рабочей директории')
    expect(db.getCiRunLog('admin', second).some((l) => l.chunk.includes('в разных папках и разных ветках'))).toBe(true)
    release()
    expect(await waitStatus(first)).toBe('success')
  })
})

/** Вторая машина проекта — для распределения параллельных запусков. */
function linkSecondMachine(): string {
  const agent = db.createAgent('admin', 'M2')
  db.linkMachine('admin', projectId, agent.id)
  db.setProjectMachineReposRoot('admin', projectId, agent.id, '/repos-b')
  return agent.id
}

/** Ран, который держит шаг модели до вызова release (статус running). */
function holdModel(): { hold: Promise<void>; release: () => void } {
  let release: () => void = () => {}
  const hold = new Promise<void>((res) => { release = res })
  return { hold, release }
}

async function waitRunning(runId: string): Promise<void> {
  for (let i = 0; i < 400 && db.getCiRunRaw(runId)?.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 5))
  expect(db.getCiRunRaw(runId)?.status).toBe('running')
}

describe('параллельный запуск мимо очереди', () => {
  it('при maxConcurrentRuns=1 параллельный ран не ждёт очередь', async () => {
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    const { hold, release } = holdModel()
    const ci = manager({ modelWork: async (ctx) => { if (ctx.task.id === taskIds[0]) await hold; return { ok: true } } })
    const first = startRun(ci, taskIds[0])
    await waitRunning(first)
    const res = ci.start('admin', projectId, taskIds[1], { launch: 'parallel' })
    if ('error' in res) throw new Error(res.error)
    // Второй ран закончился, пока первый всё ещё держит единственный слот.
    expect(await waitStatus(res.run.id)).toBe('success')
    expect(db.getCiRunRaw(first)!.status).toBe('running')
    release()
    expect(await waitStatus(first)).toBe('success')
  })

  it('свободная машина по умолчанию выбирается первой', async () => {
    linkSecondMachine()
    const ci = manager()
    const res = ci.start('admin', projectId, taskIds[0], { launch: 'parallel' })
    if ('error' in res) throw new Error(res.error)
    expect(res.run.agentId).toBe(db.getProject('admin', projectId)!.defaultAgentId)
    expect(await waitStatus(res.run.id)).toBe('success')
  })

  it('занятая машина по умолчанию уступает свободной, и ран выполняется на ней', async () => {
    const second = linkSecondMachine()
    const { hold, release } = holdModel()
    const agents: string[] = []
    const spy: CommandExecutor = {
      run: async (req, onChunk, signal) => { agents.push(req.agentId); return executor.run(req, onChunk, signal) }
    }
    const ci = manager({ executor: spy, modelWork: async (ctx) => { if (ctx.task.id === taskIds[0]) await hold; return { ok: true } } })
    const first = startRun(ci, taskIds[0])
    await waitRunning(first)
    const res = ci.start('admin', projectId, taskIds[1], { launch: 'parallel' })
    if ('error' in res) throw new Error(res.error)
    expect(res.run.agentId).toBe(second)
    expect(await waitStatus(res.run.id)).toBe('success')
    // Команды параллельного рана действительно ушли на выбранную машину.
    expect(agents).toContain(second)
    release()
    expect(await waitStatus(first)).toBe('success')
  })

  it('свободных машин нет — берётся наименее загруженная, ран с NULL-машиной учитывается за машиной по умолчанию', async () => {
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    const second = linkSecondMachine()
    const defaultAgent = db.getProject('admin', projectId)!.defaultAgentId!
    const third = db.createTask('admin', projectId, { columnId: db.getBoard('admin', projectId)!.columns[0].id, title: 'T3' })!.id
    const { hold, release } = holdModel()
    const ci = manager({ modelWork: async (ctx) => { if (ctx.task.id === taskIds[0]) await hold; return { ok: true } } })
    // Обе машины заняты: на умолчальной ран работает, вторая держит очередь
    // задачей с закреплённой машиной; плюс ран без машины — тоже за умолчальной.
    const first = startRun(ci, taskIds[0])
    await waitRunning(first)
    db.updateTask('admin', projectId, taskIds[1], { agentId: second })
    const queuedOnSecond = startRun(ci, taskIds[1])
    db.updateCiRun(first, { agentId: null })
    expect(db.countActiveCiRunsByAgent()).toEqual({ [defaultAgent]: 1, [second]: 1 })
    // Умолчальная — 1 активный ран (NULL учтён), вторая — 1: при равенстве
    // выбирается машина по умолчанию.
    const res = ci.start('admin', projectId, third, { launch: 'parallel' })
    if ('error' in res) throw new Error(res.error)
    expect(res.run.agentId).toBe(defaultAgent)
    expect(await waitStatus(res.run.id)).toBe('success')
    release()
    expect(await waitStatus(first)).toBe('success')
    expect(await waitStatus(queuedOnSecond)).toBe('success')
  })

  it('карточка с закреплённой машиной при параллельном запуске уходит на неё, а не в автоподбор', async () => {
    const second = linkSecondMachine()
    db.updateTask('admin', projectId, taskIds[0], { agentId: second })
    const ci = manager()
    const res = ci.start('admin', projectId, taskIds[0], { launch: 'parallel' })
    if ('error' in res) throw new Error(res.error)
    expect(res.run.agentId).toBe(second)
    expect(await waitStatus(res.run.id)).toBe('success')
  })
})

describe('принудительный запуск на указанной машине', () => {
  it('простаивающая задача стартует сразу на указанной машине, мимо очереди', async () => {
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    const second = linkSecondMachine()
    const { hold, release } = holdModel()
    const ci = manager({ modelWork: async (ctx) => { if (ctx.task.id === taskIds[0]) await hold; return { ok: true } } })
    const first = startRun(ci, taskIds[0])
    await waitRunning(first)
    const res = ci.forceStartOnMachine('admin', projectId, taskIds[1], second)
    if ('error' in res) throw new Error(res.error)
    expect(res.run.agentId).toBe(second)
    expect(await waitStatus(res.run.id)).toBe('success')
    release()
    expect(await waitStatus(first)).toBe('success')
  })

  it('ран из очереди продвигается: тот же ран получает машину и уходит в работу', async () => {
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    const second = linkSecondMachine()
    const { hold, release } = holdModel()
    const ci = manager({ modelWork: async (ctx) => { if (ctx.task.id === taskIds[0]) await hold; return { ok: true } } })
    const first = startRun(ci, taskIds[0])
    await waitRunning(first)
    const queued = startRun(ci, taskIds[1])
    expect(db.getCiRunRaw(queued)!.status).toBe('queued')
    const res = ci.forceStartOnMachine('admin', projectId, taskIds[1], second)
    if ('error' in res) throw new Error(res.error)
    // Продвинут именно ожидающий ран, а не создан новый.
    expect(res.run.id).toBe(queued)
    expect(res.run.agentId).toBe(second)
    expect(await waitStatus(queued)).toBe('success')
    // Первый ран всё ещё держит единственный слот — очередь не пострадала.
    expect(db.getCiRunRaw(first)!.status).toBe('running')
    release()
    expect(await waitStatus(first)).toBe('success')
    expect(ci.activeRunIds()).toEqual([])
  })

  it('уже выполняющийся ран не перезапускается, чужая машина отклоняется', async () => {
    const second = linkSecondMachine()
    const { hold, release } = holdModel()
    const ci = manager({ modelWork: async (ctx) => { if (ctx.task.id === taskIds[0]) await hold; return { ok: true } } })
    const first = startRun(ci, taskIds[0])
    await waitRunning(first)
    const busy = ci.forceStartOnMachine('admin', projectId, taskIds[0], second)
    expect('error' in busy && busy.error).toContain('уже выполняется')
    const foreign = ci.forceStartOnMachine('admin', projectId, taskIds[1], 'nope')
    expect('error' in foreign && foreign.error).toContain('не привязана')
    release()
    expect(await waitStatus(first)).toBe('success')
  })
})

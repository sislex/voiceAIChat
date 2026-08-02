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

  it('FIFO-очередь: при maxConcurrentRuns=1 второй ран ждёт первого', async () => {
    db.updateCiSettings({ maxConcurrentRuns: 1 })
    let release: () => void = () => {}
    const hold = new Promise<void>((res) => { release = res })
    const ci = manager({ modelWork: async (ctx) => { if (ctx.task.id === taskIds[0]) await hold; return { ok: true } } })
    const first = startRun(ci, taskIds[0])
    const second = startRun(ci, taskIds[1])
    for (let i = 0; i < 200 && db.getCiRunRaw(first)?.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 5))
    expect(db.getCiRunRaw(second)!.status).toBe('queued')
    release()
    expect(await waitStatus(first)).toBe('success')
    expect(await waitStatus(second)).toBe('success')
  })
})

describe('мьютекс общих ресурсов', () => {
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

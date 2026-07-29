import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'
import type { CommandExecutor } from './types.js'
import type { LlmClient } from '../claude/types.js'
import { ciToolBroker } from './ciCommandsMcp.js'

const SECRET = 'ci-secret'
let app: FastifyInstance, db: VoiceChatDb, admin: string
let scripts: string[] = []

const fakeClaude: LlmClient = {
  send: (req, handlers) => {
    void (async () => {
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

const counts = new Map<string, number>()
const ciExecutor: CommandExecutor = {
  run: async (req, onChunk) => {
    scripts.push(req.script)
    const n = (counts.get(req.script) ?? 0) + 1
    counts.set(req.script, n)
    onChunk(`run:${req.script.slice(0, 20)}\n`)
    // FLAKY падает на первом прогоне и проходит на повторе (эмуляция «исправлено моделью»).
    const flakyOk = req.script.includes('FLAKY') && n >= 2
    const fail = req.script.includes('FAIL') || (req.script.includes('FLAKY') && !flakyOk)
    return { exitCode: fail ? 1 : 0, timedOut: false }
  }
}

beforeEach(async () => {
  let id = 0
  scripts = []
  counts.clear()
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => Date.now() })
  app = await buildServer({ config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-ci-${Date.now()}`) }), db, sessionSecret: SECRET, ciExecutor, claude: fakeClaude })
  admin = signToken({ name: 'admin', role: 'admin' }, SECRET)
})
afterEach(async () => { await app.close(); db.close() })

const inj = (token: string, opts: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: object }) =>
  app.inject({ ...opts, headers: { authorization: `Bearer ${token}` } })

function setup() {
  const project = db.createProject('admin', { name: 'P', gitUrl: 'git@github.com:x/y.git' })
  const agent = db.createAgent('admin', 'M')
  db.linkMachine('admin', project.id, agent.id)
  db.setProjectMachineFeatureReposRoot('admin', project.id, agent.id, '/repos')
  db.setProjectDefaultMachine('admin', project.id, agent.id)
  const board = db.getBoard('admin', project.id)!
  const ready = board.columns.find((c) => c.semanticType === 'ready')!
  const task = db.createTask('admin', project.id, { columnId: ready.id, title: 'T1' })!
  return { project, task, readyColId: ready.id }
}

async function run(projectId: string, taskId: string): Promise<string> {
  const res = await inj(admin, { method: 'POST', url: `/api/projects/${projectId}/tasks/${taskId}/ci/run` })
  expect(res.statusCode).toBe(202)
  return res.json().id as string
}

async function waitRun(runId: string): Promise<{ run: { status: string; taskId: string }; steps: Array<{ kind: string; status: string }> }> {
  for (let i = 0; i < 100; i++) {
    const r = await inj(admin, { method: 'GET', url: `/api/ci/runs/${runId}` })
    const d = r.json()
    if (['success', 'failed', 'cancelled', 'timeout'].includes(d.run.status)) return d
    await new Promise((res) => setTimeout(res, 10))
  }
  throw new Error('run did not finish')
}

describe('ci run manager', () => {
  it('пустые слоты: ран = работа модели + резюме → success', async () => {
    const { project, task } = setup()
    const runId = await run(project.id, task.id)
    const d = await waitRun(runId)
    expect(d.run.status).toBe('success')
    expect(d.steps.map((s) => s.kind)).toContain('model_work')
    expect(d.steps.map((s) => s.kind)).toContain('model_summary')
    // Лог рана содержит строки.
    const log = (await inj(admin, { method: 'GET', url: `/api/ci/runs/${runId}/log` })).json()
    expect(Array.isArray(log)).toBe(true)
    expect(log.length).toBeGreaterThan(0)
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

  it('is_cleanup освобождает рабочую директорию', async () => {
    const { project, task } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'cleanup', script: 'rm -rf', isCleanup: true })
    db.setCiSlotCommands('task', task.id, 'after_model', [cmd.id])
    const runId = await run(project.id, task.id)
    await waitRun(runId)
    const report = db.listCiWorkspaceReport('admin', project.id)
    expect(report.some((w) => w.state === 'released')).toBe(true)
  })

  it('конкурентные раны одного проекта сериализуются очередью', async () => {
    const { project, task } = setup()
    const r1 = await run(project.id, task.id)
    const r2 = await run(project.id, task.id)
    const [d1, d2] = await Promise.all([waitRun(r1), waitRun(r2)])
    expect(d1.run.status).toBe('success')
    expect(d2.run.status).toBe('success')
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
  it('консоль: read-only пропускает ls и отклоняет rm', async () => {
    const { project, task } = setup()
    const runId = await run(project.id, task.id)
    await waitRun(runId)
    const ok = await inj(admin, { method: 'POST', url: `/api/ci/runs/${runId}/console`, payload: { command: 'ls -la' } })
    expect(ok.json().rejected).toBe(false)
    const denied = await inj(admin, { method: 'POST', url: `/api/ci/runs/${runId}/console`, payload: { command: 'rm -rf /' } })
    expect(denied.json().rejected).toBe(true)
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
})

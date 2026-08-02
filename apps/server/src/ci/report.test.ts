// Отчёт по рану и по задаче: расход модели (стоимость, токены, число запросов,
// время работы модели) плюс шаги CI со статусом и длительностью.
//
// Ключевое здесь — что расход вообще доезжает до БД: `runTurn` раньше выбрасывал
// и `meta` из `onDone`, и `onUsage`, поэтому LLM-клиент в тестах обязан отдавать
// оба. Второй инвариант — обратная совместимость: у рана без строк расхода отчёт
// открывается и показывает шаги, а не падает.

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
import type { CiRunReport, CiTaskReport, TurnMeta } from '@voicechat/shared'

const SECRET = 'ci-secret'
let app: FastifyInstance, db: VoiceChatDb, admin: string
/** Что мок CLI сообщает о ходе; null — CLI промолчал (старое поведение). */
let turnMeta: TurnMeta | null = null
/** Инструменты, которые «вызывает» мок за ход (имена — как их называет CLI). */
let turnTools: string[] = []
/** Тексты результатов вызовов за ход: по ним считаются отказы. */
let turnResults: string[] = []
/**
 * Сколько мок «думает» перед ответом. Нужно там, где проверяется замер
 * длительности хода сервером: мгновенный ход укладывается в одну миллисекунду, и
 * замер честно даёт ноль.
 */
let turnDelayMs = 0

const fakeClaude: LlmClient = {
  send: (_req, handlers) => {
    setTimeout(() => {
      for (const tool of turnTools) {
        handlers.onActivity?.({ kind: 'tool_use', summary: `${tool}: …`, raw: '{}', tool })
      }
      // Результат вызова приходит без имени инструмента — как в реальной ленте.
      for (const text of turnResults) {
        handlers.onActivity?.({ kind: 'tool_result', summary: `✗ ошибка: ${text}`, detail: text, raw: '{}' })
      }
      if (turnMeta) {
        handlers.onUsage?.({
          inputTokens: turnMeta.inputTokens,
          outputTokens: turnMeta.outputTokens,
          cacheReadTokens: turnMeta.cacheReadTokens,
          cacheCreationTokens: turnMeta.cacheCreationTokens
        })
      }
      handlers.onDelta('готово')
      handlers.onDone('готово', turnMeta ?? undefined)
    }, turnDelayMs)
    return { cancel: () => {} }
  }
}

const ciExecutor: CommandExecutor = {
  run: async (req, onChunk) => {
    onChunk(`run:${req.script}\n`)
    return { exitCode: 0, timedOut: false }
  }
}

beforeEach(async () => {
  let id = 0
  turnTools = []
  turnResults = []
  turnDelayMs = 0
  turnMeta = {
    inputTokens: 1000, outputTokens: 200, cacheReadTokens: 5000, cacheCreationTokens: 300,
    costUsd: 0.25, durationMs: 4000, numTurns: 3, model: 'claude-sonnet-5'
  }
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => Date.now() })
  app = await buildServer({ config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-ci-report-${Date.now()}`) }), db, sessionSecret: SECRET, ciExecutor, claude: fakeClaude, codex: fakeClaude })
  admin = signToken({ name: 'admin', role: 'admin' }, SECRET)
})
afterEach(async () => { await app.close(); db.close() })

const inj = (token: string, url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })

function setup() {
  const project = db.createProject('admin', { name: 'P', gitUrl: 'git@github.com:x/y.git' })
  const agent = db.createAgent('admin', 'M')
  db.linkMachine('admin', project.id, agent.id)
  db.setProjectMachineReposRoot('admin', project.id, agent.id, '/repos')
  db.setProjectDefaultMachine('admin', project.id, agent.id)
  const board = db.getBoard('admin', project.id)!
  const ready = board.columns.find((c) => c.semanticType === 'ready')!
  const task = db.createTask('admin', project.id, { columnId: ready.id, title: 'T1' })!
  return { project, task }
}

async function runTask(projectId: string, taskId: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/tasks/${taskId}/ci/run`, headers: { authorization: `Bearer ${admin}` } })
  expect(res.statusCode).toBe(202)
  const runId = res.json().id as string
  for (let i = 0; i < 200; i++) {
    const d = (await inj(admin, `/api/ci/runs/${runId}`)).json()
    if (['success', 'failed', 'cancelled', 'timeout'].includes(d.run.status)) return runId
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('run did not finish')
}

describe('расход модели пишется по каждому ходу', () => {
  it('после рана в ci_run_usage есть строка на ход работы модели и на резюме', async () => {
    const { project, task } = setup()
    const runId = await runTask(project.id, task.id)

    const rows = db.listCiRunUsage(runId)
    expect(rows.map((r) => r.kind)).toEqual(['model_work', 'summary'])
    expect(rows[0]).toMatchObject({
      runId, provider: 'claude', model: 'claude-sonnet-5',
      inputTokens: 1000, outputTokens: 200, cacheReadTokens: 5000, cacheCreationTokens: 300,
      costUsd: 0.25, durationMs: 4000, numTurns: 3
    })
    // Привязка к шагу: расход работы модели лежит на её шаге ленты.
    const steps = (await inj(admin, `/api/ci/runs/${runId}`)).json().steps as Array<{ id: string; kind: string }>
    expect(rows[0].stepId).toBe(steps.find((s) => s.kind === 'model_work')!.id)
    expect(rows[1].stepId).toBe(steps.find((s) => s.kind === 'model_summary')!.id)
  })

  it('ход без метаданных CLI строкой расхода не становится', async () => {
    turnMeta = null
    const { project, task } = setup()
    const runId = await runTask(project.id, task.id)
    expect(db.listCiRunUsage(runId)).toEqual([])
  })
})

describe('GET /api/ci/runs/:runId/report', () => {
  it('отдаёт суммы токенов, стоимость, число запросов, время модели и все шаги', async () => {
    const { project, task } = setup()
    const cmd = db.createCiCommand('admin', { scope: 'project', projectId: project.id, name: 'Тесты', script: 'npm test' })
    db.setCiSlotCommands('task', task.id, 'after_model', [cmd.id])
    const runId = await runTask(project.id, task.id)

    const res = await inj(admin, `/api/ci/runs/${runId}/report`)
    expect(res.statusCode).toBe(200)
    const report = res.json() as CiRunReport
    expect(report).toMatchObject({ runId, projectId: project.id, taskId: task.id, status: 'success', provider: 'claude' })
    expect(report.totals.requests).toBe(2)
    expect(report.totals.inputTokens).toBe(2000)
    expect(report.totals.outputTokens).toBe(400)
    expect(report.totals.cacheReadTokens).toBe(10_000)
    expect(report.totals.cacheCreationTokens).toBe(600)
    expect(report.totals.tokens).toBe(13_000)
    expect(report.totals.costUsd).toBeCloseTo(0.5, 10)
    expect(report.totals.costEstimated).toBe(false)
    expect(report.kbHit).toBeNull()
    expect(report.totals.modelActiveMs).toBe(8000)
    // Шаги: команда слота, работа модели и резюме — со статусом и длительностью.
    expect(report.steps.map((s) => s.title)).toContain('Тесты')
    const modelStep = report.steps.find((s) => s.kind === 'model_work')!
    expect(modelStep.status).toBe('success')
    expect(modelStep.durationMs).not.toBeNull()
    expect(modelStep.usage!.requests).toBe(1)
    const commandStep = report.steps.find((s) => s.title === 'Тесты')!
    expect(commandStep.usage).toBeNull()
    expect(commandStep.durationMs).not.toBeNull()
  })

  it('показывает сохранённое попадание разделов БЗ в открытые файлы', async () => {
    const { project, task } = setup()
    const conv = db.createConversation('admin', 'CI')
    db.setConversationProject('admin', conv.id, project.id)
    const run = db.createCiRun({
      projectId: project.id, taskId: task.id, agentId: null, triggeredBy: 'admin',
      prevColumnId: null, conversationId: conv.id, slotProgress: { done: 0, total: 0, phase: '' }
    })
    const step = db.addCiRunStep({ runId: run.id, slot: null, position: 0, kind: 'model_work', title: 'Работа модели' })
    db.addKbUsage({
      userId: 'admin', conversationId: conv.id, projectId: project.id, ciRunId: run.id, ciStepId: step.id,
      source: 'auto', query: 'ci', chars: 100,
      sections: [{
        documentId: 'ci', anchor: 'report', sourcePath: 'docs/kb/features/ci-runner.md',
        relatedFiles: ['apps/server/src/routes/ci.ts'], chars: 100
      }]
    })
    db.appendCiLog(run.id, step.id, 'system', '[tool_use] Read: /repo/apps/server/src/routes/ci.ts')
    expect(db.calculateAndSaveCiKbHit(run.id)).toEqual({ sectionsDelivered: 1, sectionsHit: 1, hitRatio: 1 })

    const report = (await inj(admin, `/api/ci/runs/${run.id}/report`)).json() as CiRunReport
    expect(report.kbHit).toEqual({ sectionsDelivered: 1, sectionsHit: 1, hitRatio: 1 })
  })

  it('без стоимости от CLI считает оценку по прайсу и помечает её', async () => {
    turnMeta = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 1000, model: 'sonnet' }
    const { project, task } = setup()
    const runId = await runTask(project.id, task.id)

    const report = (await inj(admin, `/api/ci/runs/${runId}/report`)).json() as CiRunReport
    expect(report.totals.costEstimated).toBe(true)
    // sonnet — 3 USD за 1M входных токенов, два хода.
    expect(report.totals.costUsd).toBeCloseTo(6, 6)
  })

  // Модель у стадий разная (разработка — на модели рана, резюме — на дешёвой),
  // и по одной сумме за ран уже не понять, кто сколько съел.
  it('разбивает расход по стадиям и моделям, которыми они считались', async () => {
    // CLI модель не назвал (штатное поведение codex) — в расход идёт та, которой
    // ход РЕАЛЬНО запускали: у резюме это дешёвая модель стадии.
    turnMeta = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 2000 }
    const { project, task } = setup()
    const runId = await runTask(project.id, task.id)

    const report = (await inj(admin, `/api/ci/runs/${runId}/report`)).json() as CiRunReport
    expect(report.stages.map((s) => [s.kind, s.model, s.totals.requests])).toEqual([
      ['model_work', 'opus', 1],
      ['summary', 'haiku', 1]
    ])
    // Сумма стадий — тот же итог рана: разбивка ничего не теряет и не двоит.
    expect(report.stages.reduce((acc, s) => acc + s.totals.tokens, 0)).toBe(report.totals.tokens)
  })

  it('показывает вызовы инструментов рана с разбивкой по видам', async () => {
    turnTools = ['mcp__remote__read', 'mcp__remote__read', 'mcp__remote__grep', 'mcp__remote__edit', 'mcp__remote__bash', 'mcp__kb__search']
    const { project, task } = setup()
    const runId = await runTask(project.id, task.id)

    const report = (await inj(admin, `/api/ci/runs/${runId}/report`)).json() as CiRunReport
    // Два хода (работа модели и резюме) — счётчики складываются по рану.
    expect(report.toolCalls).toEqual({ bash: 2, read: 4, grep: 2, edit: 2, kb: 2, other: 0, denied: 0 })
  })

  it('отказы вызовов считаются отдельно и не путаются с упавшей командой', async () => {
    turnTools = ['mcp__remote__bash']
    turnResults = [
      "Claude requested permissions to use mcp__remote__edit, but you haven't granted it yet.",
      'Отклонено: это чтение файла, а его делает инструмент read.',
      '[exit code: 1]' // обычная ошибка команды — не отказ
    ]
    const { project, task } = setup()
    const runId = await runTask(project.id, task.id)

    const report = (await inj(admin, `/api/ci/runs/${runId}/report`)).json() as CiRunReport
    // Два хода: по одному вызову bash и по два отказа в каждом.
    expect(report.toolCalls).toMatchObject({ bash: 2, denied: 4 })
  })

  it('ран через исполнителя: у codex время работы модели считает сервер, стоимость — прайс', async () => {
    // Так отвечает codex: usage без стоимости, длительности и num_turns.
    turnDelayMs = 5
    const { project, task } = setup()
    db.setCiLlmConfig('task', task.id, { provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    const codexUsage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 800_000, cacheCreationTokens: 0 }
    turnMeta = { ...codexUsage } // мок отдаёт только счётчики, без costUsd/durationMs
    const runId = await runTask(project.id, task.id)

    const rows = db.listCiRunUsage(runId)
    // Вход приведён к «без кэша» на записи: 1M пришедших минус 800k из кэша.
    expect(rows[0]).toMatchObject({ provider: 'codex', model: 'gpt-5.4', inputTokens: 200_000, inputSemantics: 'no_cache' })
    const report = (await inj(admin, `/api/ci/runs/${runId}/report`)).json() as CiRunReport
    expect(report.totals.requests).toBe(2)
    expect(report.totals.inputTokens).toBe(400_000)
    // gpt-семейство: вход 1.25 и чтение кэша 0.125 за 1M — оценка, а не прочерк.
    expect(report.totals.costUsd).toBeCloseTo((400_000 * 1.25 + 1_600_000 * 0.125) / 1e6, 6)
    expect(report.totals.costEstimated).toBe(true)
    expect(report.totals.costUnderstated).toBe(false)
    // Длительности CLI не дал — «работа модели» считается по замеру хода.
    expect(report.totals.modelActiveMs).toBeGreaterThan(0)
  })

  it('ран без строк расхода (старые раны) открывается: шаги и время есть, расход пуст', async () => {
    const { project, task } = setup()
    const run = db.createCiRun({ projectId: project.id, taskId: task.id, agentId: null, triggeredBy: 'admin', prevColumnId: null, slotProgress: { done: 1, total: 1, phase: 'Готово' } })
    db.addCiRunStep({ runId: run.id, slot: null, position: 0, kind: 'model_work', title: 'Работа модели', status: 'success' })
    db.updateCiRun(run.id, { status: 'success', durationMs: 1234 })

    const report = (await inj(admin, `/api/ci/runs/${run.id}/report`)).json() as CiRunReport
    expect(report.durationMs).toBe(1234)
    expect(report.steps).toHaveLength(1)
    expect(report.steps[0].usage).toBeNull()
    expect(report.totals.requests).toBe(0)
    expect(report.totals.costUsd).toBeNull()
    expect(report.totals.costEstimated).toBe(false)
    expect(report.kbHit).toBeNull()
    // Счётчика вызовов у старого рана нет вовсе: нули читались бы как поломка.
    expect(report.toolCalls).toBeNull()
  })

  it('чужому пользователю — 404, а не пустой отчёт', async () => {
    const { project, task } = setup()
    const runId = await runTask(project.id, task.id)
    db.createUser('bob', '', 'user')
    const bob = signToken({ name: 'bob', role: 'user' }, SECRET)

    expect((await inj(bob, `/api/ci/runs/${runId}/report`)).statusCode).toBe(404)
    expect((await inj(bob, `/api/projects/${project.id}/tasks/${task.id}/report`)).statusCode).toBe(404)
    expect((await inj(admin, '/api/ci/runs/нет-такого/report')).statusCode).toBe(404)
  })
})

describe('GET /api/projects/:id/tasks/:taskId/report', () => {
  it('складывает все раны задачи: повтор добавляет свой расход к итогу', async () => {
    const { project, task } = setup()
    const first = await runTask(project.id, task.id)
    const second = await runTask(project.id, task.id)

    const report = (await inj(admin, `/api/projects/${project.id}/tasks/${task.id}/report`)).json() as CiTaskReport
    expect(report.runs.map((r) => r.runId)).toEqual([second, first])
    expect(report.totals.requests).toBe(4)
    expect(report.totals.costUsd).toBeCloseTo(1, 10)
    expect(report.totals.modelActiveMs).toBe(16_000)
    expect(report.durationMs).toBe(report.runs.reduce((a, r) => a + (r.durationMs ?? 0), 0))
  })

  it('несуществующая задача — 404', async () => {
    const { project } = setup()
    expect((await inj(admin, `/api/projects/${project.id}/tasks/нет-такой/report`)).statusCode).toBe(404)
  })
})

// База знаний в ходах модели CI-рана: форма запроса к CLI по режимам рана,
// авто-контекст по теме задачи и — отдельно — освобождение токена БЗ.
//
// Токен важнее формы запроса: пока он в брокере, им можно читать базу от имени
// рана. Поэтому «отмена рана снимает токен» проверяется и для работы модели, и
// для fix-loop, а брокер здесь — двойник, который умеет показать живые токены.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { createCiModelHooks } from './modelHooks.js'
import type { CiFixContext, CiModelContext } from './types.js'
import type { LlmClient, LlmRequest } from '../claude/types.js'
import type { KnowledgeBaseService } from '../kb/types.js'
import { createKbUsageTracker } from '../kb/usage.js'

const U = 'alice'
const KB_MCP = 'http://127.0.0.1:8787/mcp/kb?k=secret'

/** Клиент CLI: запоминает запросы и сразу закрывает ход. */
function recorder(text = 'готово'): { client: LlmClient; last: () => LlmRequest | undefined; all: () => LlmRequest[] } {
  const seen: LlmRequest[] = []
  return {
    client: {
      send: (req, handlers) => {
        seen.push(req)
        handlers.onDelta?.(text)
        handlers.onDone?.(text)
        return { cancel: () => {} }
      }
    },
    last: () => seen[seen.length - 1],
    all: () => seen
  }
}

/** Клиент, который держит ход открытым: отмену делаем сами. */
const silent: LlmClient = { send: () => ({ cancel: () => {} }) }

const bundle = {
  query: 'тема', confidence: 'high' as const, autoInjectAllowed: true,
  sections: [{
    documentId: 'ci-runner', chunkId: 'ci-runner#model', title: 'CI-раннер', heading: 'Работа модели',
    excerpt: 'Хуки модели живут в modelHooks.', text: 'Хуки модели живут в modelHooks.', score: 12, matchTypes: ['symbol' as const],
    explanation: 'символ', freshness: 'current' as const, sourcePath: 'docs/kb/features/ci-runner.md', anchor: 'model',
    symbols: [], relatedFiles: []
  }],
  relatedFiles: [], relatedDocuments: ['ci-runner'], staleWarnings: [], estimatedTokens: 20
}

function stubKb(over: Partial<KnowledgeBaseService> = {}): KnowledgeBaseService {
  return {
    status: () => ({ available: true, mode: 'source', searchMode: 'lexical', version: 'x', createdAt: 'now', documents: 1, chunks: 1, staleDocuments: 0 }),
    topics: () => [],
    document: () => null,
    search: async () => [],
    context: async () => bundle,
    ...over
  }
}

/** Брокер токенов хода: следим за выдачей и — важнее — за освобождением. */
function broker(): { register: (t: string, e: unknown) => void; unregister: (t: string) => void; live: () => string[] } {
  const live = new Set<string>()
  return { register: (t) => live.add(t), unregister: (t) => live.delete(t), live: () => [...live] }
}

let db: VoiceChatDb
beforeEach(() => {
  let id = 0
  let clock = 1_000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.createUser(U, '', 'user')
})
afterEach(() => db.close())

/** Проект + задача + ран заданного режима БЗ; ctx — как его собирает runManager. */
function setup(kbContextMode: 'auto' | 'manual' | 'off' = 'auto', signal = new AbortController().signal, taskOver: { description?: string; acceptanceCriteria?: string } = {}) {
  const project = db.createProject(U, { name: 'P' })
  const board = db.getBoard(U, project.id)!
  const task = db.createTask(U, project.id, { title: 'Кнопка «Выполнить»', columnId: board.columns[0].id, description: 'Ран должен ходить в БЗ', acceptanceCriteria: 'Обращения видны', ...taskOver })!
  const conv = db.createConversation(U, 'Чат задачи')
  const run = db.createCiRun({
    projectId: project.id, taskId: task.id, agentId: null, triggeredBy: U, prevColumnId: null,
    conversationId: conv.id, kbContextMode, slotProgress: { done: 0, total: 2, phase: 'В очереди' }
  })
  const ctx = {
    runId: run.id,
    agentId: null,
    workspacePath: '/repos/p/1',
    env: { BRANCH: 'feature/1-x' },
    signal,
    parentStepId: 'step-1',
    log: () => {},
    run,
    task,
    project: db.getProject(U, project.id)!,
    askUser: async () => null,
    askPlanApproval: async () => null,
    runCommandById: async () => ({ exitCode: 0, timedOut: false, output: '' })
  } as unknown as CiModelContext
  return { project, task, conv, run, ctx }
}

function hooksWith(claude: LlmClient, over: Record<string, unknown> = {}) {
  return createCiModelHooks({
    db,
    claude,
    codex: claude,
    mcpBaseUrl: 'http://127.0.0.1:1/mcp/remote-bash?k=s',
    ciMcpBaseUrl: 'http://127.0.0.1:1/mcp/ci-commands?k=s',
    agentNameOf: () => 'M',
    kb: stubKb(),
    kbMcpBaseUrl: KB_MCP,
    kbToolEnabled: true,
    kbTool: broker(),
    kbUsage: createKbUsageTracker({ db }),
    ...over
  })
}

describe('работа модели: база знаний по режимам рана', () => {
  it('auto: инструменты подключены, контекст подмешан, хинт требует идти в БЗ раньше кода', async () => {
    const rec = recorder()
    const { ctx } = setup('auto')
    const r = await hooksWith(rec.client).modelWork(ctx)
    expect(r.ok).toBe(true)
    const req = rec.last()!
    expect(req.kbMcpUrl).toContain('/mcp/kb?k=secret&turn=')
    expect(req.kbMode).toBe('auto')
    expect(req.prompt).toContain('Начни работу с базы знаний проекта, а не с кода')
    // Сам блок контекста: заголовок раздела БЗ в промпте (директива лишь ссылается на него).
    expect(req.prompt).toContain('### CI-раннер / Работа модели')
  })

  it('auto: запрос к БЗ собирается из заголовка, описания и критериев приёмки', async () => {
    const asked: string[] = []
    const kb = stubKb({ context: async (query: string) => { asked.push(query); return bundle } })
    const { ctx } = setup('auto')
    await hooksWith(recorder().client, { kb }).modelWork(ctx)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('Кнопка «Выполнить»')
    expect(asked[0]).toContain('Ран должен ходить в БЗ')
    expect(asked[0]).toContain('Обращения видны')
  })

  it('auto: описание с бэктиками даёт компактный запрос — заголовок и сигнальные части', async () => {
    const asked: string[] = []
    const kb = stubKb({ context: async (query: string) => { asked.push(query); return bundle } })
    const { ctx } = setup('auto', undefined, {
      description: 'Правь `packages/ui/src/components/kanban/TaskModal.tsx`: модалка размывает поиск.\n```\nconst noise = 1\n```',
      acceptanceCriteria: 'Хук `useAiAssist` сохраняет черновик.'
    })
    await hooksWith(recorder().client, { kb }).modelWork(ctx)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('Кнопка «Выполнить»')
    expect(asked[0]).toContain('packages/ui/src/components/kanban/TaskModal.tsx')
    expect(asked[0]).toContain('useAiAssist')
    expect(asked[0]).not.toContain('модалка размывает поиск')
    expect(asked[0]).not.toContain('noise')
  })

  it('manual: инструменты есть, авто-контекста нет — БЗ не спрашивают вовсе', async () => {
    let calls = 0
    const kb = stubKb({ context: async () => { calls++; return bundle } })
    const rec = recorder()
    const { ctx, conv } = setup('manual')
    await hooksWith(rec.client, { kb }).modelWork(ctx)
    expect(calls).toBe(0)
    expect(rec.last()!.kbMode).toBe('manual')
    expect(rec.last()!.kbMcpUrl).toBeDefined()
    expect(rec.last()!.prompt).not.toContain('### CI-раннер')
    expect(rec.last()!.prompt).toContain('единственный путь')
    expect(db.kbUsageReport(U, conv.id)!.totals.queries).toBe(0)
  })

  it('off: ни инструментов, ни контекста, телеметрия пустая', async () => {
    const rec = recorder()
    const { ctx, conv } = setup('off')
    await hooksWith(rec.client).modelWork(ctx)
    expect(rec.last()!.kbMcpUrl).toBeUndefined()
    expect(rec.last()!.kbMode).toBeUndefined()
    expect(rec.last()!.prompt).not.toContain('### CI-раннер')
    expect(rec.last()!.prompt).not.toContain('Начни работу с базы знаний')
    expect(db.kbUsageReport(U, conv.id)!.totals.queries).toBe(0)
  })

  it('VC_KB_TOOL=off глушит инструменты и в ране', async () => {
    const rec = recorder()
    const { ctx } = setup('auto')
    await hooksWith(rec.client, { kbToolEnabled: false }).modelWork(ctx)
    expect(rec.last()!.kbMcpUrl).toBeUndefined()
  })

  it('недоступный индекс БЗ не даёт подключить инструменты, но ран идёт', async () => {
    const rec = recorder()
    const kb = stubKb({ status: () => ({ available: false, mode: 'disabled', searchMode: 'lexical', version: '', createdAt: '', documents: 0, chunks: 0, staleDocuments: 0 }) })
    const { ctx } = setup('auto')
    const r = await hooksWith(rec.client, { kb }).modelWork(ctx)
    expect(r.ok).toBe(true)
    expect(rec.last()!.kbMcpUrl).toBeUndefined()
  })

  it('падение поиска БЗ не роняет работу модели: обращение помечено error', async () => {
    const kb = stubKb({ context: async () => { throw new Error('индекс недоступен') } })
    const rec = recorder()
    const { ctx, conv } = setup('auto')
    const r = await hooksWith(rec.client, { kb }).modelWork(ctx)
    expect(r.ok).toBe(true)
    expect(rec.last()!.prompt).not.toContain('### CI-раннер')
    expect(db.kbUsageReport(U, conv.id)!.recent[0]).toMatchObject({ status: 'error', error: 'индекс недоступен' })
  })

  it('ран без связанного чата: инструменты выданы, телеметрия молча пропущена', async () => {
    const rec = recorder()
    const { ctx, run } = setup('auto')
    const noChat = { ...ctx, run: { ...run, conversationId: null } } as unknown as CiModelContext
    const r = await hooksWith(rec.client).modelWork(noChat)
    expect(r.ok).toBe(true)
    expect(rec.last()!.kbMcpUrl).toBeDefined()
    expect(rec.last()!.prompt).toContain('### CI-раннер')
  })

  it('обращение записано с ci_run_id и ci_step_id — оно попадёт в отчёты рана и задачи', async () => {
    const { ctx, run } = setup('auto')
    await hooksWith(recorder().client).modelWork(ctx)
    const report = db.kbUsageRunReport(U, run.id)!
    expect(report.totals.queries).toBe(1)
    expect(report.recent[0]).toMatchObject({ source: 'auto', ciRunId: run.id, ciStepId: 'step-1' })
  })
})

describe('токен базы знаний живёт ровно один ход', () => {
  it('после успешного хода токен снят', async () => {
    const tool = broker()
    const { ctx } = setup('auto')
    await hooksWith(recorder().client, { kbTool: tool }).modelWork(ctx)
    expect(tool.live()).toEqual([])
  })

  it('отмена рана снимает токен работы модели', async () => {
    const tool = broker()
    const ctl = new AbortController()
    const { ctx } = setup('auto', ctl.signal)
    const done = hooksWith(silent, { kbTool: tool }).modelWork(ctx)
    // Ход открыт — токен выдан и им можно читать базу.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(tool.live()).toHaveLength(1)
    ctl.abort()
    expect(await done).toMatchObject({ cancelled: true })
    expect(tool.live()).toEqual([])
  })

  it('отмена рана снимает токен и в fix-loop', async () => {
    const tool = broker()
    const ctl = new AbortController()
    const { ctx } = setup('auto', ctl.signal)
    const fixCtx = {
      ...ctx,
      failedStep: { id: 'step-2', title: 'npm ci', exitCode: 1, commandSnapshot: 'npm ci' },
      logTail: 'ошибка',
      rerunFailedStep: async () => ({ exitCode: 0, timedOut: false })
    } as unknown as CiFixContext
    const done = hooksWith(silent, { kbTool: tool }).attemptFix(fixCtx)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(tool.live()).toHaveLength(1)
    ctl.abort()
    expect(await done).toEqual({ fixed: false })
    expect(tool.live()).toEqual([])
  })
})

describe('инструменты БЗ в остальных ходах рана', () => {
  it('fix-loop получает инструменты и работает без машины', async () => {
    const rec = recorder('диагноз')
    const { ctx } = setup('auto')
    const fixCtx = {
      ...ctx,
      failedStep: { id: 'step-2', title: 'npm ci', exitCode: 1, commandSnapshot: 'npm ci' },
      logTail: 'ошибка',
      rerunFailedStep: async () => ({ exitCode: 0, timedOut: false }),
      recordFix: () => {}
    } as unknown as CiFixContext
    expect(await hooksWith(rec.client).attemptFix(fixCtx)).toEqual({ fixed: true })
    expect(rec.last()!.kbMcpUrl).toBeDefined()
    expect(rec.last()!.executionDisabled).toBe(true) // машины нет — команды запрещены
  })

  it('резюме тоже идёт с инструментами: база read-only и в режиме «план»', async () => {
    const rec = recorder('резюме')
    const { ctx } = setup('auto')
    expect(await hooksWith(rec.client).modelSummary(ctx)).toBe('резюме')
    expect(rec.last()!.kbMcpUrl).toBeDefined()
    expect(rec.last()!.permissionMode).toBe('plan')
  })

  it('в режиме «план» работы модели инструменты БЗ остаются', async () => {
    const rec = recorder()
    const { ctx, run } = setup('auto')
    const planCtx = { ...ctx, run: { ...run, mode: 'plan' }, askPlanApproval: async () => null } as unknown as CiModelContext
    await hooksWith(rec.client).modelWork(planCtx)
    expect(rec.last()!.kbMcpUrl).toBeDefined()
    expect(rec.last()!.readOnlyRemote).toBe(true)
  })
})

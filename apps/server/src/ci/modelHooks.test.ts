// База знаний в ходах модели CI-рана: форма запроса к CLI по режимам рана,
// авто-контекст по теме задачи и — отдельно — освобождение токена БЗ.
//
// Токен важнее формы запроса: пока он в брокере, им можно читать базу от имени
// рана. Поэтому «отмена рана снимает токен» проверяется и для работы модели, и
// для fix-loop, а брокер здесь — двойник, который умеет показать живые токены.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EMPTY_CI_TOOL_CALLS } from '@voicechat/shared'
import { VoiceChatDb } from '../db/database.js'
import { createCiModelHooks } from './modelHooks.js'
import type { CiFixContext, CiModelContext } from './types.js'
import type { LlmClient, LlmRequest } from '../claude/types.js'
import type { KnowledgeBaseService } from '../kb/types.js'
import { createKbUsageTracker } from '../kb/usage.js'
import { loadConfig } from '../config.js'
import { buildPublicMcpUrl } from '../mcp/publicBase.js'
import { REMOTE_BASH_MCP_PATH } from '../mcp/remoteBashMcp.js'
import { KB_MCP_PATH } from '../kb/kbMcp.js'
import { CI_COMMANDS_MCP_PATH } from './ciCommandsMcp.js'

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

describe('работа модели: VC_MCP_PUBLIC_BASE', () => {
  it('remote mcpUrl, kbMcpUrl и ciMcpUrl строятся от публичной базы, секрет сохраняется', async () => {
    const project = db.createProject(U, { name: 'P' })
    const board = db.getBoard(U, project.id)!
    const task = db.createTask(U, project.id, { title: 'T', columnId: board.columns[0].id })!
    const conv = db.createConversation(U, 'Чат задачи')
    const run = db.createCiRun({
      projectId: project.id, taskId: task.id, agentId: 'agent-1', triggeredBy: U, prevColumnId: null,
      conversationId: conv.id, kbContextMode: 'manual', slotProgress: { done: 0, total: 1, phase: 'В очереди' }
    })
    const ctx = {
      runId: run.id,
      agentId: 'agent-1',
      workspacePath: '/repos/p/1',
      env: { BRANCH: 'feature/1-x' },
      signal: new AbortController().signal,
      parentStepId: 'step-1',
      log: () => {},
      run,
      task,
      project: db.getProject(U, project.id)!,
      askUser: async () => null,
      askPlanApproval: async () => null,
      runCommandById: async () => ({ exitCode: 0, timedOut: false, output: '' })
    } as unknown as CiModelContext

    const config = loadConfig({ PORT: '8787', VC_MCP_PUBLIC_BASE: 'http://voicechat:8787/' })
    const rec = recorder()
    const hooks = createCiModelHooks({
      db,
      claude: rec.client,
      codex: rec.client,
      mcpBaseUrl: buildPublicMcpUrl(config, REMOTE_BASH_MCP_PATH, 'secret'),
      ciMcpBaseUrl: buildPublicMcpUrl(config, CI_COMMANDS_MCP_PATH, 'secret'),
      agentNameOf: () => 'M',
      kb: stubKb(),
      kbMcpBaseUrl: buildPublicMcpUrl(config, KB_MCP_PATH, 'secret'),
      kbToolEnabled: true,
      kbTool: broker(),
      kbUsage: createKbUsageTracker({ db })
    })

    const r = await hooks.modelWork(ctx)
    expect(r.ok).toBe(true)
    expect(rec.last()!.remote?.mcpUrl).toContain('http://voicechat:8787/mcp/remote-bash?k=secret')
    expect(rec.last()!.kbMcpUrl).toContain('http://voicechat:8787/mcp/kb?k=secret&turn=')
    expect(rec.last()!.remote?.ciMcpUrl).toContain('http://voicechat:8787/mcp/ci-commands?k=secret&run=')
  })
})

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
    expect(req.prompt).toContain('Файлы читай инструментом read, ищи grep и правь edit')
    expect(req.prompt).toContain('bash используй для команд')
    // Про гейт модель предупреждена заранее: отказ не должен быть сюрпризом.
    expect(req.prompt).toContain('мост отклонит и подскажет готовый вызов read')
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

// Измеримость расхода хода: у codex CLI не сообщает ни стоимости, ни длительности,
// ни числа ходов, а модель у него бывает пустой штатно (берётся из его
// config.toml). Пока это писалось «как пришло», отчёт рана через исполнителя был
// из одних прочерков, а токены входа у двух движков значили разное.
describe('расход хода: модель, время, семантика входа и вызовы инструментов', () => {
  /** Клиент, который отдаёт usage и «вызывает» инструменты, но не мету CLI. */
  function codexLike(tools: string[], usage = { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 800, cacheCreationTokens: 0 }): LlmClient {
    return {
      send: (_req, handlers) => {
        for (const tool of tools) handlers.onActivity?.({ kind: 'tool_use', summary: `${tool}: …`, raw: '{}', tool })
        handlers.onUsage?.(usage)
        handlers.onDelta?.('готово')
        handlers.onDone?.('готово') // мету codex не присылает
        return { cancel: () => {} }
      }
    }
  }

  /** Ран через исполнителя: провайдер codex, модель задаётся явно (бывает пустой). */
  function codexRun(llmModel: string) {
    const project = db.createProject(U, { name: 'P' })
    const board = db.getBoard(U, project.id)!
    const task = db.createTask(U, project.id, { title: 'T', columnId: board.columns[0].id })!
    const run = db.createCiRun({
      projectId: project.id, taskId: task.id, agentId: null, triggeredBy: U, prevColumnId: null,
      llmProvider: 'codex', llmModel, kbContextMode: 'off', slotProgress: { done: 0, total: 1, phase: '' }
    })
    const ctx = {
      runId: run.id, agentId: null, workspacePath: '/repos/p/1', env: { BRANCH: 'b' },
      signal: new AbortController().signal, parentStepId: 'step-1', log: () => {}, run, task,
      project: db.getProject(U, project.id)!, askUser: async () => null, askPlanApproval: async () => null,
      runCommandById: async () => ({ exitCode: 0, timedOut: false, output: '' })
    } as unknown as CiModelContext
    return { run, ctx }
  }

  it('вход пишется без кэша, а время и число запросов — по замеру сервера', async () => {
    const { run, ctx } = codexRun('gpt-5.4')
    // Часы хода инъектируются: замер сервера — единственный источник длительности
    // для codex, и проверять её надо числом, а не «сколько успел настоящий Date».
    let clock = 5_000
    await hooksWith(codexLike([]), { kb: undefined, now: () => (clock += 250) }).modelWork(ctx)

    const rows = db.listCiRunUsage(run.id)
    expect(rows).toHaveLength(1)
    // 1000 пришедших минус 800 из кэша: у claude вход и так без кэша.
    expect(rows[0]).toMatchObject({ model: 'gpt-5.4', inputTokens: 200, cacheReadTokens: 800, inputSemantics: 'no_cache', numTurns: 1 })
    expect(rows[0].durationMs).toBeGreaterThan(0)
    expect(rows[0].costUsd).toBeNull() // настоящей стоимости CLI не дал — оценит отчёт
  })

  it('модель, которую не назвал ни CLI, ни настройка рана, становится unknown', async () => {
    const { run, ctx } = codexRun('')
    await hooksWith(codexLike([]), { kb: undefined }).modelWork(ctx)
    expect(db.listCiRunUsage(run.id)[0].model).toBe('unknown')
  })

  it('вызовы инструментов копятся по видам за ран, а не теряются', async () => {
    const { run, ctx } = codexRun('gpt-5.4')
    const tools = ['remote:read', 'remote:read', 'remote:bash', 'remote:edit', 'kb:document', 'mcp__ci__run_command']
    const hooks = hooksWith(codexLike(tools), { kb: undefined })
    await hooks.modelWork(ctx)
    await hooks.modelSummary(ctx) // второй ход добавляет свои вызовы к тем же счётчикам

    expect(db.ciRunToolCalls(run.id)).toEqual({ bash: 2, read: 4, grep: 0, edit: 2, kb: 2, other: 2, denied: 0 })
  })

  it('ход без вызовов не создаёт счётчик: «нет строки» ≠ «ноль вызовов»', async () => {
    const { run, ctx } = codexRun('gpt-5.4')
    await hooksWith(codexLike([]), { kb: undefined }).modelWork(ctx)
    expect(db.ciRunToolCalls(run.id)).toBeNull()
  })

  it('ход из одних отказов всё равно пишет счётчик — иначе отказов никто не видит', async () => {
    const { run, ctx } = codexRun('gpt-5.4')
    const denials: LlmClient = {
      send: (_req, handlers) => {
        // Результат вызова приходит без имени инструмента — только текстом.
        handlers.onActivity?.({
          kind: 'tool_result',
          summary: '✗ ошибка: Отклонено: это чтение файла, а его делает инструмент read.',
          detail: 'Отклонено: это чтение файла, а его делает инструмент read.',
          raw: '{}'
        })
        handlers.onActivity?.({ kind: 'tool_result', summary: '✗ ошибка: [exit code: 1]', raw: '{}' })
        handlers.onDelta?.('готово')
        handlers.onDone?.('готово')
        return { cancel: () => {} }
      }
    }
    await hooksWith(denials, { kb: undefined }).modelWork(ctx)
    expect(db.ciRunToolCalls(run.id)).toEqual({ ...EMPTY_CI_TOOL_CALLS, denied: 1 })
  })

  it('сломанная запись метрики не роняет ход модели', async () => {
    const { ctx } = codexRun('gpt-5.4')
    const hooks = hooksWith(codexLike(['remote:read']), { kb: undefined })
    // Обе метрики хода падают — ход обязан завершиться успехом (правило расхода).
    db.addCiRunUsage = () => { throw new Error('БД недоступна') }
    db.addCiRunToolCalls = () => { throw new Error('БД недоступна') }
    expect(await hooks.modelWork(ctx)).toEqual({ ok: true })
  })
})

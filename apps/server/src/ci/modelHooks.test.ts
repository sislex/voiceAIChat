// База знаний в ходах модели CI-рана: форма запроса к CLI по режимам рана,
// авто-контекст по теме задачи и — отдельно — освобождение токена БЗ.
//
// Токен важнее формы запроса: пока он в брокере, им можно читать базу от имени
// рана. Поэтому «отмена рана снимает токен» проверяется и для работы модели, и
// для fix-loop, а брокер здесь — двойник, который умеет показать живые токены.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EMPTY_CI_TOOL_CALLS, isTrimmedToolOutput, trimmedToolOutputOriginalChars } from '@voicechat/shared'
import { VoiceChatDb } from '../db/database.js'
import { createCiModelHooks, parseCiTestFailures } from './modelHooks.js'
import { kbTaskQuery } from '../kb/taskQuery.js'
import type { CiFixContext, CiModelContext, CommandExecutor } from './types.js'
import type { LlmClient, LlmRequest } from '../claude/types.js'
import type { KnowledgeBaseService } from '../kb/types.js'
import { createKbUsageTracker } from '../kb/usage.js'
import { loadConfig } from '../config.js'
import { buildPublicMcpUrl } from '../mcp/publicBase.js'
import { REMOTE_BASH_MCP_PATH } from '../mcp/remoteBashMcp.js'
import { KB_MCP_PATH } from '../kb/kbMcp.js'
import { CI_COMMANDS_MCP_PATH, ciToolBroker } from './ciCommandsMcp.js'

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

describe('работа модели: машины проекта', () => {
  it('remote несёт project в mcpUrl и имена других машин проекта', async () => {
    const mac = db.createAgent(U, 'Мак')
    const srv = db.createAgent(U, 'Сервер')
    const project = db.createProject(U, { name: 'P' })
    db.linkMachine(U, project.id, mac.id)
    db.linkMachine(U, project.id, srv.id)
    db.setProjectMachinePath(U, project.id, srv.id, '/srv/proj')
    const board = db.getBoard(U, project.id)!
    const task = db.createTask(U, project.id, { title: 'T', columnId: board.columns[0].id })!
    const conv = db.createConversation(U, 'Чат задачи')
    const run = db.createCiRun({
      projectId: project.id, taskId: task.id, agentId: mac.id, triggeredBy: U, prevColumnId: null,
      conversationId: conv.id, kbContextMode: 'off', slotProgress: { done: 0, total: 1, phase: 'В очереди' }
    })
    const ctx = {
      runId: run.id,
      agentId: mac.id,
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

    const rec = recorder()
    const r = await hooksWith(rec.client).modelWork(ctx)
    expect(r.ok).toBe(true)
    expect(rec.last()!.remote?.mcpUrl).toContain(`&agent=${mac.id}`)
    expect(rec.last()!.remote?.mcpUrl).toContain(`&project=${encodeURIComponent(project.id)}`)
    expect(rec.last()!.remote?.projectMachines).toEqual(['Сервер'])
  })

  it('единственная машина проекта — прежний remote без project и списка', async () => {
    const mac = db.createAgent(U, 'Мак')
    const project = db.createProject(U, { name: 'P' })
    db.linkMachine(U, project.id, mac.id)
    const board = db.getBoard(U, project.id)!
    const task = db.createTask(U, project.id, { title: 'T', columnId: board.columns[0].id })!
    const conv = db.createConversation(U, 'Чат задачи')
    const run = db.createCiRun({
      projectId: project.id, taskId: task.id, agentId: mac.id, triggeredBy: U, prevColumnId: null,
      conversationId: conv.id, kbContextMode: 'off', slotProgress: { done: 0, total: 1, phase: 'В очереди' }
    })
    const ctx = {
      runId: run.id,
      agentId: mac.id,
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

    const rec = recorder()
    await hooksWith(rec.client).modelWork(ctx)
    expect(rec.last()!.remote?.mcpUrl).not.toContain('&project=')
    expect(rec.last()!.remote?.projectMachines).toBeUndefined()
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
    // Правила remote-инструментов передаёт системный хинт CLI: в taskPrompt их
    // больше нет, чтобы не платить за дубль на каждом запросе.
    expect(req.prompt).not.toContain('Файлы читай инструментом read, ищи grep и правь edit')
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

  it('auto: описание с кодом сохраняет прозу и уводит пути с символами в свою дорожку', async () => {
    const asked: string[] = []
    const kb = stubKb({ context: async (query: string) => { asked.push(query); return bundle } })
    const { ctx } = setup('auto', undefined, {
      description: 'Правь `packages/ui/src/components/kanban/TaskModal.tsx`: модалка размывает поиск.\n```\nconst noise = 1\n```',
      acceptanceCriteria: 'Хук `useAiAssist` сохраняет черновик.'
    })
    await hooksWith(recorder().client, { kb }).modelWork(ctx)
    // Лексическая дорожка одна: выдача сложилась, до кодовой дело не дошло.
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('Кнопка «Выполнить»')
    // Проза остаётся: без неё от технической задачи не остаётся темы.
    expect(asked[0]).toContain('модалка размывает поиск')
    // Многострочный блок кода — не тема задачи.
    expect(asked[0]).not.toContain('noise')
    // Пути и символы уходят второй дорожкой, и она видна в тексте обращения.
    const query = kbTaskQuery(ctx.task)
    expect(query.paths).toContain('packages/ui/src/components/kanban/TaskModal.tsx')
    expect(query.symbols).toContain('useAiAssist')
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

  it('не дублирует правила remote-инструментов в задаче: они уже в системном хинте CLI', async () => {
    const rec = recorder()
    const { ctx } = setup('off')
    await hooksWith(rec.client).modelWork(ctx)
    expect(rec.last()!.prompt).not.toContain('Файлы читай инструментом read')
    // CHAT-106 отдал проверки самой модели: прежняя строка «сам не запускай»
    // из промпта ушла, а проверка на неё осталась и падала на main.
    expect(rec.last()!.prompt).toContain('прогони проверки затронутых пакетов штатным гейтом (`npm run affected-check`)')
  })
})

// Модель по стадии рана: одна модель на весь ран означала, что сверка дифа с
// текстом статей и пересказ шагов считаются тем же тяжёлым движком, что и
// разработка (CHAT-70: актуализация базы знаний — 14% цены рана и 7 минут).
// Экономия при этом не имеет права стоить рана — отсюда откат на модель рана.
describe('модель по стадии рана', () => {
  /** Диф рабочей копии для шага базы знаний: сервер собирает его исполнителем. */
  const diffExecutor: CommandExecutor = {
    run: async (_req, onChunk) => {
      onChunk('===FILES===\napps/server/src/ci/runManager.ts\n===STAT===\n 1 file changed\n===PATCH===\ndiff\n')
      return { exitCode: 0, timedOut: false }
    }
  }
  const KB_REPLY = JSON.stringify({ note: 'нечего менять', topics: [], documents: [] })

  /**
   * Клиент, который отдаёт расход, но не мету: модель строки `ci_run_usage`
   * тогда берётся от сервера — ровно та, которой ход запускали (так ведёт себя
   * codex, и так проверяется, что стадии в отчёте различимы).
   */
  function usageRecorder(text = 'готово'): { client: LlmClient; models: () => string[] } {
    const models: string[] = []
    return {
      client: {
        send: (req, handlers) => {
          models.push(req.model ?? '')
          handlers.onUsage?.({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 })
          handlers.onDelta(text)
          handlers.onDone(text)
          return { cancel: () => {} }
        }
      },
      models: () => models
    }
  }

  /** Тот же ctx, но с машиной: без неё шаг базы знаний до модели не доходит. */
  const withAgent = (ctx: CiModelContext, log: (chunk: string) => void = () => {}): CiModelContext =>
    ({ ...ctx, agentId: 'agent-1', log: (_s: string, _stream: string, chunk: string) => log(chunk) }) as unknown as CiModelContext

  it('дефолт: разработка на модели рана, резюме и база знаний — дешевле', async () => {
    const rec = usageRecorder(KB_REPLY)
    const { ctx, run } = setup('off')
    const hooks = hooksWith(rec.client, { kb: undefined, executor: diffExecutor })
    await hooks.modelWork(ctx)
    await hooks.modelSummary(ctx)
    await hooks.kbUpdate(withAgent(ctx))
    expect(rec.models()).toEqual(['opus', 'haiku', 'sonnet'])
    // В отчёте видно, чем считалась каждая стадия: модель пишется в строку расхода.
    expect(db.listCiRunUsage(run.id).map((u) => [u.kind, u.model])).toEqual([
      ['model_work', 'opus'], ['summary', 'haiku'], ['kb_update', 'sonnet']
    ])
  })

  it('настройка переопределяет стадию, в том числе разработку', async () => {
    const rec = recorder()
    const { ctx } = setup('off')
    db.updateCiSettings({ stageModels: { model_work: 'haiku', fix: '', kb_update: '', summary: '' } })
    const hooks = hooksWith(rec.client, { kb: undefined })
    await hooks.modelWork(ctx)
    expect(rec.last()!.model).toBe('haiku')
    // Стадия с пустой настройкой осталась на модели рана.
    await hooks.modelSummary(ctx)
    expect(rec.last()!.model).toBe('opus')
  })

  it('модели, которой у движка рана нет, стадия не получает — идёт на модели рана', async () => {
    const rec = recorder()
    const { ctx } = setup('off')
    db.updateCiSettings({ stageModels: { model_work: '', fix: '', kb_update: 'gpt-5.4', summary: 'сонет' } })
    const hooks = hooksWith(rec.client, { kb: undefined, executor: diffExecutor })
    await hooks.modelSummary(ctx)
    expect(rec.last()!.model).toBe('opus')
    await hooks.kbUpdate(withAgent(ctx))
    expect(rec.last()!.model).toBe('opus')
  })

  it('модель стадии не отработала — ход повторяется на модели рана, ран не падает', async () => {
    // Исполнитель знает алиас, но саму модель не тянет: CLI падает, не начав, —
    // ни текста, ни расхода. Именно так выглядит «у исполнителя её нет».
    const seen: string[] = []
    const flaky: LlmClient = {
      send: (req, handlers) => {
        seen.push(req.model ?? '')
        if (req.model === 'haiku') handlers.onError?.('model not available')
        else {
          handlers.onUsage?.({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 })
          handlers.onDelta('готово')
          handlers.onDone('готово')
        }
        return { cancel: () => {} }
      }
    }
    const lines: string[] = []
    const { ctx, run } = setup('off')
    db.updateCiSettings({ stageModels: { model_work: 'haiku', fix: '', kb_update: '', summary: '' } })
    const logCtx = { ...ctx, log: (_step: string, _stream: string, chunk: string) => lines.push(chunk) } as unknown as CiModelContext
    expect(await hooksWith(flaky, { kb: undefined }).modelWork(logCtx)).toEqual({ ok: true })
    expect(seen).toEqual(['haiku', 'opus'])
    expect(lines.join('')).toContain('повторяю на модели рана')
    // Пустой ход строкой расхода не становится — в отчёте только состоявшийся.
    expect(db.listCiRunUsage(run.id).map((u) => u.model)).toEqual(['opus'])
  })

  it('откат помнится до конца хука: второй ход диалога к сломанной модели не идёт', async () => {
    const seen: string[] = []
    const flaky: LlmClient = {
      send: (req, handlers) => {
        seen.push(req.model ?? '')
        if (req.model === 'haiku') handlers.onError?.('model not available')
        else {
          // Первый ответ — вопрос пользователю: он продолжает тот же диалог.
          const text = seen.filter((m) => m === 'opus').length === 1
            ? 'Уточню:\n```questions\n[{"q":"Ветка?","options":["a","b"]}]\n```'
            : 'готово'
          handlers.onDelta(text)
          handlers.onDone(text)
        }
        return { cancel: () => {} }
      }
    }
    const { ctx } = setup('off')
    db.updateCiSettings({ stageModels: { model_work: 'haiku', fix: '', kb_update: '', summary: '' } })
    const askCtx = { ...ctx, askUser: async () => 'ветка a' } as unknown as CiModelContext
    expect(await hooksWith(flaky, { kb: undefined }).modelWork(askCtx)).toEqual({ ok: true })
    expect(seen).toEqual(['haiku', 'opus', 'opus'])
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

  it('сломанная запись тяжёлого ответа тоже не роняет ход', async () => {
    const { ctx } = codexRun('gpt-5.4')
    const hooks = hooksWith(withResponses([{ tool: 'remote:bash', detail: 'x'.repeat(5000) }]), { kb: undefined })
    db.addCiRunToolResponse = () => { throw new Error('БД недоступна') }
    expect(await hooks.modelWork(ctx)).toEqual({ ok: true })
  })
})

/**
 * Объём ответов инструментов — измеренный вклад в контекст хода: за него и
 * платится, потому что контекст перечитывается на каждом следующем запросе.
 * Ответ приходит БЕЗ имени инструмента, поэтому сшивка вызова с результатом —
 * отдельная механика (по `tool_use_id`, а без него по порядку).
 */
function withResponses(list: Array<{ tool: string; detail: string; id?: string }>): LlmClient {
  return {
    send: (_req, handlers) => {
      for (const item of list) {
        handlers.onActivity?.({
          kind: 'tool_use', summary: `${item.tool}: …`, raw: '{}', tool: item.tool,
          ...(item.id ? { toolUseId: item.id } : {})
        })
      }
      // Результаты — отдельными записями, у claude с id вызова.
      for (const item of [...list].reverse()) {
        handlers.onActivity?.({
          kind: 'tool_result', summary: '✓ результат: …', detail: item.detail, raw: '{}',
          ...(item.id ? { toolUseId: item.id } : {})
        })
      }
      handlers.onUsage?.({ inputTokens: 10, outputTokens: 10, cacheReadTokens: 100, cacheCreationTokens: 0 })
      handlers.onDelta?.('готово')
      handlers.onDone?.('готово')
      return { cancel: () => {} }
    }
  }
}

describe('объём ответов инструментов и тяжёлые ответы', () => {
  it('объём привязывается к виду инструмента по id вызова, даже если ответы пришли не по порядку', async () => {
    const { run, ctx } = setup('off')
    const client = withResponses([
      { tool: 'remote:bash', detail: 'B'.repeat(30_000), id: 'toolu_1' },
      { tool: 'remote:read', detail: 'R'.repeat(4000), id: 'toolu_2' }
    ])
    await hooksWith(client, { kb: undefined }).modelWork(ctx)

    // Ответы пришли в обратном порядке — сшивка по id всё равно верна.
    expect(db.ciRunToolChars(run.id)).toMatchObject({ bash: 30_000, read: 4000, other: 0 })
    const heaviest = db.ciRunToolResponses(run.id)
    expect(heaviest.map((r) => [r.kind, r.chars])).toEqual([['bash', 30_000], ['read', 4000]])
    expect(heaviest[0].label).toContain('remote:bash')
    expect(heaviest[0].stepId).toBe('step-1')
  })

  it('без id вызова (codex) сшивка идёт по порядку', async () => {
    const { run, ctx } = setup('off')
    await hooksWith(withResponses([{ tool: 'remote:bash', detail: 'B'.repeat(9000) }]), { kb: undefined }).modelWork(ctx)
    expect(db.ciRunToolChars(run.id)).toMatchObject({ bash: 9000 })
  })

  it('у рана без метрики объёма — null, а не нули', async () => {
    const { run, ctx } = setup('off')
    await hooksWith(recorder().client, { kb: undefined }).modelWork(ctx)
    expect(db.ciRunToolChars(run.id)).toBeNull()
    expect(db.ciRunToolResponses(run.id)).toEqual([])
  })

  it('в БД остаётся верхушка по объёму, а не вся лента вызовов', async () => {
    const { run, ctx } = setup('off')
    const many = Array.from({ length: 9 }, (_, i) => ({ tool: 'remote:bash', detail: 'x'.repeat(3000 + i * 1000), id: `t${i}` }))
    await hooksWith(withResponses(many), { kb: undefined }).modelWork(ctx)
    const rows = db.ciRunToolResponses(run.id, 50)
    expect(rows).toHaveLength(5) // CI_TOOL_RESPONSES_KEEP
    expect(rows[0].chars).toBe(11_000)
    expect(rows.at(-1)!.chars).toBe(7000)
  })

  it('вывод команды справочника обрезается по настройке, полный лог остаётся в ленте', async () => {
    db.updateCiSettings({ bashOutputLimitChars: 2000 })
    const project = db.createProject(U, { name: 'P' })
    const board = db.getBoard(U, project.id)!
    const task = db.createTask(U, project.id, { title: 'T', columnId: board.columns[0].id })!
    const cmd = db.createCiCommand(U, {
      scope: 'project', projectId: project.id, name: 'Установить зависимости', script: 'npm ci', availableToModel: true
    })
    const run = db.createCiRun({
      projectId: project.id, taskId: task.id, agentId: null, triggeredBy: U, prevColumnId: null,
      kbContextMode: 'off', slotProgress: { done: 0, total: 1, phase: '' }
    })
    const fullOutput = `начало npm ci\n${'y'.repeat(50_000)}\nadded 900 packages`
    let seen = ''
    const ctx = {
      runId: run.id, agentId: 'agent-1', workspacePath: '/repos/p/1', env: { BRANCH: 'b' },
      signal: new AbortController().signal, parentStepId: 'step-1', log: () => {}, run, task,
      project: db.getProject(U, project.id)!, askUser: async () => null, askPlanApproval: async () => null,
      runCommandById: async () => ({ exitCode: 0, timedOut: false, output: fullOutput })
    } as unknown as CiModelContext
    // Инструмент команд публикуется на время хода: токен рана лежит в ciMcpUrl.
    const client: LlmClient = {
      send: (req, handlers) => {
        const token = new URL(req.remote!.ciMcpUrl!).searchParams.get('run')!
        void ciToolBroker.get(token)!.invoke(cmd.name).then((r) => {
          seen = r.output
          handlers.onDelta?.('готово')
          handlers.onDone?.('готово')
        })
        return { cancel: () => {} }
      }
    }
    await hooksWith(client, { kb: undefined }).modelWork(ctx)

    expect(isTrimmedToolOutput(seen)).toBe(true)
    expect(seen).toContain('начало npm ci')
    expect(seen).toContain('added 900 packages') // хвост важнее головы
    expect(seen).toContain('полный вывод остался в ленте шага')
    expect(seen.length).toBeLessThan(fullOutput.length / 10)
    expect(trimmedToolOutputOriginalChars(seen)).toBe(fullOutput.length)
  })
})

// Пробел базы знаний обязан стать записью: обращение без ответа (или с неполным
// ответом) плюс найденный в коде ответ доходят до шага «Актуализировать базу
// знаний» и попадают в базу. Иначе следующий ран задаёт базе тот же вопрос и
// снова платит за исследование кода — ровно то, от чего база и заведена.
describe('пробелы базы знаний доходят до шага актуализации', () => {
  /** Диф рабочей копии: шаг базы знаний собирает его исполнителем, а не моделью. */
  const diffExecutor: CommandExecutor = {
    run: async (_req, onChunk) => {
      onChunk('===FILES===\napps/server/src/ci/modelHooks.ts\n===STAT===\n 1 file changed\n===PATCH===\ndiff\n')
      return { exitCode: 0, timedOut: false }
    }
  }
  /** Пустой диф: правок кода нет, а пробелы базы знаний — есть. */
  const emptyDiffExecutor: CommandExecutor = {
    run: async (_req, onChunk) => {
      onChunk('===FILES===\n===STAT===\n===PATCH===\n')
      return { exitCode: 0, timedOut: false }
    }
  }
  const KB_REPLY = JSON.stringify({
    note: 'закрыл пробел',
    topics: ['ci-runner'],
    documents: [{ title: 'Пробелы БЗ', kind: 'feature', areas: ['apps/server/src/ci'], body: '# Пробелы БЗ\n\nfix-loop живёт в attemptFix.' }]
  })

  /** Ход работы модели и ход шага базы знаний отвечают по-разному. */
  function twoStage(work: string, kbReply = KB_REPLY) {
    const seen: string[] = []
    const isKb = (prompt: string): boolean => prompt.startsWith('Ты ведёшь базу знаний')
    const client: LlmClient = {
      send: (req, handlers) => {
        seen.push(req.prompt)
        const text = isKb(req.prompt) ? kbReply : work
        handlers.onDelta?.(text)
        handlers.onDone?.(text)
        return { cancel: () => {} }
      }
    }
    return { client, kbPrompt: () => seen.find(isKb) ?? '', workPrompt: () => seen.find((p) => !isKb(p)) ?? '' }
  }

  /** Тот же ctx, но с машиной: без неё шаг базы знаний до модели не доходит. */
  const withAgent = (ctx: CiModelContext): CiModelContext =>
    ({ ...ctx, agentId: 'agent-1' }) as unknown as CiModelContext

  /** Блок, которым модель называет пробел и найденный ответ. */
  const gapsBlock = (question: string, answer: string, topic?: string): string =>
    ['готово', '```kb-gaps', JSON.stringify([{ question, answer, ...(topic ? { topic } : {}) }]), '```'].join('\n')

  it('база не ответила: вопрос уходит в промпт шага, ответ шаг ищет в коде', async () => {
    // Выдача пустая — обращение закрывается как empty, и это объективный пробел:
    // он виден даже если модель забыла назвать его блоком.
    const kb = stubKb({ context: async () => ({ ...bundle, sections: [] }) })
    const stage = twoStage('готово')
    const { ctx, run } = setup('auto')
    const hooks = hooksWith(stage.client, { kb, executor: diffExecutor })

    expect(await hooks.modelWork(ctx)).toEqual({ ok: true })
    expect(db.kbUsageRunReport(U, run.id)!.recent[0]).toMatchObject({ status: 'empty' })
    expect(await hooks.kbUpdate(withAgent(ctx))).toMatchObject({ ok: true })

    const prompt = stage.kbPrompt()
    expect(prompt).toContain('Пробелы базы знаний в этом ране')
    expect(prompt).toContain('Кнопка «Выполнить»') // текст обращения, оставшегося без ответа
    expect(prompt).toContain('найди его в коде')
    expect(prompt).toContain('ДОПОЛНИ существующий раздел')
  })

  it('неполный ответ: названный моделью пробел и его ответ попадают в базу', async () => {
    // База ответила (delivered), но ответа не хватило: модель дочитала код и
    // назвала пробел блоком — записать его обязан шаг актуализации.
    const stage = twoStage(gapsBlock('лимиты fix-loop', 'maxFixAttempts и fixTimeLimitMs из настроек CI', 'ci-runner'))
    const { ctx, run, project } = setup('auto')
    const hooks = hooksWith(stage.client, { executor: diffExecutor })

    expect(await hooks.modelWork(ctx)).toEqual({ ok: true })
    expect(db.kbUsageRunReport(U, run.id)!.recent[0]).toMatchObject({ status: 'delivered' })
    expect(db.ciRunKbGaps(run.id)).toEqual([
      { question: 'лимиты fix-loop', answer: 'maxFixAttempts и fixTimeLimitMs из настроек CI', topic: 'ci-runner' }
    ])

    expect(await hooks.kbUpdate(withAgent(ctx))).toMatchObject({ ok: true })
    const prompt = stage.kbPrompt()
    expect(prompt).toContain('лимиты fix-loop')
    expect(prompt).toContain('выяснено: maxFixAttempts и fixTimeLimitMs из настроек CI')
    expect(prompt).toContain('куда писать по мнению модели: ci-runner')
    // Пополнение состоялось: статья раздела проекта записана сервером.
    expect(db.kbDocuments({ scope: 'project', projectId: project.id }).some((d) => d.title === 'Пробелы БЗ')).toBe(true)
  })

  it('fix-loop: правка — то же исследование, пробел из неё тоже уезжает в базу', async () => {
    const stage = twoStage(gapsBlock('почему падает npm ci', 'lockfile в образе старее package.json'))
    const { ctx, run } = setup('auto')
    const fixCtx = {
      ...ctx,
      failedStep: { id: 'step-2', title: 'npm ci', exitCode: 1, commandSnapshot: 'npm ci' },
      logTail: 'ошибка',
      rerunFailedStep: async () => ({ exitCode: 0, timedOut: false }),
      recordFix: () => {}
    } as unknown as CiFixContext

    expect(await hooksWith(stage.client, { executor: diffExecutor }).attemptFix(fixCtx)).toEqual({ fixed: true })
    // Формат блока в промпте правки: без него модели нечем назвать пробел.
    expect(stage.workPrompt()).toContain('```kb-gaps')
    expect(db.ciRunKbGaps(run.id).map((g) => g.question)).toEqual(['почему падает npm ci'])
  })

  it('правок кода нет, но пробел есть — шаг всё равно идёт и пишет только пробел', async () => {
    const stage = twoStage(gapsBlock('кто снимает токен БЗ', 'withKbTools во всех выходах хода'))
    const { ctx } = setup('auto')
    const hooks = hooksWith(stage.client, { executor: emptyDiffExecutor })
    await hooks.modelWork(ctx)
    expect(await hooks.kbUpdate(withAgent(ctx))).toMatchObject({ ok: true })
    expect(stage.kbPrompt()).toContain('Изменений кода в ветке нет')
    expect(stage.kbPrompt()).toContain('кто снимает токен БЗ')
  })

  it('без пробелов и без правок кода шаг закрывается «нечего обновлять» — хода нет', async () => {
    const stage = twoStage('готово')
    const { ctx } = setup('off')
    const hooks = hooksWith(stage.client, { kb: undefined, executor: emptyDiffExecutor })
    await hooks.modelWork(ctx)
    expect(await hooks.kbUpdate(withAgent(ctx))).toMatchObject({ ok: true, message: expect.stringContaining('Нечего обновлять') })
    expect(stage.kbPrompt()).toBe('')
  })

  it('сломанная запись пробелов не роняет ход модели', async () => {
    const stage = twoStage(gapsBlock('вопрос', 'ответ'))
    const { ctx } = setup('auto')
    db.addCiRunKbGaps = () => { throw new Error('БД недоступна') }
    expect(await hooksWith(stage.client).modelWork(ctx)).toEqual({ ok: true })
  })
})

describe('parseCiTestFailures', () => {
  it('извлекает файл и test name из вывода Vitest', () => {
    const failures = parseCiTestFailures('FAIL src/chat/taskLaunch.test.ts > task launch > открывает карточку\nAssertionError: expected false to be true', 'npm test')
    expect(failures[0]).toMatchObject({ file: 'src/chat/taskLaunch.test.ts', testName: 'task launch > открывает карточку', command: 'npm test' })
    expect(failures[0]?.message).toContain('AssertionError')
  })

  it('оставляет компактный fallback для неструктурированного падения', () => {
    expect(parseCiTestFailures('команда завершилась с кодом 2')[0]?.message).toContain('кодом 2')
  })
})

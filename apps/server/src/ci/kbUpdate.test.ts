// Шаг CI-рана «Актуализировать базу знаний»: встроенная команда слота «после
// модели», статьи раздела проекта пишет сервер, а сбой шага ран не валит.
// Реальные CLI и машины не участвуют: клиент модели и исполнитель — моки.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { CI_KB_UPDATE_COMMAND_ID, CI_KB_UPDATE_COMMAND_NAME } from '@voicechat/shared'
import { signToken } from '../users/accounts.js'
import type { CommandExecutor, CiKbUpdateHook, CiModelContext } from './types.js'
import type { LlmClient, LlmRequest } from '../claude/types.js'
import { createCiModelHooks } from './modelHooks.js'
import { KB_DIFF_SCRIPT, KB_REPO_ROOT_CHECK_SCRIPT } from '../kb/codeUpdate.js'

const SECRET = 'kb-ci-secret'
let app: FastifyInstance, db: VoiceChatDb, admin: string
let modelReply = ''
let workReply = ''
let diffBundle = ''
let prompts: string[] = []
let kbMcpUrls: string[] = []
let repoCheckWorkdirs: string[] = []
let repoCheckExitCode = 0

const fakeClaude: LlmClient = {
  send: (req: LlmRequest, handlers) => {
    prompts.push(req.prompt)
    const kbTurn = req.prompt.startsWith('Ты ведёшь базу знаний')
    if (kbTurn && req.remote?.mcpUrl) kbMcpUrls.push(req.remote.mcpUrl)
    queueMicrotask(() => {
      const text = kbTurn ? modelReply : workReply
      handlers.onDelta(text)
      handlers.onDone(text)
    })
    return { cancel: () => {} }
  }
}

const ciExecutor: CommandExecutor = {
  run: async (req, onChunk) => {
    if (req.script === KB_REPO_ROOT_CHECK_SCRIPT) {
      repoCheckWorkdirs.push(req.workdir)
      return { exitCode: repoCheckExitCode, timedOut: false }
    }
    if (req.script === KB_DIFF_SCRIPT) {
      onChunk(diffBundle)
      return { exitCode: 0, timedOut: false }
    }
    onChunk(`run\n`)
    return { exitCode: 0, timedOut: false }
  }
}

const BUNDLE_WITH_CHANGES = `===FILES===
apps/server/src/ci/runManager.ts
===STAT===
 1 file changed
===PATCH===
diff --git a/apps/server/src/ci/runManager.ts b/apps/server/src/ci/runManager.ts
`
const BUNDLE_EMPTY = `===FILES===
===STAT===
===PATCH===
`

async function boot(kbUpdate?: CiKbUpdateHook): Promise<void> {
  let id = 0
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => Date.now() })
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-kb-ci-${Date.now()}`) }),
    db, sessionSecret: SECRET, ciExecutor, claude: fakeClaude, codex: fakeClaude,
    ...(kbUpdate ? { ciKbUpdate: kbUpdate } : {})
  })
  admin = signToken({ name: 'admin', role: 'admin' }, SECRET)
}

beforeEach(() => {
  prompts = []
  kbMcpUrls = []
  repoCheckWorkdirs = []
  repoCheckExitCode = 0
  workReply = 'готово'
  diffBundle = BUNDLE_WITH_CHANGES
  modelReply = JSON.stringify({
    note: 'записал новый шаг',
    topics: ['ci-runner'],
    documents: [{ title: 'CI-раннер', kind: 'feature', areas: ['apps/server/src/ci'], body: '# CI-раннер\n\nШаг актуализации базы знаний.' }]
  })
})
afterEach(async () => {
  await app?.close()
  db?.close()
})

/** Проект с машиной и встроенным шагом базы знаний в слоте «после модели». */
function setup(): { projectId: string; taskId: string } {
  const project = db.createProject('admin', { name: 'P', gitUrl: 'git@github.com:x/y.git' })
  const agent = db.createAgent('admin', 'M')
  db.linkMachine('admin', project.id, agent.id)
  db.setProjectMachineReposRoot('admin', project.id, agent.id, '/repos')
  db.setProjectDefaultMachine('admin', project.id, agent.id)
  const board = db.getBoard('admin', project.id)!
  const ready = board.columns.find((c) => c.semanticType === 'ready')!
  const task = db.createTask('admin', project.id, { columnId: ready.id, title: 'T1' })!
  db.setCiSlotCommands('project', project.id, 'after_model', [CI_KB_UPDATE_COMMAND_ID])
  return { projectId: project.id, taskId: task.id }
}

async function runToEnd(projectId: string, taskId: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/tasks/${taskId}/ci/run`, headers: { authorization: `Bearer ${admin}` } })
  expect(res.statusCode).toBe(202)
  const runId = res.json().id as string
  for (let i = 0; i < 300; i++) {
    const run = db.getCiRunRaw(runId)
    if (run && ['success', 'failed', 'cancelled', 'timeout'].includes(run.status)) return runId
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('ран не завершился')
}

function kbStep(runId: string): { status: string; log: string } {
  const detail = db.getCiRun('admin', runId)!
  const step = detail.steps.find((s) => s.title === CI_KB_UPDATE_COMMAND_NAME)!
  expect(step).toBeTruthy()
  const log = db.getCiRunLog('admin', runId).filter((l) => l.stepId === step.id).map((l) => l.chunk).join('')
  return { status: step.status, log }
}

describe('шаг «Актуализировать базу знаний»', () => {
  it('встроенная команда есть в справочнике и не предлагается модели как инструмент', async () => {
    await boot()
    const cmd = db.getCiCommand('admin', CI_KB_UPDATE_COMMAND_ID)!
    expect(cmd.builtin).toBe('kb_update')
    expect(cmd.scope).toBe('global')
    expect(cmd.availableToModel).toBe(false)
  })

  it('сохраняет статьи раздела проекта с scope=project и projectId проекта задачи', async () => {
    await boot()
    const { projectId, taskId } = setup()
    const runId = await runToEnd(projectId, taskId)

    expect(db.getCiRunRaw(runId)!.status).toBe('success')
    const step = kbStep(runId)
    expect(step.status).toBe('success')
    expect(step.log).toContain('CI-раннер (создана)')

    // Кроме заготовки, которую заводит сам проект, появилась статья шага.
    const doc = db.kbDocuments({ scope: 'project', projectId }).find((d) => d.title === 'CI-раннер')!
    expect(doc).toBeTruthy()
    expect(doc.scope).toBe('project')
    expect(doc.projectId).toBe(projectId)
    expect(doc.areas).toEqual(['apps/server/src/ci'])
    // Раздел определяет сервер: в личных знаниях пользователя статей не появляется.
    expect(db.kbDocuments({ scope: 'user' })).toHaveLength(0)

    // Промпт шага содержит диф и правила ведения файловых тем.
    const kbPrompt = prompts.find((p) => p.startsWith('Ты ведёшь базу знаний'))!
    expect(kbPrompt).toContain('apps/server/src/ci/runManager.ts')
    expect(kbPrompt).toContain('npm run kb:index')
  })

  it('пробел базы знаний из работы модели доезжает до шага целым пайплайном', async () => {
    await boot()
    // Модель назвала пробел блоком `kb-gaps` — шаг обязан увидеть и вопрос, и
    // найденный в коде ответ, иначе они умрут вместе с контекстом рана.
    workReply = ['готово', '```kb-gaps', JSON.stringify([{ question: 'кто собирает диф шага', answer: 'сервер скриптом KB_DIFF_SCRIPT, не модель', topic: 'ci-runner' }]), '```'].join('\n')
    const { projectId, taskId } = setup()
    const runId = await runToEnd(projectId, taskId)

    expect(db.getCiRunRaw(runId)!.status).toBe('success')
    expect(db.ciRunKbGaps(runId).map((g) => g.question)).toEqual(['кто собирает диф шага'])
    const kbPrompt = prompts.find((p) => p.startsWith('Ты ведёшь базу знаний'))!
    expect(kbPrompt).toContain('Пробелы базы знаний в этом ране')
    expect(kbPrompt).toContain('выяснено: сервер скриптом KB_DIFF_SCRIPT, не модель')
    // Кроме названного моделью пробела, авто-контекст задачи не нашёл
    // ответа в пустой тестовой БЗ: объективный пробел тоже обязан доехать.
    expect(kbStep(runId).log).toContain('Пробелов базы знаний за ран: 2')
  })

  it('без изменений кода, но с пустым ответом БЗ всё равно запускает пополнение', async () => {
    await boot()
    diffBundle = BUNDLE_EMPTY
    const { projectId, taskId } = setup()
    const runId = await runToEnd(projectId, taskId)
    const step = kbStep(runId)
    expect(step.status).toBe('success')
    expect(step.log).toContain('Пробелов базы знаний за ран: 1')
    expect(db.kbDocuments({ scope: 'project', projectId }).some((d) => d.title === 'CI-раннер')).toBe(true)
    const kbPrompt = prompts.find((p) => p.startsWith('Ты ведёшь базу знаний'))!
    expect(kbPrompt).toContain('ответа база не дала')
  })

  it('без изменений и обращений к БЗ шаг успешен и ничего не пишет', async () => {
    await boot()
    diffBundle = BUNDLE_EMPTY
    const { projectId, taskId } = setup()
    db.updateProject('admin', projectId, { ciKbContextMode: 'off' })
    const runId = await runToEnd(projectId, taskId)
    const step = kbStep(runId)
    expect(step.status).toBe('success')
    expect(step.log).toContain('Нечего обновлять')
    expect(db.kbDocuments({ scope: 'project', projectId }).some((d) => d.title === 'CI-раннер')).toBe(false)
    expect(prompts.some((p) => p.startsWith('Ты ведёшь базу знаний'))).toBe(false)
  })

  it('использует проверенный корень клона, а не несуществующий вложенный путь с повторным SLUG', async () => {
    await boot()
    const { projectId, taskId } = setup()
    const runId = await runToEnd(projectId, taskId)

    expect(kbStep(runId).status).toBe('success')
    const cwd = new URL(kbMcpUrls[0]).searchParams.get('cwd')!
    expect(repoCheckWorkdirs).toEqual([cwd])
    expect(cwd).toMatch(/\/t1$/)
    expect(cwd).not.toMatch(/\/t1\/t1$/)
  })

  it('не запускает модель и явно пропускает шаг, если корень рабочей копии недоступен', async () => {
    await boot()
    repoCheckExitCode = 128
    const { projectId, taskId } = setup()
    const runId = await runToEnd(projectId, taskId)

    expect(db.getCiRunRaw(runId)!.status).toBe('success')
    const step = kbStep(runId)
    expect(step.status).toBe('skipped')
    expect(step.log).toContain('Корень рабочей копии KB недоступен')
    expect(prompts.some((p) => p.startsWith('Ты ведёшь базу знаний'))).toBe(false)
  })

  it('неразборчивый ответ модели: предупреждение в ленте, ран продолжается', async () => {
    await boot()
    modelReply = 'я не понял задачу'
    const { projectId, taskId } = setup()
    const runId = await runToEnd(projectId, taskId)
    expect(db.getCiRunRaw(runId)!.status).toBe('success')
    const step = kbStep(runId)
    expect(step.status).toBe('skipped')
    expect(step.log).toContain('Предупреждение')
    expect(db.kbDocuments({ scope: 'project', projectId }).some((d) => d.title === 'CI-раннер')).toBe(false)
  })

  it('исключение в хуке ран не валит', async () => {
    await boot(async () => {
      throw new Error('база знаний недоступна')
    })
    const { projectId, taskId } = setup()
    const runId = await runToEnd(projectId, taskId)
    expect(db.getCiRunRaw(runId)!.status).toBe('success')
    const step = kbStep(runId)
    expect(step.status).toBe('skipped')
    expect(step.log).toContain('база знаний недоступна')
  })
})

describe('таймаут хука', () => {
  it('модель молчит дольше лимита — шаг возвращает предупреждение, а не виснет', async () => {
    let id = 0
    const memory = new VoiceChatDb(':memory:', { newId: () => `t-${++id}`, now: () => Date.now() })
    let cancelled = false
    const silent: LlmClient = { send: () => ({ cancel: () => { cancelled = true } }) }
    const hooks = createCiModelHooks({
      db: memory,
      claude: silent,
      codex: silent,
      mcpBaseUrl: 'http://127.0.0.1:1/mcp/remote-bash?k=s',
      ciMcpBaseUrl: 'http://127.0.0.1:1/mcp/ci-commands?k=s',
      agentNameOf: () => 'M',
      executor: ciExecutor,
      kbTimeoutMs: 30
    })
    const logged: string[] = []
    const ctx = {
      runId: 'r1',
      agentId: 'a1',
      workspacePath: '/repos/p/1',
      env: { SLUG: 'slug', BASE_BRANCH: 'main' },
      signal: new AbortController().signal,
      parentStepId: 'step-1',
      log: (_s: string, _stream: string, chunk: string) => logged.push(chunk),
      run: { triggeredBy: 'admin', llmProvider: 'claude', llmModel: 'opus' },
      task: { title: 'T', description: '' },
      project: { id: 'p1', name: 'P' }
    } as unknown as CiModelContext

    const r = await hooks.kbUpdate(ctx)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('не уложился')
    expect(cancelled).toBe(true)
    memory.close()
  })
})

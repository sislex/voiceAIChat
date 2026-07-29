// Хуки «модель в цикле» для CI-раннера: работа модели (разработка в рабочей
// директории на машине), резюме воркфлоу и fix-loop (диагноз → правка → повтор
// упавшего шага). Реализованы поверх инъектируемого LlmClient (в тестах — мок).

import { randomUUID } from 'node:crypto'
import type { LlmClient, LlmRequest, LlmStreamHandlers } from '../claude/types.js'
import { ciToolBroker } from './ciCommandsMcp.js'
import type { VoiceChatDb } from '../db/database.js'
import type { CiModelContext, CiFixContext, CiModelWorkHook, CiModelSummaryHook, CiFixHook } from './types.js'

export interface CiModelHooksDeps {
  db: VoiceChatDb
  claude: LlmClient
  codex: LlmClient
  /** База URL MCP remote-bash (с ?k=секрет); агент/cwd дописываются на ход. */
  mcpBaseUrl: string
  /** База URL MCP команд CI (с ?k=секрет); &run=<token> дописывается на ход. */
  ciMcpBaseUrl: string
  agentNameOf: (agentId: string) => string | undefined
  now?: () => number
}

/** Один ход модели как Promise: собирает текст, стримит активность в лог шага. */
function runTurn(
  claude: LlmClient,
  req: LlmRequest,
  onLog: (stream: 'stdout' | 'system', chunk: string) => void
): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) => {
    let text = ''
    const handlers: LlmStreamHandlers = {
      onDelta: (t) => {
        text += t
        onLog('stdout', t)
      },
      onSession: () => {},
      onDone: () => resolve({ ok: true, text }),
      onError: (m) => {
        onLog('system', `Ошибка модели: ${m}\n`)
        resolve({ ok: false, text })
      },
      onActivity: (e) => onLog('system', `[${e.kind}] ${e.summary}\n`)
    }
    claude.send(req, handlers)
  })
}

/** remote-часть запроса: если есть машина — прокинуть remote-bash MCP на рабочую папку. */
function remoteOf(deps: CiModelHooksDeps, ctx: CiModelContext): Partial<LlmRequest> {
  if (!ctx.agentId) return { executionDisabled: true }
  const mcpUrl = `${deps.mcpBaseUrl}&agent=${encodeURIComponent(ctx.agentId)}&cwd=${encodeURIComponent(ctx.workspacePath)}`
  return { remote: { mcpUrl, agentName: deps.agentNameOf(ctx.agentId) ?? ctx.agentId } }
}

function taskPrompt(ctx: CiModelContext): string {
  return [
    `Задача: ${ctx.task.title}`,
    ctx.task.description ? `Описание: ${ctx.task.description}` : '',
    ctx.task.acceptanceCriteria ? `Критерии приёмки: ${ctx.task.acceptanceCriteria}` : '',
    `Рабочая директория: ${ctx.workspacePath}`,
    `Ветка: ${ctx.env.BRANCH ?? ''}`,
    '',
    'Реализуй задачу в рабочей директории. Команды выполняй через доступный инструмент bash.'
  ]
    .filter(Boolean)
    .join('\n')
}

export function createCiModelHooks(deps: CiModelHooksDeps): {
  modelWork: CiModelWorkHook
  modelSummary: CiModelSummaryHook
  attemptFix: CiFixHook
} {
  const now = deps.now ?? (() => Date.now())
  const clientFor = (ctx: CiModelContext): LlmClient => ctx.run.llmProvider === 'codex' ? deps.codex : deps.claude
  const modelFor = (ctx: CiModelContext): string => ctx.run.llmProvider === 'codex' ? ctx.run.llmModel : (ctx.run.llmModel || 'sonnet')

  const modelWork: CiModelWorkHook = async (ctx: CiModelContext) => {
    // Публикуем модели команды справочника как инструмент на время шага (лимит
    // maxModelCommandCalls, is_cleanup исключены — иначе модель снесёт себе рабочую
    // директорию). Каждый вызов = вложенный шаг ленты (runCommandById).
    const token = randomUUID()
    const settings = deps.db.getCiSettings()
    const available = deps.db
      .listCiCommands(ctx.run.triggeredBy, ctx.project.id)
      .filter((c) => c.availableToModel && !c.isCleanup)
    let calls = 0
    ciToolBroker.register(token, {
      list: () => available.map((c) => ({ name: c.name, description: c.description })),
      invoke: async (name) => {
        if (calls >= settings.maxModelCommandCalls) return { output: '', exitCode: null, message: `Лимит вызовов команд (${settings.maxModelCommandCalls}) исчерпан — заверши работу.` }
        const cmd = available.find((c) => c.name === name)
        if (!cmd) return { output: '', exitCode: null, message: 'Команда не найдена среди доступных.' }
        calls++
        const r = await ctx.runCommandById(cmd.id, ctx.parentStepId)
        return { output: r.output, exitCode: r.exitCode }
      }
    })
    const base = remoteOf(deps, ctx)
    if (ctx.agentId && base.remote) base.remote.ciMcpUrl = `${deps.ciMcpBaseUrl}&run=${token}`
    const req: LlmRequest = {
      userId: ctx.run.triggeredBy,
      prompt: taskPrompt(ctx),
      sessionId: null,
      model: modelFor(ctx),
      permissionMode: 'acceptEdits',
      cwd: ctx.workspacePath,
      ...base
    }
    try {
      const r = await runTurn(clientFor(ctx), req, (stream, chunk) => ctx.log(ctx.parentStepId, stream, chunk))
      return { ok: r.ok }
    } finally {
      ciToolBroker.unregister(token)
    }
  }

  const modelSummary: CiModelSummaryHook = async (ctx: CiModelContext) => {
    const detail = deps.db.getCiRun(ctx.run.triggeredBy, ctx.run.id)
    const stepLines = (detail?.steps ?? []).map((s) => `- ${s.title}: ${s.status}${s.exitCode != null ? ` (код ${s.exitCode})` : ''}`).join('\n')
    const req: LlmRequest = {
      userId: ctx.run.triggeredBy,
      prompt: `Кратко резюмируй результат воркфлоу по задаче «${ctx.task.title}». Шаги:\n${stepLines}\nДай сжатое резюме: что сделано и в каком состоянии задача.`,
      sessionId: null,
      model: modelFor(ctx),
      permissionMode: 'plan',
      executionDisabled: true
    }
    const r = await runTurn(clientFor(ctx), req, () => {})
    return r.text.trim() || 'Резюме недоступно.'
  }

  const attemptFix: CiFixHook = async (ctx: CiFixContext) => {
    const settings = deps.db.getCiSettings()
    const startAll = now()
    for (let attempt = 1; attempt <= settings.maxFixAttempts; attempt++) {
      if (settings.fixTimeLimitMs > 0 && now() - startAll > settings.fixTimeLimitMs) break
      const started = now()
      const req: LlmRequest = {
        userId: ctx.run.triggeredBy,
        prompt: [
          `Упал шаг воркфлоу: «${ctx.failedStep.title}».`,
          ctx.failedStep.commandSnapshot ? `Команда:\n${ctx.failedStep.commandSnapshot}` : '',
          `Код выхода: ${ctx.failedStep.exitCode ?? 'неизвестен'}`,
          `Хвост вывода:\n${ctx.logTail.slice(-2000)}`,
          `Рабочая директория: ${ctx.workspacePath}`,
          '',
          'Кратко (1-2 фразы) поставь диагноз, затем исправь причину в рабочей директории',
          '(правь файлы/ставь зависимости/меняй конфиг). НЕ ослабляй саму команду ради обхода ошибки.'
        ]
          .filter(Boolean)
          .join('\n'),
        sessionId: null,
        model: modelFor(ctx),
        permissionMode: 'acceptEdits',
        cwd: ctx.workspacePath,
        ...remoteOf(deps, ctx)
      }
      const turn = await runTurn(clientFor(ctx), req, (stream, chunk) => ctx.log(ctx.parentStepId, stream, chunk))
      const diagnosis = turn.text.split('\n').find((l) => l.trim())?.slice(0, 200) ?? ''
      const rr = await ctx.rerunFailedStep()
      const fixed = rr.exitCode === 0
      ctx.recordFix({
        runStepId: ctx.failedStep.id,
        attemptNo: attempt,
        diagnosis,
        action: 'Правки в рабочей директории',
        result: fixed ? 'fixed' : attempt >= settings.maxFixAttempts ? 'gave_up' : 'retrying',
        durationMs: now() - started
      })
      if (fixed) return { fixed: true }
    }
    return { fixed: false }
  }

  return { modelWork, modelSummary, attemptFix }
}

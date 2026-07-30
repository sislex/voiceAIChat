// Хуки «модель в цикле» для CI-раннера: работа модели (разработка в рабочей
// директории на машине), резюме воркфлоу и fix-loop (диагноз → правка → повтор
// упавшего шага). Реализованы поверх инъектируемого LlmClient (в тестах — мок).

import { randomUUID } from 'node:crypto'
import type { LlmClient, LlmRequest, LlmStreamHandlers } from '../claude/types.js'
import { appendQuestionsHint, clarifyBudget, parseQuestions } from '@voicechat/shared'
import type { CiRunMode } from '@voicechat/shared'
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

/**
 * Верхний предел ходов CLI внутри одного шага модели: бюджет вопросов и
 * доработки плана уже ограничены, это страховка от зацикливания.
 */
const MAX_MODEL_TURNS = 40

/**
 * Один ход модели как Promise: собирает текст, стримит активность в лог шага и
 * запоминает id сессии CLI — по нему следующий ход продолжает тот же диалог
 * (`claude --resume` / `codex resume`), что и делает возможными уточняющие
 * вопросы и одобрение плана внутри одного шага ленты.
 */
function runTurn(
  claude: LlmClient,
  req: LlmRequest,
  onLog: (stream: 'stdout' | 'system', chunk: string) => void
): Promise<{ ok: boolean; text: string; sessionId: string | null }> {
  return new Promise((resolve) => {
    let text = ''
    let sessionId: string | null = null
    const handlers: LlmStreamHandlers = {
      onDelta: (t) => {
        text += t
        onLog('stdout', t)
      },
      onSession: (sid) => {
        sessionId = sid
      },
      onDone: () => resolve({ ok: true, text, sessionId }),
      onError: (m) => {
        onLog('system', `Ошибка модели: ${m}\n`)
        resolve({ ok: false, text, sessionId })
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

function taskPrompt(ctx: CiModelContext, mode: CiRunMode): string {
  const tail = mode === 'plan'
    ? [
        'Режим «План»: только исследуй код и составь план работы, файлы не меняй.',
        'Изложи план по шагам — пользователь его одобрит, и тогда ты приступишь к разработке.'
      ]
    : ['Реализуй задачу в рабочей директории. Команды выполняй через доступный инструмент bash.']
  return [
    `Задача: ${ctx.task.title}`,
    ctx.task.description ? `Описание: ${ctx.task.description}` : '',
    ctx.task.acceptanceCriteria ? `Критерии приёмки: ${ctx.task.acceptanceCriteria}` : '',
    `Рабочая директория: ${ctx.workspacePath}`,
    `Ветка: ${ctx.env.BRANCH ?? ''}`,
    '',
    ...tail
  ]
    .filter(Boolean)
    .join('\n')
}

/** Хинт о формате вопросов с явным остатком бюджета. */
function clarifyHint(left: number): string {
  return appendQuestionsHint(
    `Ты можешь задать пользователю не больше ${left} уточняющих ${left === 1 ? 'вопроса' : 'вопросов'} — только если без ответа не сможешь сделать задачу правильно.`
  )
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
    const log = (stream: 'stdout' | 'system', chunk: string): void => ctx.log(ctx.parentStepId, stream, chunk)

    // Шаг модели — это несколько ходов CLI в одной сессии: уточняющие вопросы и
    // одобрение плана ставят ран на паузу и продолжают тот же диалог по sessionId.
    let phase: CiRunMode = ctx.run.mode === 'plan' ? 'plan' : 'development'
    let budget = clarifyBudget(ctx.run)
    let sessionId: string | null = null
    let prompt = taskPrompt(ctx, phase)
    if (budget > 0) prompt = `${prompt}\n\n${clarifyHint(budget)}`

    try {
      // Страховка от бесконечного цикла: паузы ограничены бюджетом вопросов и
      // числом доработок плана, но верхний предел ходов задаём явно.
      for (let turnNo = 0; turnNo < MAX_MODEL_TURNS; turnNo++) {
        const req: LlmRequest = {
          userId: ctx.run.triggeredBy,
          prompt,
          sessionId,
          model: modelFor(ctx),
          permissionMode: phase === 'plan' ? 'plan' : 'acceptEdits',
          // CLI работает внутри server-контейнера; workspace существует на удалённой машине
          // и доступен модели только через remote MCP. Хостовый путь нельзя передавать в spawn cwd.
          ...base
        }
        const r = await runTurn(clientFor(ctx), req, log)
        if (!r.ok) return { ok: false }
        if (r.sessionId) sessionId = r.sessionId

        // 1) Уточняющие вопросы — пока есть бюджет.
        const parsed = budget > 0 ? parseQuestions(r.text) : null
        if (parsed) {
          budget -= parsed.questions.length
          const answer = await ctx.askUser(ctx.parentStepId, parsed.questions)
          if (answer === null) {
            log('system', 'Продолжаю без уточнений.\n')
            prompt = 'Ответа не будет — действуй по своему усмотрению и продолжай.'
          } else {
            prompt = answer.trim() || 'Ответа не будет — действуй по своему усмотрению и продолжай.'
          }
          if (budget > 0) prompt = `${prompt}\n\n${clarifyHint(budget)}`
          continue
        }

        // 2) Гейт плана: одобрение переводит тот же диалог в разработку.
        if (phase === 'plan') {
          const decision = await ctx.askPlanApproval(ctx.parentStepId, r.text)
          if (!decision) {
            log('system', 'Решение по плану не получено — ран остановлен.\n')
            return { ok: false, cancelled: true }
          }
          if (decision.decision === 'rework') {
            log('system', 'План отправлен на доработку.\n')
            prompt = decision.comment.trim()
              ? `Пользователь просит доработать план: ${decision.comment.trim()}\nПредложи исправленный план, файлы не меняй.`
              : 'Пользователь просит доработать план. Предложи исправленный вариант, файлы не меняй.'
            continue
          }
          log('system', 'План одобрен — перехожу к разработке.\n')
          phase = 'development'
          prompt = 'План одобрен. Реализуй его в рабочей директории. Команды выполняй через доступный инструмент bash.'
          continue
        }

        // 3) Разработка закончена.
        return { ok: true }
      }
      log('system', `Достигнут предел ходов модели (${MAX_MODEL_TURNS}).\n`)
      return { ok: false }
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
        // См. modelWork: рабочая директория удалённой машины задаётся в MCP URL.
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

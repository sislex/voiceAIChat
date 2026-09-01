// Хуки «модель в цикле» для CI-раннера: работа модели (разработка в рабочей
// директории на машине), резюме воркфлоу и fix-loop (диагноз → правка → повтор
// упавшего шага). Реализованы поверх инъектируемого LlmClient (в тестах — мок).

import { randomUUID } from 'node:crypto'
import type { LlmClient, LlmHandle, LlmRequest, LlmStreamHandlers } from '../claude/types.js'
import {
  appendQuestionsHint, ciToolCallsAny, designPromptLines, makeDesignPreviewUrl, ciToolCharsTotal, ciToolOutputLimits, clarifyBudget,
  classifyCiToolCall, CI_TOOL_RESPONSES_KEEP, CI_USAGE_KIND_LABELS, EMPTY_CI_TOOL_CALLS, EMPTY_CI_TOOL_CHARS,
  isCiToolDenial, KB_GAPS_HINT, parseKbGaps, parseQuestions,
  trimmedToolOutputOriginalChars, trimToolOutput, UNKNOWN_MODEL
} from '@voicechat/shared'
import type { CiRunMode, CiTestFailure, CiTargetedTestRun, CiToolCalls, CiToolChars, CiToolKind, CiUsageKind, KbContextMode, TurnMeta, TurnUsage } from '@voicechat/shared'
import { ciToolBroker } from './ciCommandsMcp.js'
import { kbToolBroker, kbRunDirective, type KbToolEntry } from '../kb/kbMcp.js'
import { buildKbAutoContext, CI_KB_AUTO_CONTEXT_BUDGET } from '../kb/autoContext.js'
import { kbCodeQuery, kbTaskQuery } from '../kb/taskQuery.js'
import { kbViewOf } from '../kb/access.js'
import type { KnowledgeBaseService } from '../kb/types.js'
import type { KbUsageTracker } from '../kb/usage.js'
import type { VoiceChatDb } from '../db/database.js'
import { buildTaskMakeSources, type MakeTaskScopeBroker } from '../mcp/makeMcp.js'
import type { CommandExecutor, CiModelContext, CiFixContext, CiModelWorkHook, CiModelSummaryHook, CiFixHook, CiKbUpdateHook } from './types.js'
import {
  EMPTY_CHANGES, KB_DIFF_SCRIPT, KB_FILE_TOPICS_SCRIPT, KB_REPO_ROOT_CHECK_SCRIPT, KB_UPDATE_TIMEOUT_MS, MAX_PROMPT_GAPS, affectedProjectDocs, formatKbUpdateSummary,
  KB_UPDATE_REPAIR_PROMPT, KbUpdateParseError, kbUpdatePrompt, parseDiffBundle, parseKbUpdateOutput, type KbGapForPrompt
} from '../kb/codeUpdate.js'

export interface CiModelHooksDeps {
  db: VoiceChatDb
  claude: LlmClient
  codex: LlmClient
  engineClient?: (engine: { id: string; kind: 'claude' | 'codex'; baseUrl: string; token: string }) => LlmClient
  /** База URL MCP remote-bash (с ?k=секрет); агент/cwd дописываются на ход. */
  mcpBaseUrl: string
  /** База URL MCP команд CI (с ?k=секрет); &run=<token> дописывается на ход. */
  ciMcpBaseUrl: string
  agentNameOf: (agentId: string) => string | undefined
  /**
   * Исполнитель команд машины: нужен шагу «Актуализировать базу знаний», чтобы
   * собрать диф рабочей копии сервером, а не доверять его сбор модели.
   * Не передан — шаг работает по тому, что модель прочитает сама.
   */
  executor?: CommandExecutor
  now?: () => number
  /** Таймаут шага актуализации базы знаний (мс); по умолчанию `KB_UPDATE_TIMEOUT_MS`. */
  kbTimeoutMs?: number
  /**
   * База знаний для ходов рана: авто-контекст по теме задачи и инструменты
   * mcp__kb__*. Не передана — ран работает как раньше (мимо базы знаний).
   */
  kb?: KnowledgeBaseService
  /** Телеметрия обращений; без неё БЗ работает, но статистика не пишется. */
  kbUsage?: KbUsageTracker
  /** База URL MCP базы знаний (с ?k=секрет); `&turn=<token>` дописывается на ход. */
  kbMcpBaseUrl?: string
  /** Инструмент БЗ включён администратором (config.kbToolEnabled). */
  kbToolEnabled?: boolean
  /** Брокер токенов ходов БЗ (в тестах — двойник, следящий за утечкой). */
  kbTool?: { register(token: string, entry: KbToolEntry): void; unregister(token: string): void }
  makeMcpBaseUrl?: string
  makeTaskScopes?: MakeTaskScopeBroker
}

/**
 * Верхний предел ходов CLI внутри одного шага модели: бюджет вопросов и
 * доработки плана уже ограничены, это страховка от зацикливания.
 */
const MAX_MODEL_TURNS = 40
const MAX_TARGETED_TESTS_PER_ATTEMPT = 3

/** Компактно извлекает из Vitest/Jest/npm-лога данные, нужные модели для фикса. */
export function parseCiTestFailures(log: string, command: string | null = null): CiTestFailure[] {
  const lines = log.split(/\r?\n/)
  const out: CiTestFailure[] = []
  let packageName: string | null = null
  for (const line of lines) {
    const pkg = /(?:^|\s)(?:@?[^\s]+)@[^\s]+\s+test|workspace\s+([^\s]+)/i.exec(line)
    if (pkg?.[1]) packageName = pkg[1]
    const failed = /^\s*(?:×|✗|FAIL)\s+(.+?)(?:\s+\d+ms)?\s*$/.exec(line)
    const file = /((?:[\w@.-]+\/)*[\w.-]+\.(?:test|spec)\.[cm]?[jt]sx?)/.exec(line)?.[1] ?? null
    if (!failed && !file) continue
    const raw = (failed?.[1] ?? line).trim()
    const parts = raw.split(/\s+>\s+/)
    const testName = parts.length > 1 ? parts.slice(1).join(' > ') : failed ? raw : null
    const message = lines.slice(Math.max(0, lines.indexOf(line)), Math.min(lines.length, lines.indexOf(line) + 4)).join('\n').slice(0, 1200)
    out.push({ packageName, file: file ?? (parts[0]?.match(/\.(?:test|spec)\.[cm]?[jt]sx?$/) ? parts[0] : null), testName, command, message })
    if (out.length >= 20) break
  }
  if (!out.length && log.trim()) out.push({ packageName, file: null, testName: null, command, message: log.trim().slice(-1200) })
  return out
}

interface TurnResult {
  ok: boolean
  text: string
  sessionId: string | null
  cancelled?: boolean
  /** Итог хода из result-события CLI: стоимость, токены, длительность, модель. */
  meta?: TurnMeta
  /** Последние накопленные счётчики токенов (приходят и у прерванного хода). */
  usage?: TurnUsage
  /**
   * Сколько ход занял по часам сервера. Нужен там, где CLI длительность не
   * сообщает (`codex exec --json` не сообщает никогда), иначе «работа модели» в
   * отчёте — вечный прочерк. Замер сервера включает накладные расходы транспорта
   * и потому не подменяет `meta.durationMs`, а лишь заменяет его отсутствие.
   */
  elapsedMs: number
  /** Сколько событий расхода прислал CLI — по ним считается `num_turns`. */
  usageEvents: number
  /** Вызовы инструментов этого хода по видам (bash/read/grep/edit/kb/other). */
  toolCalls: CiToolCalls
  /**
   * Символы ответов инструментов этого хода по видам — измеренный вклад в
   * контекст: за него и платится, потому что контекст перечитывается на каждом
   * следующем запросе хода.
   */
  toolChars: CiToolChars
  /** Самые тяжёлые ответы хода (верхушка по объёму) — для метрики рана. */
  toolResponses: TurnToolResponse[]
}

/** Тяжёлый ответ инструмента внутри хода (кандидат в метрику рана). */
interface TurnToolResponse {
  tool: string
  kind: CiToolKind
  label: string
  chars: number
  originalChars: number | null
}

/**
 * Ниже этого объёма ответ на цену хода не влияет, а строку в метрике занимает:
 * тяжёлыми считаем то, что заметно на фоне контекста (десятки тысяч символов
 * набегают именно такими ответами).
 */
const HEAVY_TOOL_RESPONSE_CHARS = 2_000

/**
 * Сколько вызовов держим в ожидании результата. Ответ сшивается с вызовом по
 * `tool_use_id`, но у codex его нет — там работает порядок, и очередь нужна
 * короткая: потерянный ответ хуже посчитать «прочим», чем растить память хода.
 */
const MAX_PENDING_TOOL_CALLS = 64

/**
 * Один ход модели как Promise: собирает текст, стримит активность в лог шага и
 * запоминает id сессии CLI — по нему следующий ход продолжает тот же диалог
 * (`claude --resume` / `codex resume`), что и делает возможными уточняющие
 * вопросы и одобрение плана внутри одного шага ленты.
 *
 * `signal` обязателен: `LlmHandle.cancel()` глушит колбэки клиента (`finished`),
 * поэтому промис хода закрываем здесь сами — иначе отмена рана оставляла
 * процесс CLI живым, а `execute` навсегда висел на этом await.
 */
function runTurn(
  claude: LlmClient,
  req: LlmRequest,
  onLog: (stream: 'stdout' | 'system', chunk: string) => void,
  signal: AbortSignal,
  abortNote = 'Ран отменён — работа модели остановлена.\n',
  now: () => number = Date.now
): Promise<TurnResult> {
  const startedAt = now()
  const toolCalls: CiToolCalls = { ...EMPTY_CI_TOOL_CALLS }
  const toolChars: CiToolChars = { ...EMPTY_CI_TOOL_CHARS }
  const toolResponses: TurnToolResponse[] = []
  if (signal.aborted) {
    return Promise.resolve({ ok: false, text: '', sessionId: null, cancelled: true, elapsedMs: 0, usageEvents: 0, toolCalls, toolChars, toolResponses })
  }
  return new Promise((resolve) => {
    let text = ''
    let sessionId: string | null = null
    let meta: TurnMeta | undefined
    let usage: TurnUsage | undefined
    let usageEvents = 0
    let settled = false
    /** Вызовы, чей результат ещё не пришёл (сшивка объёма ответа с инструментом). */
    const pendingCalls: Array<{ id?: string; tool: string; label: string }> = []
    /**
     * Объём ответа инструмента — в метрику хода. Ответ сшивается со своим
     * вызовом по `tool_use_id` (claude), а без него — по порядку (codex): вид
     * важнее точности сшивки, а «прочее» на месте потерянного вызова честнее
     * молчания. Метрика ничего не бросает и ход не трогает.
     */
    const recordToolResponse = (detail: string, toolUseId?: string): void => {
      const index = toolUseId ? pendingCalls.findIndex((c) => c.id === toolUseId) : 0
      const call = index >= 0 ? pendingCalls.splice(index, 1)[0] : undefined
      const kind: CiToolKind = call ? classifyCiToolCall(call.tool) : 'other'
      toolChars[kind] += detail.length
      if (detail.length < HEAVY_TOOL_RESPONSE_CHARS) return
      toolResponses.push({
        tool: call?.tool ?? '',
        kind,
        label: call?.label ?? 'вызов неизвестен',
        chars: detail.length,
        // Обрезанный ответ несёт исходный объём в своей метке — только так видно,
        // сколько лимит реально сэкономил.
        originalChars: trimmedToolOutputOriginalChars(detail)
      })
      // Держим верхушку: ход делает сотни вызовов, а метрике нужны тяжёлые.
      toolResponses.sort((a, b) => b.chars - a.chars)
      if (toolResponses.length > CI_TOOL_RESPONSES_KEEP) toolResponses.length = CI_TOOL_RESPONSES_KEEP
    }
    const finish = (r: { ok: boolean; cancelled?: boolean }): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve({ ...r, text, sessionId, meta, usage, elapsedMs: Math.max(0, now() - startedAt), usageEvents, toolCalls, toolChars, toolResponses })
    }
    const onAbort = (): void => {
      // Убиваем процесс CLI и закрываем ход сами: клиент после cancel() молчит.
      try {
        handle?.cancel()
      } catch {
        /* процесс уже мёртв */
      }
      onLog('system', abortNote)
      finish({ ok: false, cancelled: true })
    }
    const handlers: LlmStreamHandlers = {
      onDelta: (t) => {
        text += t
        onLog('stdout', t)
      },
      onSession: (sid) => {
        sessionId = sid
      },
      onDone: (_full, m) => {
        meta = m
        finish({ ok: true })
      },
      onError: (m) => {
        onLog('system', `Ошибка модели: ${m}\n`)
        finish({ ok: false })
      },
      onActivity: (e) => {
        // Единственное место, где мимо сервера проходит КАЖДЫЙ вызов инструмента
        // любого движка: у MCP-эндпоинта рана нет (он знает лишь машину и папку),
        // а имена в логе у claude и codex записаны по-разному.
        if (e.tool) {
          toolCalls[classifyCiToolCall(e.tool)]++
          // Ответ придёт отдельной записью и БЕЗ имени инструмента, поэтому вызов
          // ждёт своего результата здесь: иначе объём не привязать к инструменту.
          pendingCalls.push({ id: e.toolUseId, tool: e.tool, label: e.summary })
          if (pendingCalls.length > MAX_PENDING_TOOL_CALLS) pendingCalls.shift()
        } else if (e.kind === 'tool_result') {
          // Отказ виден только в результате вызова: имени инструмента там уже нет,
          // а сам вызов посчитан своим видом выше — поэтому отдельный счётчик.
          if (isCiToolDenial(`${e.summary}\n${e.detail ?? ''}`)) toolCalls.denied++
          recordToolResponse(e.detail ?? '', e.toolUseId)
        }
        onLog('system', `[${e.kind}] ${e.summary}${e.detail ? ` · ${e.detail}` : ''}\n`)
      },
      // Счётчики кумулятивны: держим последние — у прерванного хода это всё,
      // что о его расходе вообще известно.
      onUsage: (u) => {
        usage = u
        usageEvents++
      }
    }
    const handle: LlmHandle | undefined = claude.send(req, handlers)
    // Отмена могла прийти пока клиент стартовал — тогда гасим ход сразу.
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

function makeSourcesOf(deps: CiModelHooksDeps, ctx: CiModelContext): Partial<LlmRequest> {
  const makeSources = buildTaskMakeSources({
    designs: ctx.task.designs ?? [], userId: ctx.run.triggeredBy, projectId: ctx.project.id,
    taskId: ctx.task.id, baseUrl: deps.makeMcpBaseUrl, broker: deps.makeTaskScopes
  })
  return makeSources.length ? { makeSources } : {}
}

/** remote-часть запроса: если есть машина — прокинуть remote-bash MCP на рабочую папку. */
function remoteOf(deps: CiModelHooksDeps, ctx: CiModelContext): Partial<LlmRequest> {
  const makeSources = (makeSourcesOf(deps, ctx).makeSources ?? [])
  const linked = makeSources.length ? { makeSources } : {}
  if (!ctx.agentId) return { executionDisabled: true, ...linked }
  // Ран видит и остальные машины проекта: query `project` включает в мосте
  // инструмент machines и параметр machine (адресация операции другой машине),
  // имена уходят в системный хинт CLI. Одна машина — прежнее поведение.
  const others = deps.db
    .listProjectMachines(ctx.project.id)
    .filter((m) => m.agentId !== ctx.agentId)
    .map((m) => m.name)
  const project = others.length ? `&project=${encodeURIComponent(ctx.project.id)}` : ''
  const mcpUrl = `${deps.mcpBaseUrl}&agent=${encodeURIComponent(ctx.agentId)}&cwd=${encodeURIComponent(ctx.workspacePath)}${project}`
  return {
    ...linked,
    remote: {
      mcpUrl,
      agentName: deps.agentNameOf(ctx.agentId) ?? ctx.agentId,
      ...(others.length ? { projectMachines: others } : {})
    }
  }
}

/** Чем добрать вырезанное из вывода команды справочника (лог шага в ленте). */
const MODEL_COMMAND_TRIM_HINT =
  'полный вывод остался в ленте шага; повтори команду с фильтром, если нужна середина'

const DEVELOPMENT_FAST_GATE_HINT =
  'Перед завершением работы запусти быстрый гейт задачи (`npm run gate:fast`): он проверяет только связанные с текущими изменениями тесты и типы. Полный `npm run affected-check`, `npm run gate` и сырой `npm test` на этапе разработки не запускай — они выполняются на следующих шагах workflow; не отдавай работу с падающими проверками.'

function taskPrompt(ctx: CiModelContext, mode: CiRunMode, readiness: import('@voicechat/shared').DevelopmentReadiness | null): string {
  const tail = mode === 'plan'
    ? [
        'Режим «План»: только исследуй код и составь план работы, файлы не меняй.',
        'Изложи план по шагам — пользователь его одобрит, и тогда ты приступишь к разработке.'
      ]
    : [
        'Реализуй задачу в рабочей директории. Команды выполняй через доступный инструмент bash.',
        DEVELOPMENT_FAST_GATE_HINT,
        `Готовую работу коммить в ветку ${ctx.env.BRANCH ?? ''} — пушить не нужно: раннер сам отправит её в origin перед очисткой рабочей директории.`
      ]
  return [
    `Задача: ${ctx.task.title}`,
    ctx.task.description ? `Описание: ${ctx.task.description}` : '',
    ctx.task.acceptanceCriteria ? `Критерии приёмки: ${ctx.task.acceptanceCriteria}` : '',
    // Дизайн задачи (Make): адрес превью и путь страницы — тот же блок, что и в чате.
    ...(ctx.task.designs?.length ? designPromptLines(ctx.task.designs, makeDesignPreviewUrl) : []),
    readiness ? `Подтверждённый DevelopmentReadiness (авторитетный scope; не расширять): ${JSON.stringify(readiness)}` : '',
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
  kbUpdate: CiKbUpdateHook
  conflictFixForMerge(args: { run: import('@voicechat/shared').MergeRun; repo: string; conflicts: string[]; signal: AbortSignal; log(chunk:string):void }): Promise<{ ok:boolean; message:string; llmEngineId:string|null; llmProvider:'claude'|'codex'; llmModel:string }>
  kbUpdateForMerge(args: { run: import('@voicechat/shared').MergeRun; repo: string; targetRef: string; signal: AbortSignal; log(chunk:string):void }): Promise<{ ok:boolean; message:string; llmEngineId:string|null; llmProvider:'claude'|'codex'; llmModel:string }>
} {
  const now = deps.now ?? (() => Date.now())
  const clientFor = (ctx: CiModelContext): LlmClient => {
    const role = deps.db.getUser(ctx.run.triggeredBy)?.role ?? 'developer'
    const resolved = deps.db.resolveLlmEngine(ctx.run.llmEngineId, ctx.run.llmProvider, role)
    return resolved.engine && deps.engineClient ? deps.engineClient(resolved.engine) : ctx.run.llmProvider === 'codex' ? deps.codex : deps.claude
  }
  /**
   * RunManager передаёт в контексте неизменяемый снимок executor/provider/model
   * конкретного этапа. Здесь нельзя перечитывать настройки: идущий этап не должен
   * менять модель посреди выполнения.
   */
  const modelFor = (ctx: CiModelContext, _stage: CiUsageKind): string => ctx.run.llmModel

  /** Модель разработки — безопасный fallback, если модель вспомогательного этапа не стартовала. */
  const runModelOf = (ctx: CiModelContext): string =>
    deps.db.resolveTaskStageLlmConfig(ctx.project.id, ctx.task.id, 'model_work').model

  /**
   * Ходы одной стадии в одном вызове хука. Модель стадии берётся один раз, и
   * если она не отработала — стадия доигрывается на модели рана: настройка
   * экономии не имеет права стоить рана (у `kb_update` шаг просто пропускается,
   * а вот падение разработки или правки останавливает всё). Откат помнится до
   * конца хука, поэтому следующий ход диалога и следующая попытка fix-loop уже
   * не ходят к сломанной модели.
   *
   * Повтор ровно один и только у «пустого» падения — ни текста, ни расхода: так
   * выглядит CLI, который не смог начать (модели нет у исполнителя, доступ к ней
   * закрыт). Настоящую ошибку работы модели повторять на другой незачем.
   */
  function stageRunner(ctx: CiModelContext, stage: CiUsageKind, stepId: string | null) {
    let model: string | null = null
    return async (
      build: (model: string) => LlmRequest,
      onLog: (stream: 'stdout' | 'system', chunk: string) => void,
      signal: AbortSignal,
      abortNote?: string,
      allowModelFallback = true
    ): Promise<TurnResult> => {
      const runModel = runModelOf(ctx)
      const stageModel = (model ??= modelFor(ctx, stage))
      const first = await runTurn(clientFor(ctx), build(stageModel), onLog, signal, abortNote, now)
      recordUsage(ctx, stage, stepId, first, stageModel)
      const empty = !first.text.trim() && !first.meta && !first.usage
      if (first.ok || first.cancelled || signal.aborted || !allowModelFallback || stageModel === runModel || !empty) return first
      onLog('system', `Модель «${stageModel}» стадии «${CI_USAGE_KIND_LABELS[stage]}» не отработала — повторяю на модели рана «${runModel}».\n`)
      model = runModel
      const second = await runTurn(clientFor(ctx), build(runModel), onLog, signal, abortNote, now)
      recordUsage(ctx, stage, stepId, second, runModel)
      return second
    }
  }

  const kbBroker = deps.kbTool ?? kbToolBroker

  /**
   * Расход одного хода CLI — строка `ci_run_usage` с привязкой к рану и шагу.
   * Один ход = один «запрос к модели», поэтому пишем на каждом выходе `runTurn`:
   * работа модели, резюме, попытка fix-loop и актуализация базы знаний идут
   * через него же. Стоимость сохраняем только ту, что сообщил CLI; когда её нет,
   * отчёт оценит сам по прайсу и пометит «≈».
   *
   * Не бросает никогда: расход — метрика, и ронять ей ран нельзя (как и
   * телеметрии БЗ). Ход, о котором CLI не сказал ничего (мгновенная отмена,
   * клиент без usage), строкой не становится — иначе отчёт считал бы запросы,
   * которых не было видно.
   */
  function recordUsage(ctx: CiModelContext, kind: CiUsageKind, stepId: string | null, turn: TurnResult, model: string): void {
    // Вызовы инструментов считаются отдельно от токенов: ход, о расходе которого
    // CLI промолчал, всё равно успевает что-то вызвать.
    recordToolCalls(ctx, turn)
    const u: TurnUsage = turn.meta ?? turn.usage ?? {}
    const tokens = (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheCreationTokens ?? 0)
    if (!turn.meta && tokens === 0) return
    const cacheReadTokens = u.cacheReadTokens ?? 0
    const rawInput = u.inputTokens ?? 0
    // Одна семантика входа на оба движка — «вход без кэша»: codex сообщает
    // input_tokens ВМЕСТЕ с прочитанным кэшем, claude — уже без него. Пока их
    // складывали как есть, суммы «до/после» сравнивали разные величины, а оценка
    // по прайсу считала кэш по полной цене входа и завышала её в разы.
    const inputTokens = ctx.run.llmProvider === 'codex' ? Math.max(0, rawInput - cacheReadTokens) : rawInput
    try {
      deps.db.addCiRunUsage({
        runId: ctx.run.id,
        stepId,
        kind,
        provider: ctx.run.llmProvider,
        // Пустая модель (у codex это штатное состояние — он берёт её из своего
        // config.toml) превращается в `unknown`: прайса для неё нет, и итог
        // честно помечается заниженным вместо молчаливого нуля. Запасной вариант
        // — модель, которой ход РЕАЛЬНО запускали (стадии считаются разными).
        model: turn.meta?.model || model || UNKNOWN_MODEL,
        inputTokens,
        outputTokens: u.outputTokens ?? 0,
        cacheReadTokens,
        cacheCreationTokens: u.cacheCreationTokens ?? 0,
        inputSemantics: 'no_cache',
        costUsd: turn.meta?.costUsd ?? null,
        // Длительность и число запросов: у codex CLI не сообщает ни то, ни
        // другое, поэтому время берём по замеру хода на сервере, а `num_turns` —
        // по числу событий расхода (одно событие = один ответ модели).
        durationMs: turn.meta?.durationMs ?? (turn.elapsedMs > 0 ? turn.elapsedMs : null),
        numTurns: turn.meta?.numTurns ?? (turn.usageEvents > 0 ? turn.usageEvents : null)
      })
    } catch {
      /* метрика расхода не имеет права уронить ран */
    }
  }

  /**
   * Вызовы инструментов хода — в счётчик рана. Ход без вызовов ничего не пишет:
   * «строки нет» должно означать «счётчика у рана нет», а не «модель не вызвала
   * ничего». Ход из одних отказов писать надо — иначе они снова не видны.
   * Не бросает никогда — это метрика.
   */
  function recordToolCalls(ctx: CiModelContext, turn: TurnResult): void {
    const chars = ciToolCharsTotal(turn.toolChars)
    if (!ciToolCallsAny(turn.toolCalls) && chars === 0) return
    try {
      deps.db.addCiRunToolCalls(ctx.run.id, turn.toolCalls, turn.toolChars)
      // Тяжёлые ответы — отдельными строками: по ним видно, ЧТО раздуло контекст,
      // а не только сколько его было.
      for (const r of turn.toolResponses) {
        deps.db.addCiRunToolResponse({
          runId: ctx.run.id,
          stepId: ctx.parentStepId,
          tool: r.tool,
          kind: r.kind,
          label: r.label,
          chars: r.chars,
          originalChars: r.originalChars
        })
      }
    } catch {
      /* метрика вызовов не имеет права уронить ран */
    }
  }

  /**
   * Пробелы базы знаний, о которых модель сообщила блоком `kb-gaps`, — в ран,
   * чтобы шаг «Актуализировать базу знаний» их занёс. Зовётся после КАЖДОГО хода
   * (работа модели и fix-loop): пробел закрывается и в исследовании, и по ходу
   * правки, а ход, в котором это случилось, заранее неизвестен.
   *
   * Не бросает: потерянный пробел — упущенная запись в базе, а не повод валить
   * ран. Дубли снимает само хранение (ключ «ран + вопрос»).
   */
  function recordKbGaps(ctx: CiModelContext, stepId: string, text: string): void {
    const gaps = parseKbGaps(text)
    if (!gaps.length) return
    try {
      deps.db.addCiRunKbGaps(ctx.run.id, stepId, gaps)
    } catch {
      /* запись пробелов не имеет права уронить ран */
    }
  }

  /**
   * Пробелы рана для промпта шага актуализации. Источников два: названные самой
   * моделью (с ответом) и обращения, на которые база не ответила вовсе (ответ
   * шаг найдёт в коде). Второе нужно именно потому, что первое зависит от
   * дисциплины модели: забыла блок — пробел всё равно виден по телеметрии.
   * Названный пробел старше: у него уже есть ответ, повторять его вопросом
   * незачем.
   */
  function collectKbGaps(ctx: CiModelContext): KbGapForPrompt[] {
    try {
      const reported = deps.db.ciRunKbGaps(ctx.run.id)
      const named = new Set(reported.map((gap) => gap.question.trim().toLowerCase()))
      const unanswered = deps.db
        .kbUsageRunGaps(ctx.run.id, MAX_PROMPT_GAPS)
        .filter((gap) => !named.has(gap.query.trim().toLowerCase()))
        .map((gap) => ({ question: gap.query, reason: gap.reason }))
      return [...reported, ...unanswered].slice(0, MAX_PROMPT_GAPS)
    } catch {
      // Пробелы — добавка к дифу: без них шаг работает как раньше.
      return []
    }
  }

  /**
   * Режим БЗ рана — снимок настройки ПРОЕКТА на старте (`ci_runs.kb_context_mode`),
   * а не режим связанного чата: в ране модель исследует проект по задаче, и от
   * настроек конкретного чата это зависеть не должно.
   */
  const kbModeOf = (ctx: CiModelContext): KbContextMode => ctx.run.kbContextMode ?? 'auto'

  /**
   * Доступны ли инструменты БЗ. Проверка НЕ зависит от машины и от режима шага:
   * база read-only, поэтому она есть и в фазе плана, и в ходе без агента (там
   * она вообще единственный источник контекста). `VC_KB_TOOL=off` глушит их и
   * здесь — как в чате.
   */
  function kbToolAvailable(mode: KbContextMode): boolean {
    if (!deps.kb || !deps.kbMcpBaseUrl || mode === 'off' || deps.kbToolEnabled === false) return false
    try {
      return deps.kb.status().available
    } catch {
      return false // сломанный индекс = инструмента нет, ран продолжается
    }
  }

  /**
   * Ход с инструментами БЗ. Токен живёт ровно на время `body` и снимается во
   * ВСЕХ выходах — успех, ошибка, отмена рана, убийство CLI: иначе после каждой
   * отмены в брокере оставался бы живой токен, которым можно читать базу.
   */
  async function withKbTools<T>(
    ctx: CiModelContext,
    stepId: string,
    body: (kbFields: Partial<LlmRequest>, turnId: string) => Promise<T>
  ): Promise<T> {
    const mode = kbModeOf(ctx)
    const turnId = randomUUID()
    if (!kbToolAvailable(mode)) return body({}, turnId)
    const token = randomUUID()
    kbBroker.register(token, {
      userId: ctx.run.triggeredBy,
      // Чата у рана может не быть — тогда БЗ работает, телеметрия молчит.
      conversationId: ctx.run.conversationId,
      projectId: ctx.project.id,
      turnId,
      ciRunId: ctx.run.id,
      ciStepId: stepId
    })
    try {
      return await body(
        {
          kbMcpUrl: `${deps.kbMcpBaseUrl}&turn=${encodeURIComponent(token)}`,
          kbMode: mode === 'manual' ? 'manual' : 'auto'
        },
        turnId
      )
    } finally {
      kbBroker.unregister(token)
    }
  }

  /**
   * Авто-контекст БЗ по теме задачи (режим `auto`): разобранный на прозу и код
   * запрос (kb/taskQuery.ts) идёт тем же поиском и с тем же порогом уверенности,
   * что и ход чата (kb/autoContext.ts). Никогда не бросает: сломанная БЗ — это
   * пустой контекст и обращение со статусом `error`, но не упавший ран.
   */
  async function kbTaskContext(ctx: CiModelContext, turnId: string, stepId: string): Promise<string> {
    if (!deps.kb || kbModeOf(ctx) !== 'auto') return ''
    const query = kbTaskQuery(ctx.task)
    if (!query.text && !query.paths.length && !query.symbols.length) return ''
    const usage = deps.kbUsage?.begin(
      {
        userId: ctx.run.triggeredBy,
        conversationId: ctx.run.conversationId,
        projectId: ctx.project.id,
        turnId,
        ciRunId: ctx.run.id,
        ciStepId: stepId,
        source: 'auto'
      },
      // В телеметрии видно ровно то, что ушло в поиск: проза, а за ней код.
      [query.text, kbCodeQuery(query)].filter(Boolean).join('\n')
    )
    try {
      const auto = await buildKbAutoContext(deps.kb, query, {
        ...kbViewOf(deps.db, ctx.run.triggeredBy),
        projectId: ctx.project.id
      }, CI_KB_AUTO_CONTEXT_BUDGET)
      if (!auto.text) {
        usage?.empty(auto.emptyReason ?? 'no-match', auto.bundle.confidence)
        return ''
      }
      usage?.complete({
        deliveredChars: auto.text.length,
        injected: true,
        bundleTokens: auto.bundle.estimatedTokens,
        confidence: auto.bundle.confidence,
        sections: auto.sections
      })
      return auto.text
    } catch (err) {
      usage?.fail(err instanceof Error ? err.message : String(err))
      return ''
    }
  }

  const modelWork: CiModelWorkHook = async (ctx: CiModelContext) => {
    // Публикуем модели команды справочника как инструмент на время шага (лимит
    // maxModelCommandCalls, is_cleanup исключены — иначе модель снесёт себе рабочую
    // директорию). Каждый вызов = вложенный шаг ленты (runCommandById).
    // В том числе команды проверки: их доступность определяется только
    // availableToModel в справочнике проекта. Каждый вызов виден вложенным шагом.
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
        // Вывод команды — тот же контекст, что и у bash: `npm ci` печатает
        // десятки тысяч символов, и они перечитываются до конца хода. В ленте
        // вложенного шага лог остаётся полным, модель получает голову и хвост.
        const trimmed = trimToolOutput(r.output, ciToolOutputLimits(settings).bashChars, MODEL_COMMAND_TRIM_HINT)
        return { output: trimmed.text, exitCode: r.exitCode }
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
    const turnOf = stageRunner(ctx, 'model_work', ctx.parentStepId)

    try {
      return await withKbTools(ctx, ctx.parentStepId, async (kbFields, kbTurnId) => {
        // «Сначала база знаний, потом код»: требование идёт в задании, а блок
        // контекста по теме задачи сервер подмешивает сам (режим `auto`).
        const kbMode = kbModeOf(ctx)
        let prompt = taskPrompt(ctx, phase, deps.db.confirmedDevelopmentReadiness(ctx.task.id))
        const qa = deps.db.getQaTaskState(ctx.run.triggeredBy, ctx.task.projectId, ctx.task.id)
        const fixSession = qa?.sessions.find((session) => session.status === 'failed' && (session.linkedFixRunId === ctx.run.id || session.results.some((result) => result.issue?.linkedFixRunId === ctx.run.id)))
        if (fixSession) {
          const criteria = new Map(qa?.criteria.map((criterion) => [criterion.id, criterion]))
          const feedback = fixSession.results.filter((result) => result.status === 'failed').map((result, index) => {
            const criterion = criteria.get(result.criterionId)
            return `${index + 1}. ${criterion?.title ?? 'Тест'}\nОжидалось: ${result.expectedResult}\nФактически: ${result.actualResult}\nШаги: ${result.executedSteps}\nЗамечание QA: ${result.comment}`
          }).join('\n\n')
          const additional = fixSession.additionalIssues?.trim() ? `\n\nДополнительные баги и недоработки:\n${fixSession.additionalIssues.trim()}` : ''
          prompt += `\n\nПредыдущий результат не прошёл ручное QA. Исправь все замечания:\n${feedback}${additional}`
        }
        if (kbFields.kbMcpUrl) prompt = `${prompt}\n\n${kbRunDirective(kbMode === 'manual' ? 'manual' : 'auto')}`
        prompt = `${prompt}${await kbTaskContext(ctx, kbTurnId, ctx.parentStepId)}`
        if (budget > 0) prompt = `${prompt}\n\n${clarifyHint(budget)}`

        // Страховка от бесконечного цикла: паузы ограничены бюджетом вопросов и
        // числом доработок плана, но верхний предел ходов задаём явно.
        for (let turnNo = 0; turnNo < MAX_MODEL_TURNS; turnNo++) {
          if (ctx.signal.aborted) return { ok: false, cancelled: true }
          // Фаза плана НЕ идёт в CLI-режиме `plan`: он блокирует MCP-инструменты целиком
          // («Cannot call mcp__remote__bash while in plan mode»), а рабочая копия доступна
          // модели только через remote MCP — в плане она оказывалась слепой. Вместо этого
          // `default` с белым списком инструментов (правки файлов CLI отклонит сам) плюс
          // remote-bash в режиме только чтения (`ro=1`) и без команд CI-справочника.
          const req = (model: string): LlmRequest => ({
            userId: ctx.run.triggeredBy,
            prompt,
            sessionId,
            model,
            permissionMode: phase === 'plan' ? 'default' : 'acceptEdits',
            // Инструменты БЗ — ВНЕ ветки `remote`: база read-only и от машины не
            // зависит (в фазе плана и в ходе без машины она тем более нужна).
            ...kbFields,
            // CLI работает внутри server-контейнера; workspace существует на удалённой машине
            // и доступен модели только через remote MCP. Хостовый путь нельзя передавать в spawn cwd.
            ...base,
            ...(phase === 'plan'
              ? {
                  readOnlyRemote: true,
                  // Без ciMcpUrl: команды CI-справочника в фазе плана выключены.
                  ...(base.remote
                    ? {
                        remote: {
                          mcpUrl: `${base.remote.mcpUrl}&ro=1`,
                          agentName: base.remote.agentName,
                          ...(base.remote.projectMachines
                            ? { projectMachines: base.remote.projectMachines }
                            : {})
                        }
                      }
                    : {})
                }
              : {})
          })
          const r = await turnOf(req, log, ctx.signal)
          // Отмена рана: не «ошибка модели» — ран закрывается как cancelled.
          if (r.cancelled || ctx.signal.aborted) return { ok: false, cancelled: true }
          if (!r.ok) return { ok: false }
          // Пробелы базы знаний снимаем с каждого хода: назвать их модель может
          // и в плане, и в ответе на уточнение, а не только в последнем ходе.
          recordKbGaps(ctx, ctx.parentStepId, r.text)
          if (r.sessionId) {
            sessionId = r.sessionId
            // Тот же диалог продолжит fix-loop: он живёт в другом вызове хука.
            ctx.setModelSessionId(sessionId)
          }

          // 1) Уточняющие вопросы — пока есть бюджет.
          const parsed = budget > 0 ? parseQuestions(r.text) : null
          if (parsed) {
            budget -= parsed.questions.length
            const answer = await ctx.askUser(ctx.parentStepId, parsed.questions)
            if (ctx.signal.aborted) return { ok: false, cancelled: true }
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
            prompt = `План одобрен. Реализуй его в рабочей директории. Команды выполняй через доступный инструмент bash.\n${DEVELOPMENT_FAST_GATE_HINT}`
            continue
          }

          // 3) Разработка закончена.
          return { ok: true }
        }
        log('system', `Достигнут предел ходов модели (${MAX_MODEL_TURNS}).\n`)
        return { ok: false }
      })
    } finally {
      ciToolBroker.unregister(token)
    }
  }

  const modelSummary: CiModelSummaryHook = async (ctx: CiModelContext) => {
    const detail = deps.db.getCiRun(ctx.run.triggeredBy, ctx.run.id)
    const stepLines = (detail?.steps ?? []).map((s) => `- ${s.title}: ${s.status}${s.exitCode != null ? ` (код ${s.exitCode})` : ''}`).join('\n')
    // Инструменты БЗ есть и здесь: ход без машины и в режиме «план» — база
    // read-only, а сверить формулировки резюме с ней дешевле, чем угадывать.
    const turnOf = stageRunner(ctx, 'summary', ctx.parentStepId)
    return await withKbTools(ctx, ctx.parentStepId, async (kbFields) => {
      const req = (model: string): LlmRequest => ({
        userId: ctx.run.triggeredBy,
        prompt: `Кратко резюмируй результат воркфлоу по задаче «${ctx.task.title}». Шаги:\n${stepLines}\nДай сжатое резюме: что сделано и в каком состоянии задача.`,
        sessionId: null,
        model,
        permissionMode: 'plan',
        executionDisabled: true,
        ...kbFields,
        ...makeSourcesOf(deps, ctx)
      })
      const r = await turnOf(req, () => {}, ctx.signal)
      return r.text.trim() || 'Резюме недоступно.'
    })
  }

  const attemptFix: CiFixHook = async (ctx: CiFixContext) => {
    const settings = deps.db.getCiSettings()
    const startAll = now()
    const maxFixAttempts = Math.min(Math.max(0, settings.maxFixAttempts), 10)
    let sessionId = ctx.modelSessionId ?? ctx.run.modelSessionId ?? null
    const tailLimit = ctx.isTestStep ? 20_000 : 2000
    let latestLogTail = (ctx.run.fixContext?.logTail || ctx.logTail).slice(-tailLimit)
    let latestStepId = ctx.run.fixContext?.stepId || ctx.failedStep.id
    let failures = parseCiTestFailures(latestLogTail, ctx.failedStep.commandSnapshot)
    const turnOf = stageRunner(ctx, 'fix', ctx.parentStepId)

    for (let attempt = 1; attempt <= maxFixAttempts; attempt++) {
      if (ctx.signal.aborted) return { fixed: false }
      if (settings.fixTimeLimitMs > 0 && now() - startAll > settings.fixTimeLimitMs) break
      const started = now()
      const targetedTests: CiTargetedTestRun[] = []
      const token = randomUUID()
      ciToolBroker.register(token, {
        list: () => [],
        invoke: async () => ({ output: '', exitCode: null, message: 'Обычные команды в fix-loop недоступны.' }),
        runTargetedTests: async (command) => {
          if (targetedTests.length >= MAX_TARGETED_TESTS_PER_ATTEMPT) {
            return { output: '', exitCode: null, timedOut: false, message: `Лимит точечных проверок (${MAX_TARGETED_TESTS_PER_ATTEMPT}) исчерпан.` }
          }
          const result = ctx.runTargetedTest
            ? await ctx.runTargetedTest(command)
            : { command, exitCode: null, timedOut: false, output: 'Инструмент точечных тестов недоступен.' }
          targetedTests.push(result)
          return result
        }
      })
      ctx.setFixContext?.({ stepId: latestStepId, logTail: latestLogTail, failures, updatedAt: now() })

      let turn: TurnResult
      try {
        turn = await withKbTools(ctx, ctx.parentStepId, async (kbFields) => {
          const req = (model: string): LlmRequest => {
            const remote = remoteOf(deps, ctx)
            if (ctx.agentId && remote.remote) remote.remote.ciMcpUrl = `${deps.ciMcpBaseUrl}&run=${token}`
            return {
              userId: ctx.run.triggeredBy,
              prompt: [
                `Упал шаг воркфлоу: «${ctx.failedStep.title}».`,
                ctx.failedStep.commandSnapshot ? `Команда:\n${ctx.failedStep.commandSnapshot}` : '',
                `Свежий шаг падения: ${latestStepId}`,
                `Структурированные ошибки:\n${JSON.stringify(failures, null, 2)}`,
                `Свежий хвост вывода:\n${latestLogTail}`,
                `Рабочая директория: ${ctx.workspacePath}`,
                attempt > 1 ? `Попытка ${attempt} из ${maxFixAttempts}: прошлая правка не прошла полный повтор.` : '',
                '',
                'Кратко поставь диагноз, исправь причину. НЕ ослабляй саму команду ради обхода ошибки.',
                `До полного повтора можешь сделать до ${MAX_TARGETED_TESTS_PER_ATTEMPT} внутренних циклов правка→точечный тест через mcp__ci__run_targeted_tests.`,
                'Инструмент принимает только конкретный test-файл или test name; полный гейт, typecheck, lint и build запрещены.',
                'После завершения хода workflow сам целиком перезапустит упавшую команду.',
                kbFields.kbMcpUrl ? 'Если причина связана с устройством проекта — сверься с базой знаний (mcp__kb__*) до правок.' : '',
                kbFields.kbMcpUrl ? KB_GAPS_HINT : ''
              ].filter(Boolean).join('\n'),
              sessionId,
              model,
              permissionMode: 'acceptEdits',
              ...kbFields,
              ...remote
            }
          }
          return turnOf(req, (stream, chunk) => ctx.log(ctx.parentStepId, stream, chunk), ctx.signal)
        })
      } finally {
        ciToolBroker.unregister(token)
      }

      recordKbGaps(ctx, ctx.parentStepId, turn.text)
      if (turn.sessionId) {
        sessionId = turn.sessionId
        ctx.setModelSessionId(sessionId)
      }
      if (turn.cancelled || ctx.signal.aborted) return { fixed: false }
      const diagnosis = turn.text.split('\n').find((line) => line.trim())?.slice(0, 200) ?? ''
      const changedFiles = ctx.listChangedFiles ? await ctx.listChangedFiles() : []
      const rr = await ctx.rerunFailedStep()
      const rerunStepId = rr.stepId ?? latestStepId
      const rerunOutput = rr.output ?? latestLogTail
      const fixed = rr.exitCode === 0
      ctx.recordFix({
        runStepId: ctx.failedStep.id,
        attemptNo: attempt,
        diagnosis,
        action: targetedTests.length ? `Правки и точечных проверок: ${targetedTests.length}` : 'Правки в рабочей директории',
        result: fixed ? 'fixed' : attempt >= maxFixAttempts ? 'gave_up' : 'retrying',
        changedFiles,
        targetedTests,
        fullRerun: { stepId: rerunStepId, exitCode: rr.exitCode, timedOut: rr.timedOut },
        failures,
        durationMs: now() - started
      })
      if (fixed) {
        ctx.setFixContext?.(null)
        return { fixed: true }
      }
      latestStepId = rerunStepId
      latestLogTail = rerunOutput.slice(-tailLimit)
      failures = parseCiTestFailures(latestLogTail, ctx.failedStep.commandSnapshot)
      ctx.setFixContext?.({ stepId: latestStepId, logTail: latestLogTail, failures, updatedAt: now() })
    }
    return { fixed: false }
  }

  /**
   * Шаг «Актуализировать базу знаний» (слот «после модели», до коммита в ветку
   * задачи). Диф собирает сервер, а не модель: список изменённых путей нужен,
   * чтобы выбрать задетые статьи по `areas`, и чтобы объём был капнут заранее.
   * Дальше — один ход модели с remote-bash в рабочей копии: файловые темы
   * `docs/kb/*.md` она правит сама (их закоммитит следующий шаг воркфлоу),
   * статьи раздела проекта возвращает текстом, и записывает их сервер.
   *
   * Хук никогда не бросает: работа модели к этому моменту уже сделана, и терять
   * ран из-за базы знаний нельзя — любая беда превращается в `ok: false`,
   * то есть в предупреждение в ленте.
   */
  const kbUpdate: CiKbUpdateHook = async (ctx: CiModelContext) => {
    const log = (chunk: string): void => ctx.log(ctx.parentStepId, 'system', chunk)
    const cancelled = { ok: true, message: 'Ран отменён — база знаний не обновлялась' }
    if (ctx.signal.aborted) return cancelled

    // В примитивах CI `workspacePath` уже является корнем клона (`repoPath`).
    // Не добавляем сюда SLUG повторно: так remote MCP получал путь
    // `.../<slug>/<slug>`, которого на машине нет, а модель отвечала
    // `nothingToUpdate`, маскируя инфраструктурную ошибку под успех.
    const repoDir = ctx.workspacePath
    if (ctx.agentId && deps.executor) {
      try {
        const check = await deps.executor.run(
          { agentId: ctx.agentId, script: KB_REPO_ROOT_CHECK_SCRIPT, workdir: repoDir, env: ctx.env, timeoutMs: 30_000 },
          () => {},
          ctx.signal
        )
        if (check.exitCode !== 0) {
          return { ok: false, message: 'Корень рабочей копии KB недоступен — база знаний не обновлена' }
        }
      } catch (err) {
        return { ok: false, message: `Корень рабочей копии KB недоступен: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
    if (ctx.signal.aborted) return cancelled

    let changes = { ...EMPTY_CHANGES }
    if (ctx.agentId && deps.executor) {
      const chunks: string[] = []
      try {
        await deps.executor.run(
          { agentId: ctx.agentId, script: KB_DIFF_SCRIPT, workdir: repoDir, env: ctx.env, timeoutMs: 120_000 },
          (d) => chunks.push(d),
          ctx.signal
        )
        changes = parseDiffBundle(chunks.join(''))
      } catch (err) {
        log(`Диф собрать не удалось: ${err instanceof Error ? err.message : String(err)}\n`)
      }
    }
    if (ctx.signal.aborted) return cancelled
    if (changes.unavailable) return { ok: false, message: 'Диф рабочей копии собрать не удалось — база знаний не обновлена' }
    // Пробелы базы знаний — вторая причина этого шага, наравне с дифом: ран без
    // правок кода мог быть исследованием, у которого база знаний не ответила, и
    // найденный в коде ответ обязан остаться в базе.
    const gaps = collectKbGaps(ctx)
    if (!changes.files.length && !gaps.length) return { ok: true, message: 'Нечего обновлять: изменений кода в ветке задачи нет' }
    if (changes.files.length) log(`Изменённых файлов: ${changes.files.length}.\n`)
    if (gaps.length) log(`Пробелов базы знаний за ран: ${gaps.length}.\n`)

    const projectDocs = deps.db.kbDocuments({ scope: 'project', projectId: ctx.project.id })
    const affected = affectedProjectDocs(projectDocs, changes.files)
    const req = (model: string): LlmRequest => ({
      userId: ctx.run.triggeredBy,
      prompt: kbUpdatePrompt({
        projectName: ctx.project.name,
        workdir: repoDir,
        taskTitle: ctx.task.title,
        taskDescription: ctx.task.description,
        baseLabel: `базовая ветка ${ctx.env.BASE_BRANCH ?? 'main'}`,
        changes,
        affected,
        editFileTopics: !!ctx.agentId,
        gaps
      }),
      sessionId: null,
      model,
      permissionMode: 'acceptEdits',
      ...(ctx.agentId
        ? {
            remote: {
              mcpUrl: `${deps.mcpBaseUrl}&agent=${encodeURIComponent(ctx.agentId)}&cwd=${encodeURIComponent(repoDir)}`,
              agentName: deps.agentNameOf(ctx.agentId) ?? ctx.agentId
            }
          }
        : { executionDisabled: true }),
      ...makeSourcesOf(deps, ctx)
    })

    // Таймаут шага: свой контроллер поверх сигнала рана, чтобы отличать «не
    // уложился» от «ран отменили» — сообщения в ленте у них разные.
    const ctl = new AbortController()
    let timedOut = false
    const onAbort = (): void => ctl.abort()
    ctx.signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      ctl.abort()
    }, deps.kbTimeoutMs ?? KB_UPDATE_TIMEOUT_MS)
    const timeoutResult = async (repair: boolean): Promise<{ ok: boolean; message: string }> => {
      const topics: string[] = []
      if (ctx.agentId && deps.executor && !ctx.signal.aborted) {
        try {
          await deps.executor.run(
            { agentId: ctx.agentId, script: KB_FILE_TOPICS_SCRIPT, workdir: repoDir, env: ctx.env, timeoutMs: 30_000 },
            (chunk) => topics.push(...chunk.split('\n').map((p) => p.trim()).filter((p) => p.startsWith('docs/kb/'))),
            ctx.signal
          )
        } catch {
          // Таймаут уже известен; диагностическая проверка не меняет его исход.
        }
      }
      const changedTopics = [...new Set(topics)]
      const timeoutMessage = repair
        ? 'Repair финального ответа не завершён до таймаута'
        : 'Модель не вернула финальный ответ до таймаута'
      if (changedTopics.length) {
        return {
          ok: true,
          message: `${timeoutMessage}; файловые темы базы знаний обновлены (${changedTopics.join(', ')}), статьи раздела проекта не сохранены`
        }
      }
      return { ok: false, message: repair ? timeoutMessage : 'Шаг не уложился в отведённое время — файловые темы базы знаний не изменены' }
    }

    const runStageTurn = stageRunner(ctx, 'kb_update', ctx.parentStepId)
    let out
    let repairRecovered = false
    try {
      const turn = await runStageTurn(
        req,
        (stream, chunk) => ctx.log(ctx.parentStepId, stream, chunk),
        ctl.signal,
        'Шаг актуализации базы знаний остановлен.\n'
      )
      if (timedOut) return await timeoutResult(false)
      if (ctx.signal.aborted) return cancelled
      if (!turn.ok) return { ok: false, message: 'Модель не ответила — база знаний не обновлена' }

      try {
        out = parseKbUpdateOutput(turn.text)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        const code = err instanceof KbUpdateParseError ? err.code : 'unknown'
        log(`Финальный ответ kb_update отклонён [${code}]: ${detail}\n`)
        const repairable = err instanceof KbUpdateParseError
          && (err.code === 'json_not_found' || err.code === 'invalid_json' || err.code === 'invalid_contract')
        if (!repairable) {
          const message = err instanceof KbUpdateParseError && err.code === 'ambiguous_json'
            ? 'В ответе модели несколько JSON-кандидатов — статьи раздела проекта не сохранены'
            : 'Ответ модели неразборчив — статьи раздела проекта не сохранены'
          log('Repair финального JSON не запускается; merge остановлен.\n')
          return { ok: false, message }
        }
        if (!turn.sessionId) {
          log('Repair финального JSON не запущен: sessionId отсутствует; merge остановлен.\n')
          return { ok: false, message: 'Repair финального ответа не выполнен: сессия модели недоступна' }
        }

        log(`Запускаю repair финального JSON; sessionId доступен.\n`)
        const repairStartedAt = now()
        const repaired = await runStageTurn(
          (model) => ({
            userId: ctx.run.triggeredBy,
            prompt: KB_UPDATE_REPAIR_PROMPT,
            sessionId: turn.sessionId,
            model,
            permissionMode: 'plan',
            executionDisabled: true
          }),
          (stream, chunk) => {
            // Финальный текст не дублируем в пользовательскую ленту; системная
            // активность остаётся в техническом логе.
            if (stream === 'system') ctx.log(ctx.parentStepId, stream, chunk)
          },
          ctl.signal,
          'Repair финального ответа остановлен.\n',
          false
        )
        log(`Repair финального JSON завершил ход за ${Math.max(0, now() - repairStartedAt)} мс.\n`)
        if (timedOut) {
          log('Repair финального JSON не завершён до общего таймаута; merge остановлен.\n')
          return await timeoutResult(true)
        }
        if (ctx.signal.aborted) return cancelled
        if (!repaired.ok) {
          log('Repair финального JSON завершился ошибкой транспорта; merge остановлен.\n')
          return { ok: false, message: 'Модель повторно не вернула корректный JSON — статьи раздела проекта не сохранены' }
        }
        try {
          out = parseKbUpdateOutput(repaired.text)
        } catch (repairErr) {
          const repairDetail = repairErr instanceof Error ? repairErr.message : String(repairErr)
          const repairCode = repairErr instanceof KbUpdateParseError ? repairErr.code : 'unknown'
          log(`Repair финального JSON отклонён [${repairCode}]: ${repairDetail}; merge остановлен.\n`)
          return { ok: false, message: 'Модель повторно не вернула корректный JSON — статьи раздела проекта не сохранены' }
        }
        repairRecovered = true
        log('Repair финального JSON успешно восстановил ответ.\n')
      }
    } catch (err) {
      return { ok: false, message: `Шаг не выполнен: ${err instanceof Error ? err.message : String(err)}` }
    } finally {
      clearTimeout(timer)
      ctx.signal.removeEventListener('abort', onAbort)
    }
    // Раздел и владелец статьи — дело сервера: чужой id молча становится новой
    // статьёй, раздел всегда `project` (видна только участникам проекта).
    const own = new Set(projectDocs.map((doc) => doc.id))
    const today = new Date(now()).toISOString().slice(0, 10)
    const saved = out.documents.map((item) => {
      const id = item.id && own.has(item.id) ? item.id : null
      const doc = deps.db.saveKbDocument({
        id,
        scope: 'project',
        projectId: ctx.project.id,
        title: item.title,
        body: item.body,
        kind: item.kind,
        tags: item.tags,
        areas: item.areas,
        checkedOn: today,
        createdBy: ctx.run.triggeredBy
      })
      return { title: doc.title, action: id ? ('updated' as const) : ('created' as const) }
    })
    const summary = formatKbUpdateSummary(out, saved)
    return { ok: true, message: repairRecovered ? `Финальный JSON восстановлен дополнительным запросом. ${summary}` : summary }
  }

  const conflictFixForMerge = async (args: { run: import('@voicechat/shared').MergeRun; repo: string; conflicts: string[]; signal: AbortSignal; log(chunk:string):void }): Promise<{ ok:boolean; message:string; llmEngineId:string|null; llmProvider:'claude'|'codex'; llmModel:string }> => {
    const project = deps.db.getProject(args.run.triggeredBy, args.run.projectId)
    const task = deps.db.getCiTask(args.run.triggeredBy, args.run.projectId, args.run.taskId)
    const development = deps.db.findLatestCiRunForTask(args.run.projectId, args.run.taskId)
    const llm = { llmEngineId:args.run.llmEngineId, provider:args.run.llmProvider, model:args.run.llmModel }
    if (!project || !task || !development) return { ok:false, message:'Контекст development-рана для исправления конфликтов недоступен', llmEngineId:llm.llmEngineId, llmProvider:llm.provider, llmModel:llm.model }
    const noop = (): never => { throw new Error('Операция development CI недоступна в merge conflict_fix') }
    const ctx = {
      runId:development.id, agentId:args.run.agentId, workspacePath:args.repo,
      env:{BASE_BRANCH:'main'}, signal:args.signal, addStep:noop, finishStep:noop,
      log:(_stepId:string,_stream:'stdout'|'stderr'|'system',chunk:string)=>args.log(chunk),
      runCommandById:noop, setModelSessionId:()=>{}, recordFix:noop, suggest:noop,
      askUser:noop, askPlanApproval:noop,
      run:{...development,llmEngineId:llm.llmEngineId,llmProvider:llm.provider,llmModel:llm.model},
      task, project, parentStepId:'merge-conflict-fix'
    } as unknown as CiModelContext
    const request=(model:string):LlmRequest=>({
      userId:args.run.triggeredBy,
      prompt:[
        'Дополнительный шаг CI: исправь Git-конфликты текущего merge в рабочей копии.',
        `Задача: ${task.title}`,
        task.description?`Описание: ${task.description}`:'',
        task.acceptanceCriteria?`Критерии приёмки: ${task.acceptanceCriteria}`:'',
        `Конфликтующие файлы: ${args.conflicts.join(', ')}`,
        'Изучи обе стороны и общий предок, сохрани совместимое поведение обеих веток. Удали все конфликтные маркеры и проиндексируй исправленные файлы через git add.',
        'Не выполняй git merge --abort, commit, push, reset, checkout другой ветки или очистку рабочей копии. Не расширяй задачу и не меняй файлы без необходимости.',
        'Перед завершением проверь git diff --name-only --diff-filter=U. Сервер независимо проверит результат и создаст merge-коммит.'
      ].filter(Boolean).join('\\n'),
      sessionId:null, model, permissionMode:'acceptEdits',
      remote:{mcpUrl:`${deps.mcpBaseUrl}&agent=${encodeURIComponent(args.run.agentId)}&cwd=${encodeURIComponent(args.repo)}`,agentName:deps.agentNameOf(args.run.agentId)??args.run.agentId}
    })
    try {
      const turn=await stageRunner(ctx,'fix','merge-conflict-fix')(request,(_stream,chunk)=>args.log(chunk),args.signal,'Исправление конфликтов остановлено.\\n')
      return {llmEngineId:llm.llmEngineId,llmProvider:llm.provider,llmModel:llm.model,ok:turn.ok&&!turn.cancelled,message:turn.ok?'Дополнительный шаг исправления конфликтов завершён':'Модель не смогла исправить конфликты'}
    } catch(error) {
      return {llmEngineId:llm.llmEngineId,llmProvider:llm.provider,llmModel:llm.model,ok:false,message:`Шаг исправления конфликтов не выполнен: ${error instanceof Error?error.message:String(error)}`}
    }
  }

  const kbUpdateForMerge = async (args: { run: import('@voicechat/shared').MergeRun; repo: string; targetRef: string; signal: AbortSignal; log(chunk:string):void }): Promise<{ ok:boolean; message:string; llmEngineId:string|null; llmProvider:'claude'|'codex'; llmModel:string }> => {
    const project = deps.db.getProject(args.run.triggeredBy, args.run.projectId)
    const task = deps.db.getCiTask(args.run.triggeredBy, args.run.projectId, args.run.taskId)
    const development = deps.db.findLatestCiRunForTask(args.run.projectId, args.run.taskId)
    if (!project || !task || !development) return { ok:false, message:'Контекст development-рана для БЗ недоступен', llmEngineId:null, llmProvider:'claude', llmModel:'' }
    // Merge-ран получает разрешённую фактическую конфигурацию до создания записи.
    // Здесь используется именно этот неизменяемый снимок: повторное чтение настроек
    // могло бы запустить одну модель, а в исторической ленте сохранить другую.
    const llm = {
      llmEngineId: args.run.llmEngineId,
      provider: args.run.llmProvider,
      model: args.run.llmModel
    }
    const noop = (): never => { throw new Error('Операция development CI недоступна в merge kb_update') }
    const ctx = {
      runId: development.id,
      agentId: args.run.agentId,
      workspacePath: args.repo,
      env: { BASE_BRANCH:'main', KB_BASE_REF:args.targetRef },
      signal: args.signal,
      addStep: noop,
      finishStep: noop,
      log: (_stepId:string,_stream:'stdout'|'stderr'|'system',chunk:string) => args.log(chunk),
      runCommandById: noop,
      setModelSessionId: () => {},
      recordFix: noop,
      suggest: noop,
      askUser: noop,
      askPlanApproval: noop,
      run: { ...development, llmEngineId:llm.llmEngineId, llmProvider:llm.provider, llmModel:llm.model },
      task,
      project,
      parentStepId: 'merge-kb-update'
    } as unknown as CiModelContext
    const result = await kbUpdate(ctx)
    return { ...result, llmEngineId:llm.llmEngineId, llmProvider:llm.provider, llmModel:llm.model }
  }

  return { modelWork, modelSummary, attemptFix, kbUpdate, conflictFixForMerge, kbUpdateForMerge }
}

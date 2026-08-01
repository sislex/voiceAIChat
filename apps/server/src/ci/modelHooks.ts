// Хуки «модель в цикле» для CI-раннера: работа модели (разработка в рабочей
// директории на машине), резюме воркфлоу и fix-loop (диагноз → правка → повтор
// упавшего шага). Реализованы поверх инъектируемого LlmClient (в тестах — мок).

import { randomUUID } from 'node:crypto'
import type { LlmClient, LlmHandle, LlmRequest, LlmStreamHandlers } from '../claude/types.js'
import { appendQuestionsHint, clarifyBudget, DEFAULT_CI_CLAUDE_MODEL, parseQuestions } from '@voicechat/shared'
import type { CiRunMode } from '@voicechat/shared'
import { ciToolBroker } from './ciCommandsMcp.js'
import type { VoiceChatDb } from '../db/database.js'
import type { CommandExecutor, CiModelContext, CiFixContext, CiModelWorkHook, CiModelSummaryHook, CiFixHook, CiKbUpdateHook } from './types.js'
import {
  EMPTY_CHANGES, KB_DIFF_SCRIPT, KB_UPDATE_TIMEOUT_MS, affectedProjectDocs, formatKbUpdateSummary,
  kbUpdatePrompt, parseDiffBundle, parseKbUpdateOutput
} from '../kb/codeUpdate.js'

export interface CiModelHooksDeps {
  db: VoiceChatDb
  claude: LlmClient
  codex: LlmClient
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
  abortNote = 'Ран отменён — работа модели остановлена.\n'
): Promise<{ ok: boolean; text: string; sessionId: string | null; cancelled?: boolean }> {
  if (signal.aborted) return Promise.resolve({ ok: false, text: '', sessionId: null, cancelled: true })
  return new Promise((resolve) => {
    let text = ''
    let sessionId: string | null = null
    let settled = false
    const finish = (r: { ok: boolean; cancelled?: boolean }): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve({ ...r, text, sessionId })
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
      onDone: () => finish({ ok: true }),
      onError: (m) => {
        onLog('system', `Ошибка модели: ${m}\n`)
        finish({ ok: false })
      },
      onActivity: (e) => onLog('system', `[${e.kind}] ${e.summary}\n`)
    }
    const handle: LlmHandle | undefined = claude.send(req, handlers)
    // Отмена могла прийти пока клиент стартовал — тогда гасим ход сразу.
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
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
    : [
        'Реализуй задачу в рабочей директории. Команды выполняй через доступный инструмент bash.',
        `Готовую работу коммить в ветку ${ctx.env.BRANCH ?? ''} — пушить не нужно: раннер сам отправит её в origin перед очисткой рабочей директории.`
      ]
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
  kbUpdate: CiKbUpdateHook
} {
  const now = deps.now ?? (() => Date.now())
  const clientFor = (ctx: CiModelContext): LlmClient => ctx.run.llmProvider === 'codex' ? deps.codex : deps.claude
  const modelFor = (ctx: CiModelContext): string => ctx.run.llmProvider === 'codex' ? ctx.run.llmModel : (ctx.run.llmModel || DEFAULT_CI_CLAUDE_MODEL)

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
        if (ctx.signal.aborted) return { ok: false, cancelled: true }
        // Фаза плана НЕ идёт в CLI-режиме `plan`: он блокирует MCP-инструменты целиком
        // («Cannot call mcp__remote__bash while in plan mode»), а рабочая копия доступна
        // модели только через remote MCP — в плане она оказывалась слепой. Вместо этого
        // `default` с белым списком инструментов (правки файлов CLI отклонит сам) плюс
        // remote-bash в режиме только чтения (`ro=1`) и без команд CI-справочника.
        const req: LlmRequest = {
          userId: ctx.run.triggeredBy,
          prompt,
          sessionId,
          model: modelFor(ctx),
          permissionMode: phase === 'plan' ? 'default' : 'acceptEdits',
          // CLI работает внутри server-контейнера; workspace существует на удалённой машине
          // и доступен модели только через remote MCP. Хостовый путь нельзя передавать в spawn cwd.
          ...base,
          ...(phase === 'plan'
            ? {
                readOnlyRemote: true,
                ...(base.remote
                  ? { remote: { mcpUrl: `${base.remote.mcpUrl}&ro=1`, agentName: base.remote.agentName } }
                  : {})
              }
            : {})
        }
        const r = await runTurn(clientFor(ctx), req, log, ctx.signal)
        // Отмена рана: не «ошибка модели» — ран закрывается как cancelled.
        if (r.cancelled || ctx.signal.aborted) return { ok: false, cancelled: true }
        if (!r.ok) return { ok: false }
        if (r.sessionId) sessionId = r.sessionId

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
    const r = await runTurn(clientFor(ctx), req, () => {}, ctx.signal)
    return r.text.trim() || 'Резюме недоступно.'
  }

  const attemptFix: CiFixHook = async (ctx: CiFixContext) => {
    const settings = deps.db.getCiSettings()
    const startAll = now()
    for (let attempt = 1; attempt <= settings.maxFixAttempts; attempt++) {
      if (ctx.signal.aborted) return { fixed: false }
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
      const turn = await runTurn(clientFor(ctx), req, (stream, chunk) => ctx.log(ctx.parentStepId, stream, chunk), ctx.signal)
      if (turn.cancelled || ctx.signal.aborted) return { fixed: false }
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

    let changes = { ...EMPTY_CHANGES }
    if (ctx.agentId && deps.executor) {
      const chunks: string[] = []
      try {
        await deps.executor.run(
          { agentId: ctx.agentId, script: KB_DIFF_SCRIPT, workdir: ctx.workspacePath, env: ctx.env, timeoutMs: 120_000 },
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
    if (!changes.files.length) return { ok: true, message: 'Нечего обновлять: изменений кода в ветке задачи нет' }
    log(`Изменённых файлов: ${changes.files.length}.\n`)

    // Рабочая копия лежит в подкаталоге $SLUG рабочей директории рана: команды
    // базы знаний (`kb.mjs touch`, `kb:index`) запускаются из корня репозитория.
    const repoDir = ctx.env.SLUG ? `${ctx.workspacePath}/${ctx.env.SLUG}` : ctx.workspacePath
    const projectDocs = deps.db.kbDocuments({ scope: 'project', projectId: ctx.project.id })
    const affected = affectedProjectDocs(projectDocs, changes.files)
    const req: LlmRequest = {
      userId: ctx.run.triggeredBy,
      prompt: kbUpdatePrompt({
        projectName: ctx.project.name,
        workdir: repoDir,
        taskTitle: ctx.task.title,
        taskDescription: ctx.task.description,
        baseLabel: `базовая ветка ${ctx.env.BASE_BRANCH ?? 'main'}`,
        changes,
        affected,
        editFileTopics: !!ctx.agentId
      }),
      sessionId: null,
      model: modelFor(ctx),
      permissionMode: 'acceptEdits',
      ...(ctx.agentId
        ? {
            remote: {
              mcpUrl: `${deps.mcpBaseUrl}&agent=${encodeURIComponent(ctx.agentId)}&cwd=${encodeURIComponent(repoDir)}`,
              agentName: deps.agentNameOf(ctx.agentId) ?? ctx.agentId
            }
          }
        : { executionDisabled: true })
    }

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
    let turn: { ok: boolean; text: string }
    try {
      turn = await runTurn(clientFor(ctx), req, (stream, chunk) => ctx.log(ctx.parentStepId, stream, chunk), ctl.signal, 'Шаг актуализации базы знаний остановлен.\n')
    } catch (err) {
      return { ok: false, message: `Шаг не выполнен: ${err instanceof Error ? err.message : String(err)}` }
    } finally {
      clearTimeout(timer)
      ctx.signal.removeEventListener('abort', onAbort)
    }
    if (timedOut) return { ok: false, message: 'Шаг не уложился в отведённое время — база знаний не обновлена' }
    if (ctx.signal.aborted) return cancelled
    if (!turn.ok) return { ok: false, message: 'Модель не ответила — база знаний не обновлена' }

    let out
    try {
      out = parseKbUpdateOutput(turn.text)
    } catch {
      return { ok: false, message: 'Ответ модели неразборчив — статьи раздела проекта не сохранены' }
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
    return { ok: true, message: formatKbUpdateSummary(out, saved) }
  }

  return { modelWork, modelSummary, attemptFix, kbUpdate }
}
